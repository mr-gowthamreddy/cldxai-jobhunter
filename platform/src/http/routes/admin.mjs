import { Router } from 'express';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.mjs';
import { logAdmin, logSystemError } from '../../lib/activity.mjs';
import { getSetting, setSetting, parseJson } from '../../db/index.mjs';
import { DEFAULT_EXPERIENCE_BANDS } from '../../lib/job-analyzer.mjs';
import { CATEGORIES } from '../../lib/taxonomy.mjs';
import { schedulerStatus, postFetchHooks } from '../../services/scheduler.mjs';
import { runFetch, fetchSourceJobs, resolveSourceProvider, listProviderIds, isFetchRunning } from '../../services/fetcher.mjs';
import { checkLink } from '../../services/link-verifier.mjs';
import { syncJobsToSheet, sheetsConfigProblem } from '../../services/sheets.mjs';
import { notify } from '../../services/notifications.mjs';
import { mailConfigured } from '../../lib/mailer.mjs';
import { ah, HttpError, str, idParam, oneOf, httpUrl, paginate, clientIp } from '../util.mjs';

export function adminRoutes(getDb) {
  const r = Router();
  const audit = (req, action, targetType, targetId, details) => logAdmin(getDb(), { actorId: req.user.id, action, targetType, targetId, details, ip: clientIp(req) });

  r.get('/overview', ah(async (req, res) => {
    const db = getDb();
    const one = (sql, ...p) => db.prepare(sql).get(...p);
    const users = one(`SELECT COUNT(*) total, SUM(status='active') active, SUM(status='pending') pending, SUM(status='disabled') disabled,
      SUM(created_at >= datetime('now','-7 days')) new_week FROM users`);
    const resumes = one('SELECT COUNT(*) total, COALESCE(SUM(size_bytes),0) bytes, SUM(parse_status = \'failed\') failed FROM resumes');
    const jobs = one(`SELECT COUNT(*) total, SUM(status='active') active, SUM(status='expired') expired, SUM(status='duplicate') duplicate,
      SUM(status='broken') broken, SUM(status='active' AND work_arrangement='Unspecified') unspecified,
      SUM(status='active' AND link_status='unverified') unverified, SUM(first_seen_at >= datetime('now','-1 day')) new_day FROM jobs`);
    const visible = one(`SELECT COUNT(*) n FROM jobs j WHERE j.status='active' AND j.duplicate_of IS NULL AND j.work_arrangement IN ('Remote','Hybrid','WFO') AND j.link_status IN ('source_confirmed','verified')`).n;
    const sources = one("SELECT COUNT(*) total, SUM(enabled) enabled, SUM(last_status = 'error') failing FROM job_sources");
    const runs = db.prepare('SELECT id, trigger, started_at, finished_at, status, jobs_new, jobs_expired, jobs_updated, sources_failed, sources_total FROM fetch_runs ORDER BY id DESC LIMIT 14').all().reverse();
    const byArrangement = db.prepare("SELECT work_arrangement k, COUNT(*) n FROM jobs WHERE status='active' AND duplicate_of IS NULL GROUP BY work_arrangement").all();
    const bySource = db.prepare("SELECT s.name k, COUNT(*) n FROM jobs j JOIN job_sources s ON s.id = j.source_id WHERE j.status='active' GROUP BY s.name ORDER BY n DESC LIMIT 12").all();
    const lastSheets = db.prepare('SELECT * FROM sheets_sync_logs ORDER BY id DESC LIMIT 1').get();
    const errors = one("SELECT COUNT(*) n FROM system_errors WHERE created_at >= datetime('now','-1 day')").n
      + one("SELECT COUNT(*) n FROM fetch_logs WHERE level='error' AND created_at >= datetime('now','-1 day')").n;
    res.json({
      users, resumes, jobs: { ...jobs, visible }, sources, runs,
      by_arrangement: byArrangement, by_source: bySource,
      scheduler: schedulerStatus(db),
      sheets: { problem: sheetsConfigProblem(), last: lastSheets || null },
      mail: { configured: mailConfigured() },
      errors_24h: errors,
    });
  }));

  // ---- Users ----
  r.get('/users', ah(async (req, res) => {
    const db = getDb();
    const { page, size, offset } = paginate(req.query, { defaultSize: 25 });
    const where = []; const params = [];
    if (req.query.q) { where.push('(u.email LIKE ? OR u.full_name LIKE ?)'); const q = `%${String(req.query.q).slice(0, 100)}%`; params.push(q, q); }
    if (['active', 'pending', 'disabled'].includes(req.query.status)) { where.push('u.status = ?'); params.push(req.query.status); }
    if (['user', 'admin'].includes(req.query.role)) { where.push('r.name = ?'); params.push(req.query.role); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id ${w}`).get(...params).n;
    const rows = db.prepare(`SELECT u.id, u.email, u.full_name, u.status, u.is_verified, u.created_at, u.last_login_at, r.name AS role,
        (SELECT COUNT(*) FROM resumes WHERE user_id = u.id) AS resumes,
        (SELECT COUNT(*) FROM applications WHERE user_id = u.id) AS applications,
        (SELECT COUNT(*) FROM saved_jobs WHERE user_id = u.id) AS saved_jobs
      FROM users u JOIN roles r ON r.id = u.role_id ${w} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    res.json({ total, page, page_size: size, items: rows.map((u) => ({ ...u, is_verified: Boolean(u.is_verified) })) });
  }));

  function activeAdminCount(db) {
    return db.prepare("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active'").get().n;
  }

  r.patch('/users/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const user = db.prepare('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id);
    if (!user) throw new HttpError(404, 'User not found');
    const b = req.body || {};
    const changes = {};
    if (b.status !== undefined) changes.status = oneOf(b.status, ['active', 'pending', 'disabled'], 'status');
    if (b.role !== undefined) changes.role = oneOf(b.role, ['user', 'admin'], 'role');
    if (b.is_verified !== undefined) changes.is_verified = b.is_verified ? 1 : 0;
    const losesAdmin = user.role === 'admin' && user.status === 'active' && ((changes.role && changes.role !== 'admin') || (changes.status && changes.status !== 'active'));
    if (losesAdmin && activeAdminCount(db) <= 1) throw new HttpError(400, 'At least one active administrator must remain.');
    if (id === req.user.id && (changes.status === 'disabled' || changes.role === 'user')) throw new HttpError(400, 'You cannot deactivate or demote your own account here.');
    if (changes.status) {
      db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(changes.status, id);
      if (changes.status !== 'active') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      if (changes.status === 'active' && user.status === 'pending') notify(db, id, { type: 'account', title: 'Your account was approved', body: 'You can now use every Career-Ops feature.' });
    }
    if (changes.role) db.prepare("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = ?), updated_at = datetime('now') WHERE id = ?").run(changes.role, id);
    if (changes.is_verified !== undefined) db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').run(changes.is_verified, id);
    audit(req, 'user_updated', 'user', id, changes);
    res.json({ ok: true });
  }));

  r.post('/users/:id/revoke-sessions', ah(async (req, res) => {
    const id = idParam(req.params.id);
    getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(req, 'sessions_revoked', 'user', id, {});
    res.json({ ok: true });
  }));

  r.delete('/users/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'Use account settings to delete your own account.');
    const user = db.prepare('SELECT u.email, r.name AS role, u.status FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(id);
    if (!user) throw new HttpError(404, 'User not found');
    if (user.role === 'admin' && user.status === 'active' && activeAdminCount(db) <= 1) throw new HttpError(400, 'At least one active administrator must remain.');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    rmSync(path.join(config.uploadDir, String(id)), { recursive: true, force: true });
    audit(req, 'user_deleted', 'user', id, { email: user.email });
    res.json({ ok: true });
  }));

  r.get('/activity', ah(async (req, res) => {
    const db = getDb();
    const userId = req.query.user_id ? idParam(req.query.user_id) : null;
    const userActivity = db.prepare(`SELECT a.id, a.user_id, u.email, a.action, a.details, a.ip, a.created_at FROM user_activity a LEFT JOIN users u ON u.id = a.user_id
      ${userId ? 'WHERE a.user_id = ?' : ''} ORDER BY a.id DESC LIMIT 200`).all(...(userId ? [userId] : []));
    const adminActivity = db.prepare(`SELECT a.id, a.actor_id, u.email AS actor_email, a.action, a.target_type, a.target_id, a.details, a.created_at FROM admin_activity a
      LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 200`).all();
    res.json({ user_activity: userActivity.map((a) => ({ ...a, details: parseJson(a.details, {}) })), admin_activity: adminActivity.map((a) => ({ ...a, details: parseJson(a.details, {}) })) });
  }));

  // Resume monitoring: counts and metadata only — never file contents or parsed text.
  r.get('/resumes', ah(async (req, res) => {
    const db = getDb();
    const byType = db.prepare('SELECT file_ext, COUNT(*) n, SUM(size_bytes) bytes FROM resumes GROUP BY file_ext').all();
    const byStatus = db.prepare('SELECT parse_status, COUNT(*) n FROM resumes GROUP BY parse_status').all();
    const daily = db.prepare("SELECT date(created_at) d, COUNT(*) n FROM resumes WHERE created_at >= date('now','-30 days') GROUP BY d ORDER BY d").all();
    const perUser = db.prepare('SELECT u.id, u.email, COUNT(r.id) n, MAX(r.created_at) last_upload FROM users u LEFT JOIN resumes r ON r.user_id = u.id GROUP BY u.id HAVING n > 0 ORDER BY n DESC LIMIT 50').all();
    res.json({ by_type: byType, by_status: byStatus, daily, per_user: perUser, max_upload_mb: config.maxUploadMb });
  }));

  // ---- Jobs ----
  r.get('/jobs', ah(async (req, res) => {
    const db = getDb();
    const { page, size, offset } = paginate(req.query, { defaultSize: 50 });
    const where = []; const params = [];
    if (['active', 'expired', 'closed', 'broken', 'duplicate'].includes(req.query.status)) { where.push('j.status = ?'); params.push(req.query.status); }
    if (['Remote', 'Hybrid', 'WFO', 'Unspecified'].includes(req.query.arrangement)) { where.push('j.work_arrangement = ?'); params.push(req.query.arrangement); }
    if (['source_confirmed', 'verified', 'unverified', 'broken', 'expired'].includes(req.query.link_status)) { where.push('j.link_status = ?'); params.push(req.query.link_status); }
    if (req.query.source) { where.push('j.source_id = ?'); params.push(Number(req.query.source)); }
    if (req.query.q) { where.push('(j.title LIKE ? OR j.company LIKE ?)'); const q = `%${String(req.query.q).slice(0, 100)}%`; params.push(q, q); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) n FROM jobs j ${w}`).get(...params).n;
    const rows = db.prepare(`SELECT j.id, j.title, j.company, j.location, j.work_arrangement, j.status, j.link_status, j.link_check_note, j.apply_url, j.is_direct,
      j.duplicate_of, j.first_seen_at, j.last_seen_at, j.posted_at, j.missed_fetches, s.name AS source_name FROM jobs j LEFT JOIN job_sources s ON s.id = j.source_id ${w}
      ORDER BY j.last_seen_at DESC LIMIT ? OFFSET ?`).all(...params, size, offset);
    res.json({ total, page, page_size: size, items: rows });
  }));

  r.get('/duplicates', ah(async (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT d.id, d.title, d.company, d.location, d.apply_url, d.is_direct, ds.name AS source_name, d.first_seen_at,
        p.id AS primary_id, p.apply_url AS primary_url, p.is_direct AS primary_direct, ps.name AS primary_source, p.status AS primary_status
      FROM jobs d JOIN jobs p ON p.id = d.duplicate_of LEFT JOIN job_sources ds ON ds.id = d.source_id LEFT JOIN job_sources ps ON ps.id = p.source_id
      WHERE d.status = 'duplicate' ORDER BY d.first_seen_at DESC LIMIT 200`).all();
    res.json({ items: rows });
  }));

  r.post('/jobs/:id/not-duplicate', ah(async (req, res) => {
    const id = idParam(req.params.id);
    getDb().prepare("UPDATE jobs SET status = 'active', duplicate_of = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'duplicate'").run(id);
    audit(req, 'job_unmarked_duplicate', 'job', id, {});
    res.json({ ok: true });
  }));

  r.post('/jobs/:id/make-primary', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const job = db.prepare('SELECT id, duplicate_of FROM jobs WHERE id = ?').get(id);
    if (!job?.duplicate_of) throw new HttpError(400, 'This job is not a duplicate.');
    db.prepare("UPDATE jobs SET status = 'duplicate', duplicate_of = ? WHERE id = ?").run(id, job.duplicate_of);
    db.prepare("UPDATE jobs SET status = 'active', duplicate_of = NULL WHERE id = ?").run(id);
    db.prepare('UPDATE jobs SET duplicate_of = ? WHERE duplicate_of = ? AND id != ?').run(id, job.duplicate_of, id);
    audit(req, 'job_made_primary', 'job', id, { previous_primary: job.duplicate_of });
    res.json({ ok: true });
  }));

  r.patch('/jobs/:id', ah(async (req, res) => {
    const id = idParam(req.params.id);
    const status = oneOf(req.body.status, ['active', 'expired', 'closed', 'broken'], 'status');
    getDb().prepare("UPDATE jobs SET status = ?, link_status = CASE WHEN ? = 'active' THEN link_status ELSE ? END, updated_at = datetime('now') WHERE id = ?")
      .run(status, status, status === 'closed' ? 'expired' : status === 'broken' ? 'broken' : 'expired', id);
    audit(req, 'job_status_changed', 'job', id, { status });
    res.json({ ok: true });
  }));

  r.post('/jobs/:id/check-link', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const job = db.prepare('SELECT apply_url, link_status FROM jobs WHERE id = ?').get(id);
    if (!job) throw new HttpError(404, 'Job not found');
    const result = await checkLink(job.apply_url);
    const map = { active: ['verified', 'active'], expired: ['expired', 'expired'], broken: ['broken', 'broken'] };
    const [ls, st] = map[result.result] || [job.link_status === 'expired' ? 'unverified' : job.link_status, 'active'];
    db.prepare("UPDATE jobs SET link_status = ?, status = ?, link_checked_at = datetime('now'), link_check_note = ? WHERE id = ?").run(ls, st, `${result.code}: ${result.reason}`.slice(0, 300), id);
    audit(req, 'job_link_checked', 'job', id, { result: result.result });
    res.json({ result });
  }));

  // ---- Sources ----
  r.get('/providers', ah(async (req, res) => res.json({ providers: await listProviderIds() })));

  r.get('/sources', ah(async (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM jobs j WHERE j.source_id = s.id AND j.status = 'active') AS active_jobs FROM job_sources s ORDER BY s.kind, s.name`).all();
    res.json({ items: rows.map((s) => ({ ...s, enabled: Boolean(s.enabled), is_direct: Boolean(s.is_direct), config: parseJson(s.config, {}) })) });
  }));

  function sourceBody(b, existing = {}) {
    const name = str(b.name ?? existing.name, { field: 'Name', required: true, max: 120 });
    const careersUrl = b.careers_url !== undefined ? httpUrl(b.careers_url, 'Careers URL') : existing.careers_url || '';
    const provider = b.provider !== undefined ? str(b.provider, { max: 60, field: 'Provider' }) : existing.provider || '';
    const kind = oneOf(b.kind ?? existing.kind ?? 'company', ['company', 'aggregator'], 'kind');
    let cfg = existing.config ? parseJson(existing.config, {}) : {};
    if (b.config !== undefined) {
      if (typeof b.config !== 'object' || Array.isArray(b.config)) throw new HttpError(400, 'config must be an object');
      cfg = b.config;
      if (JSON.stringify(cfg).length > 4000) throw new HttpError(400, 'config is too large');
    }
    if (!careersUrl && !provider) throw new HttpError(400, 'Give a careers URL (Greenhouse, Lever, Ashby…) or choose a provider.');
    return { name, careers_url: careersUrl || null, provider: provider || null, kind, is_direct: kind === 'company' ? 1 : 0, config: JSON.stringify(cfg), enabled: b.enabled === undefined ? (existing.enabled ?? 1) : (b.enabled ? 1 : 0) };
  }

  r.post('/sources', ah(async (req, res) => {
    const db = getDb();
    const s = sourceBody(req.body || {});
    const resolved = await resolveSourceProvider(s);
    if (resolved.error) throw new HttpError(400, resolved.error);
    const info = db.prepare('INSERT INTO job_sources (name, provider, careers_url, kind, is_direct, enabled, config) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.name, s.provider, s.careers_url, s.kind, s.is_direct, s.enabled, s.config);
    audit(req, 'source_created', 'job_source', info.lastInsertRowid, { name: s.name, provider: resolved.provider.id });
    res.status(201).json({ id: Number(info.lastInsertRowid), provider: resolved.provider.id });
  }));

  r.patch('/sources/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const existing = db.prepare('SELECT * FROM job_sources WHERE id = ?').get(id);
    if (!existing) throw new HttpError(404, 'Source not found');
    const s = sourceBody(req.body || {}, existing);
    const resolved = await resolveSourceProvider(s);
    if (resolved.error) throw new HttpError(400, resolved.error);
    db.prepare('UPDATE job_sources SET name = ?, provider = ?, careers_url = ?, kind = ?, is_direct = ?, enabled = ?, config = ? WHERE id = ?')
      .run(s.name, s.provider, s.careers_url, s.kind, s.is_direct, s.enabled, s.config, id);
    audit(req, 'source_updated', 'job_source', id, { enabled: Boolean(s.enabled) });
    res.json({ ok: true });
  }));

  r.delete('/sources/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    db.prepare("UPDATE jobs SET status = 'closed', link_status = 'expired', link_check_note = 'source removed by an administrator' WHERE source_id = ? AND status = 'active'").run(id);
    db.prepare('DELETE FROM job_sources WHERE id = ?').run(id);
    audit(req, 'source_deleted', 'job_source', id, {});
    res.json({ ok: true });
  }));

  r.post('/sources/:id/test', ah(async (req, res) => {
    const db = getDb();
    const source = db.prepare('SELECT * FROM job_sources WHERE id = ?').get(idParam(req.params.id));
    if (!source) throw new HttpError(404, 'Source not found');
    try {
      const { providerId, jobs } = await fetchSourceJobs(source, { timeoutMs: 45000 });
      res.json({ ok: true, provider: providerId, count: jobs.length, sample: jobs.slice(0, 5).map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url })) });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  }));

  // ---- Fetching ----
  r.post('/fetch', ah(async (req, res) => {
    const db = getDb();
    const sourceIds = Array.isArray(req.body?.source_ids) ? req.body.source_ids.map(Number).filter(Number.isInteger) : null;
    const status = schedulerStatus(db);
    audit(req, 'fetch_requested', 'fetch', '', { source_ids: sourceIds });
    if (status.alive && status.heartbeat?.pid !== process.pid) {
      setSetting(db, 'fetch_requested', { at: new Date().toISOString(), by: req.user.id, sourceIds });
      return res.status(202).json({ queued: true, message: 'The scheduler worker will start the fetch within 30 seconds.' });
    }
    if (isFetchRunning()) return res.status(409).json({ error: 'A fetch is already running.' });
    // No separate worker alive: run in this process, in the background.
    runFetch(db, { trigger: 'manual', sourceIds, hooks: postFetchHooks }).catch((err) => logSystemError(db, 'manual-fetch', err));
    res.status(202).json({ started: true, message: 'Fetch started on the web server (no scheduler worker is running).' });
  }));

  r.get('/fetch-runs', ah(async (req, res) => {
    const rows = getDb().prepare('SELECT * FROM fetch_runs ORDER BY id DESC LIMIT 50').all();
    res.json({ items: rows, scheduler: schedulerStatus(getDb()) });
  }));

  r.get('/fetch-runs/:id/logs', ah(async (req, res) => {
    const rows = getDb().prepare('SELECT l.*, s.name AS source_name FROM fetch_logs l LEFT JOIN job_sources s ON s.id = l.source_id WHERE l.run_id = ? ORDER BY l.id').all(idParam(req.params.id));
    res.json({ items: rows });
  }));

  r.get('/logs', ah(async (req, res) => {
    const level = ['info', 'warn', 'error'].includes(req.query.level) ? req.query.level : null;
    const rows = getDb().prepare(`SELECT l.*, s.name AS source_name FROM fetch_logs l LEFT JOIN job_sources s ON s.id = l.source_id ${level ? 'WHERE l.level = ?' : ''} ORDER BY l.id DESC LIMIT 300`).all(...(level ? [level] : []));
    res.json({ items: rows });
  }));

  r.get('/errors', ah(async (req, res) => {
    const db = getDb();
    res.json({
      system: db.prepare('SELECT id, context, message, created_at FROM system_errors ORDER BY id DESC LIMIT 100').all(),
      fetch: db.prepare("SELECT l.id, l.message, l.created_at, s.name AS source_name FROM fetch_logs l LEFT JOIN job_sources s ON s.id = l.source_id WHERE l.level = 'error' ORDER BY l.id DESC LIMIT 100").all(),
      failing_sources: db.prepare("SELECT id, name, last_error, last_fetch_at FROM job_sources WHERE last_status = 'error' ORDER BY name").all(),
    });
  }));

  // ---- Google Sheets ----
  r.get('/sheets', ah(async (req, res) => {
    res.json({
      problem: sheetsConfigProblem(),
      spreadsheet_id: config.sheets.spreadsheetId ? `${config.sheets.spreadsheetId.slice(0, 6)}…` : '',
      tab_prefix: config.sheets.tabPrefix,
      logs: getDb().prepare('SELECT * FROM sheets_sync_logs ORDER BY id DESC LIMIT 50').all(),
    });
  }));

  r.post('/sheets/sync', ah(async (req, res) => {
    const result = await syncJobsToSheet(getDb());
    audit(req, 'sheets_sync', 'sheets', result.tab, { status: result.status, rows: result.rows });
    res.json(result);
  }));

  // ---- Settings ----
  r.get('/settings', ah(async (req, res) => {
    const db = getDb();
    res.json({
      experience_bands: getSetting(db, 'experience_bands', DEFAULT_EXPERIENCE_BANDS),
      fetch_daily_at: getSetting(db, 'fetch_daily_at', config.fetchDailyAt),
      categories: CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, featured: Boolean(c.featured) })),
      registration: { allow: config.allowRegistration, require_approval: config.requireAdminApproval },
    });
  }));

  r.put('/settings', ah(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    if (b.fetch_daily_at !== undefined) {
      const t = str(b.fetch_daily_at, { max: 5, field: 'Daily fetch time' });
      if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new HttpError(400, 'Daily fetch time must be HH:MM (24-hour).');
      setSetting(db, 'fetch_daily_at', t);
    }
    if (b.experience_bands !== undefined) {
      if (!Array.isArray(b.experience_bands) || !b.experience_bands.length || b.experience_bands.length > 20) throw new HttpError(400, 'Provide 1–20 experience bands.');
      const bands = b.experience_bands.map((x, i) => {
        const min = Number(x.min); const max = x.max === null || x.max === '' || x.max === undefined ? null : Number(x.max);
        if (!Number.isFinite(min) || min < 0 || (max !== null && (!Number.isFinite(max) || max < min))) throw new HttpError(400, `Band ${i + 1} has an invalid range.`);
        return { id: str(x.id || `${min}-${max ?? '+'}`, { max: 20, field: 'Band id' }), label: str(x.label, { max: 40, field: 'Band label', required: true }), min, max };
      });
      setSetting(db, 'experience_bands', bands);
      // Relabel stored jobs with the new bands.
      const { experienceBand } = await import('../../lib/job-analyzer.mjs');
      const upd = db.prepare('UPDATE jobs SET experience_band = ? WHERE id = ?');
      for (const j of db.prepare('SELECT id, experience_min, experience_max FROM jobs').all()) upd.run(experienceBand(j.experience_min, j.experience_max, bands), j.id);
    }
    audit(req, 'settings_updated', 'settings', '', Object.keys(b));
    res.json({ ok: true });
  }));

  return r;
}

import { Router } from 'express';
import { buildJobQuery, SORTS } from '../../services/job-query.mjs';
import { candidateForUser, decodeJob, scoreJobs, VISIBLE_JOB_WHERE, favoriteSet } from '../../services/matching.mjs';
import { CATEGORIES } from '../../lib/taxonomy.mjs';
import { DEFAULT_EXPERIENCE_BANDS } from '../../lib/job-analyzer.mjs';
import { interviewPrep } from '../../lib/insights.mjs';
import { getSetting, parseJson } from '../../db/index.mjs';
import { schedulerStatus } from '../../services/scheduler.mjs';
import { ah, HttpError, str, idParam, paginate } from '../util.mjs';

const LIST_COLUMNS = `j.id, j.title, j.company, j.location, j.apply_url, j.is_direct, j.work_arrangement, j.experience_min, j.experience_max,
  j.experience_band, j.skills, j.preferred_skills, j.categories, j.salary_min, j.salary_max, j.salary_currency, j.posted_at, j.first_seen_at,
  j.last_seen_at, j.link_status, j.link_checked_at, j.source_id, s.name AS source_name`;

function publicJob(job, { saved, application } = {}) {
  const { description, ...rest } = job;
  return { ...rest, is_direct: Boolean(job.is_direct), saved: Boolean(saved), application: application || null };
}

export function filtersFromQuery(q) {
  const pick = ['q', 'title', 'company', 'skills', 'category', 'bands', 'years', 'min_years', 'max_years', 'location', 'arrangement', 'salary_min', 'has_salary', 'posted_within_days', 'source', 'direct_only'];
  const f = {};
  for (const k of pick) if (q[k] !== undefined && q[k] !== '') f[k] = q[k];
  return f;
}

export function jobRoutes(getDb) {
  const r = Router();

  r.get('/meta', ah(async (req, res) => {
    const db = getDb();
    const sources = db.prepare("SELECT id, name, kind FROM job_sources WHERE enabled = 1 ORDER BY name").all();
    const counts = db.prepare(`SELECT j.categories FROM jobs j WHERE ${VISIBLE_JOB_WHERE}`).all();
    const catCount = new Map();
    for (const row of counts) for (const c of parseJson(row.categories, [])) catCount.set(c, (catCount.get(c) || 0) + 1);
    const status = schedulerStatus(db);
    res.json({
      categories: CATEGORIES.map((c) => ({ slug: c.slug, name: c.name, featured: Boolean(c.featured), count: catCount.get(c.slug) || 0 })),
      experience_bands: getSetting(db, 'experience_bands', DEFAULT_EXPERIENCE_BANDS),
      arrangements: ['Remote', 'Hybrid', 'WFO'],
      sources,
      total_active: counts.length,
      last_updated: status.last_successful_fetch_at,
      next_refresh: status.next_run_at,
    });
  }));

  r.get('/', ah(async (req, res) => {
    const db = getDb();
    const filters = filtersFromQuery(req.query);
    if (req.query.saved) {
      const ss = db.prepare('SELECT query FROM saved_searches WHERE id = ? AND user_id = ?').get(Number(req.query.saved), req.user.id);
      if (ss) Object.assign(filters, parseJson(ss.query, {}));
    }
    const { candidate } = candidateForUser(db, req.user.id);
    if (req.query.fit_experience === '1' && candidate.years !== null) filters.years = candidate.years;
    const { where, params } = buildJobQuery(filters);
    const sort = String(req.query.sort || (candidate.hasProfile ? 'match' : 'newest'));
    const minMatch = Number(req.query.min_match) || 0;
    const { page, size, offset } = paginate(req.query, { defaultSize: 20 });
    const base = `FROM jobs j LEFT JOIN job_sources s ON s.id = j.source_id WHERE ${VISIBLE_JOB_WHERE}${where ? ` AND ${where}` : ''}`;
    let items; let total;
    if ((sort === 'match' || sort === 'relevance' || minMatch > 0) && candidate.hasProfile) {
      // Score in memory, then sort/paginate. Bounded so a huge table stays responsive.
      const rows = db.prepare(`SELECT ${LIST_COLUMNS} ${base} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC LIMIT 6000`).all(...params).map(decodeJob);
      let scored = scoreJobs(candidate, rows, favoriteSet(db, req.user.id));
      if (minMatch > 0) scored = scored.filter((s) => s.match.score >= minMatch);
      scored.sort(sort === 'relevance' ? (a, b) => b.relevance - a.relevance : (a, b) => b.match.score - a.match.score || b.relevance - a.relevance);
      if (sort === 'newest') scored.sort((a, b) => String(b.job.posted_at || b.job.first_seen_at).localeCompare(String(a.job.posted_at || a.job.first_seen_at)));
      total = scored.length;
      items = scored.slice(offset, offset + size);
    } else {
      total = db.prepare(`SELECT COUNT(*) n ${base}`).get(...params).n;
      const order = SORTS[sort] || SORTS.newest;
      const rows = db.prepare(`SELECT ${LIST_COLUMNS} ${base} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, offset).map(decodeJob);
      items = candidate.hasProfile ? scoreJobs(candidate, rows, favoriteSet(db, req.user.id)) : rows.map((job) => ({ job, match: null, relevance: null }));
    }
    const ids = items.map((i) => i.job.id);
    const savedSet = new Set(ids.length ? db.prepare(`SELECT job_id FROM saved_jobs WHERE user_id = ? AND job_id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids).map((x) => x.job_id) : []);
    const appMap = new Map(ids.length ? db.prepare(`SELECT job_id, id, status FROM applications WHERE user_id = ? AND job_id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids).map((x) => [x.job_id, { id: x.id, status: x.status }]) : []);
    res.json({
      total, page, page_size: size, has_profile: candidate.hasProfile,
      items: items.map((i) => ({ ...publicJob(i.job, { saved: savedSet.has(i.job.id), application: appMap.get(i.job.id) }), match: i.match ? compactMatch(i.match) : null, relevance: i.relevance })),
    });
  }));

  r.get('/recommendations', ah(async (req, res) => {
    const db = getDb();
    const { candidate, preferences } = candidateForUser(db, req.user.id);
    if (!candidate.hasProfile) return res.json({ has_profile: false, items: [] });
    const fresh = req.query.fresh === '1';
    const rows = db.prepare(`SELECT ${LIST_COLUMNS} FROM jobs j LEFT JOIN job_sources s ON s.id = j.source_id WHERE ${VISIBLE_JOB_WHERE}
      ${fresh ? "AND j.first_seen_at >= datetime('now','-2 days')" : ''} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC LIMIT 6000`).all().map(decodeJob);
    const threshold = Number(req.query.min_match) || preferences.min_match_score || 50;
    const scored = scoreJobs(candidate, rows, favoriteSet(db, req.user.id))
      .filter((s) => s.match.score >= threshold && candidate.arrangements.has(s.job.work_arrangement))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, Math.min(100, Number(req.query.limit) || 50));
    const ids = scored.map((s) => s.job.id);
    const savedSet = new Set(ids.length ? db.prepare(`SELECT job_id FROM saved_jobs WHERE user_id = ? AND job_id IN (${ids.map(() => '?').join(',')})`).all(req.user.id, ...ids).map((x) => x.job_id) : []);
    res.json({ has_profile: true, threshold, items: scored.map((s) => ({ ...publicJob(s.job, { saved: savedSet.has(s.job.id) }), match: s.match, relevance: s.relevance })) });
  }));

  r.get('/saved', ah(async (req, res) => {
    const db = getDb();
    const { candidate } = candidateForUser(db, req.user.id);
    const rows = db.prepare(`SELECT ${LIST_COLUMNS}, j.status, sj.created_at AS saved_at FROM saved_jobs sj JOIN jobs j ON j.id = sj.job_id
      LEFT JOIN job_sources s ON s.id = j.source_id WHERE sj.user_id = ? ORDER BY sj.created_at DESC`).all(req.user.id).map(decodeJob);
    const scored = candidate.hasProfile ? scoreJobs(candidate, rows) : rows.map((job) => ({ job, match: null }));
    const appMap = new Map(db.prepare('SELECT job_id, id, status FROM applications WHERE user_id = ? AND job_id IS NOT NULL').all(req.user.id).map((x) => [x.job_id, { id: x.id, status: x.status }]));
    res.json({ items: scored.map((s) => ({ ...publicJob(s.job, { saved: true, application: appMap.get(s.job.id) }), status: s.job.status, saved_at: s.job.saved_at, match: s.match ? compactMatch(s.match) : null })) });
  }));

  r.get('/recent', ah(async (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT ${LIST_COLUMNS}, j.status, rv.viewed_at FROM recently_viewed rv JOIN jobs j ON j.id = rv.job_id
      LEFT JOIN job_sources s ON s.id = j.source_id WHERE rv.user_id = ? ORDER BY rv.viewed_at DESC LIMIT 20`).all(req.user.id).map(decodeJob);
    res.json({ items: rows.map((j) => ({ ...publicJob(j), status: j.status, viewed_at: j.viewed_at })) });
  }));

  r.get('/companies', ah(async (req, res) => {
    const db = getDb();
    const q = str(req.query.q, { max: 80 });
    const rows = db.prepare(`SELECT j.company, COUNT(*) n FROM jobs j WHERE ${VISIBLE_JOB_WHERE} AND j.company LIKE ? GROUP BY j.company ORDER BY n DESC LIMIT 30`).all(`%${q}%`);
    res.json({ companies: rows });
  }));

  r.get('/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    // Users may open expired jobs they saved/tracked, but never hidden duplicates of unknown jobs.
    const row = db.prepare(`SELECT j.*, s.name AS source_name FROM jobs j LEFT JOIN job_sources s ON s.id = j.source_id WHERE j.id = ?`).get(id);
    if (!row) throw new HttpError(404, 'Job not found');
    const job = decodeJob(row);
    const { candidate } = candidateForUser(db, req.user.id);
    const [scored] = scoreJobs(candidate, [job], favoriteSet(db, req.user.id));
    const saved = db.prepare('SELECT 1 FROM saved_jobs WHERE user_id = ? AND job_id = ?').get(req.user.id, id);
    const app = db.prepare('SELECT id, status FROM applications WHERE user_id = ? AND job_id = ?').get(req.user.id, id);
    db.prepare(`INSERT INTO recently_viewed (user_id, job_id, viewed_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id, job_id) DO UPDATE SET viewed_at = excluded.viewed_at`).run(req.user.id, id);
    db.prepare(`DELETE FROM recently_viewed WHERE user_id = ? AND job_id NOT IN (SELECT job_id FROM recently_viewed WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 50)`).run(req.user.id, req.user.id);
    const favorite = db.prepare('SELECT 1 FROM favorite_companies WHERE user_id = ? AND company = ?').get(req.user.id, job.company);
    res.json({
      job: { ...publicJob(job, { saved, application: app }), description: job.description, status: job.status, link_check_note: job.link_check_note, duplicate_of: job.duplicate_of },
      match: candidate.hasProfile ? scored.match : null,
      relevance: candidate.hasProfile ? scored.relevance : null,
      favorite_company: Boolean(favorite),
      interview_prep: interviewPrep({ title: job.title, company: job.company, requiredSkills: scored.match.required_skills, missingSkills: candidate.hasProfile ? scored.match.missing_skills : [], status: app?.status || 'Applied' }),
    });
  }));

  r.post('/:id/save', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    if (!db.prepare('SELECT 1 FROM jobs WHERE id = ?').get(id)) throw new HttpError(404, 'Job not found');
    db.prepare('INSERT OR IGNORE INTO saved_jobs (user_id, job_id) VALUES (?, ?)').run(req.user.id, id);
    res.json({ saved: true });
  }));

  r.delete('/:id/save', ah(async (req, res) => {
    getDb().prepare('DELETE FROM saved_jobs WHERE user_id = ? AND job_id = ?').run(req.user.id, idParam(req.params.id));
    res.json({ saved: false });
  }));

  return r;
}

export function compactMatch(m) {
  return { score: m.score, label: m.label, matching_skills: m.matching_skills, missing_skills: m.missing_skills, reasons: m.reasons.slice(0, 3) };
}

export function searchRoutes(getDb) {
  const r = Router();
  r.get('/searches', ah(async (req, res) => {
    const rows = getDb().prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
    res.json({ searches: rows.map((s) => ({ ...s, query: parseJson(s.query, {}), notify: Boolean(s.notify) })) });
  }));
  r.post('/searches', ah(async (req, res) => {
    const db = getDb();
    const name = str(req.body.name, { field: 'Name', required: true, max: 80 });
    const query = filtersFromQuery(req.body.query || {});
    if (db.prepare('SELECT COUNT(*) n FROM saved_searches WHERE user_id = ?').get(req.user.id).n >= 30) throw new HttpError(400, 'You can keep up to 30 saved searches.');
    const info = db.prepare('INSERT INTO saved_searches (user_id, name, query, notify) VALUES (?, ?, ?, ?)').run(req.user.id, name, JSON.stringify(query), req.body.notify === false ? 0 : 1);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  }));
  r.patch('/searches/:id', ah(async (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const row = db.prepare('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!row) throw new HttpError(404, 'Saved search not found');
    const name = req.body.name !== undefined ? str(req.body.name, { field: 'Name', required: true, max: 80 }) : row.name;
    const notifyFlag = req.body.notify !== undefined ? (req.body.notify ? 1 : 0) : row.notify;
    db.prepare('UPDATE saved_searches SET name = ?, notify = ? WHERE id = ? AND user_id = ?').run(name, notifyFlag, id, req.user.id);
    res.json({ ok: true });
  }));
  r.delete('/searches/:id', ah(async (req, res) => {
    getDb().prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').run(idParam(req.params.id), req.user.id);
    res.json({ ok: true });
  }));

  r.get('/favorites', ah(async (req, res) => {
    const db = getDb();
    const rows = db.prepare(`SELECT f.company, f.created_at, (SELECT COUNT(*) FROM jobs j WHERE j.company = f.company COLLATE NOCASE AND ${VISIBLE_JOB_WHERE}) AS open_jobs
      FROM favorite_companies f WHERE f.user_id = ? ORDER BY f.company`).all(req.user.id);
    res.json({ companies: rows });
  }));
  r.post('/favorites', ah(async (req, res) => {
    const company = str(req.body.company, { field: 'Company', required: true, max: 200 });
    getDb().prepare('INSERT OR IGNORE INTO favorite_companies (user_id, company) VALUES (?, ?)').run(req.user.id, company);
    res.status(201).json({ ok: true });
  }));
  r.delete('/favorites', ah(async (req, res) => {
    const company = str(req.body.company ?? req.query.company, { field: 'Company', required: true, max: 200 });
    getDb().prepare('DELETE FROM favorite_companies WHERE user_id = ? AND company = ?').run(req.user.id, company);
    res.json({ ok: true });
  }));
  return r;
}

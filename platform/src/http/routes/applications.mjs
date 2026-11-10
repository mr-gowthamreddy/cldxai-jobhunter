import { Router } from 'express';
import ExcelJS from 'exceljs';
import { config } from '../../config.mjs';
import { ah, HttpError, str, idParam, dateStr, httpUrl, oneOf } from '../util.mjs';
import { candidateForUser, decodeJob, scoreJobs, VISIBLE_JOB_WHERE } from '../../services/matching.mjs';
import { interviewPrep } from '../../lib/insights.mjs';
import { logUser } from '../../lib/activity.mjs';
import { tx, parseJson } from '../../db/index.mjs';

export const STATUSES = ['Interested', 'Saved', 'Applied', 'Interview Scheduled', 'Technical Round', 'HR Round', 'Offer Received', 'Rejected'];

function own(db, userId, id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) throw new HttpError(404, 'Application not found');
  return row;
}

export function applicationRoutes(getDb) {
  const r = Router();

  r.get('/', ah(async (req, res) => {
    const db = getDb();
    const where = ['a.user_id = ?'];
    const params = [req.user.id];
    if (req.query.status && STATUSES.includes(req.query.status)) { where.push('a.status = ?'); params.push(req.query.status); }
    if (req.query.q) { where.push('(a.company LIKE ? OR a.title LIKE ? OR a.notes LIKE ?)'); const q = `%${String(req.query.q).slice(0, 100)}%`; params.push(q, q, q); }
    const rows = db.prepare(`SELECT a.*, j.status AS job_status, j.work_arrangement, j.apply_url FROM applications a LEFT JOIN jobs j ON j.id = a.job_id
      WHERE ${where.join(' AND ')} ORDER BY a.updated_at DESC`).all(...params);
    res.json({ items: rows, statuses: STATUSES });
  }));

  r.post('/', ah(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const status = oneOf(b.status || 'Interested', STATUSES, 'status');
    let jobId = null; let company; let title; let jobUrl; let location = ''; let source = 'manual'; let matchScore = null;
    if (b.job_id) {
      jobId = idParam(b.job_id);
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
      if (!job) throw new HttpError(404, 'Job not found');
      const existing = db.prepare('SELECT id FROM applications WHERE user_id = ? AND job_id = ?').get(req.user.id, jobId);
      if (existing) throw new HttpError(409, 'You are already tracking this job.', { id: existing.id });
      company = job.company; title = job.title; jobUrl = job.apply_url; location = job.location; source = 'platform';
      const { candidate } = candidateForUser(db, req.user.id);
      if (candidate.hasProfile) matchScore = scoreJobs(candidate, [decodeJob(job)])[0].match.score;
    } else {
      company = str(b.company, { field: 'Company', required: true, max: 200 });
      title = str(b.title, { field: 'Job title', required: true, max: 200 });
      jobUrl = httpUrl(b.job_url, 'Job URL');
      location = str(b.location, { field: 'Location', max: 200 });
    }
    const appliedOn = dateStr(b.applied_on, 'Applied on') || (status === 'Applied' ? new Date().toISOString().slice(0, 10) : null);
    const id = tx(db, () => {
      const info = db.prepare(`INSERT INTO applications (user_id, job_id, company, title, job_url, location, status, applied_on, interview_at, notes, source, match_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, jobId, company, title, jobUrl, location, status, appliedOn,
        dateStr(b.interview_at, 'Interview date'), str(b.notes, { max: 5000, field: 'Notes' }), source, matchScore);
      const newId = Number(info.lastInsertRowid);
      db.prepare('INSERT INTO application_events (application_id, user_id, from_status, to_status, note) VALUES (?, ?, NULL, ?, ?)').run(newId, req.user.id, status, 'Created');
      return newId;
    });
    logUser(db, { userId: req.user.id, action: 'application_created', details: { application_id: id, source } });
    res.status(201).json({ application: own(db, req.user.id, id) });
  }));

  r.get('/stats', ah(async (req, res) => {
    const db = getDb();
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of db.prepare('SELECT status, COUNT(*) n FROM applications WHERE user_id = ? GROUP BY status').all(req.user.id)) byStatus[row.status] = row.n;
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const applied = total - byStatus.Interested - byStatus.Saved;
    const interviewing = byStatus['Interview Scheduled'] + byStatus['Technical Round'] + byStatus['HR Round'];
    const weekly = db.prepare(`SELECT strftime('%Y-%W', COALESCE(applied_on, created_at)) AS week, COUNT(*) n FROM applications
      WHERE user_id = ? AND status NOT IN ('Interested','Saved') AND COALESCE(applied_on, created_at) >= date('now','-84 days') GROUP BY week ORDER BY week`).all(req.user.id);
    const upcoming = db.prepare(`SELECT id, company, title, interview_at, status FROM applications WHERE user_id = ? AND interview_at IS NOT NULL AND interview_at >= date('now') ORDER BY interview_at LIMIT 5`).all(req.user.id);
    const reachedInterview = db.prepare(`SELECT COUNT(DISTINCT application_id) n FROM application_events WHERE user_id = ? AND to_status IN ('Interview Scheduled','Technical Round','HR Round','Offer Received')`).get(req.user.id).n;
    res.json({
      total, by_status: byStatus, applied, interviewing, offers: byStatus['Offer Received'], rejected: byStatus.Rejected,
      response_rate: applied ? Math.round((reachedInterview / applied) * 100) : 0,
      weekly, upcoming_interviews: upcoming,
    });
  }));

  r.get('/export', ah(async (req, res) => {
    const db = getDb();
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';
    const rows = db.prepare(`SELECT a.company, a.title, a.status, a.applied_on, a.interview_at, a.location, a.job_url, a.match_score, a.source, a.notes, a.created_at, a.updated_at
      FROM applications a WHERE a.user_id = ? ORDER BY a.updated_at DESC`).all(req.user.id);
    const header = ['Company', 'Job Title', 'Status', 'Applied On', 'Interview Date', 'Location', 'Job URL', 'Match %', 'Source', 'Notes', 'Created', 'Updated'];
    const stamp = new Date().toISOString().slice(0, 10);
    logUser(db, { userId: req.user.id, action: 'applications_exported', details: { format, rows: rows.length } });
    if (format === 'csv') {
      // Prefix formula-like cells so spreadsheets never execute them.
      const esc = (v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [header, ...rows.map((r0) => Object.values(r0))].map((line) => line.map(esc).join(',')).join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="applications-${stamp}.csv"`);
      return res.send('﻿' + csv);
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = config.appName;
    const ws = wb.addWorksheet('Applications', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = header.map((h) => ({ header: h, width: h === 'Notes' ? 50 : h === 'Job URL' ? 45 : 18 }));
    ws.getRow(1).font = { bold: true };
    for (const r0 of rows) ws.addRow(Object.values(r0).map((v) => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v)));
    ws.autoFilter = { from: 'A1', to: `L${rows.length + 1}` };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="applications-${stamp}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }));

  r.get('/:id', ah(async (req, res) => {
    const db = getDb();
    const app = own(db, req.user.id, idParam(req.params.id));
    const events = db.prepare('SELECT from_status, to_status, note, created_at FROM application_events WHERE application_id = ? AND user_id = ? ORDER BY id').all(app.id, req.user.id);
    let prep = null;
    if (app.job_id) {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(app.job_id);
      if (job) {
        const { candidate } = candidateForUser(db, req.user.id);
        const m = scoreJobs(candidate, [decodeJob(job)])[0].match;
        prep = interviewPrep({ title: app.title, company: app.company, requiredSkills: m.required_skills, missingSkills: candidate.hasProfile ? m.missing_skills : [], status: app.status });
      }
    } else {
      prep = interviewPrep({ title: app.title, company: app.company, status: app.status });
    }
    res.json({ application: app, events, interview_prep: prep });
  }));

  r.patch('/:id', ah(async (req, res) => {
    const db = getDb();
    const app = own(db, req.user.id, idParam(req.params.id));
    const b = req.body || {};
    const next = {
      status: b.status !== undefined ? oneOf(b.status, STATUSES, 'status') : app.status,
      notes: b.notes !== undefined ? str(b.notes, { max: 5000, field: 'Notes' }) : app.notes,
      applied_on: b.applied_on !== undefined ? dateStr(b.applied_on, 'Applied on') : app.applied_on,
      interview_at: b.interview_at !== undefined ? dateStr(b.interview_at, 'Interview date') : app.interview_at,
      company: b.company !== undefined && !app.job_id ? str(b.company, { field: 'Company', required: true, max: 200 }) : app.company,
      title: b.title !== undefined && !app.job_id ? str(b.title, { field: 'Job title', required: true, max: 200 }) : app.title,
      job_url: b.job_url !== undefined && !app.job_id ? httpUrl(b.job_url, 'Job URL') : app.job_url,
      location: b.location !== undefined && !app.job_id ? str(b.location, { max: 200 }) : app.location,
    };
    if (next.status === 'Applied' && !next.applied_on) next.applied_on = new Date().toISOString().slice(0, 10);
    tx(db, () => {
      db.prepare(`UPDATE applications SET status = ?, notes = ?, applied_on = ?, interview_at = ?, company = ?, title = ?, job_url = ?, location = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`).run(next.status, next.notes, next.applied_on, next.interview_at, next.company, next.title, next.job_url, next.location, app.id, req.user.id);
      if (next.status !== app.status) {
        db.prepare('INSERT INTO application_events (application_id, user_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)')
          .run(app.id, req.user.id, app.status, next.status, str(b.event_note, { max: 500 }));
      }
    });
    res.json({ application: own(db, req.user.id, app.id) });
  }));

  r.delete('/:id', ah(async (req, res) => {
    const db = getDb();
    const app = own(db, req.user.id, idParam(req.params.id));
    db.prepare('DELETE FROM applications WHERE id = ? AND user_id = ?').run(app.id, req.user.id);
    res.json({ ok: true });
  }));

  return r;
}

/** Per-user dashboard summary. */
export function dashboardRoute(getDb) {
  return ah(async (req, res) => {
    const db = getDb();
    const { candidate, resumeData, preferences } = candidateForUser(db, req.user.id);
    const resumes = db.prepare('SELECT COUNT(*) n FROM resumes WHERE user_id = ?').get(req.user.id).n;
    const saved = db.prepare('SELECT COUNT(*) n FROM saved_jobs WHERE user_id = ?').get(req.user.id).n;
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    const totalJobs = db.prepare(`SELECT COUNT(*) n FROM jobs j WHERE ${VISIBLE_JOB_WHERE}`).get().n;
    const newToday = db.prepare(`SELECT COUNT(*) n FROM jobs j WHERE ${VISIBLE_JOB_WHERE} AND j.first_seen_at >= datetime('now','-1 day')`).get().n;
    let matches = { strong: 0, good: 0, top: [], by_category: [], by_arrangement: {}, by_band: {} };
    if (candidate.hasProfile) {
      const rows = db.prepare(`SELECT j.id, j.title, j.company, j.location, j.work_arrangement, j.skills, j.preferred_skills, j.categories, j.experience_min, j.experience_max,
        j.experience_band, j.posted_at, j.first_seen_at, j.is_direct, j.apply_url FROM jobs j WHERE ${VISIBLE_JOB_WHERE} ORDER BY COALESCE(j.posted_at, j.first_seen_at) DESC LIMIT 6000`).all().map(decodeJob);
      const scored = scoreJobs(candidate, rows);
      const good = scored.filter((s) => s.match.score >= (preferences.min_match_score || 50));
      matches.strong = scored.filter((s) => s.match.score >= 75).length;
      matches.good = good.length;
      matches.top = good.sort((a, b) => b.relevance - a.relevance).slice(0, 6).map((s) => ({ id: s.job.id, title: s.job.title, company: s.job.company, location: s.job.location, work_arrangement: s.job.work_arrangement, posted_at: s.job.posted_at || s.job.first_seen_at, apply_url: s.job.apply_url, score: s.match.score }));
      const cat = new Map(); const arr = {}; const band = {};
      for (const s of good) {
        for (const c of s.job.categories) cat.set(c, (cat.get(c) || 0) + 1);
        arr[s.job.work_arrangement] = (arr[s.job.work_arrangement] || 0) + 1;
        band[s.job.experience_band] = (band[s.job.experience_band] || 0) + 1;
      }
      matches.by_category = [...cat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([slug, n]) => ({ slug, n }));
      matches.by_arrangement = arr;
      matches.by_band = band;
    }
    const recent = db.prepare(`SELECT a.id, a.company, a.title, a.status, a.updated_at FROM applications a WHERE a.user_id = ? ORDER BY a.updated_at DESC LIMIT 5`).all(req.user.id);
    const lastFetch = db.prepare("SELECT value FROM settings WHERE key = 'last_successful_fetch_at'").get();
    res.json({
      user: { full_name: req.user.full_name },
      profile: resumeData ? { name: resumeData.candidate_name, current_role: resumeData.current_role, years: candidate.years, skills: [...candidate.skills].slice(0, 30) } : null,
      counts: { resumes, saved, unread, total_jobs: totalJobs, new_today: newToday },
      matches, recent_applications: recent,
      last_updated: lastFetch ? parseJson(lastFetch.value, null) : null,
      onboarding: { has_resume: resumes > 0, has_preferences: Boolean(preferences.desired_titles?.length || preferences.categories?.length) },
    });
  });
}

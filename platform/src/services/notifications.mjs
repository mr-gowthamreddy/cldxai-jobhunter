// New-job notifications after each fetch: per-user resume matches and saved
// search alerts. Each user is scored against their own profile only.

import { config } from '../config.mjs';
import { sendMail, mailConfigured } from '../lib/mailer.mjs';
import { candidateForUser, decodeJob, scoreJobs, VISIBLE_JOB_WHERE, favoriteSet } from './matching.mjs';
import { parseJson } from '../db/index.mjs';
import { buildJobQuery } from './job-query.mjs';

export function notify(db, userId, { type, title, body = '', link = '' }) {
  db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)').run(userId, type, title, body, link);
}

export async function notifyNewJobs(db, newJobIds = []) {
  if (!newJobIds.length) return { users: 0 };
  const placeholders = newJobIds.map(() => '?').join(',');
  const jobs = db.prepare(`SELECT j.* FROM jobs j WHERE j.id IN (${placeholders}) AND ${VISIBLE_JOB_WHERE}`).all(...newJobIds).map(decodeJob);
  if (!jobs.length) return { users: 0 };
  const users = db.prepare(`SELECT u.id, u.email, u.full_name, COALESCE(p.email_notifications, 1) AS email_ok
    FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.status = 'active'`).all();
  let notified = 0;
  for (const u of users) {
    const { candidate, preferences } = candidateForUser(db, u.id);
    if (candidate.hasProfile && preferences.notify_new_matches) {
      const threshold = preferences.min_match_score ?? 50;
      const scored = scoreJobs(candidate, jobs, favoriteSet(db, u.id))
        .filter((s) => s.match.score >= threshold && candidate.arrangements.has(s.job.work_arrangement))
        .sort((a, b) => b.relevance - a.relevance);
      if (scored.length) {
        const top = scored.slice(0, 3).map((s) => `${s.job.title} at ${s.job.company} (${s.match.score}%)`).join('; ');
        notify(db, u.id, { type: 'new_matches', title: `${scored.length} new job${scored.length > 1 ? 's' : ''} match your resume`, body: `Top: ${top}`, link: '/app/recommendations?fresh=1' });
        notified++;
        if (u.email_ok && mailConfigured()) {
          await sendMail({ to: u.email, subject: `${config.appName}: ${scored.length} new matching jobs`, text: `Hi ${u.full_name},\n\nNew jobs matching your resume:\n\n${scored.slice(0, 10).map((s) => `• ${s.job.title} — ${s.job.company} (${s.match.score}% match)\n  ${s.job.apply_url}`).join('\n')}\n\nSee all: ${config.publicUrl}/app/recommendations\n` }).catch(() => {});
        }
      }
    }
    // Saved-search alerts.
    for (const s of db.prepare('SELECT * FROM saved_searches WHERE user_id = ? AND notify = 1').all(u.id)) {
      const filters = parseJson(s.query, {});
      const { where, params } = buildJobQuery(filters);
      const n = db.prepare(`SELECT COUNT(*) AS n FROM jobs j WHERE ${VISIBLE_JOB_WHERE} AND j.id IN (${placeholders}) ${where ? `AND ${where}` : ''}`).get(...newJobIds, ...params).n;
      if (n > 0) {
        notify(db, u.id, { type: 'saved_search', title: `${n} new job${n > 1 ? 's' : ''} for “${s.name}”`, link: `/app/jobs?saved=${s.id}` });
        db.prepare("UPDATE saved_searches SET last_notified_at = datetime('now') WHERE id = ?").run(s.id);
      }
    }
  }
  return { users: notified };
}

/** Tell users when a job they saved or are tracking has expired. */
export function notifyExpiredTracked(db, sinceIso) {
  const rows = db.prepare(`SELECT DISTINCT a.user_id, j.id, j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id
    WHERE j.status IN ('expired','broken') AND j.updated_at >= ? AND a.status IN ('Interested','Saved')
    UNION SELECT DISTINCT sj.user_id, j.id, j.title, j.company FROM saved_jobs sj JOIN jobs j ON j.id = sj.job_id
    WHERE j.status IN ('expired','broken') AND j.updated_at >= ?`).all(sinceIso, sinceIso);
  for (const r of rows) notify(db, r.user_id, { type: 'job_expired', title: `A saved job is no longer open`, body: `${r.title} at ${r.company} was closed or removed by the employer.`, link: `/app/jobs/${r.id}` });
  return rows.length;
}

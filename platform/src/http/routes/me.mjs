import { Router } from 'express';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { config } from '../../config.mjs';
import { verifyPassword } from '../../lib/security.mjs';
import { canonicalSkill, CATEGORY_BY_SLUG } from '../../lib/taxonomy.mjs';
import { loadPreferences } from '../../services/matching.mjs';
import { logUser } from '../../lib/activity.mjs';
import { destroySession } from '../auth-middleware.mjs';
import { ah, HttpError, str, strList, num, oneOf, httpUrl, idParam, clientIp } from '../util.mjs';

export function meRoutes(getDb) {
  const r = Router();

  r.get('/profile', ah(async (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT id, email, full_name, created_at, last_login_at, is_verified FROM users WHERE id = ?').get(req.user.id);
    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(req.user.id) || {};
    res.json({ user, profile: { ...profile, email_notifications: Boolean(profile.email_notifications ?? 1) } });
  }));

  r.put('/profile', ah(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const fullName = str(b.full_name, { field: 'Full name', required: true, min: 2, max: 120 });
    const vals = [
      str(b.headline, { max: 160, field: 'Headline' }),
      str(b.phone, { max: 40, field: 'Phone' }),
      str(b.location, { max: 120, field: 'Location' }),
      b.linkedin_url ? httpUrl(b.linkedin_url, 'LinkedIn URL') : '',
      b.portfolio_url ? httpUrl(b.portfolio_url, 'Portfolio URL') : '',
      str(b.bio, { max: 2000, field: 'Bio' }),
      oneOf(b.theme || 'system', ['system', 'light', 'dark'], 'theme'),
      b.email_notifications === false ? 0 : 1,
    ];
    db.prepare("UPDATE users SET full_name = ?, updated_at = datetime('now') WHERE id = ?").run(fullName, req.user.id);
    db.prepare(`INSERT INTO user_profiles (user_id, headline, phone, location, linkedin_url, portfolio_url, bio, theme, email_notifications)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET headline = excluded.headline, phone = excluded.phone, location = excluded.location,
      linkedin_url = excluded.linkedin_url, portfolio_url = excluded.portfolio_url, bio = excluded.bio, theme = excluded.theme,
      email_notifications = excluded.email_notifications, updated_at = datetime('now')`).run(req.user.id, ...vals);
    res.json({ ok: true });
  }));

  r.get('/preferences', ah(async (req, res) => {
    res.json({ preferences: loadPreferences(getDb(), req.user.id) });
  }));

  r.put('/preferences', ah(async (req, res) => {
    const db = getDb();
    const b = req.body || {};
    const categories = strList(b.categories, { field: 'Categories', maxItems: 30 }).filter((c) => CATEGORY_BY_SLUG.has(c));
    const arrangements = strList(b.work_arrangements, { field: 'Work arrangements' }).filter((a) => ['Remote', 'Hybrid', 'WFO'].includes(a));
    const vals = [
      JSON.stringify(strList(b.desired_titles, { field: 'Desired titles', maxItems: 15 })),
      JSON.stringify(strList(b.desired_skills, { field: 'Skills', maxItems: 60 }).map(canonicalSkill)),
      JSON.stringify(categories),
      JSON.stringify(strList(b.locations, { field: 'Locations', maxItems: 15 })),
      JSON.stringify(arrangements.length ? arrangements : ['Remote', 'Hybrid', 'WFO']),
      num(b.min_salary, { min: 0, max: 1e9, field: 'Minimum salary' }),
      str(b.salary_currency, { max: 8, field: 'Currency' }).toUpperCase(),
      num(b.experience_years, { min: 0, max: 60, field: 'Experience' }),
      num(b.min_match_score ?? 50, { min: 0, max: 100, field: 'Minimum match', nullable: false, int: true }),
      b.notify_new_matches === false ? 0 : 1,
    ];
    db.prepare(`INSERT INTO job_preferences (user_id, desired_titles, desired_skills, categories, locations, work_arrangements, min_salary, salary_currency, experience_years, min_match_score, notify_new_matches)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET desired_titles = excluded.desired_titles, desired_skills = excluded.desired_skills,
      categories = excluded.categories, locations = excluded.locations, work_arrangements = excluded.work_arrangements, min_salary = excluded.min_salary,
      salary_currency = excluded.salary_currency, experience_years = excluded.experience_years, min_match_score = excluded.min_match_score,
      notify_new_matches = excluded.notify_new_matches, updated_at = datetime('now')`).run(req.user.id, ...vals);
    res.json({ preferences: loadPreferences(db, req.user.id) });
  }));

  r.get('/notifications', ah(async (req, res) => {
    const db = getDb();
    const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    res.json({ items: items.map((n) => ({ ...n, is_read: Boolean(n.is_read) })), unread });
  }));

  r.post('/notifications/read', ah(async (req, res) => {
    const db = getDb();
    if (req.body?.id) db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(idParam(req.body.id), req.user.id);
    else db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  }));

  r.delete('/notifications/:id', ah(async (req, res) => {
    getDb().prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(idParam(req.params.id), req.user.id);
    res.json({ ok: true });
  }));

  // Self-service account deletion: removes the user, every owned row (cascade) and their files.
  r.delete('/account', ah(async (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT u.password_hash, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?').get(req.user.id);
    if (!(await verifyPassword(String(req.body?.password || ''), user.password_hash))) throw new HttpError(400, 'Password is incorrect.');
    if (user.role === 'admin' && db.prepare("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.status = 'active'").get().n <= 1) {
      throw new HttpError(400, 'You are the only administrator. Promote another admin before deleting your account.');
    }
    logUser(db, { userId: null, action: 'account_deleted', details: { former_user_id: req.user.id }, ip: clientIp(req) });
    destroySession(db, req, res);
    db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
    rmSync(path.join(config.uploadDir, String(Number(req.user.id))), { recursive: true, force: true });
    res.json({ ok: true });
  }));

  return r;
}

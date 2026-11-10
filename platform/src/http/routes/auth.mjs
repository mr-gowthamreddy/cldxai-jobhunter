import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../../config.mjs';
import { hashPassword, verifyPassword, dummyVerify, passwordProblems, newToken, sha256 } from '../../lib/security.mjs';
import { sendMail, mailConfigured } from '../../lib/mailer.mjs';
import { logUser } from '../../lib/activity.mjs';
import { notify } from '../../services/notifications.mjs';
import { ah, HttpError, str, email as emailField, clientIp } from '../util.mjs';
import { createSession, destroySession, requireAuth } from '../auth-middleware.mjs';

export function authRoutes(getDb) {
  const r = Router();
  const limiter = (max, windowMin) => rateLimit({
    windowMs: windowMin * 60 * 1000, limit: config.env === 'test' ? 10000 : max, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  });

  r.post('/register', limiter(10, 15), ah(async (req, res) => {
    if (!config.allowRegistration) throw new HttpError(403, 'Registration is closed. Ask an administrator for an account.');
    const db = getDb();
    const fullName = str(req.body.full_name, { field: 'Full name', required: true, min: 2, max: 120 });
    const mail = emailField(req.body.email);
    const password = String(req.body.password || '');
    const problems = passwordProblems(password);
    if (problems.length) throw new HttpError(400, `Password needs ${problems.join(', ')}.`);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) throw new HttpError(409, 'An account with this email already exists. Try signing in or resetting your password.');
    const hash = await hashPassword(password);
    const roleId = db.prepare("SELECT id FROM roles WHERE name = 'user'").get().id;
    const status = config.requireAdminApproval ? 'pending' : 'active';
    const info = db.prepare('INSERT INTO users (email, password_hash, full_name, role_id, status) VALUES (?, ?, ?, ?, ?)').run(mail, hash, fullName, roleId, status);
    const userId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO user_profiles (user_id) VALUES (?)').run(userId);
    db.prepare('INSERT INTO job_preferences (user_id) VALUES (?)').run(userId);
    logUser(db, { userId, action: 'register', ip: clientIp(req) });
    notify(db, userId, { type: 'account', title: `Welcome to ${config.appName}`, body: 'Start by uploading your resume so we can match you with active jobs.', link: '/app/resumes' });
    if (status === 'pending') {
      return res.status(201).json({ ok: true, pending: true, message: 'Account created. An administrator must approve it before you can sign in.' });
    }
    const { csrf } = createSession(db, req, res, userId);
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
    res.status(201).json({ ok: true, csrf, user: { id: userId, email: mail, full_name: fullName, role: 'user' } });
  }));

  r.post('/login', limiter(20, 15), ah(async (req, res) => {
    const db = getDb();
    const mail = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body.password || '').slice(0, 200);
    const user = db.prepare('SELECT u.*, r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?').get(mail);
    if (!user) { await dummyVerify(password); throw new HttpError(401, 'Incorrect email or password.'); }
    if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
      throw new HttpError(429, 'Too many failed attempts. This account is temporarily locked; try again later or reset your password.');
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.loginMaxAttempts ? new Date(Date.now() + config.loginLockMinutes * 60000).toISOString() : null;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : fails, lock, user.id);
      logUser(db, { userId: user.id, action: 'login_failed', ip: clientIp(req) });
      throw new HttpError(401, 'Incorrect email or password.');
    }
    if (user.status === 'pending') throw new HttpError(403, 'Your account is waiting for administrator approval.');
    if (user.status === 'disabled') throw new HttpError(403, 'This account has been deactivated. Contact an administrator.');
    db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").run(user.id);
    // Fresh session on login (prevents session fixation).
    destroySession(db, req, res);
    const { csrf } = createSession(db, req, res, user.id);
    logUser(db, { userId: user.id, action: 'login', ip: clientIp(req) });
    res.json({ ok: true, csrf, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
  }));

  r.post('/logout', ah(async (req, res) => {
    const db = getDb();
    if (req.user) logUser(db, { userId: req.user.id, action: 'logout', ip: clientIp(req) });
    destroySession(db, req, res);
    res.json({ ok: true });
  }));

  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null, registration: config.allowRegistration, app_name: config.appName });
    res.json({ user: req.user, csrf: req.session.csrf, app_name: config.appName });
  });

  r.post('/forgot', limiter(5, 15), ah(async (req, res) => {
    const db = getDb();
    const mail = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const user = db.prepare("SELECT id, email, full_name FROM users WHERE email = ? AND status != 'disabled'").get(mail);
    // Same answer whether or not the account exists.
    const answer = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };
    if (!user) return res.json(answer);
    const token = newToken(32);
    db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)')
      .run(user.id, sha256(token), new Date(Date.now() + config.passwordResetTtlMinutes * 60000).toISOString());
    const link = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: user.email,
      subject: `Reset your ${config.appName} password`,
      text: `Hi ${user.full_name},\n\nUse this link to choose a new password. It expires in ${config.passwordResetTtlMinutes} minutes and can be used once:\n\n${link}\n\nIf you did not ask for this, ignore this email; your password stays the same.\n`,
    });
    logUser(db, { userId: user.id, action: 'password_reset_requested', ip: clientIp(req) });
    if (!mailConfigured()) answer.dev_note = 'SMTP is not configured on this server, so the reset email was saved to the server outbox folder instead of being sent. Ask the administrator.';
    res.json(answer);
  }));

  r.post('/reset', limiter(10, 15), ah(async (req, res) => {
    const db = getDb();
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(token));
    if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.');
    const problems = passwordProblems(password);
    if (problems.length) throw new HttpError(400, `Password needs ${problems.join(', ')}.`);
    const hash = await hashPassword(password);
    db.prepare("UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = ?").run(hash, row.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").run(row.user_id);
    // Sign out every existing session for this account.
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    logUser(db, { userId: row.user_id, action: 'password_reset', ip: clientIp(req) });
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  }));

  r.post('/change-password', requireAuth, ah(async (req, res) => {
    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(String(req.body.current_password || ''), user.password_hash))) throw new HttpError(400, 'Your current password is incorrect.');
    const problems = passwordProblems(req.body.new_password);
    if (problems.length) throw new HttpError(400, `New password needs ${problems.join(', ')}.`);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(await hashPassword(req.body.new_password), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(req.user.id, req.session.id);
    logUser(db, { userId: req.user.id, action: 'password_changed', ip: clientIp(req) });
    res.json({ ok: true });
  }));

  return r;
}

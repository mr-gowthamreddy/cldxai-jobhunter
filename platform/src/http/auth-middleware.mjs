// Session + CSRF + role middleware.
//
// Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie; only its
// SHA-256 is stored. CSRF: every state-changing /api request from a logged-in
// session must echo the session's CSRF token in X-CSRF-Token. Unauthenticated
// POSTs (login/register/forgot/reset) must come from this origin.

import { config } from '../config.mjs';
import { sha256, newToken } from '../lib/security.mjs';
import { HttpError, clientIp } from './util.mjs';

export const SESSION_COOKIE = 'cops_sid';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* malformed cookie */ }
  }
  return out;
}

function cookieAttrs(maxAgeSec) {
  const secure = config.cookieSecure || config.publicUrl.startsWith('https://');
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

export function createSession(db, req, res, userId) {
  const token = newToken(32);
  const csrf = newToken(24);
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, csrf_token, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha256(token), userId, csrf, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 300), expires);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieAttrs(config.sessionTtlHours * 3600)}`);
  return { csrf };
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(0)}`);
}

export function sessionMiddleware(getDb) {
  return (req, res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const db = getDb();
    const row = db.prepare(`SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, s.expires_at,
        u.id, u.email, u.full_name, u.status, u.is_verified, r.name AS role
      FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id
      WHERE s.token_hash = ?`).get(sha256(token));
    if (!row) return next();
    if (Date.parse(row.expires_at) < Date.now() || row.status !== 'active') {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
      return next();
    }
    req.user = { id: row.id, email: row.email, full_name: row.full_name, role: row.role, is_verified: Boolean(row.is_verified) };
    req.session = { id: row.session_id, csrf: row.csrf_token };
    // Touch at most once a minute.
    if (Date.now() - Date.parse(row.last_seen_at + 'Z') > 60_000) {
      db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(row.session_id);
    }
    next();
  };
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfMiddleware(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (req.user) {
    const sent = req.headers['x-csrf-token'];
    if (!sent || sent !== req.session.csrf) return next(new HttpError(403, 'Invalid or missing CSRF token. Reload the page and try again.'));
    return next();
  }
  // No session: allow only same-origin requests (blocks login CSRF from other sites).
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers.host;
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { ok = false; }
    if (!ok) return next(new HttpError(403, 'Cross-origin request refused.'));
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (req.user.role !== 'admin') return next(new HttpError(403, 'Administrator access required.'));
  next();
}

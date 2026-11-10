import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setupEnv, startApp, client } from './helpers.mjs';

const dir = setupEnv({ LOGIN_MAX_ATTEMPTS: '3' });
let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.close(); });

test('registration creates a session and hashes the password', async () => {
  const c = client(ctx.base);
  const r = await c.register('alice@example.com', 'AlicePass123', 'Alice Example');
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
  assert.ok(c.cookie.startsWith('cops_sid='));
  const row = ctx.db.prepare('SELECT password_hash FROM users WHERE email = ?').get('alice@example.com');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('AlicePass123'));
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.email, 'alice@example.com');
  // Session token is stored hashed, never raw.
  const raw = c.cookie.split('=')[1];
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM sessions WHERE token_hash = ?').get(raw).n, 0);
});

test('registration validation: duplicate email, weak password, bad email', async () => {
  const c = client(ctx.base);
  assert.equal((await c.register('ALICE@example.com', 'AlicePass123')).status, 409);
  assert.equal((await c.register('weak@example.com', 'short')).status, 400);
  assert.equal((await c.register('weak@example.com', 'onlyletters')).status, 400);
  assert.equal((await c.register('not-an-email', 'GoodPass123')).status, 400);
});

test('login, wrong password, logout', async () => {
  const c = client(ctx.base);
  assert.equal((await c.login('alice@example.com', 'wrong-password1')).status, 401);
  assert.equal((await c.login('nobody@example.com', 'whatever123')).status, 401);
  const ok = await c.login('alice@example.com', 'AlicePass123');
  assert.equal(ok.status, 200);
  assert.ok(ok.data.csrf);
  assert.equal((await c.get('/api/dashboard')).status, 200);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/dashboard')).status, 401);
});

test('protected endpoints require a session', async () => {
  const c = client(ctx.base);
  for (const p of ['/api/dashboard', '/api/jobs', '/api/resumes', '/api/applications', '/api/me/profile', '/api/admin/overview']) {
    assert.equal((await c.get(p)).status, 401, p);
  }
});

test('CSRF: state-changing requests need the session token; cross-origin anonymous POSTs are refused', async () => {
  const c = client(ctx.base);
  await c.login('alice@example.com', 'AlicePass123');
  const token = c.csrf;
  c.csrf = '';
  assert.equal((await c.put('/api/me/profile', { full_name: 'Hacked' })).status, 403);
  c.csrf = 'wrong';
  assert.equal((await c.put('/api/me/profile', { full_name: 'Hacked' })).status, 403);
  c.csrf = token;
  assert.equal((await c.put('/api/me/profile', { full_name: 'Alice Example' })).status, 200);
  const anon = client(ctx.base);
  const r = await anon.raw('POST', '/api/auth/login', { body: { email: 'alice@example.com', password: 'AlicePass123' }, headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});

test('account lockout after repeated failures', async () => {
  const c = client(ctx.base);
  await c.register('locky@example.com', 'LockyPass123');
  for (let i = 0; i < 3; i++) await c.login('locky@example.com', 'bad-password-9');
  const r = await c.login('locky@example.com', 'LockyPass123');
  assert.equal(r.status, 429);
});

test('forgot / reset password: one-time token, sessions revoked', async () => {
  const victim = client(ctx.base);
  await victim.register('bob@example.com', 'BobPass123', 'Bob');
  const anon = client(ctx.base);
  const f = await anon.post('/api/auth/forgot', { email: 'bob@example.com' });
  assert.equal(f.status, 200);
  // Unknown email returns the same message (no account enumeration).
  const g = await anon.post('/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(g.data.message, f.data.message);
  const outbox = path.join(dir, 'outbox');
  const file = readdirSync(outbox).find((n) => n.includes('bob@example.com'));
  const token = /token=([A-Za-z0-9_\-%]+)/.exec(readFileSync(path.join(outbox, file), 'utf8'))[1];
  assert.equal((await anon.post('/api/auth/reset', { token: 'bogus', password: 'NewPass123' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset', { token: decodeURIComponent(token), password: 'short' })).status, 400);
  assert.equal((await anon.post('/api/auth/reset', { token: decodeURIComponent(token), password: 'BrandNew123' })).status, 200);
  assert.equal((await anon.post('/api/auth/reset', { token: decodeURIComponent(token), password: 'Again12345' })).status, 400, 'token is single-use');
  assert.equal((await victim.get('/api/dashboard')).status, 401, 'old session revoked');
  assert.equal((await anon.login('bob@example.com', 'BobPass123')).status, 401);
  assert.equal((await anon.login('bob@example.com', 'BrandNew123')).status, 200);
});

test('change password keeps the current session and revokes others', async () => {
  const a = client(ctx.base); const b = client(ctx.base);
  await a.register('carol@example.com', 'CarolPass123');
  await b.login('carol@example.com', 'CarolPass123');
  assert.equal((await a.post('/api/auth/change-password', { current_password: 'nope', new_password: 'CarolNew123' })).status, 400);
  assert.equal((await a.post('/api/auth/change-password', { current_password: 'CarolPass123', new_password: 'CarolNew123' })).status, 200);
  assert.equal((await a.get('/api/dashboard')).status, 200);
  assert.equal((await b.get('/api/dashboard')).status, 401);
});

test('security headers are set', async () => {
  const r = await fetch(`${ctx.base}/`);
  assert.match(r.headers.get('content-security-policy') || '', /script-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

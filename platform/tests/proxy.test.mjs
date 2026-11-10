// Sharing through a tunnel / reverse proxy (https) while also using http://localhost.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, startApp, client } from './helpers.mjs';

setupEnv({ TRUST_PROXY: 'true', PUBLIC_URL: 'https://jobs-share.example.com' });
let ctx;
before(async () => { ctx = await startApp(); await client(ctx.base).register('share@example.com', 'SharePass1', 'Sharer'); });
after(async () => { await ctx.close(); });

const login = (headers) => fetch(`${ctx.base}/api/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify({ email: 'share@example.com', password: 'SharePass1' }),
});

test('through the https tunnel: login allowed and the cookie is Secure', async () => {
  const r = await login({ origin: 'https://jobs-share.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'jobs-share.example.com' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /; Secure/);
});

test('a tunnel that rewrites Host still works via X-Forwarded-Host', async () => {
  const r = await login({ origin: 'https://random-words.trycloudflare.com', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'random-words.trycloudflare.com' });
  assert.equal(r.status, 200);
});

test('plain http://localhost on the same server: login works with a non-Secure cookie', async () => {
  const host = new URL(ctx.base).host;
  const r = await login({ origin: `http://${host}` });
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.headers.get('set-cookie'), /; Secure/);
});

test('a foreign site is still refused', async () => {
  const r = await login({ origin: 'https://evil.example', 'x-forwarded-proto': 'https' });
  assert.equal(r.status, 403);
});

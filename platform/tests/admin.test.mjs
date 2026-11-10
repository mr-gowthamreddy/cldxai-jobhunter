import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, startApp, client, makeAdmin, seedJobs } from './helpers.mjs';

setupEnv({ REQUIRE_ADMIN_APPROVAL: 'true' });
let ctx; let admin; let user;
before(async () => {
  ctx = await startApp();
  await makeAdmin(ctx.db, 'root@example.com');
  admin = client(ctx.base);
  assert.equal((await admin.login('root@example.com', 'AdminPass123')).status, 200);
  user = client(ctx.base);
});
after(async () => { await ctx.close(); });

const ADMIN_GETS = ['/api/admin/overview', '/api/admin/users', '/api/admin/activity', '/api/admin/resumes', '/api/admin/jobs', '/api/admin/duplicates', '/api/admin/sources', '/api/admin/providers', '/api/admin/fetch-runs', '/api/admin/logs', '/api/admin/errors', '/api/admin/sheets', '/api/admin/settings'];

test('pending accounts need approval; approval lets them sign in', async () => {
  const r = await user.register('pending@example.com', 'PendPass123', 'Pending Person');
  assert.equal(r.status, 201);
  assert.equal(r.data.pending, true);
  assert.equal((await user.login('pending@example.com', 'PendPass123')).status, 403);
  const { items } = (await admin.get('/api/admin/users?status=pending')).data;
  const u = items.find((x) => x.email === 'pending@example.com');
  assert.equal((await admin.patch(`/api/admin/users/${u.id}`, { status: 'active', is_verified: true })).status, 200);
  assert.equal((await user.login('pending@example.com', 'PendPass123')).status, 200);
});

test('normal users get 403 on every admin endpoint', async () => {
  for (const p of ADMIN_GETS) assert.equal((await user.get(p)).status, 403, p);
  const uid = ctx.db.prepare("SELECT id FROM users WHERE email = 'pending@example.com'").get().id;
  assert.equal((await user.patch(`/api/admin/users/${uid}`, { role: 'admin' })).status, 403, 'cannot promote self');
  assert.equal((await user.post('/api/admin/fetch', {})).status, 403);
  assert.equal((await user.post('/api/admin/sources', { name: 'x', provider: 'remotive' })).status, 403);
  assert.equal((await user.put('/api/admin/settings', { fetch_daily_at: '01:00' })).status, 403);
});

test('admin endpoints all respond for an admin', async () => {
  for (const p of ADMIN_GETS) assert.equal((await admin.get(p)).status, 200, p);
});

test('deactivating a user ends their sessions and blocks login; roles can change', async () => {
  const uid = ctx.db.prepare("SELECT id FROM users WHERE email = 'pending@example.com'").get().id;
  await admin.patch(`/api/admin/users/${uid}`, { status: 'disabled' });
  assert.equal((await user.get('/api/dashboard')).status, 401);
  assert.equal((await user.login('pending@example.com', 'PendPass123')).status, 403);
  await admin.patch(`/api/admin/users/${uid}`, { status: 'active' });
  await admin.patch(`/api/admin/users/${uid}`, { role: 'admin' });
  assert.equal((await user.login('pending@example.com', 'PendPass123')).status, 200);
  assert.equal((await user.get('/api/admin/overview')).status, 200, 'promoted user can use admin');
  await admin.patch(`/api/admin/users/${uid}`, { role: 'user' });
  assert.equal((await user.get('/api/admin/overview')).status, 403, 'demotion takes effect immediately');
  const log = (await admin.get('/api/admin/activity')).data.admin_activity;
  assert.ok(log.some((a) => a.action === 'user_updated'));
});

test('the last active admin cannot be removed, disabled or demoted', async () => {
  const me = ctx.db.prepare("SELECT id FROM users WHERE email = 'root@example.com'").get().id;
  assert.equal((await admin.patch(`/api/admin/users/${me}`, { status: 'disabled' })).status, 400);
  assert.equal((await admin.patch(`/api/admin/users/${me}`, { role: 'user' })).status, 400);
  assert.equal((await admin.del(`/api/admin/users/${me}`)).status, 400);
});

test('resume monitoring exposes counts, not contents', async () => {
  await user.upload('/api/resumes', 'data-engineer.pdf');
  const r = (await admin.get('/api/admin/resumes')).data;
  const json = JSON.stringify(r);
  assert.ok(r.by_type.some((t) => t.file_ext === 'pdf' && t.n === 1));
  for (const secret of ['asha.verma@example.com', 'Databricks', 'raw_text', '98765']) assert.ok(!json.includes(secret), secret);
  const overview = JSON.stringify((await admin.get('/api/admin/overview')).data);
  assert.ok(!overview.includes('asha.verma'));
});

test('sources: validation, create, test-less update, disable, delete closes jobs', async () => {
  assert.equal((await admin.post('/api/admin/sources', { name: 'Bad', careers_url: 'https://example.com/careers' })).status, 400, 'no provider recognises the URL');
  assert.equal((await admin.post('/api/admin/sources', { name: 'Bad2' })).status, 400);
  const ok = await admin.post('/api/admin/sources', { name: 'Acme Greenhouse', careers_url: 'https://job-boards.greenhouse.io/acme' });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.provider, 'greenhouse');
  const feed = await admin.post('/api/admin/sources', { name: 'Remotive 2', provider: 'remotive', kind: 'aggregator', config: { remote_only: true } });
  assert.equal(feed.status, 201);
  assert.equal((await admin.patch(`/api/admin/sources/${ok.data.id}`, { enabled: false })).status, 200);
  const src = ctx.db.prepare('SELECT * FROM job_sources WHERE id = ?').get(ok.data.id);
  assert.equal(src.enabled, 0);
  const { counters } = await seedJobs(ctx.db, [{ title: 'Remote Thing', url: 'https://d.example.com/1', company: 'Del', location: 'Remote', description: 'Remote', postedAt: Date.now() }], { name: 'ToDelete' });
  const sid = ctx.db.prepare('SELECT source_id FROM jobs WHERE id = ?').get(counters.newIds[0]).source_id;
  assert.equal((await admin.del(`/api/admin/sources/${sid}`)).status, 200);
  assert.equal(ctx.db.prepare('SELECT status FROM jobs WHERE id = ?').get(counters.newIds[0]).status, 'closed');
});

test('duplicates can be swapped or unmarked', async () => {
  const job = { title: 'Twin Role', company: 'Twins', location: 'Remote', description: 'Remote role.', postedAt: Date.now() };
  await seedJobs(ctx.db, [{ ...job, url: 'https://a.example.com/twin' }], { name: 'Twins A' });
  await seedJobs(ctx.db, [{ ...job, url: 'https://b.example.com/twin' }], { name: 'Twins B' });
  const dups = (await admin.get('/api/admin/duplicates')).data.items;
  assert.equal(dups.length, 1);
  assert.equal((await admin.post(`/api/admin/jobs/${dups[0].id}/make-primary`)).status, 200);
  const after1 = (await admin.get('/api/admin/duplicates')).data.items;
  assert.equal(after1[0].primary_id, dups[0].id);
  await admin.post(`/api/admin/jobs/${after1[0].id}/not-duplicate`);
  assert.equal((await admin.get('/api/admin/duplicates')).data.items.length, 0);
});

test('settings: daily time and experience bands validated and applied', async () => {
  assert.equal((await admin.put('/api/admin/settings', { fetch_daily_at: '25:00' })).status, 400);
  assert.equal((await admin.put('/api/admin/settings', { experience_bands: [{ label: 'x', min: 5, max: 2 }] })).status, 400);
  const bands = [{ id: 'entry', label: 'Entry', min: 0, max: 3 }, { id: 'mid', label: 'Mid', min: 3, max: 7 }, { id: 'senior', label: 'Senior', min: 7, max: null }];
  assert.equal((await admin.put('/api/admin/settings', { fetch_daily_at: '07:30', experience_bands: bands })).status, 200);
  const s = (await admin.get('/api/admin/settings')).data;
  assert.equal(s.fetch_daily_at, '07:30');
  assert.deepEqual(s.experience_bands.map((b) => b.id), ['entry', 'mid', 'senior']);
  const meta = (await user.get('/api/jobs/meta')).data;
  assert.deepEqual(meta.experience_bands.map((b) => b.label), ['Entry', 'Mid', 'Senior']);
});

test('manual fetch request is queued for a live worker', async () => {
  const { setSetting, getSetting } = await import('../src/db/index.mjs');
  setSetting(ctx.db, 'scheduler_heartbeat', { at: new Date().toISOString(), pid: process.pid + 1, role: 'worker' });
  const r = await admin.post('/api/admin/fetch', {});
  assert.equal(r.status, 202);
  assert.equal(r.data.queued, true);
  assert.ok(getSetting(ctx.db, 'fetch_requested'));
});

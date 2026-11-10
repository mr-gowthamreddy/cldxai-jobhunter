// Link verification, scheduler, Google Sheets and persistence — no network needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { setupEnv, startApp, seedJobs } from './helpers.mjs';

const dir = setupEnv();
let ctx;
before(async () => { ctx = await startApp(); });
after(async () => { await ctx.close(); });

function fakeFetch(map) {
  return async (url) => {
    const r = map[url];
    if (!r) { const e = new Error('getaddrinfo ENOTFOUND'); throw e; }
    if (r.status >= 400) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.body = r.body || ''; throw e; }
    return new Response(r.body ?? '', { status: r.status, headers: r.headers || {} });
  };
}
const LIVE = '<html><body><h1>Data Engineer</h1><p>' + 'We are looking for an engineer to build pipelines. '.repeat(20) + '</p><a href="/apply">Apply now</a></body></html>';
const CLOSED = '<html><body><h1>Data Engineer</h1><p>This job is no longer accepting applications. The position has been filled.</p></body></html>';

test('checkLink: live, gone, closed banner, redirect, bot wall, unreachable', async () => {
  const { checkLink } = await import('../src/services/link-verifier.mjs');
  const fetchImpl = fakeFetch({
    'https://jobs.example.com/live': { status: 200, body: LIVE },
    'https://jobs.example.com/gone': { status: 404 },
    'https://jobs.example.com/closed': { status: 200, body: CLOSED },
    'https://jobs.example.com/moved': { status: 301, headers: { location: '/live' } },
    'https://jobs.example.com/blocked': { status: 403 },
  });
  assert.equal((await checkLink('https://jobs.example.com/live', { fetchImpl })).result, 'active');
  assert.equal((await checkLink('https://jobs.example.com/gone', { fetchImpl })).result, 'expired');
  assert.equal((await checkLink('https://jobs.example.com/closed', { fetchImpl })).result, 'expired');
  const moved = await checkLink('https://jobs.example.com/moved', { fetchImpl });
  assert.equal(moved.result, 'active');
  assert.equal(moved.finalUrl, 'https://jobs.example.com/live');
  assert.equal((await checkLink('https://jobs.example.com/blocked', { fetchImpl })).result, 'uncertain', 'a bot wall is never "expired"');
  assert.equal((await checkLink('https://nowhere.invalid/x', { fetchImpl })).result, 'broken');
  assert.equal((await checkLink('javascript:alert(1)', { fetchImpl })).result, 'broken');
});

test('verifyJobLinks updates job status and visibility', async () => {
  const { verifyJobLinks, checkLink } = await import('../src/services/link-verifier.mjs');
  await seedJobs(ctx.db, [
    { title: 'Live Remote', url: 'https://jobs.example.com/live', company: 'L', location: 'Remote', description: 'Remote', postedAt: Date.now() },
    { title: 'Gone Remote', url: 'https://jobs.example.com/gone', company: 'G', location: 'Remote', description: 'Remote', postedAt: Date.now() },
    { title: 'Blocked Remote', url: 'https://jobs.example.com/blocked', company: 'B', location: 'Remote', description: 'Remote', postedAt: Date.now() },
  ], { kind: 'aggregator', name: 'Agg' });
  const fetchImpl = fakeFetch({ 'https://jobs.example.com/live': { status: 200, body: LIVE }, 'https://jobs.example.com/gone': { status: 410 }, 'https://jobs.example.com/blocked': { status: 403 } });
  const r = await verifyJobLinks(ctx.db, { check: (u) => checkLink(u, { fetchImpl }) });
  assert.equal(r.checked, 3);
  const st = (t) => ctx.db.prepare('SELECT status, link_status FROM jobs WHERE title = ?').get(t);
  assert.deepEqual({ ...st('Live Remote') }, { status: 'active', link_status: 'verified' });
  assert.deepEqual({ ...st('Gone Remote') }, { status: 'expired', link_status: 'expired' });
  assert.deepEqual({ ...st('Blocked Remote') }, { status: 'active', link_status: 'source_confirmed' });
});

test('scheduler: daily slot, once per day, manual request, stale start-up', async () => {
  const { dueReason, nextRunAt } = await import('../src/services/scheduler.mjs');
  const at = (h, m = 0) => { const d = new Date(2026, 10, 10, h, m); return d; };
  assert.equal(dueReason({ now: at(5, 59), dailyAt: '06:00', lastScheduledDay: '2026-11-09', lastSuccessAt: at(1).toISOString() }), null);
  assert.equal(dueReason({ now: at(6, 1), dailyAt: '06:00', lastScheduledDay: '2026-11-09', lastSuccessAt: at(1).toISOString() }), 'schedule');
  assert.equal(dueReason({ now: at(9), dailyAt: '06:00', lastScheduledDay: '2026-11-10', lastSuccessAt: at(6).toISOString() }), null, 'only once per day');
  assert.equal(dueReason({ now: at(9), dailyAt: '06:00', lastScheduledDay: '2026-11-10', requestedAt: 'x' }), 'manual');
  assert.equal(dueReason({ now: at(3), dailyAt: '06:00', lastScheduledDay: '2026-11-09', lastSuccessAt: null, startup: true, fetchOnStartupIfStale: true }), 'startup');
  assert.equal(dueReason({ now: at(3), dailyAt: '06:00', lastScheduledDay: '2026-11-09', lastSuccessAt: at(1).toISOString(), startup: true }), null);
  assert.equal(nextRunAt(at(3), '06:00', '2026-11-09').getHours(), 6);
  assert.equal(nextRunAt(at(9), '06:00', '2026-11-10').getDate(), 11);
});

test('scheduler loop runs a queued manual fetch without any browser', async () => {
  const { startScheduler } = await import('../src/services/scheduler.mjs');
  const { setSetting, getSetting } = await import('../src/db/index.mjs');
  ctx.db.prepare('UPDATE job_sources SET enabled = 0').run(); // no network in tests
  setSetting(ctx.db, 'last_successful_fetch_at', new Date().toISOString());
  setSetting(ctx.db, 'fetch_requested', { at: new Date().toISOString() });
  const runsBefore = ctx.db.prepare('SELECT COUNT(*) n FROM fetch_runs').get().n;
  const s = startScheduler(ctx.db, { intervalMs: 200, log: () => {} });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && ctx.db.prepare('SELECT COUNT(*) n FROM fetch_runs').get().n === runsBefore) await new Promise((r) => setTimeout(r, 100));
  while (Date.now() < deadline && getSetting(ctx.db, 'fetch_lock', null)) await new Promise((r) => setTimeout(r, 100));
  s.stop();
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM fetch_runs').get().n, runsBefore + 1);
  assert.equal(getSetting(ctx.db, 'fetch_requested', null), null, 'request consumed');
  assert.ok(getSetting(ctx.db, 'scheduler_heartbeat').at);
});

test('Google Sheets: skipped when unconfigured; daily tab, header, de-duplicated rows, formula-safe', async () => {
  const { syncJobsToSheet, sheetsConfigProblem, _resetTokenCache, SHEET_HEADER } = await import('../src/services/sheets.mjs');
  const skipped = await syncJobsToSheet(ctx.db);
  assert.equal(skipped.status, 'skipped');
  assert.match(skipped.message, /disabled/);

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const cfg = { enabled: true, spreadsheetId: 'sheet123', serviceAccountEmail: 'svc@proj.iam.gserviceaccount.com', privateKey, tabPrefix: 'Jobs', maxDescriptionChars: 100 };
  assert.equal(sheetsConfigProblem(cfg), null);
  await seedJobs(ctx.db, [{ title: '=HYPERLINK("evil")', url: 'https://s.example.com/1', company: 'Sheety', location: 'Remote', description: 'Remote. SQL.', postedAt: Date.now() }], { name: 'Sheety' });

  const sheet = { tabs: [], rows: {} };
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      assert.match(String(opts.body), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
      return json({ access_token: 'tok', expires_in: 3600 });
    }
    assert.equal(opts.headers.authorization, 'Bearer tok');
    const u = new URL(url);
    if (u.pathname.endsWith('/sheet123') && (opts.method || 'GET') === 'GET') return json({ sheets: sheet.tabs.map((t) => ({ properties: { title: t } })) });
    if (u.pathname.endsWith(':batchUpdate')) { const t = JSON.parse(opts.body).requests[0].addSheet.properties.title; sheet.tabs.push(t); sheet.rows[t] = []; return json({}); }
    const range = decodeURIComponent(u.pathname.split('/values/')[1] || '');
    const tab = range.replace(/:append$/, '').split('!')[0].replace(/^'|'$/g, '');
    if (opts.method === 'PUT') { sheet.rows[tab].push(...JSON.parse(opts.body).values); return json({}); }
    if (opts.method === 'POST' && range.endsWith(':append')) { sheet.rows[tab].push(...JSON.parse(opts.body).values); return json({}); }
    if (!opts.method || opts.method === 'GET') return json({ values: sheet.rows[tab].slice(1).map((r) => [r[0]]) });
    return json({}, 404);
  };
  _resetTokenCache();
  const first = await syncJobsToSheet(ctx.db, { cfg, fetchImpl });
  assert.equal(first.status, 'success', first.message);
  assert.ok(first.rows >= 1);
  assert.equal(sheet.tabs.length, 1);
  assert.match(sheet.tabs[0], /^Jobs \d{4}-\d{2}-\d{2}$/);
  const rows = sheet.rows[sheet.tabs[0]];
  assert.deepEqual(rows[0], SHEET_HEADER);
  const evil = rows.find((r) => r[1].includes('HYPERLINK'));
  assert.ok(evil[1].startsWith("'="), 'formula injection neutralised');
  assert.ok(rows.every((r) => r.length === SHEET_HEADER.length));
  const second = await syncJobsToSheet(ctx.db, { cfg, fetchImpl });
  assert.equal(second.status, 'success');
  assert.equal(second.rows, 0, 'no duplicate rows on re-sync');
  assert.equal(sheet.tabs.length, 1, 'tab reused the same day');
  const failing = await syncJobsToSheet(ctx.db, { cfg: { ...cfg, spreadsheetId: 'nope' }, fetchImpl: async (u) => (u.includes('oauth2') ? fetchImpl(u, { body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer' }) : new Response('{"error":{"message":"not found"}}', { status: 404 })) });
  assert.equal(failing.status, 'failed');
  // The scheduler test above already logged one "skipped" sync from its post-fetch hook.
  const logs = ctx.db.prepare('SELECT status FROM sheets_sync_logs ORDER BY id').all().map((r) => r.status);
  assert.deepEqual(logs.slice(-4), ['skipped', 'success', 'success', 'failed']);
});

test('database persists across restarts; migrations are idempotent', async () => {
  const { openDatabase, migrate } = await import('../src/db/index.mjs');
  ctx.db.prepare("INSERT INTO settings (key, value) VALUES ('persist_probe', '\"yes\"')").run();
  const second = openDatabase(path.join(dir, 'career-ops.db'));
  assert.deepEqual(migrate(second), [], 'nothing left to migrate');
  assert.equal(second.prepare("SELECT value FROM settings WHERE key = 'persist_probe'").get().value, '"yes"');
  assert.ok(second.prepare('SELECT COUNT(*) n FROM jobs').get().n > 0);
  second.close();
});

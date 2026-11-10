import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { setupEnv, startApp, client, seedJobs, DATA_JD } from './helpers.mjs';

setupEnv();
let ctx; let c; let jobId;
before(async () => {
  ctx = await startApp();
  c = client(ctx.base);
  await c.register('tracker@example.com', 'TrackPass1', 'Tracker');
  await c.upload('/api/resumes', 'data-engineer.pdf');
  jobId = (await seedJobs(ctx.db, [{ title: 'Data Engineer', url: 'https://t.example.com/1', company: 'Trackco', location: 'Bengaluru', description: DATA_JD, postedAt: Date.now() }])).counters.newIds[0];
});
after(async () => { await ctx.close(); });

test('track a platform job (with match score) and refuse duplicates', async () => {
  const r = await c.post('/api/applications', { job_id: jobId, status: 'Interested' });
  assert.equal(r.status, 201);
  assert.equal(r.data.application.company, 'Trackco');
  assert.ok(r.data.application.match_score > 0);
  assert.equal((await c.post('/api/applications', { job_id: jobId })).status, 409);
});

test('manual jobs, validation, every status, history and dates', async () => {
  assert.equal((await c.post('/api/applications', { title: 'No company' })).status, 400);
  assert.equal((await c.post('/api/applications', { company: 'X', title: 'Y', job_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await c.post('/api/applications', { company: 'X', title: 'Y', status: 'Hired!!' })).status, 400);
  const m = await c.post('/api/applications', { company: 'Manual Corp', title: 'BI Developer', job_url: 'https://manual.example.com/job', status: 'Saved' });
  assert.equal(m.data.application.source, 'manual');
  const id = m.data.application.id;
  for (const s of ['Applied', 'Interview Scheduled', 'Technical Round', 'HR Round', 'Offer Received', 'Rejected']) {
    assert.equal((await c.patch(`/api/applications/${id}`, { status: s, event_note: `moved to ${s}` })).status, 200, s);
  }
  await c.patch(`/api/applications/${id}`, { interview_at: '2026-12-01T10:30', notes: 'Panel with 3 people' });
  const d = await c.get(`/api/applications/${id}`);
  assert.equal(d.data.application.status, 'Rejected');
  assert.ok(d.data.application.applied_on, 'applied date auto-filled');
  assert.equal(d.data.application.notes, 'Panel with 3 people');
  assert.equal(d.data.events.length, 7);
  assert.ok(d.data.interview_prep.stage_tips.length > 0);
  assert.equal((await c.patch(`/api/applications/${id}`, { applied_on: 'not-a-date' })).status, 400);
});

test('stats reflect the pipeline', async () => {
  const s = (await c.get('/api/applications/stats')).data;
  assert.equal(s.total, 2);
  assert.equal(s.by_status.Interested, 1);
  assert.equal(s.by_status.Rejected, 1);
  assert.equal(s.applied, 1);
  assert.equal(s.response_rate, 100, 'the manual one reached interview stages');
});

test('export to CSV and Excel', async () => {
  const csv = await c.get('/api/applications/export?format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="applications-.*\.csv"/);
  assert.match(csv.data, /Company,Job Title,Status/);
  assert.match(csv.data, /Manual Corp/);
  const res = await c.raw('GET', '/api/applications/export?format=xlsx', { raw: true });
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('Applications');
  assert.equal(ws.getRow(1).getCell(1).value, 'Company');
  assert.equal(ws.rowCount, 3);
});

test('dashboard summarises the user\'s own data', async () => {
  const d = (await c.get('/api/dashboard')).data;
  assert.equal(d.counts.resumes, 1);
  assert.equal(d.profile.current_role, 'Senior Data Engineer');
  assert.equal(d.recent_applications.length, 2);
  assert.ok(d.matches.good >= 1);
});

test('delete an application', async () => {
  const { items } = (await c.get('/api/applications')).data;
  assert.equal((await c.del(`/api/applications/${items[0].id}`)).status, 200);
  assert.equal((await c.get('/api/applications')).data.items.length, 1);
});

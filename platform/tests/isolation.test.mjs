// One user's resume, profile and history must never be visible to another.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, startApp, client, seedJobs, DATA_JD, MARKETING_JD } from './helpers.mjs';

setupEnv();
let ctx; let A; let B; let resumeId; let appId; let jobId; let searchId;
before(async () => {
  ctx = await startApp();
  const { counters } = await seedJobs(ctx.db, [
    { title: 'Senior Data Engineer', url: 'https://boards.example.com/acme/1', company: 'Acme', location: 'Bengaluru', description: DATA_JD, postedAt: Date.now() },
    { title: 'Content Marketing Manager', url: 'https://boards.example.com/acme/2', company: 'Acme', location: 'Remote', description: MARKETING_JD, postedAt: Date.now() },
  ]);
  jobId = counters.newIds[0];
  // Two users signed in at the same time, each with their own cookie jar.
  A = client(ctx.base); B = client(ctx.base);
  await A.register('asha@example.com', 'AshaPass123', 'Asha');
  await B.register('rohan@example.com', 'RohanPass123', 'Rohan');
  const up = await A.upload('/api/resumes', 'data-engineer.pdf');
  resumeId = up.data.resume.id;
  appId = (await A.post('/api/applications', { job_id: jobId, status: 'Applied', notes: 'secret note' })).data.application.id;
  await A.post(`/api/jobs/${jobId}/save`);
  searchId = (await A.post('/api/me/searches', { name: 'A search', query: { q: 'data' } })).data.id;
  await A.post('/api/me/favorites', { company: 'Acme' });
  await A.put('/api/me/preferences', { desired_titles: ['Data Engineer'], categories: ['data-engineering'] });
});
after(async () => { await ctx.close(); });

test('simultaneous sessions stay separate', async () => {
  assert.equal((await A.get('/api/auth/me')).data.user.email, 'asha@example.com');
  assert.equal((await B.get('/api/auth/me')).data.user.email, 'rohan@example.com');
});

test("B cannot list, read, download, edit or delete A's resume", async () => {
  assert.equal((await B.get('/api/resumes')).data.resumes.length, 0);
  assert.equal((await B.get(`/api/resumes/${resumeId}`)).status, 404);
  assert.equal((await B.get(`/api/resumes/${resumeId}/file`)).status, 404);
  assert.equal((await B.get(`/api/resumes/${resumeId}/insights`)).status, 404);
  assert.equal((await B.put(`/api/resumes/${resumeId}/data`, { candidate_name: 'x' })).status, 404);
  assert.equal((await B.post(`/api/resumes/${resumeId}/activate`)).status, 404);
  assert.equal((await B.post(`/api/resumes/${resumeId}/reparse`)).status, 404);
  assert.equal((await B.del(`/api/resumes/${resumeId}`)).status, 404);
  assert.equal((await A.get(`/api/resumes/${resumeId}`)).status, 200, 'still there for its owner');
});

test("B cannot see or change A's applications, saved jobs, searches or notifications", async () => {
  assert.equal((await B.get('/api/applications')).data.items.length, 0);
  assert.equal((await B.get(`/api/applications/${appId}`)).status, 404);
  assert.equal((await B.patch(`/api/applications/${appId}`, { status: 'Rejected' })).status, 404);
  assert.equal((await B.del(`/api/applications/${appId}`)).status, 404);
  assert.equal((await A.get(`/api/applications/${appId}`)).data.application.status, 'Applied');
  assert.equal((await B.get('/api/jobs/saved')).data.items.length, 0);
  assert.equal((await B.get('/api/me/searches')).data.searches.length, 0);
  assert.equal((await B.del(`/api/me/searches/${searchId}`)).status, 200);
  assert.equal((await A.get('/api/me/searches')).data.searches.length, 1, "B's delete did not touch A's search");
  assert.equal((await B.get('/api/me/favorites')).data.companies.length, 0);
  const aNotes = (await A.get('/api/me/notifications')).data.items;
  const bNotes = (await B.get('/api/me/notifications')).data.items;
  assert.ok(aNotes.length >= 1);
  assert.ok(bNotes.every((n) => !aNotes.some((x) => x.id === n.id)));
  await B.post('/api/me/notifications/read', { id: aNotes[0].id });
  assert.equal((await A.get('/api/me/notifications')).data.items.find((n) => n.id === aNotes[0].id).is_read, false);
  assert.equal((await B.get('/api/applications/export?format=csv')).data.includes('secret note'), false);
});

test("recommendations use only the requesting user's resume", async () => {
  const a = await A.get('/api/jobs/recommendations?min_match=1');
  const b = await B.get('/api/jobs/recommendations');
  assert.equal(a.data.has_profile, true);
  assert.equal(b.data.has_profile, false, 'B has no resume, so gets no resume-based matches');
  assert.equal((await B.get('/api/dashboard')).data.profile, null);
  const bJobs = await B.get('/api/jobs');
  assert.ok(bJobs.data.items.every((j) => j.match === null), "B's job list carries no scores derived from A");
  assert.equal((await B.get('/api/me/preferences')).data.preferences.desired_titles.length, 0);
});

test('job detail is shared public data but per-user state is not', async () => {
  const a = await A.get(`/api/jobs/${jobId}`);
  const b = await B.get(`/api/jobs/${jobId}`);
  assert.equal(a.data.job.saved, true);
  assert.equal(b.data.job.saved, false);
  assert.ok(a.data.job.application);
  assert.equal(b.data.job.application, null);
  assert.equal(b.data.favorite_company, false);
});

test('deleting an account removes its data only', async () => {
  const C = client(ctx.base);
  await C.register('temp@example.com', 'TempPass123');
  await C.upload('/api/resumes', 'marketing.docx');
  assert.equal((await C.del('/api/me/account', { password: 'TempPass123' })).status, 200);
  assert.equal(ctx.db.prepare("SELECT COUNT(*) n FROM users WHERE email = 'temp@example.com'").get().n, 0);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM resumes WHERE user_id NOT IN (SELECT id FROM users)').get().n, 0);
  assert.equal((await A.get('/api/resumes')).data.resumes.length, 1);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, startApp, client, seedJobs, DATA_JD, MARKETING_JD } from './helpers.mjs';

setupEnv({ EXPIRE_AFTER_MISSED_FETCHES: '2' });
let ctx; let c;
const now = Date.now();
const day = 86400000;
before(async () => {
  ctx = await startApp();
  c = client(ctx.base);
  await c.register('seeker@example.com', 'SeekerPass1', 'Seeker');
});
after(async () => { await ctx.close(); });

test('analyzer: experience, bands, arrangement, skills, categories, salary', async () => {
  const { analyzeJob, extractExperience, experienceBand, detectWorkArrangement } = await import('../src/lib/job-analyzer.mjs');
  const a = analyzeJob({ title: 'Data Engineer', description: DATA_JD, location: 'Bengaluru' });
  assert.equal(a.experience_min, 3); assert.equal(a.experience_max, 5); assert.equal(a.experience_band, '2-4');
  assert.equal(a.work_arrangement, 'Hybrid');
  for (const s of ['Python', 'SQL', 'PySpark', 'Databricks', 'Azure Data Factory', 'Snowflake', 'dbt']) assert.ok(a.skills.includes(s), s);
  assert.deepEqual(a.preferred_skills.sort(), ['Kafka', 'Terraform']);
  for (const cat of ['data-engineering', 'databricks', 'snowflake', 'dbt', 'pyspark']) assert.ok(a.categories.includes(cat), cat);
  assert.equal(extractExperience('Graduate Engineer', 'Freshers welcome').min, 0);
  assert.equal(experienceBand(0, 1), 'fresher');
  assert.equal(experienceBand(12, null), '10+');
  assert.equal(experienceBand(null, null), 'unknown');
  assert.equal(detectWorkArrangement({ title: 'X', location: 'London', description: 'This role is fully remote.' }), 'Remote');
  assert.equal(detectWorkArrangement({ title: 'X', location: 'Pune', description: 'Work from office, 5 days a week in the office.' }), 'WFO');
  assert.equal(detectWorkArrangement({ title: 'X', location: 'NYC', description: 'We sell hybrid cloud software.' }), 'Unspecified');
  assert.equal(detectWorkArrangement({ title: 'X', location: 'Paris', workplaceType: 'OnSite' }), 'WFO');
  const sal = analyzeJob({ title: 'Analyst', description: 'Compensation: $120,000 - $150,000 per year. Remote.' }).salary;
  assert.deepEqual(sal, { min: 120000, max: 150000, currency: 'USD' });
  const lpa = analyzeJob({ title: 'Analyst', description: 'CTC 12-18 LPA. Remote.' }).salary;
  assert.equal(lpa.currency, 'INR');
});

test('ingest dedups by URL and across sources, preferring the direct employer link', async () => {
  const job = { title: 'Analytics Engineer', company: 'Globex', location: 'Remote, India', description: 'Fully remote. 2+ years of experience with SQL and dbt.', postedAt: now };
  const agg = await seedJobs(ctx.db, [{ ...job, url: 'https://aggregator.example.com/jobs/77?utm_source=feed' }], { kind: 'aggregator', name: 'Agg' });
  assert.equal(agg.counters.created, 1);
  const again = await seedJobs(ctx.db, [{ ...job, url: 'https://aggregator.example.com/jobs/77' }], { kind: 'aggregator', name: 'Agg2' });
  assert.equal(again.counters.updated, 1, 'same URL (tracking params ignored) is updated, not duplicated');
  const direct = await seedJobs(ctx.db, [{ ...job, url: 'https://boards.globex.com/jobs/1' }], { name: 'Globex' });
  assert.equal(direct.counters.duplicate, 1);
  const rows = ctx.db.prepare("SELECT apply_url, status, is_direct FROM jobs WHERE company = 'Globex'").all();
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.status === 'active').apply_url, 'https://boards.globex.com/jobs/1');
  assert.equal(rows.find((r) => r.status === 'duplicate').is_direct, 0);
});

test('jobs without a stated work arrangement, unverified links and old postings are excluded', async () => {
  await seedJobs(ctx.db, [
    { title: 'Mystery Role', url: 'https://x.example.com/m1', company: 'Initech', location: 'Austin', description: 'Great job with Python.', postedAt: now },
    { title: 'Ancient Remote Role', url: 'https://x.example.com/old', company: 'Initech', location: 'Remote', description: 'Remote role.', postedAt: now - 400 * day },
  ], { name: 'Initech' });
  await seedJobs(ctx.db, [{ title: 'Remote Role via board', url: 'https://agg.example.com/r1', company: 'Hooli', location: 'Remote', description: 'Remote. Python.', postedAt: now }], { kind: 'aggregator', name: 'Board' });
  const titles = (await c.get('/api/jobs?page_size=100')).data.items.map((j) => j.title);
  assert.ok(!titles.includes('Mystery Role'), 'Unspecified arrangement hidden');
  assert.ok(!titles.includes('Ancient Remote Role'), 'older than MAX_JOB_AGE_DAYS not imported');
  assert.ok(!titles.includes('Remote Role via board'), 'aggregator link not yet verified');
  ctx.db.prepare("UPDATE jobs SET link_status = 'verified' WHERE title = 'Remote Role via board'").run();
  assert.ok((await c.get('/api/jobs?page_size=100')).data.items.some((j) => j.title === 'Remote Role via board'));
});

test('filters: arrangement, experience, skills, category, company, location, salary, date, source, direct', async () => {
  await seedJobs(ctx.db, [
    { title: 'Senior Data Engineer', url: 'https://f.example.com/1', company: 'Umbrella', location: 'Bengaluru, India', description: DATA_JD, postedAt: now - 1 * day, salary: { min: 2500000, max: 3500000, currency: 'INR' } },
    { title: 'Content Marketing Manager', url: 'https://f.example.com/2', company: 'Wayne', location: 'Remote', description: MARKETING_JD, postedAt: now - 20 * day },
    { title: 'Principal Cloud Architect', url: 'https://f.example.com/3', company: 'Stark', location: 'London', description: 'On-site role. 12+ years of experience with AWS, Azure, Terraform and Kubernetes.', postedAt: now - 2 * day },
  ], { name: 'Filters Co' });
  const q = async (qs) => (await c.get(`/api/jobs?page_size=100&${qs}`)).data.items.map((j) => j.title);
  assert.deepEqual(await q('arrangement=WFO&company=Stark'), ['Principal Cloud Architect']);
  assert.ok((await q('arrangement=Remote')).includes('Content Marketing Manager'));
  assert.ok(!(await q('arrangement=Remote')).includes('Senior Data Engineer'));
  assert.deepEqual(await q('bands=10%2B'), ['Principal Cloud Architect']);
  assert.ok((await q('skills=Snowflake,dbt')).includes('Senior Data Engineer'));
  assert.deepEqual(await q('category=databricks&company=Umbrella'), ['Senior Data Engineer']);
  assert.ok((await q('category=marketing')).includes('Content Marketing Manager'));
  assert.deepEqual(await q('location=London'), ['Principal Cloud Architect']);
  assert.deepEqual(await q('salary_min=3000000'), ['Senior Data Engineer']);
  assert.ok(!(await q('posted_within_days=7')).includes('Content Marketing Manager'));
  assert.ok((await q('q=marketing')).includes('Content Marketing Manager'));
  assert.ok((await q('years=3&company=Stark')).length === 0, 'a 3-year candidate is not shown 12+ year roles with "years"');
  const src = ctx.db.prepare("SELECT id FROM job_sources WHERE name = 'Filters Co'").get().id;
  assert.equal((await q(`source=${src}`)).length, 3);
  assert.ok((await q('direct_only=1')).every(Boolean));
  // SQL-ish input is just text.
  assert.equal((await c.get("/api/jobs?q=%27%20OR%201%3D1%20--")).status, 200);
});

test('match scores, explanations and recommendations follow the user\'s own resume', async () => {
  await c.upload('/api/resumes', 'data-engineer.docx');
  const items = (await c.get('/api/jobs?page_size=100&sort=match')).data.items;
  const de = items.find((j) => j.title === 'Senior Data Engineer');
  const mk = items.find((j) => j.title === 'Content Marketing Manager');
  assert.ok(de.match.score >= 60, `data engineer job scored ${de.match.score}`);
  assert.ok(mk.match.score < 30, `marketing job scored ${mk.match.score}`);
  assert.ok(items.indexOf(de) < items.indexOf(mk));
  const detail = (await c.get(`/api/jobs/${de.id}`)).data;
  assert.ok(detail.match.matching_skills.includes('Databricks'));
  assert.ok(Array.isArray(detail.match.missing_skills));
  assert.deepEqual(detail.match.required_experience, { min: 3, max: 5 });
  assert.ok(detail.match.reasons.length >= 2);
  assert.ok(detail.interview_prep.skill_focus.length > 0);
  const rec = (await c.get('/api/jobs/recommendations?min_match=50')).data.items.map((j) => j.title);
  assert.ok(rec.includes('Senior Data Engineer'));
  assert.ok(!rec.includes('Content Marketing Manager'));
});

test('a marketing resume gets marketing matches (not data engineering)', async () => {
  const m = client(ctx.base);
  await m.register('marketer@example.com', 'MarketPass1', 'Marketer');
  await m.upload('/api/resumes', 'marketing.docx');
  const items = (await m.get('/api/jobs?page_size=100&sort=match')).data.items;
  assert.equal(items[0].title, 'Content Marketing Manager');
});

test('postings that disappear from their source expire after N misses; empty answers do not mass-expire', async () => {
  const { ingestJobs, expireMissing } = await import('../src/services/fetcher.mjs');
  const { source } = await seedJobs(ctx.db, [
    { title: 'Keep Me', url: 'https://e.example.com/keep', company: 'Expiro', location: 'Remote', description: 'Remote job.', postedAt: now },
    { title: 'Drop Me', url: 'https://e.example.com/drop', company: 'Expiro', location: 'Remote', description: 'Remote job.', postedAt: now },
  ], { name: 'Expiro' });
  for (let i = 0; i < 2; i++) {
    const started = new Date(Date.now() + 1000 * (i + 1)).toISOString().replace('T', ' ').slice(0, 19);
    ingestJobs(ctx.db, source, [{ title: 'Keep Me', url: 'https://e.example.com/keep', company: 'Expiro', location: 'Remote', description: 'Remote job.', postedAt: now }], { now: new Date(Date.now() + 2000 * (i + 1)) });
    expireMissing(ctx.db, source.id, started);
  }
  const status = (t) => ctx.db.prepare('SELECT status FROM jobs WHERE title = ?').get(t).status;
  assert.equal(status('Keep Me'), 'active');
  assert.equal(status('Drop Me'), 'expired');

  const { runFetch } = await import('../src/services/fetcher.mjs');
  ctx.db.prepare('UPDATE job_sources SET enabled = 0').run();
  ctx.db.prepare('UPDATE job_sources SET enabled = 1 WHERE id = ?').run(source.id);
  const r = await runFetch(ctx.db, { trigger: 'test', verifyLinks: false, fetchFn: async () => ({ providerId: 'fake', jobs: [] }) });
  assert.equal(r.status, 'success');
  assert.equal(status('Keep Me'), 'active', 'an empty response is treated as an outage, not a purge');
  const warn = ctx.db.prepare("SELECT message FROM fetch_logs WHERE level = 'warn' ORDER BY id DESC").get();
  assert.match(warn.message, /skipped expiry/);
});

test('runFetch records runs, per-source errors, last success time and calls hooks', async () => {
  const { runFetch } = await import('../src/services/fetcher.mjs');
  const { getSetting } = await import('../src/db/index.mjs');
  ctx.db.prepare('UPDATE job_sources SET enabled = 1').run();
  const sources = ctx.db.prepare('SELECT id FROM job_sources ORDER BY id').all().map((s) => s.id);
  let hookRun = null;
  const r = await runFetch(ctx.db, {
    trigger: 'test', verifyLinks: false, sourceIds: sources.slice(0, 2),
    hooks: { afterFetch: async (_db, run) => { hookRun = run; } },
    fetchFn: async (s) => {
      if (s.id === sources[0]) throw new Error('board offline');
      return { providerId: 'fake', jobs: [{ title: 'Brand New Remote Analyst', url: `https://new.example.com/${s.id}`, company: 'NewCo', location: 'Remote', description: 'Remote. SQL and Excel.', postedAt: Date.now() }] };
    },
  });
  assert.equal(r.status, 'partial');
  assert.equal(r.failed, 1);
  assert.equal(r.created, 1);
  assert.ok(hookRun && hookRun.newIds.length === 1);
  assert.ok(getSetting(ctx.db, 'last_successful_fetch_at'));
  const run = ctx.db.prepare('SELECT * FROM fetch_runs WHERE id = ?').get(r.id);
  assert.equal(run.sources_failed, 1);
  assert.ok(ctx.db.prepare("SELECT COUNT(*) n FROM fetch_logs WHERE run_id = ? AND level = 'error' AND message LIKE '%board offline%'").get(r.id).n === 1);
  assert.equal(ctx.db.prepare('SELECT last_status FROM job_sources WHERE id = ?').get(sources[0]).last_status, 'error');
});

test('new-match notifications go only to users whose resume matches', async () => {
  const { notifyNewJobs } = await import('../src/services/notifications.mjs');
  const { counters } = await seedJobs(ctx.db, [{ title: 'Azure Data Engineer', url: 'https://n.example.com/1', company: 'Notify', location: 'Remote', description: `Remote. ${DATA_JD}`, postedAt: Date.now() }], { name: 'Notify Co' });
  const before = (await c.get('/api/me/notifications')).data.items.filter((n) => n.type === 'new_matches').length;
  await notifyNewJobs(ctx.db, counters.newIds);
  const after1 = (await c.get('/api/me/notifications')).data.items.filter((n) => n.type === 'new_matches').length;
  assert.equal(after1, before + 1);
  const m = client(ctx.base);
  await m.login('marketer@example.com', 'MarketPass1');
  assert.equal((await m.get('/api/me/notifications')).data.items.filter((n) => n.type === 'new_matches').length, 0);
});

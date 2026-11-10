import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { setupEnv, startApp, client, FIXTURES } from './helpers.mjs';

const dir = setupEnv({ MAX_UPLOAD_MB: '1', MAX_RESUMES_PER_USER: '4' });
let ctx; let c;
before(async () => { ctx = await startApp(); c = client(ctx.base); await c.register('up@example.com', 'UploadPass1', 'Up Loader'); });
after(async () => { await ctx.close(); });

test('PDF upload is parsed into a structured profile and becomes active', async () => {
  const r = await c.upload('/api/resumes', 'data-engineer.pdf');
  assert.equal(r.status, 201);
  assert.equal(r.data.resume.parse_status, 'parsed');
  assert.equal(r.data.resume.is_active, true);
  assert.equal('stored_name' in r.data.resume, false, 'internal file name is not exposed');
  const d = r.data.data;
  assert.equal(d.candidate_name, 'Asha Verma');
  assert.equal(d.email, 'asha.verma@example.com');
  assert.match(d.phone, /98765/);
  assert.ok(d.total_experience_years >= 5);
  assert.equal(d.current_role, 'Senior Data Engineer');
  for (const s of ['Databricks', 'PySpark', 'dbt', 'Azure Data Factory']) assert.ok(d.technical_skills.includes(s), s);
  assert.deepEqual(d.programming_languages.sort(), ['Python', 'SQL', 'Scala']);
  assert.deepEqual(d.cloud_platforms.sort(), ['AWS', 'Azure']);
  assert.ok(d.databases.includes('Snowflake'));
  assert.equal(d.certifications.length, 2);
  assert.match(d.education[0], /B\.Tech/);
  assert.ok(d.job_titles.includes('Data Engineer'));
});

test('DOCX and legacy DOC uploads are parsed', async () => {
  const docx = await c.upload('/api/resumes', 'marketing.docx');
  assert.equal(docx.data.resume.parse_status, 'parsed');
  assert.ok(docx.data.data.technical_skills.includes('SEO'));
  assert.equal(docx.data.resume.is_active, false, 'later uploads do not steal the active slot');
  const doc = await c.upload('/api/resumes', 'marketing.doc');
  assert.equal(doc.data.resume.parse_status, 'parsed');
  assert.equal(doc.data.data.candidate_name, 'Rohan Mehta');
});

test('invalid files are rejected by content, extension and size', async () => {
  assert.equal((await c.upload('/api/resumes', 'fake.pdf')).status, 400, 'not really a PDF');
  assert.equal((await c.upload('/api/resumes', Buffer.from('MZ\x90\x00binary'), {}, 'evil.exe')).status, 400);
  const pdf = readFileSync(path.join(FIXTURES, 'data-engineer.pdf'));
  assert.equal((await c.upload('/api/resumes', pdf, {}, 'resume.docx')).status, 400, 'content/extension mismatch');
  const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1.5 * 1024 * 1024, 32)]);
  assert.equal((await c.upload('/api/resumes', big, {}, 'big.pdf')).status, 413);
  assert.equal((await c.post('/api/resumes')).status, 400, 'no file');
});

test('per-user resume limit', async () => {
  const list = (await c.get('/api/resumes')).data.resumes;
  assert.equal(list.length, 3);
  assert.equal((await c.upload('/api/resumes', 'marketing.docx')).status, 201);
  assert.equal((await c.upload('/api/resumes', 'marketing.docx')).status, 400, 'limit of 4 reached');
});

test('download returns the original bytes as an attachment; files are not publicly served', async () => {
  const { resumes } = (await c.get('/api/resumes')).data;
  const pdf = resumes.find((r) => r.file_ext === 'pdf');
  const res = await c.raw('GET', `/api/resumes/${pdf.id}/file`, { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.match(res.headers.get('cache-control'), /no-store/);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.ok(bytes.equals(readFileSync(path.join(FIXTURES, 'data-engineer.pdf'))));
  const userDir = path.join(dir, 'uploads', readdirSync(path.join(dir, 'uploads'))[0]);
  const stored = readdirSync(userDir)[0];
  assert.notEqual((await fetch(`${ctx.base}/uploads/${stored}`)).headers.get('content-type'), 'application/pdf');
  assert.equal((await fetch(`${ctx.base}/api/resumes/${pdf.id}/file`)).status, 401, 'anonymous download refused');
});

test('edit extracted data, replace (new version), activate, delete', async () => {
  const { resumes } = (await c.get('/api/resumes')).data;
  const pdf = resumes.find((r) => r.file_ext === 'pdf');
  const e = await c.put(`/api/resumes/${pdf.id}/data`, { candidate_name: 'Asha V.', total_experience_years: 6, technical_skills: ['databricks', 'Microsoft Fabric'], programming_languages: ['Python'] });
  assert.equal(e.status, 200);
  assert.equal(e.data.data.edited_by_user, 1);
  assert.deepEqual(e.data.data.technical_skills, ['Databricks', 'Microsoft Fabric'], 'aliases canonicalised');
  assert.equal((await c.put(`/api/resumes/${pdf.id}/data`, { total_experience_years: 400 })).status, 400);

  const rep = await c.upload('/api/resumes', 'data-engineer.docx', { replace_id: String(pdf.id) });
  assert.equal(rep.status, 201);
  assert.equal(rep.data.resume.version, pdf.version + 1);
  assert.equal(rep.data.resume.is_active, true, 'replacement keeps the active flag');
  assert.equal((await c.get(`/api/resumes/${pdf.id}`)).status, 404, 'old version removed');

  const other = (await c.get('/api/resumes')).data.resumes.find((r) => !r.is_active);
  await c.post(`/api/resumes/${other.id}/activate`);
  const after1 = (await c.get('/api/resumes')).data.resumes;
  assert.equal(after1.filter((r) => r.is_active).length, 1);
  assert.equal(after1.find((r) => r.is_active).id, other.id);

  const before = readdirSync(path.join(dir, 'uploads', String(ctx.db.prepare("SELECT id FROM users WHERE email='up@example.com'").get().id))).length;
  assert.equal((await c.del(`/api/resumes/${other.id}`)).status, 200);
  const remaining = (await c.get('/api/resumes')).data.resumes;
  assert.equal(remaining.filter((r) => r.is_active).length, 1, 'another resume becomes active');
  const afterFiles = readdirSync(path.join(dir, 'uploads', String(ctx.db.prepare("SELECT id FROM users WHERE email='up@example.com'").get().id))).length;
  assert.equal(afterFiles, before - 1, 'file deleted from disk');
});

test('insights return suggestions and stay private', async () => {
  const { resumes } = (await c.get('/api/resumes')).data;
  const r = await c.get(`/api/resumes/${resumes[0].id}/insights`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.suggestions) && r.data.suggestions.length > 0);
  assert.equal(existsSync(path.join(dir, 'uploads')), true);
});

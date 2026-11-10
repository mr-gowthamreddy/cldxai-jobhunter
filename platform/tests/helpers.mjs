// Test harness: every test file runs in its own process (node --test) with a
// fresh temporary data directory, database and upload folder.
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

export function setupEnv(extra = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cops-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_DIR: dir,
    SCHEDULER_MODE: 'off',
    CAREER_OPS_PLATFORM_ENV: path.join(dir, 'no.env'), // never read the developer's .env
    PUBLIC_URL: 'http://localhost',
    ...extra,
  });
  return dir;
}

export async function startApp() {
  const { getDb } = await import('../src/db/index.mjs');
  const { ensureBaseData } = await import('../src/db/seed.mjs');
  const { createApp } = await import('../src/app.mjs');
  const db = getDb();
  ensureBaseData(db);
  const app = createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, db,
    async close() {
      await new Promise((r) => server.close(r));
      const { closeDb } = await import('../src/db/index.mjs');
      closeDb();
      rmSync(process.env.DATA_DIR, { recursive: true, force: true });
    },
  };
}

/** HTTP client with its own cookie jar and CSRF token (one per simulated browser). */
export function client(base) {
  let cookie = '';
  let csrf = '';
  async function req(method, p, { body, form, headers = {}, raw = false } = {}) {
    const h = { ...headers };
    if (cookie) h.cookie = cookie;
    if (csrf && method !== 'GET') h['x-csrf-token'] = csrf;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = /cops_sid=([^;]*)/.exec(set);
      if (m) cookie = m[1] ? `cops_sid=${m[1]}` : '';
    }
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (data && typeof data === 'object' && data.csrf) csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p, o) => req('GET', p, o),
    post: (p, body, o = {}) => req('POST', p, { ...o, body }),
    put: (p, body, o = {}) => req('PUT', p, { ...o, body }),
    patch: (p, body, o = {}) => req('PATCH', p, { ...o, body }),
    del: (p, body, o = {}) => req('DELETE', p, { ...o, body }),
    raw: req,
    async upload(p, file, fields = {}, name) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      const buf = Buffer.isBuffer(file) ? file : readFileSync(path.join(FIXTURES, file));
      fd.append('file', new Blob([buf]), name || (Buffer.isBuffer(file) ? 'upload.bin' : file));
      return req('POST', p, { form: fd });
    },
    async register(email, password = 'TestPass123', fullName = 'Test User') {
      return req('POST', '/api/auth/register', { body: { email, password, full_name: fullName } });
    },
    async login(email, password = 'TestPass123') {
      return req('POST', '/api/auth/login', { body: { email, password } });
    },
    get csrf() { return csrf; },
    set csrf(v) { csrf = v; },
    get cookie() { return cookie; },
  };
}

export async function makeAdmin(db, email, password = 'AdminPass123') {
  const { upsertAdmin } = await import('../scripts/lib.mjs');
  return upsertAdmin(db, { email, password, name: 'Admin' });
}

/** Insert a synthetic, user-visible job via the real ingest path (no network). */
export async function seedJobs(db, jobs, sourceOverrides = {}) {
  const { ingestJobs } = await import('../src/services/fetcher.mjs');
  const info = db.prepare("INSERT INTO job_sources (name, provider, careers_url, kind, is_direct, config) VALUES (?, ?, ?, ?, ?, '{}')")
    .run(sourceOverrides.name || `Test Source ${Math.random()}`, sourceOverrides.provider || 'greenhouse', sourceOverrides.careers_url || null, sourceOverrides.kind || 'company', sourceOverrides.kind === 'aggregator' ? 0 : 1);
  const source = db.prepare('SELECT * FROM job_sources WHERE id = ?').get(info.lastInsertRowid);
  const counters = ingestJobs(db, source, jobs, { runStartedAt: new Date().toISOString() });
  return { source, counters };
}

export const DATA_JD = `We are hiring a Data Engineer. Hybrid: 3 days a week in our Bengaluru office.
Requirements: 3-5 years of experience. Python, SQL, PySpark, Databricks, Azure Data Factory, Snowflake and dbt.
Nice to have:
Kafka, Terraform`;
export const MARKETING_JD = `Content Marketing Manager (fully remote). 4+ years of experience in SEO, content marketing, email marketing and Google Ads. HubSpot a plus.`;

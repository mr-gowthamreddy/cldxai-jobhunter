// Google Sheets reporting layer. The database stays the source of truth; each
// day's fetched jobs are appended to a dated tab ("Jobs 2026-11-09") with a
// fixed header. A hidden key column (the platform's job id + URL key) makes
// re-syncs idempotent: rows already on the tab are never written twice.
//
// Auth: a Google Cloud service account (JWT bearer flow, signed locally with
// node:crypto — no Google SDK needed). Share the spreadsheet with the service
// account's email as an Editor. Configure via environment variables; see
// platform/.env.example and platform/docs/GOOGLE_SHEETS.md.

import { createSign } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { config } from '../config.mjs';
import { parseJson } from '../db/index.mjs';

export const SHEET_HEADER = [
  'Job Key', 'Job Title', 'Company', 'Job Description', 'Required Experience', 'Required Skills',
  'Work Arrangement', 'Location', 'Source', 'Direct Application URL', 'Date Posted', 'Date Fetched', 'Link Verification Status',
];

function credentials(cfg = config.sheets) {
  let email = cfg.serviceAccountEmail;
  let key = cfg.privateKey;
  if ((!email || !key) && cfg.credentialsFile && existsSync(cfg.credentialsFile)) {
    const json = JSON.parse(readFileSync(cfg.credentialsFile, 'utf8'));
    email = email || json.client_email;
    key = key || json.private_key;
  }
  return { email, key };
}

/** Why Sheets sync cannot run, or null when it is fully configured. */
export function sheetsConfigProblem(cfg = config.sheets) {
  if (!cfg.enabled) return 'Google Sheets sync is disabled (GOOGLE_SHEETS_ENABLED is not true).';
  if (!cfg.spreadsheetId) return 'GOOGLE_SHEETS_SPREADSHEET_ID is not set.';
  const { email, key } = credentials(cfg);
  if (!email || !key) return 'No service-account credentials: set GOOGLE_APPLICATION_CREDENTIALS (JSON key file) or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.';
  if (!/BEGIN (RSA )?PRIVATE KEY/.test(key)) return 'The service-account private key is not a PEM private key.';
  return null;
}

let cachedToken = null;
async function accessToken(cfg, fetchImpl) {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const { email, key } = credentials(cfg);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key).toString('base64url');
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google OAuth failed (${res.status}): ${json.error_description || json.error || 'unknown error'}`);
  cachedToken = { token: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function api(cfg, fetchImpl, method, path, body) {
  const token = await accessToken(cfg, fetchImpl);
  const res = await fetchImpl(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId)}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Sheets API ${method} ${path.split('?')[0]} failed (${res.status}): ${json.error?.message || 'unknown error'}`);
  return json;
}

function quoteTab(name) {
  return `'${name.replace(/'/g, "''")}'`;
}

function expText(min, max) {
  if (min === null || min === undefined) return 'Not stated';
  if (max === null || max === undefined) return `${min}+ years`;
  return min === max ? `${min} years` : `${min}-${max} years`;
}

// Neutralise spreadsheet formula injection from scraped text.
function cell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function jobToRow(job, sourceName, maxDesc = config.sheets.maxDescriptionChars) {
  return [
    `${job.id}|${job.url_key}`,
    job.title, job.company, String(job.description || '').slice(0, maxDesc),
    expText(job.experience_min, job.experience_max),
    parseJson(job.skills, []).join(', '),
    job.work_arrangement, job.location, sourceName || '', job.apply_url,
    job.posted_at ? job.posted_at.slice(0, 10) : '', (job.first_seen_at || '').slice(0, 10),
    job.link_status,
  ].map(cell);
}

/**
 * Append today's jobs to the daily tab. Returns { status, tab, rows }.
 * `fetchImpl` is injectable for tests.
 */
export async function syncJobsToSheet(db, { runId = null, date = new Date(), cfg = config.sheets, fetchImpl = fetch } = {}) {
  const problem = sheetsConfigProblem(cfg);
  const tab = `${cfg.tabPrefix} ${date.toISOString().slice(0, 10)}`;
  const record = db.prepare('INSERT INTO sheets_sync_logs (run_id, tab_name, status, rows_written, message) VALUES (?, ?, ?, ?, ?)');
  if (problem) {
    record.run(runId, tab, 'skipped', 0, problem);
    return { status: 'skipped', tab, rows: 0, message: problem };
  }
  try {
    const meta = await api(cfg, fetchImpl, 'GET', '?fields=sheets.properties.title');
    const titles = (meta.sheets || []).map((s) => s.properties.title);
    if (!titles.includes(tab)) {
      await api(cfg, fetchImpl, 'POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] });
      await api(cfg, fetchImpl, 'PUT', `/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}?valueInputOption=RAW`, { values: [SHEET_HEADER] });
    }
    const existing = await api(cfg, fetchImpl, 'GET', `/values/${encodeURIComponent(`${quoteTab(tab)}!A2:A`)}`);
    const have = new Set((existing.values || []).map((r) => r[0]));
    // Jobs first seen today (the day's fetch), plus anything still active and refreshed today that isn't on the tab yet.
    const day = date.toISOString().slice(0, 10);
    const jobs = db.prepare(`SELECT j.*, s.name AS source_name FROM jobs j LEFT JOIN job_sources s ON s.id = j.source_id
      WHERE j.status = 'active' AND j.work_arrangement != 'Unspecified' AND j.link_status IN ('source_confirmed','verified')
        AND date(j.last_seen_at) = ? ORDER BY j.first_seen_at DESC`).all(day);
    const rows = [];
    for (const j of jobs) {
      const key = `${j.id}|${j.url_key}`;
      if (have.has(key)) continue;
      have.add(key);
      rows.push(jobToRow(j, j.source_name));
    }
    for (let i = 0; i < rows.length; i += 500) {
      await api(cfg, fetchImpl, 'POST', `/values/${encodeURIComponent(`${quoteTab(tab)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: rows.slice(i, i + 500) });
    }
    record.run(runId, tab, 'success', rows.length, `${rows.length} new rows (${jobs.length - rows.length} already present).`);
    return { status: 'success', tab, rows: rows.length };
  } catch (err) {
    record.run(runId, tab, 'failed', 0, String(err.message).slice(0, 1000));
    return { status: 'failed', tab, rows: 0, message: err.message };
  }
}

export function _resetTokenCache() { cachedToken = null; }

// Job fetching. Every source is read through career-ops' existing provider
// modules (providers/*.mjs: Greenhouse, Lever, Ashby, Workable, Remotive,
// Himalayas, …), so the platform inherits their SSRF hardening and parsing.
//
// Pipeline per run: fetch each enabled source → normalise URL (url-key.mjs) →
// analyse (experience, arrangement, skills, categories) → upsert → cross-source
// duplicate detection → expire postings that vanished from their source →
// verify aggregator links → notify users → sync Google Sheets.

import path from 'node:path';
import { loadProviders, resolveProvider } from '../../../providers/_registry.mjs';
import { makeHttpCtx } from '../../../providers/_http.mjs';
import { normalizeUrl } from '../../../url-key.mjs';
import { REPO_ROOT, config } from '../config.mjs';
import { analyzeJob, fingerprint, DEFAULT_EXPERIENCE_BANDS } from '../lib/job-analyzer.mjs';
import { getSetting, setSetting, parseJson } from '../db/index.mjs';
import { logSystemError } from '../lib/activity.mjs';
import { verifyJobLinks } from './link-verifier.mjs';

let providersPromise = null;
export function getProviders() {
  if (!providersPromise) {
    // Silence load warnings for the few providers that need optional deps.
    const origError = console.error;
    console.error = () => {};
    providersPromise = loadProviders(path.join(REPO_ROOT, 'providers')).finally(() => { console.error = origError; });
  }
  return providersPromise;
}

export async function listProviderIds() {
  const providers = await getProviders();
  return [...providers.keys()].sort();
}

function sourceEntry(source) {
  const cfg = parseJson(source.config, {});
  const entry = { name: source.name, ...cfg };
  if (source.careers_url) entry.careers_url = source.careers_url;
  if (source.provider) entry.provider = source.provider;
  return entry;
}

/** Resolve which provider will read a source (for validation in the admin UI). */
export async function resolveSourceProvider(source) {
  const providers = await getProviders();
  const r = resolveProvider(sourceEntry(source), providers);
  if (!r) return { error: 'No provider recognises this URL. Use a Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee… careers URL, or pick a provider explicitly.' };
  return r;
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label}: timed out after ${Math.round(ms / 1000)}s`)), ms); }),
  ]);
}

/** Fetch raw jobs for one source. */
export async function fetchSourceJobs(source, { timeoutMs = config.fetchSourceTimeoutMs } = {}) {
  const providers = await getProviders();
  const entry = sourceEntry(source);
  const r = resolveProvider(entry, providers);
  if (!r || r.error) throw new Error(r?.error || `no provider for source "${source.name}"`);
  const ctx = { ...makeHttpCtx(), includeUndated: true };
  const jobs = await withTimeout(Promise.resolve(r.provider.fetch(entry, ctx)), timeoutMs, source.name);
  if (!Array.isArray(jobs)) throw new Error(`${source.name}: provider returned a non-array`);
  return { providerId: r.provider.id, jobs };
}

function iso(d = new Date()) {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Upsert one source's jobs. Returns counters. Exported for tests, which feed
 * synthetic provider output without network access.
 */
export function ingestJobs(db, source, rawJobs, { runStartedAt, bands, maxAgeDays = config.maxJobAgeDays, now = new Date() } = {}) {
  const counters = { seen: 0, created: 0, updated: 0, duplicate: 0, excluded: 0, tooOld: 0, invalid: 0, newIds: [] };
  const srcCfg = parseJson(source.config, {});
  const isDirect = source.kind === 'company' ? 1 : (source.is_direct ? 1 : 0);
  const findByKey = db.prepare('SELECT id, status, link_status, duplicate_of FROM jobs WHERE url_key = ?');
  const findByFp = db.prepare("SELECT id, is_direct, url_key FROM jobs WHERE fingerprint = ? AND url_key != ? AND status IN ('active') AND duplicate_of IS NULL ORDER BY is_direct DESC, id ASC LIMIT 1");
  const insert = db.prepare(`INSERT INTO jobs (source_id, url_key, fingerprint, title, company, location, description, apply_url, is_direct,
      work_arrangement, experience_min, experience_max, experience_band, skills, preferred_skills, categories, salary_min, salary_max, salary_currency,
      posted_at, first_seen_at, last_seen_at, status, link_status, duplicate_of)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE jobs SET title = ?, company = ?, location = ?, description = ?, apply_url = ?, work_arrangement = ?,
      experience_min = ?, experience_max = ?, experience_band = ?, skills = ?, preferred_skills = ?, categories = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
      posted_at = COALESCE(?, posted_at), last_seen_at = ?, missed_fetches = 0, source_id = ?,
      status = CASE WHEN status IN ('expired','closed') THEN 'active' ELSE status END,
      link_status = CASE WHEN ? = 1 THEN 'source_confirmed' WHEN link_status IN ('expired') THEN 'unverified' ELSE link_status END,
      updated_at = ? WHERE id = ?`);
  const markDup = db.prepare("UPDATE jobs SET status = 'duplicate', duplicate_of = ? WHERE id = ?");
  const nowIso = iso(now);
  const ageCutoff = now.getTime() - maxAgeDays * 86400000;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const raw of rawJobs) {
      if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || typeof raw.url !== 'string') { counters.invalid++; continue; }
      let url;
      try { url = new URL(raw.url.trim()); } catch { counters.invalid++; continue; }
      if (!['http:', 'https:'].includes(url.protocol)) { counters.invalid++; continue; }
      const key = normalizeUrl(url.href) || url.href;
      counters.seen++;
      if (Number.isFinite(raw.postedAt) && raw.postedAt < ageCutoff) { counters.tooOld++; continue; }
      const a = analyzeJob(raw, { source: { name: source.name, config: srcCfg }, bands });
      if (a.work_arrangement === 'Unspecified') counters.excluded++;
      const fp = fingerprint(a.company, a.title, a.location);
      const fields = [
        a.title.slice(0, 300), a.company.slice(0, 200), a.location.slice(0, 300), a.description.slice(0, 60000), url.href, a.work_arrangement,
        a.experience_min, a.experience_max, a.experience_band, JSON.stringify(a.skills), JSON.stringify(a.preferred_skills), JSON.stringify(a.categories),
        a.salary?.min ?? null, a.salary?.max ?? null, a.salary?.currency || '',
      ];
      const existing = findByKey.get(key);
      if (existing) {
        update.run(...fields, a.posted_at, nowIso, source.id, isDirect, nowIso, existing.id);
        counters.updated++;
        continue;
      }
      const dup = findByFp.get(fp, key);
      let status = 'active';
      let duplicateOf = null;
      const linkStatus = isDirect ? 'source_confirmed' : 'unverified';
      const res = insert.run(source.id, key, fp, ...fields.slice(0, 5), isDirect, ...fields.slice(5), a.posted_at, nowIso, nowIso, status, linkStatus, duplicateOf);
      const newId = Number(res.lastInsertRowid);
      if (dup) {
        // Keep the employer's own link as the primary record.
        if (isDirect && !dup.is_direct) markDup.run(newId, dup.id);
        else markDup.run(dup.id, newId);
        counters.duplicate++;
      }
      counters.created++;
      counters.newIds.push(newId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return counters;
}

/**
 * After a successful source fetch, postings that were not in the response
 * missed a fetch; after N consecutive misses they are marked expired.
 */
export function expireMissing(db, sourceId, runStartedAt, { threshold = config.expireAfterMissedFetches } = {}) {
  db.prepare(`UPDATE jobs SET missed_fetches = missed_fetches + 1 WHERE source_id = ? AND status = 'active' AND last_seen_at < ?`).run(sourceId, runStartedAt);
  const r = db.prepare(`UPDATE jobs SET status = 'expired', link_status = 'expired', updated_at = datetime('now'),
      link_check_note = 'no longer listed by its source' WHERE source_id = ? AND status IN ('active','duplicate') AND missed_fetches >= ?`).run(sourceId, threshold);
  // A duplicate whose primary expired becomes the primary again.
  db.prepare(`UPDATE jobs SET status = 'active', duplicate_of = NULL WHERE status = 'duplicate' AND duplicate_of IN (SELECT id FROM jobs WHERE status = 'expired') AND missed_fetches < ?`).run(threshold);
  return Number(r.changes);
}

/** Expire jobs whose posting date is older than the configured max age. */
export function expireStale(db, maxAgeDays = config.maxJobAgeDays) {
  const r = db.prepare(`UPDATE jobs SET status = 'expired', link_status = 'expired', link_check_note = 'older than the maximum job age'
    WHERE status = 'active' AND posted_at IS NOT NULL AND posted_at < datetime('now', ?)`).run(`-${maxAgeDays} days`);
  return Number(r.changes);
}

let running = false;
export function isFetchRunning() { return running; }

/**
 * One complete fetch run. `hooks.afterFetch(db, run)` lets the caller plug in
 * notifications and Google Sheets without a circular import.
 */
export async function runFetch(db, { trigger = 'manual', sourceIds = null, hooks = {}, verifyLinks = true, fetchFn = fetchSourceJobs } = {}) {
  if (running) return { skipped: true, reason: 'a fetch is already running in this process' };
  // Cross-process guard (server + worker share the DB).
  const lock = getSetting(db, 'fetch_lock', null);
  if (lock && Date.now() - Date.parse(lock.at) < 2 * 60 * 60 * 1000 && lock.pid !== process.pid) {
    return { skipped: true, reason: `a fetch started at ${lock.at} is still running (pid ${lock.pid})` };
  }
  running = true;
  setSetting(db, 'fetch_lock', { pid: process.pid, at: new Date().toISOString() });
  const startedAt = iso();
  const run = db.prepare('INSERT INTO fetch_runs (trigger, started_at) VALUES (?, ?)').run(trigger, startedAt);
  const runId = Number(run.lastInsertRowid);
  const logStmt = db.prepare('INSERT INTO fetch_logs (run_id, source_id, level, message) VALUES (?, ?, ?, ?)');
  const log = (level, message, sourceId = null) => logStmt.run(runId, sourceId, level, String(message).slice(0, 2000));
  const bands = getSetting(db, 'experience_bands', DEFAULT_EXPERIENCE_BANDS);
  const totals = { sources: 0, failed: 0, seen: 0, created: 0, updated: 0, expired: 0, duplicate: 0, excluded: 0, newIds: [] };

  try {
    let sources = db.prepare('SELECT * FROM job_sources WHERE enabled = 1 ORDER BY id').all();
    if (sourceIds?.length) sources = sources.filter((s) => sourceIds.includes(s.id));
    totals.sources = sources.length;
    log('info', `Fetch started (${trigger}) for ${sources.length} sources.`);
    let idx = 0;
    const worker = async () => {
      while (idx < sources.length) {
        const source = sources[idx++];
        const started = Date.now();
        try {
          const { providerId, jobs } = await fetchFn(source);
          const c = ingestJobs(db, source, jobs, { runStartedAt: startedAt, bands });
          // Only expire when the source answered with postings; an empty answer
          // from a board that had jobs is more likely an outage than a purge.
          const prev = db.prepare("SELECT COUNT(*) n FROM jobs WHERE source_id = ? AND status = 'active'").get(source.id).n;
          let expired = 0;
          if (jobs.length > 0 || prev === 0) expired = expireMissing(db, source.id, startedAt);
          else log('warn', `${source.name}: returned 0 postings while ${prev} were active; skipped expiry this run.`, source.id);
          Object.assign(totals, {
            seen: totals.seen + c.seen, created: totals.created + c.created, updated: totals.updated + c.updated,
            duplicate: totals.duplicate + c.duplicate, excluded: totals.excluded + c.excluded, expired: totals.expired + expired,
          });
          totals.newIds.push(...c.newIds);
          db.prepare(`UPDATE job_sources SET last_fetch_at = datetime('now'), last_success_at = datetime('now'), last_status = 'ok', last_error = NULL, last_job_count = ? WHERE id = ?`).run(jobs.length, source.id);
          log('info', `${source.name} (${providerId}): ${jobs.length} postings, ${c.created} new, ${c.updated} refreshed, ${expired} expired, ${c.duplicate} duplicates, ${c.tooOld} too old, ${c.excluded} without a stated work arrangement — ${((Date.now() - started) / 1000).toFixed(1)}s`, source.id);
        } catch (err) {
          totals.failed++;
          const msg = `${source.name}: ${err.message}`;
          db.prepare(`UPDATE job_sources SET last_fetch_at = datetime('now'), last_status = 'error', last_error = ? WHERE id = ?`).run(String(err.message).slice(0, 500), source.id);
          log('error', msg, source.id);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(config.fetchConcurrency, sources.length)) }, worker));
    totals.expired += expireStale(db);

    db.prepare(`UPDATE fetch_runs SET jobs_seen = ?, jobs_new = ?, jobs_updated = ?, jobs_expired = ?, jobs_duplicate = ?, jobs_excluded = ?, sources_total = ?, sources_failed = ? WHERE id = ?`)
      .run(totals.seen, totals.created, totals.updated, totals.expired, totals.duplicate, totals.excluded, totals.sources, totals.failed, runId);

    if (verifyLinks) {
      try { await verifyJobLinks(db, { budget: config.linkCheckBudget, recheckDays: config.linkRecheckDays, runId, log }); }
      catch (err) { log('error', `Link verification failed: ${err.message}`); logSystemError(db, 'link-verifier', err); }
    }

    const status = totals.sources === 0 ? 'success' : totals.failed === totals.sources ? 'failed' : totals.failed ? 'partial' : 'success';
    const summary = `${totals.created} new, ${totals.updated} refreshed, ${totals.expired} expired, ${totals.duplicate} duplicates across ${totals.sources} sources (${totals.failed} failed).`;
    db.prepare(`UPDATE fetch_runs SET status = ?, finished_at = datetime('now'), summary = ? WHERE id = ?`).run(status, summary, runId);
    if (status !== 'failed') setSetting(db, 'last_successful_fetch_at', new Date().toISOString());
    log('info', `Fetch finished: ${summary}`);

    const runInfo = { id: runId, status, ...totals };
    if (hooks.afterFetch) {
      try { await hooks.afterFetch(db, runInfo); }
      catch (err) { log('error', `Post-fetch hook failed: ${err.message}`); logSystemError(db, 'post-fetch', err); }
    }
    return runInfo;
  } catch (err) {
    db.prepare(`UPDATE fetch_runs SET status = 'failed', finished_at = datetime('now'), summary = ? WHERE id = ?`).run(String(err.message).slice(0, 500), runId);
    log('error', `Fetch run crashed: ${err.message}`);
    logSystemError(db, 'fetch-run', err);
    throw err;
  } finally {
    running = false;
    setSetting(db, 'fetch_lock', null);
  }
}

// Application-link verification. Reuses career-ops' guarded HTTP transport
// (providers/_http.mjs: private-IP/SSRF guard, timeouts, body caps) and its
// liveness classifier (liveness-core.mjs), so a link is judged by the same
// rules the CLI uses: 404/410 or an explicit "position closed" banner means
// expired; bot walls and 403/429 are "uncertain", never "expired".

import { fetchResponse } from '../../../providers/_http.mjs';
import { classifyLiveness } from '../../../liveness-core.mjs';
import { plainText } from '../lib/job-analyzer.mjs';

const MAX_HOPS = 5;

/** Visible texts of links, buttons and submit inputs — what liveness-core calls apply controls. */
export function applyControls(html = '') {
  const out = [];
  const h = String(html).slice(0, 2_000_000);
  for (const m of h.matchAll(/<(a|button)\b([^>]*)>([\s\S]{0,400}?)<\/\1>/gi)) {
    const text = plainText(m[3]).replace(/\s+/g, ' ').trim();
    const aria = (/aria-label\s*=\s*["']([^"']{1,80})["']/i.exec(m[2]) || [])[1];
    if (text && text.length <= 80) out.push(text);
    else if (aria) out.push(aria);
    if (out.length > 400) break;
  }
  for (const m of h.matchAll(/<input\b[^>]*type\s*=\s*["']?submit["']?[^>]*value\s*=\s*["']([^"']{1,80})["']/gi)) out.push(m[1]);
  return out;
}
const UA = 'Mozilla/5.0 (compatible; CareerOpsPlatform/1.0; +https://github.com/career-ops-hq/career-ops)';

/**
 * Check one URL. Returns { result: 'active'|'expired'|'uncertain'|'broken', code, reason, finalUrl, status }.
 * 'broken' = the URL cannot be fetched at all (DNS failure, refused, invalid).
 */
export async function checkLink(url, { timeoutMs = 15000, fetchImpl = fetchResponse } = {}) {
  let current = url;
  let status = 0;
  let body = '';
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    let parsed;
    try { parsed = new URL(current); } catch { return { result: 'broken', code: 'invalid_url', reason: 'invalid URL', finalUrl: current, status: 0 }; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return { result: 'broken', code: 'invalid_url', reason: 'unsupported scheme', finalUrl: current, status: 0 };
    try {
      const res = await fetchImpl(current, {
        redirect: 'manual',
        timeoutMs,
        maxBytes: 2 * 1024 * 1024,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      });
      status = res.status;
      if (status >= 300 && status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, current).href;
        continue;
      }
      body = await res.text();
      break;
    } catch (err) {
      if (err?.status) { status = err.status; body = err.body || ''; break; }
      const msg = String(err?.message || err);
      if (/blocked|private|not allowed|refus/i.test(msg) && /address|ip|host/i.test(msg)) {
        return { result: 'broken', code: 'blocked_address', reason: 'link resolves to a private address', finalUrl: current, status: 0 };
      }
      if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|certificate|CERT_|ERR_TLS/i.test(msg + (err?.cause?.code || '') + (err?.cause?.message || ''))) {
        return { result: 'broken', code: 'unreachable', reason: msg.slice(0, 200), finalUrl: current, status: 0 };
      }
      return { result: 'uncertain', code: 'network_error', reason: msg.slice(0, 200), finalUrl: current, status: 0 };
    }
  }
  const verdict = classifyLiveness({ status, requestedUrl: url, finalUrl: current, bodyText: plainText(body).slice(0, 200000), applyControls: applyControls(body) });
  return { result: verdict.result, code: verdict.code, reason: verdict.reason, finalUrl: current, status };
}

/** Verify a batch of jobs' links and persist the outcome. */
export async function verifyJobLinks(db, { budget = 150, recheckDays = 3, concurrency = 10, runId = null, log = () => {}, check = checkLink } = {}) {
  const rows = db.prepare(`
    SELECT id, apply_url, link_status FROM jobs
    WHERE status = 'active' AND work_arrangement != 'Unspecified'
      AND (link_status IN ('unverified') OR (is_direct = 0 AND (link_checked_at IS NULL OR link_checked_at < datetime('now', ?))))
    ORDER BY CASE link_status WHEN 'unverified' THEN 0 ELSE 1 END, COALESCE(posted_at, first_seen_at) DESC
    LIMIT ?`).all(`-${recheckDays} days`, budget);
  const update = db.prepare(`UPDATE jobs SET link_status = ?, status = ?, link_checked_at = datetime('now'), link_check_note = ?, updated_at = datetime('now') WHERE id = ?`);
  let checked = 0; let broken = 0; let expired = 0; let verified = 0;
  let i = 0;
  async function worker() {
    while (i < rows.length) {
      const row = rows[i++];
      let r;
      try { r = await check(row.apply_url); } catch (err) { r = { result: 'uncertain', code: 'error', reason: String(err.message || err) }; }
      checked++;
      const note = `${r.code || ''}: ${r.reason || ''}`.slice(0, 300);
      if (r.result === 'active') { update.run('verified', 'active', note, row.id); verified++; }
      else if (r.result === 'expired') { update.run('expired', 'expired', note, row.id); expired++; }
      else if (r.result === 'broken') { update.run('broken', 'broken', note, row.id); broken++; }
      // Unreadable page (bot wall, rate limit, no visible apply button) but the
      // posting is still in the source's live feed: shown as "source confirmed",
      // never as "verified".
      else update.run(row.link_status === 'verified' ? 'verified' : 'source_confirmed', 'active', note, row.id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  if (checked) log('info', `Link check: ${checked} checked, ${verified} verified, ${expired} expired, ${broken} broken.`);
  if (runId) db.prepare('UPDATE fetch_runs SET links_checked = links_checked + ?, links_broken = links_broken + ? WHERE id = ?').run(checked, broken + expired, runId);
  return { checked, verified, expired, broken };
}

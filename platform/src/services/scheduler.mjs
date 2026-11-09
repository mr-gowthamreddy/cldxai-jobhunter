// Daily job refresh scheduler. Runs inside the worker process (or embedded in
// the web server with SCHEDULER_MODE=embedded) and never depends on a browser.
//
// Every 30s it checks: (1) a manual "run now" request queued by an admin,
// (2) the daily slot (FETCH_DAILY_AT, server local time) not yet run today,
// (3) on start-up, a last successful fetch older than 24h. It writes a
// heartbeat so the admin dashboard can show whether the scheduler is alive.

import { config } from '../config.mjs';
import { getSetting, setSetting } from '../db/index.mjs';
import { runFetch, isFetchRunning } from './fetcher.mjs';
import { notifyNewJobs, notifyExpiredTracked } from './notifications.mjs';
import { syncJobsToSheet } from './sheets.mjs';
import { logSystemError } from '../lib/activity.mjs';

export const postFetchHooks = {
  async afterFetch(db, run) {
    const since = db.prepare('SELECT started_at FROM fetch_runs WHERE id = ?').get(run.id)?.started_at;
    await notifyNewJobs(db, run.newIds || []);
    if (since) notifyExpiredTracked(db, since);
    await syncJobsToSheet(db, { runId: run.id });
  },
};

function parseDailyAt(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return { h: 6, m: 0 };
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}

function localDay(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Decide whether a scheduled run is due now. Pure, for tests. */
export function dueReason({ now = new Date(), dailyAt = config.fetchDailyAt, lastScheduledDay = null, lastSuccessAt = null, requestedAt = null, startup = false, fetchOnStartupIfStale = config.fetchOnStartupIfStale } = {}) {
  if (requestedAt) return 'manual';
  const { h, m } = parseDailyAt(dailyAt);
  const slot = new Date(now); slot.setHours(h, m, 0, 0);
  if (now >= slot && lastScheduledDay !== localDay(now)) return 'schedule';
  if (startup && fetchOnStartupIfStale) {
    const last = lastSuccessAt ? Date.parse(lastSuccessAt) : 0;
    if (!last || now.getTime() - last > 24 * 3600 * 1000) return 'startup';
  }
  return null;
}

export function nextRunAt(now = new Date(), dailyAt = config.fetchDailyAt, lastScheduledDay = null) {
  const { h, m } = parseDailyAt(dailyAt);
  const slot = new Date(now); slot.setHours(h, m, 0, 0);
  if (now < slot || lastScheduledDay !== localDay(now)) {
    if (now >= slot && lastScheduledDay !== localDay(now)) return now;
    return slot;
  }
  slot.setDate(slot.getDate() + 1);
  return slot;
}

export function startScheduler(db, { intervalMs = 30_000, log = console.log, role = 'worker' } = {}) {
  let first = true;
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try {
      setSetting(db, 'scheduler_heartbeat', { at: new Date().toISOString(), pid: process.pid, role });
      if (isFetchRunning()) return;
      const requested = getSetting(db, 'fetch_requested', null);
      const reason = dueReason({
        lastScheduledDay: getSetting(db, 'last_scheduled_day', null),
        lastSuccessAt: getSetting(db, 'last_successful_fetch_at', null),
        requestedAt: requested?.at || null,
        startup: first,
        dailyAt: getSetting(db, 'fetch_daily_at', config.fetchDailyAt),
      });
      first = false;
      if (!reason) return;
      if (reason === 'manual') setSetting(db, 'fetch_requested', null);
      if (reason === 'schedule') setSetting(db, 'last_scheduled_day', localDay());
      log(`[scheduler] starting fetch (${reason})`);
      const sourceIds = reason === 'manual' && Array.isArray(requested?.sourceIds) ? requested.sourceIds : null;
      const result = await runFetch(db, { trigger: reason, sourceIds, hooks: postFetchHooks });
      log(`[scheduler] fetch ${result.skipped ? `skipped: ${result.reason}` : `finished: ${result.status}`}`);
    } catch (err) {
      logSystemError(db, 'scheduler', err);
      log(`[scheduler] error: ${err.message}`);
    }
  }
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  setTimeout(tick, 2000).unref?.();
  return { stop() { stopped = true; clearInterval(timer); } };
}

/** Scheduler status for the dashboard. */
export function schedulerStatus(db) {
  const hb = getSetting(db, 'scheduler_heartbeat', null);
  const alive = hb ? Date.now() - Date.parse(hb.at) < 3 * 60 * 1000 : false;
  const dailyAt = getSetting(db, 'fetch_daily_at', config.fetchDailyAt);
  return {
    mode: config.schedulerMode,
    alive,
    heartbeat: hb,
    daily_at: dailyAt,
    next_run_at: nextRunAt(new Date(), dailyAt, getSetting(db, 'last_scheduled_day', null)).toISOString(),
    last_successful_fetch_at: getSetting(db, 'last_successful_fetch_at', null),
    fetch_requested: getSetting(db, 'fetch_requested', null),
    fetch_running: Boolean(getSetting(db, 'fetch_lock', null)),
  };
}

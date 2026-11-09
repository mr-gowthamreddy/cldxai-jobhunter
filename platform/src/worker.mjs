#!/usr/bin/env node
// Scheduler worker: a separate process that keeps job listings fresh whether or
// not anyone has the web app open.
//   node src/worker.mjs          run forever (daily schedule + admin "run now")
//   node src/worker.mjs --once   run one full fetch now and exit (cron / Task Scheduler)

import { getDb } from './db/index.mjs';
import { ensureBaseData } from './db/seed.mjs';
import { startScheduler, postFetchHooks } from './services/scheduler.mjs';
import { runFetch } from './services/fetcher.mjs';
import { config } from './config.mjs';

const db = getDb();
ensureBaseData(db);

if (process.argv.includes('--once')) {
  const t0 = Date.now();
  console.log('[worker] running a one-off fetch…');
  const r = await runFetch(db, { trigger: 'cli', hooks: postFetchHooks });
  if (r.skipped) { console.log(`[worker] skipped: ${r.reason}`); process.exit(0); }
  console.log(`[worker] ${r.status}: ${r.created} new, ${r.updated} refreshed, ${r.expired} expired, ${r.duplicate} duplicates, ${r.failed}/${r.sources} sources failed (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  process.exit(r.status === 'failed' ? 1 : 0);
} else {
  console.log(`[worker] scheduler started — daily fetch at ${config.fetchDailyAt} (server local time); DB ${config.dbPath}`);
  const s = startScheduler(db, { role: 'worker' });
  const stop = () => { s.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  setInterval(() => {}, 1 << 30); // keep the event loop alive
}

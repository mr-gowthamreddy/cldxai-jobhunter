#!/usr/bin/env node
// Web server. Binds HOST:PORT (default 0.0.0.0:4300) so other devices on the
// network can reach it; put it behind HTTPS (reverse proxy) for public hosting.

import os from 'node:os';
import { config } from './config.mjs';
import { getDb } from './db/index.mjs';
import { createApp } from './app.mjs';
import { ensureBaseData } from './db/seed.mjs';
import { startScheduler } from './services/scheduler.mjs';

const db = getDb();
ensureBaseData(db);
const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(`\nCareer-Ops Platform is running`);
  console.log(`  Local:    http://localhost:${config.port}`);
  if (config.host === '0.0.0.0' || config.host === '::') {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) console.log(`  Network:  http://${a.address}:${config.port}`);
    }
  }
  console.log(`  Database: ${config.dbPath}`);
  console.log(`  Scheduler mode: ${config.schedulerMode}${config.schedulerMode === 'worker' ? ' (start the worker with: npm run worker)' : ''}\n`);
});

let scheduler = null;
if (config.schedulerMode === 'embedded') scheduler = startScheduler(db, { role: 'embedded' });

function shutdown() {
  scheduler?.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

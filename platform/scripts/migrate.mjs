#!/usr/bin/env node
// Apply pending database migrations and base data.
import { getDb, migrate } from '../src/db/index.mjs';
import { ensureBaseData } from '../src/db/seed.mjs';
import { config } from '../src/config.mjs';
const conn = getDb(); // getDb() already applies migrations
const ran = migrate(conn);
ensureBaseData(conn);
console.log(`Database ready at ${config.dbPath}${ran.length ? ` (applied ${ran.join(', ')})` : ''}`);

// SQLite access through Node's built-in node:sqlite (no native build step, so
// it installs the same way on Windows, macOS and Linux). WAL mode lets the web
// server and the scheduler worker share one database file safely.

import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.mjs';

// node:sqlite prints an ExperimentalWarning on first load; it is stable enough
// for this use and the warning only confuses users reading the console.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const msg = typeof warning === 'string' ? warning : warning?.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return origEmit.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

let db = null;

export function openDatabase(file = config.dbPath) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL;');
  conn.exec('PRAGMA foreign_keys = ON;');
  conn.exec('PRAGMA busy_timeout = 10000;');
  conn.exec('PRAGMA synchronous = NORMAL;');
  return conn;
}

export function getDb() {
  if (!db) {
    db = openDatabase();
    migrate(db);
  }
  return db;
}

/** Replace the process-wide connection (tests use a temp file). */
export function setDb(conn) {
  db = conn;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export function migrate(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(conn.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    conn.exec('BEGIN');
    try {
      conn.exec(sql);
      conn.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      conn.exec('COMMIT');
      ran.push(file);
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    }
  }
  return ran;
}

/** Run fn inside a transaction (node:sqlite has no built-in helper). */
export function tx(conn, fn) {
  conn.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

export function getSetting(conn, key, fallback = null) {
  const row = conn.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(conn, key, value) {
  conn.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value));
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

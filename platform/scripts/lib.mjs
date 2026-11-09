// Shared helpers for the CLI scripts.
import readline from 'node:readline';
import { getDb } from '../src/db/index.mjs';
import { ensureBaseData } from '../src/db/seed.mjs';
import { hashPassword, passwordProblems } from '../src/lib/security.mjs';

export function db() {
  const conn = getDb();
  ensureBaseData(conn);
  return conn;
}

export function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

/** Create or promote an admin account. Returns a status string. */
export async function upsertAdmin(conn, { email, password, name }) {
  const mail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) throw new Error('Invalid email address.');
  const existing = conn.prepare('SELECT id FROM users WHERE email = ?').get(mail);
  const adminRole = conn.prepare("SELECT id FROM roles WHERE name = 'admin'").get().id;
  if (existing) {
    conn.prepare("UPDATE users SET role_id = ?, status = 'active', is_verified = 1 WHERE id = ?").run(adminRole, existing.id);
    if (password) {
      const problems = passwordProblems(password);
      if (problems.length) throw new Error(`Password needs ${problems.join(', ')}.`);
      conn.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), existing.id);
    }
    return `promoted existing account ${mail} to admin`;
  }
  const problems = passwordProblems(password);
  if (problems.length) throw new Error(`Password needs ${problems.join(', ')}.`);
  const info = conn.prepare("INSERT INTO users (email, password_hash, full_name, role_id, status, is_verified) VALUES (?, ?, ?, ?, 'active', 1)")
    .run(mail, await hashPassword(password), name || 'Administrator', adminRole);
  const id = Number(info.lastInsertRowid);
  conn.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)').run(id);
  conn.prepare('INSERT OR IGNORE INTO job_preferences (user_id) VALUES (?)').run(id);
  return `created admin account ${mail}`;
}

export async function upsertUser(conn, { email, password, name }) {
  const mail = email.toLowerCase();
  if (conn.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return false;
  const role = conn.prepare("SELECT id FROM roles WHERE name = 'user'").get().id;
  const info = conn.prepare("INSERT INTO users (email, password_hash, full_name, role_id, status, is_verified) VALUES (?, ?, ?, ?, 'active', 1)")
    .run(mail, await hashPassword(password), name, role);
  const id = Number(info.lastInsertRowid);
  conn.prepare('INSERT OR IGNORE INTO user_profiles (user_id) VALUES (?)').run(id);
  conn.prepare('INSERT OR IGNORE INTO job_preferences (user_id) VALUES (?)').run(id);
  return true;
}

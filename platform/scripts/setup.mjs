#!/usr/bin/env node
// One-time (and re-runnable) setup: .env, database, base data, first admin.
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  copyFileSync(path.join(root, '.env.example'), envPath);
  console.log('Created platform/.env from .env.example (edit it to configure SMTP, Google Sheets, etc.).');
}
const { config } = await import('../src/config.mjs');
const { db, ask, upsertAdmin, upsertUser } = await import('./lib.mjs');
mkdirSync(config.uploadDir, { recursive: true, mode: 0o700 });
const conn = db();
console.log(`Database ready: ${config.dbPath}`);

const admins = conn.prepare("SELECT COUNT(*) n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin'").get().n;
if (!admins) {
  let { email, password, name } = config.bootstrapAdmin;
  if ((!email || !password) && process.stdin.isTTY && !process.argv.includes('--non-interactive')) {
    console.log('\nNo administrator exists yet. Create one now (you can also run "npm run create-admin" later).');
    email = email || await ask('Admin email: ');
    password = password || await ask('Admin password (min 8 chars, letters + numbers): ', { hidden: true });
    name = (await ask('Admin full name [Administrator]: ')) || name;
  }
  if (email && password) {
    try { console.log(await upsertAdmin(conn, { email, password, name })); }
    catch (err) { console.error(`Admin not created: ${err.message}. Run "npm run create-admin" to retry.`); }
  } else {
    console.log('No admin created. Set ADMIN_EMAIL and ADMIN_PASSWORD in platform/.env or run "npm run create-admin".');
  }
} else {
  console.log(`${admins} administrator account(s) already exist.`);
}
if (config.seedDemoUsers || process.argv.includes('--demo')) {
  for (const u of [{ email: 'demo.alex@example.com', password: 'DemoPass123', name: 'Alex Demo' }, { email: 'demo.sam@example.com', password: 'DemoPass123', name: 'Sam Demo' }]) {
    if (await upsertUser(conn, u)) console.log(`Demo user: ${u.email} / ${u.password}`);
  }
}
console.log('\nSetup complete. Start everything with: npm run start:all');

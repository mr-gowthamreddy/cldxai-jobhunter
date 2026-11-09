#!/usr/bin/env node
// Create (or promote) an administrator.
//   npm run create-admin                       interactive
//   npm run create-admin -- --email a@b.c --password 'Secret123' --name "Ana"
//   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run create-admin
import { db, ask, upsertAdmin } from './lib.mjs';
import { config } from '../src/config.mjs';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
let email = arg('email') || config.bootstrapAdmin.email;
let password = arg('password') || config.bootstrapAdmin.password;
let name = arg('name') || config.bootstrapAdmin.name;
if (!email) email = await ask('Admin email: ');
if (!password) password = await ask('Admin password (min 8 chars, letters + numbers): ', { hidden: true });
if (!arg('name') && !process.env.ADMIN_NAME && process.stdin.isTTY) name = (await ask('Admin full name [Administrator]: ')) || 'Administrator';
try {
  console.log(await upsertAdmin(db(), { email, password, name }));
} catch (err) {
  console.error(`Could not create the admin: ${err.message}`);
  process.exit(1);
}

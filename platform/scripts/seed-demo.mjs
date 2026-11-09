#!/usr/bin/env node
// Optional development accounts (never run automatically in production).
// Creates two ordinary users so you can test data isolation side by side.
import { db, upsertUser } from './lib.mjs';
const conn = db();
const demo = [
  { email: 'demo.alex@example.com', password: 'DemoPass123', name: 'Alex Demo' },
  { email: 'demo.sam@example.com', password: 'DemoPass123', name: 'Sam Demo' },
];
for (const u of demo) console.log(`${(await upsertUser(conn, u)) ? 'created' : 'exists '}  ${u.email} / ${u.password}`);
console.log('These are development-only accounts. Delete them (Admin → Users) before sharing the server.');

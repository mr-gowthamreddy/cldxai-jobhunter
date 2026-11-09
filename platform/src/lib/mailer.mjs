// Outbound email. With SMTP configured, mail goes through nodemailer. Without
// it (typical local setup), each message is written to the outbox directory as
// an .eml file and the path is logged, so password-reset links still work in
// development without pretending an email was delivered.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { config } from '../config.mjs';

let transport = null;

export function mailConfigured() {
  return Boolean(config.smtp.host);
}

function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text }) {
  if (mailConfigured()) {
    await getTransport().sendMail({ from: config.smtp.from, to, subject, text });
    return { delivered: true };
  }
  mkdirSync(config.outboxDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeTo = String(to).replace(/[^a-z0-9@._-]/gi, '_');
  const file = path.join(config.outboxDir, `${stamp}-${safeTo}.eml`);
  const body = `From: ${config.smtp.from}\nTo: ${to}\nSubject: ${subject}\nDate: ${new Date().toUTCString()}\nContent-Type: text/plain; charset=utf-8\n\n${text}\n`;
  writeFileSync(file, body, { mode: 0o600 });
  if (config.env !== 'test') console.log(`[mail] SMTP not configured — message for ${to} saved to ${file}`);
  return { delivered: false, file };
}

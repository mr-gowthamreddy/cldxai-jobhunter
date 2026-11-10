// Central configuration. Every secret and deployment-specific value comes from
// the environment (platform/.env, see .env.example). Nothing here is a
// credential; defaults are safe for local development only.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const PLATFORM_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PLATFORM_ROOT, '..');

const envFile = process.env.CAREER_OPS_PLATFORM_ENV || path.join(PLATFORM_ROOT, '.env');
if (existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });

const env = process.env;

function bool(v, fallback) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function int(v, fallback) {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}
function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(PLATFORM_ROOT, p);
}

const dataDir = resolveFromRoot(env.DATA_DIR || '../data/platform');

export const config = {
  env: env.NODE_ENV || 'development',
  isProduction: (env.NODE_ENV || 'development') === 'production',
  host: env.HOST || '0.0.0.0',
  port: int(env.PORT, 4300),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${int(env.PORT, 4300)}`).replace(/\/+$/, ''),
  trustProxy: bool(env.TRUST_PROXY, false),
  cookieSecure: bool(env.COOKIE_SECURE, false),

  dataDir,
  dbPath: resolveFromRoot(env.DATABASE_PATH || path.join(dataDir, 'career-ops.db')),
  uploadDir: resolveFromRoot(env.UPLOAD_DIR || path.join(dataDir, 'uploads')),
  outboxDir: resolveFromRoot(env.MAIL_OUTBOX_DIR || path.join(dataDir, 'outbox')),

  sessionTtlHours: int(env.SESSION_TTL_HOURS, 24 * 7),
  passwordResetTtlMinutes: int(env.PASSWORD_RESET_TTL_MINUTES, 60),
  requireAdminApproval: bool(env.REQUIRE_ADMIN_APPROVAL, false),
  allowRegistration: bool(env.ALLOW_REGISTRATION, true),
  maxUploadMb: int(env.MAX_UPLOAD_MB, 5),
  maxResumesPerUser: int(env.MAX_RESUMES_PER_USER, 10),
  loginMaxAttempts: int(env.LOGIN_MAX_ATTEMPTS, 8),
  loginLockMinutes: int(env.LOGIN_LOCK_MINUTES, 15),

  // Scheduler
  schedulerMode: env.SCHEDULER_MODE || 'worker', // worker | embedded | off
  fetchDailyAt: env.FETCH_DAILY_AT || '06:00',    // local server time, HH:MM
  fetchOnStartupIfStale: bool(env.FETCH_ON_STARTUP_IF_STALE, true),
  fetchConcurrency: int(env.FETCH_CONCURRENCY, 4),
  fetchSourceTimeoutMs: int(env.FETCH_SOURCE_TIMEOUT_MS, 60_000),
  expireAfterMissedFetches: int(env.EXPIRE_AFTER_MISSED_FETCHES, 2),
  linkCheckBudget: int(env.LINK_CHECK_BUDGET, 1500),
  linkRecheckDays: int(env.LINK_RECHECK_DAYS, 3),
  maxJobAgeDays: int(env.MAX_JOB_AGE_DAYS, 60),

  // Mail (optional). Without SMTP_HOST, mail is written to outboxDir as .eml.
  smtp: {
    host: env.SMTP_HOST || '',
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Career-Ops <no-reply@localhost>',
  },

  // Google Sheets (optional reporting layer)
  sheets: {
    enabled: bool(env.GOOGLE_SHEETS_ENABLED, false),
    spreadsheetId: env.GOOGLE_SHEETS_SPREADSHEET_ID || '',
    serviceAccountEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    credentialsFile: env.GOOGLE_APPLICATION_CREDENTIALS ? resolveFromRoot(env.GOOGLE_APPLICATION_CREDENTIALS) : '',
    tabPrefix: env.GOOGLE_SHEETS_TAB_PREFIX || 'Jobs',
    maxDescriptionChars: int(env.GOOGLE_SHEETS_MAX_DESCRIPTION_CHARS, 2000),
  },

  // Bootstrap admin (only used by scripts/setup.mjs / create-admin.mjs when no admin exists)
  bootstrapAdmin: {
    email: env.ADMIN_EMAIL || '',
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Administrator',
  },
  seedDemoUsers: bool(env.SEED_DEMO_USERS, false),
};

# Platform build — progress checkpoint (paused)

## Done and verified so far
- Audit: the repo is a single-user CLI with 159 job providers, a liveness checker, and a Next.js single-user web UI. It had no Google Sheets integration.
- `platform/` package (Express + built-in `node:sqlite`) — deps installed.
- Schema `src/db/migrations/001_init.sql` (users, roles, sessions, password_resets, user_profiles, job_preferences,
  resumes, resume_data, job_sources, jobs, saved_jobs, applications, application_events, saved_searches,
  favorite_companies, recently_viewed, notifications, admin_activity, user_activity, fetch_runs, fetch_logs,
  sheets_sync_logs, system_errors, settings).
- Libraries: taxonomy (skills + categories), job-analyzer (experience/bands/arrangement/salary),
  resume text extraction (PDF/DOCX/DOC, magic-byte validation) + parser, matcher, insights, security, mailer.
- Services: fetcher (reuses providers/), link verifier (reuses liveness-core + guarded _http), Google Sheets
  (service-account JWT), notifications, job-query, scheduler.
- HTTP: auth (register/login/lockout/logout/forgot/reset/change), resumes, jobs, saved searches, favourites,
  applications + stats + CSV/XLSX export, profile/preferences/notifications/account delete, full admin API.
- Scripts: setup, migrate, create-admin, seed-demo, start-all. `.env.example` written.
- Real fetch tested: 36 sources, 5,467 jobs, 0 failures, 157 duplicates detected.
- Link verification tested (live link → active; dead Greenhouse ID → expired).
- Provider improvement: ashby.mjs / lever.mjs now pass through `workplaceType` (additive).
- Front-end: `public/css/app.css` design system written.

## Remaining
1. Front-end JS: index.html, api/ui/router helpers, shell, pages (landing, auth, dashboard, jobs, job detail,
   recommendations, saved, applications/kanban, resumes dropzone, profile/preferences, notifications, admin).
2. Re-run the fetch after the arrangement-detection changes.
3. Tests in `platform/tests/` (auth, isolation, uploads, matching, filters, dedup, link check, admin perms,
   scheduler, Sheets with mocked fetch, persistence) + a Playwright UI smoke test.
4. start.bat / start.sh, README + docs (GOOGLE_SHEETS.md, troubleshooting), .gitignore for platform/.env,
   register `platform/`, `start.bat`, `start.sh` in lib/update-manifest.mjs SYSTEM_PATHS, run the repo's test suite.

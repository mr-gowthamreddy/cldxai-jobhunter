# CloudX AI JobHunter

A multi-user web application built on top of career-ops. Anyone can register, upload a resume, get matched with **active, verified** job openings, and run their whole job search from a private dashboard. Administrators manage users, job sources and the daily job pipeline.

It reuses the career-ops engine underneath: the 130+ job-source providers in `providers/`, the posting-liveness classifier (`liveness-core.mjs`), the SSRF-guarded HTTP layer (`providers/_http.mjs`) and the URL normaliser used for de-duplication (`url-key.mjs`). The original single-user CLI keeps working unchanged.

- [Quick start](#quick-start)
- [Features](#features)
- [Configuration](#configuration-environment-variables)
- [Admin accounts](#admin-accounts)
- [Running for other people (LAN / public)](#running-for-other-people)
- [Architecture](#architecture) · [Database](#database)
- [Testing](#testing) · [Troubleshooting](#troubleshooting)

---

## Quick start

**You need:** [Node.js 22 LTS or newer](https://nodejs.org). Nothing else: the database is SQLite, built into Node, and no Python, Docker or database server is required.

### Windows

Double-click **`start.bat`** in the repository root, or run it from a terminal:

```bat
start.bat
```

### macOS / Linux

```bash
./start.sh
```

The start script:
1. checks your Node.js version,
2. installs dependencies the first time (`npm install` in the repo root and in `platform/`),
3. creates `platform/.env` from `.env.example` and the database (`data/platform/career-ops.db`),
4. asks you to create the first **administrator** if none exists,
5. starts the **web server** and the **job scheduler worker**, and
6. opens **http://localhost:4300** in your browser.

Close the window or press **Ctrl+C** to stop both processes. Your data is kept in `data/platform/`.

> The first job fetch runs automatically a few seconds after start-up, because no fetch has happened yet. It takes about a minute and loads several thousand jobs. After that, jobs refresh once a day at 06:00 server time.

### Manual setup (any OS)

```bash
# from the repository root
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install   # core career-ops deps (job providers)
cd platform
npm install
npm run setup          # .env + database + first admin (interactive)
npm run start:all      # web server + scheduler worker, opens the browser
```

Or run the two processes yourself, for example under a process manager:

```bash
npm start              # web server only  (http://localhost:4300)
npm run worker         # scheduler worker only
npm run fetch-now      # one full fetch, then exit (cron / Task Scheduler friendly)
```

---

## Features

**For job seekers**
- Registration, sign-in and sign-out; forgot/reset password by one-time email link; password change; self-service account deletion.
- **Resumes:** drag-and-drop or browse upload of PDF, DOC and DOCX, with an upload progress bar, multiple versions, replace, rename, delete, download and an in-browser PDF preview. One resume is "active" and drives matching.
- **Automatic extraction:** name, email, phone, total and relevant experience, current role, previous titles, technical skills, programming languages, cloud platforms, databases, certifications, education and summary. Every field is editable, because parsing is never perfect.
- **Matching:** a match % for every job, with matching skills, missing skills, related skills (partial credit), required vs. your experience, title relevance, domain fit and plain-language reasons. Works for any profession: engineering, data, product, design, marketing, sales, finance, HR, operations, healthcare and more.
- **Job discovery:** search and filter by keywords, title, company, required skills, experience band or "match my experience", location, work arrangement (Remote / Hybrid / Work from office), salary, date posted, source, direct-employer links only and category. Featured categories: Snowflake, Azure Data Engineering, Databricks, PySpark, SQL, dbt, Microsoft Fabric, Power BI, Data Engineering and Cloud Engineering.
- **Recommendations** ranked by match, freshness, direct links and favourite companies; saved searches with alerts; favourite companies; recently viewed jobs; "new" and "posted N days ago" indicators; direct "Apply on company site" buttons.
- **Application tracker:** statuses Interested → Saved → Applied → Interview Scheduled → Technical Round → HR Round → Offer Received / Rejected. Includes a kanban board with drag-and-drop, a table view, notes, applied and interview dates, status history, manually added jobs, progress charts, and **CSV / Excel export**.
- **Insights:** resume improvement suggestions, missing-skills analysis across your best matches, and interview-preparation plans per job and stage.
- **Notifications** for new matching jobs, saved-search hits, saved jobs that closed, and account events. Email is used too when SMTP is configured.
- Light and dark mode, responsive layout for phones and tablets, accessible keyboard navigation.

**For administrators** (`/admin`)
- Overview: users, jobs (visible / expired / duplicate / broken), resumes, sources, errors, scheduler health, Sheets and email status, and charts.
- Users: search, approve pending accounts, verify, activate or deactivate, promote or demote admins, revoke sessions, delete. The last active admin is protected.
- Activity: per-user activity (action types only) and a full audit log of admin actions.
- Resumes: counts, types, parse status and uploads per user, **never contents**.
- Jobs: browse every record including hidden ones, re-check a link, close or reactivate. Duplicates: swap the primary or unmark.
- Job sources: add any Greenhouse / Lever / Ashby / Workable / SmartRecruiters / … careers URL or feed provider; enable, disable, test, fetch one, delete.
- Fetching: run a fetch now, run history, per-run logs and scheduler logs. Google Sheets: status, sync logs, sync now. Errors: system and fetch errors, failing sources.
- Settings: daily fetch time and the experience bands (configurable; they label jobs and never exclude any range).

### How job data stays clean

| Rule | How it is enforced |
|---|---|
| Direct company links first | Company career boards (ATS APIs) are "direct". When the same job appears on an aggregator too, the employer's link becomes the primary record and the aggregator copy is marked a duplicate. |
| Only active, verifiable links | A job is shown only when (a) the employer's ATS API listed it in the latest fetch, or (b) its application link passed an HTTP liveness check. The check uses career-ops' classifier: 404/410, "position closed" banners and expired redirects mark it expired. Pages behind bot walls are shown as "live on source" only while the source's own feed still lists them. |
| Expired / closed | A posting missing from its source in 2 consecutive fetches (`EXPIRE_AFTER_MISSED_FETCHES`) is expired. Postings older than `MAX_JOB_AGE_DAYS` are not imported. An empty response from a board that had jobs is treated as an outage, not as "all closed". |
| Broken links | Unreachable or invalid URLs are marked broken and hidden. |
| Duplicates | Same normalised URL means the same record, refreshed and never re-inserted. The same company + title + location from another URL counts as a cross-source duplicate. |
| Work arrangement | Only Remote, Hybrid and Work-from-office jobs are shown. The arrangement comes from the ATS's structured field (Ashby/Lever `workplaceType`) or from explicit wording in the posting. Jobs that never state it are kept, hidden, and counted for admins. |
| Experience | Parsed from the posting ("3–5 years", "5+ years", "freshers"). If the posting gives none, it is inferred from title seniority and marked as an estimate. Jobs are labelled Fresher, 0–2, 2–4, 4–6, 6–8, 8–10 or 10+ (configurable). |

---

## Configuration (environment variables)

All settings live in `platform/.env`; `npm run setup` creates it from `.env.example`. Nothing secret is stored in source code. The defaults are fine for local use.

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | `CloudX AI JobHunter` | Product name shown in the app, browser tab, emails and exports. The logo files are in `public/brand/` (`wordmark.svg`, `mark.svg`, `icon-*.png`, `og.png`). |
| `HOST` | `0.0.0.0` | Interface to listen on. `0.0.0.0` lets other devices on your network connect; `127.0.0.1` restricts the app to this computer. |
| `PORT` | `4300` | HTTP port. |
| `PUBLIC_URL` | `http://localhost:4300` | The address people use. Used in password-reset and notification links. Set it to your LAN IP or https domain when sharing. |
| `TRUST_PROXY` | `false` | Set `true` behind nginx, Caddy or a PaaS load balancer so client IPs and HTTPS are detected. |
| `COOKIE_SECURE` | `false` | Forces the Secure cookie flag (automatic when `PUBLIC_URL` is https). |
| `DATA_DIR` | `../data/platform` | Database, uploads and mail outbox. The folder is gitignored. |
| `DATABASE_PATH`, `UPLOAD_DIR`, `MAIL_OUTBOX_DIR` | inside `DATA_DIR` | Individual overrides. |
| `ALLOW_REGISTRATION` | `true` | Allow self sign-up. |
| `REQUIRE_ADMIN_APPROVAL` | `false` | New accounts stay "pending" until an admin approves them. |
| `SESSION_TTL_HOURS` | `168` | Session lifetime (7 days). |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | Reset link lifetime. |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCK_MINUTES` | `8` / `15` | Account lockout after repeated failed sign-ins. |
| `MAX_UPLOAD_MB` / `MAX_RESUMES_PER_USER` | `5` / `10` | Upload limits. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | empty | First admin, created by setup when none exists. Remove the password after setup. |
| `SEED_DEMO_USERS` | `false` | Create two demo users during setup (development only). |
| `SCHEDULER_MODE` | `worker` | `worker` = separate process (recommended); `embedded` = inside the web server; `off` = no automatic fetching. |
| `FETCH_DAILY_AT` | `06:00` | Daily fetch time (server local time). Admins can change it in the UI. |
| `FETCH_ON_STARTUP_IF_STALE` | `true` | Fetch at start-up if the last success is more than 24 h old. |
| `FETCH_CONCURRENCY`, `FETCH_SOURCE_TIMEOUT_MS` | `4`, `60000` | Parallel sources and per-source time limit. |
| `EXPIRE_AFTER_MISSED_FETCHES` | `2` | Misses before a posting is expired. |
| `LINK_CHECK_BUDGET`, `LINK_RECHECK_DAYS` | `1500`, `3` | Aggregator links verified per run; re-check interval. |
| `MAX_JOB_AGE_DAYS` | `60` | Older postings are ignored or expired. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | empty | Outgoing email. **Without `SMTP_HOST`, emails such as password resets are written as `.eml` files to `data/platform/outbox/`** and the path is printed in the server console. |
| `GOOGLE_SHEETS_ENABLED`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_APPLICATION_CREDENTIALS` or `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_SHEETS_TAB_PREFIX`, `GOOGLE_SHEETS_MAX_DESCRIPTION_CHARS` | disabled | Optional Google Sheets reporting. See [docs/GOOGLE_SHEETS.md](docs/GOOGLE_SHEETS.md). |

Restart the server and the worker after editing `.env`.

---

## Admin accounts

- **First run:** the start script (or `npm run setup`) asks for an admin email and password when no admin exists. To skip the prompt, put `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `platform/.env` first.
- **Any time later:**
  ```bash
  cd platform
  npm run create-admin                                        # interactive
  npm run create-admin -- --email you@example.com --password 'Str0ngPass' --name "Your Name"
  ```
  An existing account with that email is **promoted** to admin (and its password reset if you pass one).
- **In the app:** an admin can promote any user under Admin → Users → *Make admin*.
- **Demo accounts (development only):** `npm run seed:demo` creates `demo.alex@example.com` and `demo.sam@example.com`, both with password `DemoPass123`. Use them to test that two users stay isolated, and delete them before sharing the server.

There are no built-in default credentials. Nothing is hard-coded to any person.

---

## Running for other people

`localhost` is just the starting point. The app is multi-user from day one: every account is isolated server-side, so the same server can serve many people.

**Same network (home / office LAN):** keep `HOST=0.0.0.0`, set `PUBLIC_URL=http://<your-computer's-IP>:4300` and allow port 4300 through your firewall. When the server starts it prints the network address, e.g. `Network: http://192.168.1.20:4300`. Others open that address in their browser.

**Internet, quick and free, from your own computer (Cloudflare quick tunnel):**
1. Install `cloudflared` from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ (Windows: `winget install --id Cloudflare.cloudflared`).
2. In `platform/.env` set `TRUST_PROXY=true`, then restart the app.
3. With the app running, open a second terminal and run `cloudflared tunnel --url http://localhost:4300`.
4. It prints an address like `https://some-random-words.trycloudflare.com`. Share that link. Set it as `PUBLIC_URL` too if you want password-reset links to use it.
5. The link works only while your computer, the app and `cloudflared` are running, and it changes every time you restart the tunnel. For a permanent address, use a named Cloudflare tunnel with your own domain, or public hosting (below).

**Public hosting (a VPS or any Node host):**
1. Run `npm run start:all` (or the server and worker as two services under systemd / pm2 / Docker) with `NODE_ENV=production`.
2. Put a TLS reverse proxy in front (Caddy, nginx), set `PUBLIC_URL=https://your.domain` and `TRUST_PROXY=true`. Cookies then become `Secure` automatically.
3. Configure SMTP so password-reset emails are actually delivered.
4. Consider `REQUIRE_ADMIN_APPROVAL=true` or `ALLOW_REGISTRATION=false` for private groups.
5. Back up `data/platform/` (the database file and uploads).

SQLite in WAL mode comfortably handles a team or community of users on one server. If you ever outgrow a single machine, `src/db/` is the only module that talks to the database.

---

## Architecture

```
Browser (vanilla-JS SPA, no build step)          public/
   │  JSON over HTTPS, session cookie + CSRF header
   ▼
Express web server                               src/server.mjs, src/app.mjs
   ├── http/auth-middleware   sessions, CSRF, roles
   ├── http/routes/*          auth · resumes · jobs · applications · me · admin
   ├── lib/*                  resume parser · text extraction · taxonomy · job analyzer
   │                          matcher · insights · security · mailer
   └── services/*             matching · job-query · notifications · sheets
        │
        ▼
SQLite (node:sqlite, WAL)  ◄──── Scheduler worker   src/worker.mjs → services/scheduler.mjs
data/platform/career-ops.db         │ daily / on demand
                                    ▼
                    services/fetcher.mjs ──► career-ops providers/ (Greenhouse, Lever, Ashby,
                    services/link-verifier.mjs   Remotive, Himalayas, Jobicy, …) + liveness-core
                    services/sheets.mjs  ──► Google Sheets API (service account)
```

- **Two processes, one database.** The web server never blocks on fetching. The worker keeps listings fresh even when nobody has the app open. A database lock prevents two fetches from overlapping, and a heartbeat shows the worker's health on the admin dashboard. Admin "Run fetch now" queues a request that the worker picks up within 30 seconds. If no worker is alive, the web server runs the fetch itself.
- **Front-end:** dependency-free ES modules with a strict Content-Security-Policy (no inline scripts). Chart.js is served locally from `node_modules`; nothing loads from a CDN.
- **Per-run pipeline:** fetch every enabled source → normalise the URL → analyse (experience, arrangement, skills, categories, salary) → upsert → cross-source de-dup → expire vanished postings → verify links → notify users → sync Google Sheets → record the run and its logs.

### Security

- Passwords are hashed with **scrypt** (per-password salt), with timing-safe comparison and a dummy hash for unknown emails, so responses never reveal which accounts exist.
- Sessions use 256-bit random tokens in `HttpOnly; SameSite=Lax` cookies (`Secure` on https); only SHA-256 hashes are stored. A fresh session is issued on login. Password reset and password change revoke other sessions.
- **CSRF:** every state-changing request needs the per-session token header. Anonymous POSTs must be same-origin.
- **Authorisation:** every user-data query is filtered by the session's user id, and other users' records return 404. Admin routes require the admin role, checked server-side on every request.
- **Uploads:** extension allow-list plus a **magic-byte content check**, size limit and per-user count limit. Files are stored under random names outside the web root (`data/platform/uploads/<user-id>/`, mode 600) and served only to their owner, as `no-store` attachments.
- Rate limiting on registration, login, forgot and reset; account lockout after repeated failures.
- Helmet security headers and a strict CSP. All rendering uses text nodes (no `innerHTML` of data), so scraped job descriptions cannot inject script.
- Parameterised SQL everywhere, with LIKE wildcards escaped. Inputs are validated for type and length.
- Outbound fetches go through career-ops' SSRF guard (private and metadata IPs blocked, redirects re-validated).
- CSV, Excel and Sheets exports neutralise formula injection (`=`, `+`, `-`, `@`).

---

## Database

Schema: `src/db/migrations/001_init.sql`. Migrations run automatically on start; `npm run migrate` applies them explicitly.

| Table | Contents |
|---|---|
| `roles` | `user`, `admin` |
| `users` | email, scrypt hash, name, role, status (active / pending / disabled), verification, lockout counters |
| `sessions` | hashed session tokens, CSRF token, expiry, IP / user agent |
| `password_resets` | hashed one-time reset tokens with expiry |
| `user_profiles` | headline, phone, location, links, bio, theme, email-notification choice |
| `job_preferences` | target titles, extra skills, categories, locations, arrangements, salary, experience override, match threshold |
| `resumes` | file metadata per user, version, active flag, parse status (the file itself is on disk) |
| `resume_data` | extracted, user-editable candidate profile per resume |
| `job_sources` | provider / careers URL, kind (company / aggregator), enabled, last-run status |
| `jobs` | normalised URL key, fingerprint, analysed fields, status, link status, duplicate link |
| `saved_jobs`, `favorite_companies`, `recently_viewed`, `saved_searches` | per-user lists |
| `applications`, `application_events` | tracker rows and their status history |
| `notifications` | per-user notifications |
| `admin_activity`, `user_activity` | audit trails (action types, never resume content) |
| `fetch_runs`, `fetch_logs` | every scheduler run and its log lines |
| `sheets_sync_logs`, `system_errors`, `settings` | integration logs, server errors, runtime settings |

Every user-owned table has `user_id … ON DELETE CASCADE`, so deleting an account removes all of its data. Its upload folder is deleted too.

---

## Testing

```bash
cd platform
npm test
```

53 automated tests. Each test file uses its own temporary database, and none of them need network access. They cover:
- **Auth:** registration rules, hashing, login and lockout, logout, forgot/reset (single-use token, sessions revoked), password change, CSRF, security headers.
- **Data isolation:** two simultaneous users. B cannot list, read, download, edit or delete A's resumes, applications, saved jobs, searches or notifications; recommendations use only the requester's resume; account deletion.
- **Resumes:** PDF / DOCX / DOC parsing accuracy; content-sniffing rejects fake and mismatched files; size and count limits; download integrity; edit, replace (new version), activate, delete (file removed).
- **Jobs:** analyzer (experience, bands, arrangement, salary, skills, categories); URL and cross-source de-dup preferring direct links; hidden unspecified / unverified / stale jobs; every filter; match ranking for a data-engineer vs. a marketing resume; expiry after missed fetches; empty-response protection; run logging and hooks; per-user notifications.
- **Admin:** approval flow; 403 for normal users on every admin endpoint; deactivate / promote / demote; last-admin protection; resume monitoring leaks no contents; source validation and CRUD; duplicate management; settings; queued manual fetch.
- **Services:** link checker (live, 404, closed banner, redirect, bot wall, unreachable); link verification updates; scheduler timing and a real queued run; Google Sheets (mocked API: daily tab, header, no duplicate rows, formula-safe, failure logging); persistence across restarts.
- **Applications:** tracking with match score, duplicates refused, manual jobs, every status with history, stats, CSV and Excel export, dashboard.

Browser smoke test of every page against a running server (needs a Chromium for Playwright once: `npx playwright install chromium` in the repo root):

```bash
BASE_URL=http://localhost:4300 ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' npm run test:ui
```

It registers a fresh user, uploads a resume, then browses, saves, tracks, edits preferences and opens every admin section. It fails on any console error, page error or failed API call.

A browser end-to-end pass (Playwright) was also run against a live server with real fetched jobs, covering every page as a user and as an admin, in light and dark mode and on a phone viewport, with zero console errors.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Node.js 22 or newer is required` | Install the current LTS from nodejs.org, then reopen the terminal. |
| `Cannot find package 'js-yaml'` / provider load warnings | Run `npm install` in the repository root (the job providers live there). `start.bat` / `start.sh` do this. |
| Port 4300 already in use | Set `PORT=4400` (and `PUBLIC_URL`) in `platform/.env`. |
| No jobs after start-up | The first fetch takes about a minute. Check Admin → Fetching & logs. Corporate networks may block job-board APIs; failing sources show their error there. |
| Admin shows "Scheduler worker is not running" | Start with `start.bat` / `start.sh` / `npm run start:all`, or run `npm run worker`, or set `SCHEDULER_MODE=embedded`. |
| Forgot-password email never arrives | Without SMTP, emails are saved to `data/platform/outbox/*.eml`. Open the file to get the link, or configure `SMTP_*`. |
| "Invalid or missing CSRF token" | Your session changed in another tab. Reload the page. |
| A resume uploads but parsing fails | Scanned/image-only PDFs have no text. Upload a text-based PDF or DOCX, or fill in the fields by hand. |
| Other devices cannot connect | Use the printed `Network:` address, keep `HOST=0.0.0.0`, and allow the port through the OS firewall. |
| `ExperimentalWarning: SQLite` | Harmless; Node's built-in SQLite. The app hides it where it can. |
| Locked out of the only admin account | `npm run create-admin -- --email you@example.com --password 'NewPass123'` resets the password and re-activates the account. |
| Start over with a clean database | Stop the app and delete `data/platform/` (this deletes all users, resumes and jobs). |

# Google Sheets integration

Google Sheets is an **optional reporting layer**. The platform database stays the source of truth for users, resumes and applications. Only job data is written to Sheets, and never personal data.

After every daily fetch, the worker appends that day's active, verified jobs to a tab named **`Jobs YYYY-MM-DD`**, creating the tab if it doesn't exist yet. Each tab has the same frozen header row:

| Job Key | Job Title | Company | Job Description | Required Experience | Required Skills | Work Arrangement | Location | Source | Direct Application URL | Date Posted | Date Fetched | Link Verification Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

- **No duplicates:** the `Job Key` column (`<job id>|<normalised URL>`) is read back before each write. Rows already on the tab are never written again, so re-running a sync is safe.
- Descriptions are truncated to `GOOGLE_SHEETS_MAX_DESCRIPTION_CHARS` (default 2000) to keep the sheet usable.
- Cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so scraped text can never run as a formula.
- Every sync, whether it succeeded, was skipped or failed, is logged and visible under **Admin → Google Sheets**, where an admin can also trigger "Sync today's jobs now".

## Setup (about 10 minutes)

1. **Create a Google Cloud project:** go to https://console.cloud.google.com/ and create a project, or pick an existing one.
2. **Enable the API:** under APIs & Services → Library, enable **Google Sheets API**.
3. **Create a service account:** under APIs & Services → Credentials → Create credentials → Service account. Give it any name; it needs no project roles.
4. **Create a key:** open the service account → Keys → Add key → JSON. A `.json` file downloads. Keep it private and never commit it.
5. **Create the spreadsheet:** make a new Google Sheet. Copy its ID from the URL: `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
6. **Share the sheet** with the service account's email (`…@….iam.gserviceaccount.com`, found in the JSON as `client_email`) as an **Editor**.
7. **Configure `platform/.env`:**
   ```env
   GOOGLE_SHEETS_ENABLED=true
   GOOGLE_SHEETS_SPREADSHEET_ID=1AbC…xyz
   # Option A: path to the JSON key (absolute, or relative to the platform/ folder)
   GOOGLE_APPLICATION_CREDENTIALS=C:\secrets\career-ops-sheets.json
   # Option B: the two fields directly (keep the \n escapes, all on one line)
   # GOOGLE_SERVICE_ACCOUNT_EMAIL=career-ops@my-project.iam.gserviceaccount.com
   # GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"
   GOOGLE_SHEETS_TAB_PREFIX=Jobs
   ```
8. **Restart** the server and the worker. In **Admin → Google Sheets**, the status should read "Configured". Click **Sync today's jobs now** to test.

## How it authenticates

The platform signs a short-lived JWT with the service account's private key (RS256, using Node's built-in crypto) and exchanges it at `https://oauth2.googleapis.com/token` for an access token with the `spreadsheets` scope. No Google SDK is installed, and no user's Google account is involved.

## Troubleshooting

| Message in Admin → Google Sheets | Meaning |
|---|---|
| `Google Sheets sync is disabled` | `GOOGLE_SHEETS_ENABLED` is not `true`. |
| `No service-account credentials` | Neither the JSON key path nor the email + private key pair is set or readable. |
| `Google OAuth failed (400): invalid_grant` | The key is wrong or revoked, or the server clock is far off. |
| `Sheets API … failed (403)` | The spreadsheet isn't shared with the service account email, or the Sheets API isn't enabled. |
| `Sheets API … failed (404)` | Wrong `GOOGLE_SHEETS_SPREADSHEET_ID`. |

-- Career-Ops Platform — initial schema.
-- Every user-owned table carries user_id with ON DELETE CASCADE, and every
-- query in src/routes filters on the session's user id (see tests/isolation).

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,          -- 'user' | 'admin'
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash     TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  role_id           INTEGER NOT NULL REFERENCES roles(id),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','disabled')),
  is_verified       INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_profiles (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline         TEXT NOT NULL DEFAULT '',
  phone            TEXT NOT NULL DEFAULT '',
  location         TEXT NOT NULL DEFAULT '',
  linkedin_url     TEXT NOT NULL DEFAULT '',
  portfolio_url    TEXT NOT NULL DEFAULT '',
  bio              TEXT NOT NULL DEFAULT '',
  theme            TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('system','light','dark')),
  email_notifications INTEGER NOT NULL DEFAULT 1,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE job_preferences (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  desired_titles      TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  desired_skills      TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  categories          TEXT NOT NULL DEFAULT '[]',   -- JSON string[] of category slugs
  locations           TEXT NOT NULL DEFAULT '[]',   -- JSON string[]
  work_arrangements   TEXT NOT NULL DEFAULT '["Remote","Hybrid","WFO"]',
  min_salary          INTEGER,
  salary_currency     TEXT NOT NULL DEFAULT '',
  experience_years    REAL,                          -- override of resume-derived years
  min_match_score     INTEGER NOT NULL DEFAULT 50,
  notify_new_matches  INTEGER NOT NULL DEFAULT 1,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE resumes (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  stored_name     TEXT NOT NULL UNIQUE,      -- random name inside the private storage dir
  mime_type       TEXT NOT NULL,
  file_ext        TEXT NOT NULL CHECK (file_ext IN ('pdf','doc','docx')),
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       INTEGER NOT NULL DEFAULT 0,
  parse_status    TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsed','failed')),
  parse_error     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resumes_user ON resumes(user_id);

CREATE TABLE resume_data (
  resume_id              INTEGER PRIMARY KEY REFERENCES resumes(id) ON DELETE CASCADE,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  candidate_name         TEXT NOT NULL DEFAULT '',
  email                  TEXT NOT NULL DEFAULT '',
  phone                  TEXT NOT NULL DEFAULT '',
  total_experience_years REAL,
  relevant_experience_years REAL,
  current_role           TEXT NOT NULL DEFAULT '',
  job_titles             TEXT NOT NULL DEFAULT '[]',
  technical_skills       TEXT NOT NULL DEFAULT '[]',
  programming_languages  TEXT NOT NULL DEFAULT '[]',
  cloud_platforms        TEXT NOT NULL DEFAULT '[]',
  databases              TEXT NOT NULL DEFAULT '[]',
  certifications         TEXT NOT NULL DEFAULT '[]',
  education              TEXT NOT NULL DEFAULT '[]',
  summary                TEXT NOT NULL DEFAULT '',
  raw_text               TEXT NOT NULL DEFAULT '',
  edited_by_user         INTEGER NOT NULL DEFAULT 0,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resume_data_user ON resume_data(user_id);

CREATE TABLE job_sources (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL,
  provider           TEXT,                  -- explicit provider id, or NULL to auto-detect from careers_url
  careers_url        TEXT,
  kind               TEXT NOT NULL DEFAULT 'company' CHECK (kind IN ('company','aggregator')),
  is_direct          INTEGER NOT NULL DEFAULT 1,   -- 1 when postings link to the employer's own ATS
  enabled            INTEGER NOT NULL DEFAULT 1,
  config             TEXT NOT NULL DEFAULT '{}',
  last_fetch_at      TEXT,
  last_success_at    TEXT,
  last_status        TEXT,
  last_error         TEXT,
  last_job_count     INTEGER,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, careers_url, provider)
);

CREATE TABLE jobs (
  id                   INTEGER PRIMARY KEY,
  source_id            INTEGER REFERENCES job_sources(id) ON DELETE SET NULL,
  url_key              TEXT NOT NULL UNIQUE,       -- normalized URL (career-ops url-key.mjs)
  fingerprint          TEXT NOT NULL,              -- company+title+location identity for cross-source dedup
  title                TEXT NOT NULL,
  company              TEXT NOT NULL DEFAULT '',
  location             TEXT NOT NULL DEFAULT '',
  description          TEXT NOT NULL DEFAULT '',
  apply_url            TEXT NOT NULL,
  is_direct            INTEGER NOT NULL DEFAULT 1,
  work_arrangement     TEXT NOT NULL DEFAULT 'Unspecified' CHECK (work_arrangement IN ('Remote','Hybrid','WFO','Unspecified')),
  experience_min       REAL,
  experience_max       REAL,
  experience_band      TEXT NOT NULL DEFAULT 'unknown',
  skills               TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (canonical skill names)
  preferred_skills     TEXT NOT NULL DEFAULT '[]',   -- subset of skills named only under "nice to have"
  categories           TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (category slugs)
  salary_min           REAL,
  salary_max           REAL,
  salary_currency      TEXT NOT NULL DEFAULT '',
  posted_at            TEXT,
  first_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','closed','broken','duplicate')),
  link_status          TEXT NOT NULL DEFAULT 'source_confirmed' CHECK (link_status IN ('source_confirmed','verified','unverified','broken','expired')),
  link_checked_at      TEXT,
  link_check_note      TEXT,
  missed_fetches       INTEGER NOT NULL DEFAULT 0,
  duplicate_of         INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_status ON jobs(status, work_arrangement);
CREATE INDEX idx_jobs_fingerprint ON jobs(fingerprint);
CREATE INDEX idx_jobs_company ON jobs(company);
CREATE INDEX idx_jobs_posted ON jobs(posted_at);
CREATE INDEX idx_jobs_source ON jobs(source_id);

CREATE TABLE saved_jobs (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, job_id)
);

CREATE TABLE applications (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id          INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  company         TEXT NOT NULL,
  title           TEXT NOT NULL,
  job_url         TEXT NOT NULL DEFAULT '',
  location        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'Interested' CHECK (status IN ('Interested','Saved','Applied','Interview Scheduled','Technical Round','HR Round','Offer Received','Rejected')),
  applied_on      TEXT,
  interview_at    TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  source          TEXT NOT NULL DEFAULT 'platform' CHECK (source IN ('platform','manual')),
  match_score     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_applications_user ON applications(user_id, status);
CREATE UNIQUE INDEX idx_applications_user_job ON applications(user_id, job_id) WHERE job_id IS NOT NULL;

CREATE TABLE application_events (
  id             INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_status    TEXT,
  to_status      TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_app_events_user ON application_events(user_id);

CREATE TABLE saved_searches (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  query       TEXT NOT NULL,      -- JSON of the job-search filter object
  notify      INTEGER NOT NULL DEFAULT 1,
  last_notified_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE favorite_companies (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company    TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, company)
);

CREATE TABLE recently_viewed (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  viewed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, job_id)
);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,          -- new_matches | saved_search | job_expired | system | account
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE admin_activity (
  id           INTEGER PRIMARY KEY,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL DEFAULT '',
  target_id    TEXT NOT NULL DEFAULT '',
  details      TEXT NOT NULL DEFAULT '{}',
  ip           TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_admin_activity_created ON admin_activity(created_at);

-- User activity (logins, uploads, status changes) for the admin "activity" view.
-- Stores the kind of action only, never resume contents.
CREATE TABLE user_activity (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  details     TEXT NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_activity_user ON user_activity(user_id, created_at);

CREATE TABLE fetch_runs (
  id              INTEGER PRIMARY KEY,
  trigger         TEXT NOT NULL,      -- schedule | manual | startup | cli
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
  sources_total   INTEGER NOT NULL DEFAULT 0,
  sources_failed  INTEGER NOT NULL DEFAULT 0,
  jobs_seen       INTEGER NOT NULL DEFAULT 0,
  jobs_new        INTEGER NOT NULL DEFAULT 0,
  jobs_updated    INTEGER NOT NULL DEFAULT 0,
  jobs_expired    INTEGER NOT NULL DEFAULT 0,
  jobs_duplicate  INTEGER NOT NULL DEFAULT 0,
  jobs_excluded   INTEGER NOT NULL DEFAULT 0,
  links_checked   INTEGER NOT NULL DEFAULT 0,
  links_broken    INTEGER NOT NULL DEFAULT 0,
  summary         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE fetch_logs (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER REFERENCES fetch_runs(id) ON DELETE CASCADE,
  source_id   INTEGER REFERENCES job_sources(id) ON DELETE SET NULL,
  level       TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  message     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fetch_logs_run ON fetch_logs(run_id);
CREATE INDEX idx_fetch_logs_level ON fetch_logs(level, created_at);

CREATE TABLE sheets_sync_logs (
  id           INTEGER PRIMARY KEY,
  run_id       INTEGER REFERENCES fetch_runs(id) ON DELETE SET NULL,
  tab_name     TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL CHECK (status IN ('success','skipped','failed')),
  rows_written INTEGER NOT NULL DEFAULT 0,
  message      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE system_errors (
  id          INTEGER PRIMARY KEY,
  context     TEXT NOT NULL,
  message     TEXT NOT NULL,
  stack       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

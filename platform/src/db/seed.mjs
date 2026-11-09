// Base data: roles and the default job sources. Idempotent — safe on every start.
//
// Default sources are real, public, no-auth endpoints read by career-ops'
// provider modules: company ATS boards (direct employer links) and remote-job
// aggregators. Admins can disable, edit or add sources in the admin UI.

export const DEFAULT_SOURCES = [
  // Company career boards (direct application links)
  ['Databricks', 'https://job-boards.greenhouse.io/databricks'],
  ['Snowflake', 'https://jobs.ashbyhq.com/snowflake'],
  ['Fivetran', 'https://job-boards.greenhouse.io/fivetran'],
  ['Starburst', 'https://job-boards.greenhouse.io/starburst'],
  ['Sigma Computing', 'https://job-boards.greenhouse.io/sigmacomputing'],
  ['ClickHouse', 'https://jobs.ashbyhq.com/clickhouse'],
  ['Airbyte', 'https://jobs.ashbyhq.com/airbyte'],
  ['Astronomer', 'https://jobs.ashbyhq.com/astronomer'],
  ['MotherDuck', 'https://jobs.ashbyhq.com/motherduck'],
  ['MongoDB', 'https://job-boards.greenhouse.io/mongodb'],
  ['Elastic', 'https://job-boards.greenhouse.io/elastic'],
  ['Datadog', 'https://job-boards.greenhouse.io/datadog'],
  ['Cloudflare', 'https://job-boards.greenhouse.io/cloudflare'],
  ['GitLab', 'https://job-boards.greenhouse.io/gitlab'],
  ['Okta', 'https://job-boards.greenhouse.io/okta'],
  ['Twilio', 'https://job-boards.greenhouse.io/twilio'],
  ['Stripe', 'https://job-boards.greenhouse.io/stripe'],
  ['Coinbase', 'https://job-boards.greenhouse.io/coinbase'],
  ['Airbnb', 'https://job-boards.greenhouse.io/airbnb'],
  ['Supabase', 'https://jobs.ashbyhq.com/supabase'],
  ['Notion', 'https://jobs.ashbyhq.com/notion'],
  ['Ramp', 'https://jobs.ashbyhq.com/ramp'],
  ['Linear', 'https://jobs.ashbyhq.com/linear'],
  ['Palantir', 'https://jobs.lever.co/palantir'],
  ['Spotify', 'https://jobs.lever.co/spotify'],
  // India-based employers
  ['Razorpay', 'https://job-boards.greenhouse.io/razorpaysoftwareprivatelimited'],
  ['Groww', 'https://job-boards.greenhouse.io/groww'],
  ['Meesho', 'https://jobs.lever.co/meesho'],
  ['Paytm', 'https://jobs.lever.co/paytm'],
  ['CRED', 'https://jobs.lever.co/cred'],
  ['Zeta', 'https://jobs.lever.co/zeta'],
];

export const DEFAULT_AGGREGATORS = [
  // [name, provider id, config]
  ['Remotive', 'remotive', { remote_only: true }],
  ['Himalayas', 'himalayas', { remote_only: true }],
  ['Jobicy', 'jobicy', { remote_only: true }],
  ['RemoteOK', 'remoteok', { remote_only: true }],
  ['Arbeitnow', 'arbeitnow', {}],
];

export function ensureBaseData(db) {
  db.prepare("INSERT OR IGNORE INTO roles (id, name, description) VALUES (1, 'user', 'Job seeker: manages only their own data')").run();
  db.prepare("INSERT OR IGNORE INTO roles (id, name, description) VALUES (2, 'admin', 'Administrator: manages users, sources and the job pipeline')").run();
  const seeded = db.prepare("SELECT value FROM settings WHERE key = 'sources_seeded'").get();
  if (!seeded) {
    const ins = db.prepare('INSERT OR IGNORE INTO job_sources (name, provider, careers_url, kind, is_direct, config) VALUES (?, ?, ?, ?, ?, ?)');
    for (const [name, url] of DEFAULT_SOURCES) ins.run(name, null, url, 'company', 1, '{}');
    for (const [name, provider, cfg] of DEFAULT_AGGREGATORS) ins.run(name, provider, null, 'aggregator', 0, JSON.stringify(cfg));
    db.prepare("INSERT INTO settings (key, value) VALUES ('sources_seeded', 'true')").run();
  }
}

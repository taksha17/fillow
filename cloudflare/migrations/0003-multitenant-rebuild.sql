-- 0003: rebuild the data tables to the multi-tenant (user_id-scoped) shape.
-- D1 rows are derived data — local files stay canonical and `fillow cf:sync`
-- rebuilds them — so drop+recreate is the safe path for deployments that
-- still carry the pre-multi-tenant tables (CREATE TABLE IF NOT EXISTS in
-- schema.sql cannot alter an existing table).
-- Run remotely with:
--   npx wrangler d1 execute fillow --remote --file=cloudflare/migrations/0003-multitenant-rebuild.sql --config cloudflare/wrangler.toml -y

DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS job_postings;
DROP TABLE IF EXISTS dashboard_metrics;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS user_profiles;

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  score TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  pdf TEXT NOT NULL DEFAULT '',
  report TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  resume_md TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX applications_url_user ON applications(user_id, url) WHERE url != '';
CREATE INDEX applications_status ON applications(status);
CREATE INDEX applications_date ON applications(date);
CREATE INDEX applications_user ON applications(user_id);

CREATE TABLE job_postings (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  ats TEXT NOT NULL DEFAULT '',
  match_score TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'discovered',
  PRIMARY KEY (user_id, source, external_id)
);

CREATE TABLE dashboard_metrics (
  captured_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  conversion_rate REAL NOT NULL DEFAULT 0,
  by_status TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, captured_at)
);

CREATE TABLE user_profiles (
  user_id TEXT PRIMARY KEY,
  profile_yaml TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE settings (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);

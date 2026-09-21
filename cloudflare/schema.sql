-- fillow D1 schema (Cloudflare Workers Free / D1 Free)
-- Local files remain canonical. D1 is an additive hosted index.

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY,
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
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_url ON applications(url) WHERE url != '';
CREATE INDEX IF NOT EXISTS applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS applications_date ON applications(date);

CREATE TABLE IF NOT EXISTS job_postings (
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  apply_url TEXT NOT NULL DEFAULT '',
  ats TEXT NOT NULL DEFAULT '',
  match_score TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'discovered',
  PRIMARY KEY (source, external_id)
);

CREATE TABLE IF NOT EXISTS dashboard_metrics (
  captured_at TEXT PRIMARY KEY,
  total INTEGER NOT NULL DEFAULT 0,
  conversion_rate REAL NOT NULL DEFAULT 0,
  by_status TEXT NOT NULL DEFAULT '{}'
);

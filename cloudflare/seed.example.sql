-- Example D1 seed — generic placeholder rows.
-- Copy/rename to cloudflare/.sync.sql (gitignored) and edit with your own data,
-- or let `node scripts/sync-cloudflare.mjs` generate it from data/applications.md.
-- Schema: cloudflare/schema.sql — every row needs a user_id (multi-tenant).
-- Apply with: npx wrangler d1 execute fillow --file=cloudflare/.sync.sql --remote

INSERT INTO applications (user_id, date, company, role, score, status, pdf, report, notes, url, resume_md, updated_at)
VALUES
  ('local', '2026-09-20', 'Example Corp', 'Software Engineer', '82', 'applied', '✅', 'reports/001-example-corp-2026-09-20.md', 'example row — replace with your own applications', 'https://example.com/jobs/1001', '', '2026-09-20'),
  ('local', '2026-09-21', 'Sample Inc', 'Machine Learning Engineer', '88', 'dry_run', '✅', 'reports/002-sample-inc-2026-09-21.md', 'example row — DRY_RUN=true; nothing submitted', 'https://example.com/jobs/1002', '', '2026-09-21');

INSERT INTO job_postings (source, external_id, user_id, title, company, location, url, apply_url, ats, match_score, status)
VALUES
  ('greenhouse', 'example-corp:1001', 'local', 'Software Engineer, Platform', 'Example Corp', 'US-Remote', 'https://example.com/jobs/1001', 'https://example.com/jobs/1001', 'greenhouse', '82', 'applied'),
  ('ashby', 'sample-inc:2002', 'local', 'Machine Learning Engineer', 'Sample Inc', 'US-CA-San Francisco', 'https://jobs.ashbyhq.com/sample-inc/2002', 'https://jobs.ashbyhq.com/sample-inc/2002/application', 'ashby', '88', 'ready');

INSERT INTO dashboard_metrics (captured_at, user_id, total, conversion_rate, by_status)
VALUES
  ('2026-09-21T09:00:00Z', 'local', 2, 0.0, '{"applied":1,"dry_run":1}');

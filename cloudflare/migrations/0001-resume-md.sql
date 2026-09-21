-- migration: per-application tailored resume markdown in D1
-- run once per database:
--   npx wrangler d1 execute fillow --remote --file cloudflare/migrations/0001-resume-md.sql
--   npx wrangler d1 execute fillow --config cloudflare/wrangler.toml --local --file cloudflare/migrations/0001-resume-md.sql
-- a "duplicate column name" error means it is already applied
ALTER TABLE applications ADD COLUMN resume_md TEXT NOT NULL DEFAULT '';

-- Discover settings + last-run summary for the Agent 1 UI ("Discover now").
-- Multi-tenant shape (user_id scoping) matches cloudflare/schema.sql.
-- Applied via: npm run cf:schema:local (local) or cf:setup (remote).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);

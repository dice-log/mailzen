CREATE TABLE IF NOT EXISTS mail_accounts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  provider    TEXT NOT NULL,
  credentials TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

ALTER TABLE mail_results ADD COLUMN account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_results_account_id ON mail_results (account_id);

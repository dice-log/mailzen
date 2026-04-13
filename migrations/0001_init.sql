CREATE TABLE IF NOT EXISTS mail_results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT    NOT NULL UNIQUE,
  thread_id   TEXT    NOT NULL,
  sender      TEXT,
  subject     TEXT,
  category    TEXT    NOT NULL,
  summary     TEXT    NOT NULL,
  suspicious  INTEGER NOT NULL DEFAULT 0,
  processed_at TEXT   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_results_processed_at ON mail_results (processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_results_category ON mail_results (category);

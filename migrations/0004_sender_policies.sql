CREATE TABLE IF NOT EXISTS sender_policies (
  sender_id  TEXT PRIMARY KEY,
  action     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sender_policies_action
  ON sender_policies (action);

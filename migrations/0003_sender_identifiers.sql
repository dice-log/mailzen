ALTER TABLE mail_results ADD COLUMN sender_id TEXT;
ALTER TABLE mail_results ADD COLUMN sender_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_mail_results_sender_id ON mail_results (sender_id);
CREATE INDEX IF NOT EXISTS idx_mail_results_sender_domain ON mail_results (sender_domain);

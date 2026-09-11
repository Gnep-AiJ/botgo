CREATE TABLE IF NOT EXISTS email_login_codes (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS email_login_codes_email_idx ON email_login_codes(email);

ALTER TABLE invite_codes ADD COLUMN label TEXT NOT NULL DEFAULT '';

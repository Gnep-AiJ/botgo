CREATE TABLE IF NOT EXISTS desktop_authorizations (
  id TEXT PRIMARY KEY,
  verifier_hash TEXT NOT NULL,
  device_label TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  account_id TEXT REFERENCES accounts(id),
  authorization_code_hash TEXT,
  issued_device_token_hash TEXT,
  approved_at TEXT,
  consumed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS desktop_authorizations_expiry_idx ON desktop_authorizations(expires_at, consumed_at, cancelled_at);

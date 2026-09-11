ALTER TABLE device_tokens ADD COLUMN last_used_at TEXT;

ALTER TABLE api_keys ADD COLUMN device_token_hash TEXT REFERENCES device_tokens(token_hash);

CREATE INDEX IF NOT EXISTS device_tokens_account_active_idx ON device_tokens(account_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS api_keys_desktop_device_idx ON api_keys(device_token_hash, revoked_at);

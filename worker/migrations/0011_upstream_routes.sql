CREATE TABLE IF NOT EXISTS upstream_routes (
  channel TEXT PRIMARY KEY CHECK (channel IN ('web_chat', 'desktop_codex')),
  profile_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profile_id) REFERENCES upstream_profiles(id),
  FOREIGN KEY (updated_by) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS upstream_route_probes (
  profile_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('web_chat', 'desktop_codex')),
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  http_status INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (profile_id, channel, model_id),
  FOREIGN KEY (profile_id) REFERENCES upstream_profiles(id)
);

CREATE TABLE IF NOT EXISTS upstream_route_history (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('web_chat', 'desktop_codex')),
  from_profile_id TEXT,
  from_model_id TEXT,
  to_profile_id TEXT NOT NULL,
  to_model_id TEXT NOT NULL,
  actor_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_profile_id) REFERENCES upstream_profiles(id),
  FOREIGN KEY (to_profile_id) REFERENCES upstream_profiles(id),
  FOREIGN KEY (actor_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS upstream_route_history_channel_idx
ON upstream_route_history(channel, created_at DESC);

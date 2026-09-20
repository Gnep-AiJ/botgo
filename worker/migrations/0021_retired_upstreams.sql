-- Retired profiles remain for route history and request/lease audit records.
ALTER TABLE upstream_profiles ADD COLUMN retired_at TEXT;

CREATE TABLE model_service_drafts (
  model_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  tested_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

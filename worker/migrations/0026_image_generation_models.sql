-- Image generation models are separate from Agent text models and use the
-- official image-token price selected when the upstream binding is created.
CREATE TABLE image_model_routes (
  model_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES upstream_profiles(id),
  upstream_model_id TEXT NOT NULL,
  billing_model_id TEXT NOT NULL,
  price_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  verified_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX image_model_routes_profile ON image_model_routes(profile_id,enabled);

-- Only an exact official model page can populate this cache. Published request
-- snapshots retain their price even when a later official refresh changes it.
CREATE TABLE official_model_cache (
  model_id TEXT PRIMARY KEY,
  model_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER image_route_profile_changed AFTER UPDATE OF base_url,api_key_ciphertext ON upstream_profiles
WHEN OLD.base_url<>NEW.base_url OR OLD.api_key_ciphertext<>NEW.api_key_ciphertext BEGIN
  UPDATE image_model_routes SET enabled=0,verified_at=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE profile_id=NEW.id;
END;

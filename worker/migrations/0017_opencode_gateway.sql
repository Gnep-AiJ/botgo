-- Additive OpenCode routing; existing balances, routes and migration history remain intact.
CREATE TABLE agent_model_routes (
 model_id TEXT PRIMARY KEY REFERENCES model_catalog(id),
 profile_id TEXT NOT NULL REFERENCES upstream_profiles(id),
 protocol TEXT NOT NULL CHECK(protocol IN ('chat','responses')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 verified_at TEXT,
 revision INTEGER NOT NULL DEFAULT 1,
 cost_price_json TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE agent_route_health (
 model_id TEXT NOT NULL,
 profile_id TEXT NOT NULL,
 protocol TEXT NOT NULL,
 reason TEXT NOT NULL,
 blocked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(model_id,profile_id,protocol)
);
ALTER TABLE metered_requests ADD COLUMN upstream_cost_estimate_micros INTEGER;
CREATE TRIGGER agent_profile_changed AFTER UPDATE OF base_url,api_key_ciphertext ON upstream_profiles
WHEN OLD.base_url<>NEW.base_url OR OLD.api_key_ciphertext<>NEW.api_key_ciphertext BEGIN
 UPDATE agent_model_routes SET enabled=0,verified_at=NULL,revision=revision+1 WHERE profile_id=NEW.id;
END;
CREATE TRIGGER agent_model_mapping_changed AFTER UPDATE OF upstream_id ON model_catalog
WHEN OLD.upstream_id<>NEW.upstream_id BEGIN
 UPDATE agent_model_routes SET enabled=0,verified_at=NULL,revision=revision+1 WHERE model_id=NEW.id;
END;
CREATE TRIGGER agent_request_limits BEFORE INSERT ON metered_requests
WHEN NEW.channel='desktop_opencode' BEGIN
 SELECT RAISE(ABORT,'AGENT_CONCURRENCY_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id AND state='reserved') >= 8;
 SELECT RAISE(ABORT,'AGENT_REVIEW_LIMIT') WHERE
  (SELECT COUNT(*) FROM metered_requests WHERE account_id=NEW.account_id AND state='review' AND reviewed_at IS NULL) >= 3;
END;

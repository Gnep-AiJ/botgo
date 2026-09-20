-- Capacity-aware upstream pools. Existing single-route tables remain as
-- compatibility and audit records; their current rows seed the new pools.
ALTER TABLE upstream_profiles ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 5
  CHECK(max_concurrency BETWEEN 1 AND 1000);

CREATE TABLE upstream_route_members (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('web_chat','desktop_codex')),
  model_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES upstream_profiles(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel,model_id,profile_id)
);
CREATE INDEX upstream_route_members_lookup
  ON upstream_route_members(channel,model_id,enabled,priority);

INSERT OR IGNORE INTO upstream_route_members(id,channel,model_id,profile_id)
SELECT channel || ':' || model_id || ':' || profile_id, channel, model_id, profile_id
FROM upstream_routes;
INSERT OR IGNORE INTO upstream_route_members(id,channel,model_id,profile_id)
SELECT r.channel || ':' || p.model_id || ':' || r.profile_id,r.channel,p.model_id,r.profile_id
FROM upstream_routes r JOIN upstream_route_probes p ON p.profile_id=r.profile_id AND p.channel=r.channel
WHERE p.status='ok' AND p.metering_verified=1;

-- A model route keeps protocol/cost settings in agent_model_routes while each
-- independently keyed upstream is represented by one member row.
CREATE TABLE agent_route_members (
  model_id TEXT NOT NULL REFERENCES model_catalog(id),
  profile_id TEXT NOT NULL REFERENCES upstream_profiles(id),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  verified_at TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(model_id,profile_id)
);
INSERT OR IGNORE INTO agent_route_members(model_id,profile_id,enabled,verified_at)
SELECT model_id,profile_id,1,verified_at FROM agent_model_routes;

CREATE TABLE upstream_route_pool_history (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('web_chat','desktop_codex')),
  model_id TEXT NOT NULL,
  members_json TEXT NOT NULL,
  actor_id TEXT REFERENCES accounts(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX upstream_route_pool_history_lookup
  ON upstream_route_pool_history(channel,model_id,created_at DESC);

CREATE TABLE upstream_leases (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES metered_requests(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  profile_id TEXT NOT NULL REFERENCES upstream_profiles(id),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','released')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  released_at TEXT
);
CREATE INDEX upstream_leases_profile_active
  ON upstream_leases(profile_id,state,expires_at);
CREATE INDEX upstream_leases_account_active
  ON upstream_leases(account_id,state,expires_at);
CREATE INDEX upstream_leases_request_active
  ON upstream_leases(request_id,state);

CREATE TRIGGER upstream_lease_limits BEFORE INSERT ON upstream_leases
WHEN NEW.state='active' BEGIN
  SELECT RAISE(ABORT,'ACCOUNT_CONCURRENCY_LIMIT') WHERE
    (SELECT COUNT(*) FROM upstream_leases
     WHERE account_id=NEW.account_id AND state='active' AND expires_at>CURRENT_TIMESTAMP) >= 2;
  SELECT RAISE(ABORT,'UPSTREAM_CAPACITY_LIMIT') WHERE
    (SELECT COUNT(*) FROM upstream_leases
     WHERE profile_id=NEW.profile_id AND state='active' AND expires_at>CURRENT_TIMESTAMP) >=
    (SELECT max_concurrency FROM upstream_profiles WHERE id=NEW.profile_id);
END;

CREATE TRIGGER upstream_lease_release_on_settle AFTER UPDATE OF state ON metered_requests
WHEN OLD.state='reserved' AND NEW.state<>'reserved' BEGIN
  UPDATE upstream_leases SET state='released',released_at=CURRENT_TIMESTAMP
  WHERE request_id=NEW.id AND state='active';
END;

DROP TRIGGER agent_profile_changed;
CREATE TRIGGER upstream_pool_profile_changed AFTER UPDATE OF base_url,api_key_ciphertext ON upstream_profiles
WHEN OLD.base_url<>NEW.base_url OR OLD.api_key_ciphertext<>NEW.api_key_ciphertext BEGIN
  UPDATE agent_route_members SET verified_at=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE profile_id=NEW.id;
  UPDATE agent_model_routes SET verified_at=NULL WHERE profile_id=NEW.id;
  UPDATE agent_model_routes SET verified_at=(SELECT MAX(verified_at) FROM agent_route_members WHERE model_id=agent_model_routes.model_id)
  WHERE model_id IN (SELECT model_id FROM agent_route_members WHERE profile_id=NEW.id)
    AND EXISTS(SELECT 1 FROM agent_route_members WHERE model_id=agent_model_routes.model_id AND verified_at IS NOT NULL);
END;

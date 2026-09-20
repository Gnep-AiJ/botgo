ALTER TABLE upstream_route_members ADD COLUMN upstream_model_id TEXT;
ALTER TABLE upstream_route_members ADD COLUMN protocol TEXT NOT NULL DEFAULT 'chat' CHECK(protocol IN ('chat','responses'));
ALTER TABLE agent_route_members ADD COLUMN upstream_model_id TEXT;
ALTER TABLE upstream_route_probes ADD COLUMN protocol TEXT NOT NULL DEFAULT 'chat' CHECK(protocol IN ('chat','responses'));
UPDATE upstream_route_probes SET protocol='responses' WHERE channel='desktop_codex';

-- Isolated operational advice; does not change customer billing or routes.
CREATE TABLE admin_ai_diagnostics (
 id TEXT PRIMARY KEY,
 snapshot_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','failed')),
 result_json TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finished_at TEXT
);
CREATE INDEX admin_ai_diagnostics_time ON admin_ai_diagnostics(created_at);
CREATE INDEX admin_ai_diagnostics_snapshot ON admin_ai_diagnostics(snapshot_hash,created_at);

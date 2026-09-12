-- Preserve integer-fen payment interfaces; retain sub-fen consumption exactly.
ALTER TABLE accounts ADD COLUMN credit_remainder_micros INTEGER NOT NULL DEFAULT 0 CHECK(credit_remainder_micros BETWEEN 0 AND 9999);
ALTER TABLE accounts ADD COLUMN billing_reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(billing_reserved_micros >= 0);
ALTER TABLE accounts ADD COLUMN billing_blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upstream_route_probes ADD COLUMN metering_verified INTEGER NOT NULL DEFAULT 0;
CREATE TABLE model_catalog (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, upstream_id TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0, web_enabled INTEGER NOT NULL DEFAULT 0,
 agent_enabled INTEGER NOT NULL DEFAULT 0, multiplier_ppm INTEGER,
 price_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE metering_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), multiplier_ppm INTEGER NOT NULL,
 usd_cny_ppm INTEGER NOT NULL, default_model TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
INSERT INTO metering_settings VALUES(1,300000,7000000,'gpt-5.6-sol',1);
CREATE TABLE metered_requests (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 channel TEXT NOT NULL, model TEXT NOT NULL, snapshot TEXT NOT NULL,
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),
 cost_micros INTEGER NOT NULL DEFAULT 0 CHECK(cost_micros>=0),
 charged_micros INTEGER NOT NULL DEFAULT 0, usage_json TEXT,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','completed','refunded','review')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, settled_at TEXT,
 reviewed_at TEXT, review_note TEXT
);
CREATE INDEX metered_account_time ON metered_requests(account_id,created_at);
CREATE TRIGGER metering_reserve BEFORE INSERT ON metered_requests BEGIN
 SELECT CASE WHEN NEW.state <> 'reserved' OR NOT EXISTS(
  SELECT 1 FROM accounts WHERE id=NEW.account_id AND status='active' AND billing_blocked=0
  AND credit_balance*10000+credit_remainder_micros-billing_reserved_micros>=NEW.reserved_micros
 ) THEN RAISE(ABORT,'BILLING_INSUFFICIENT') END;
 UPDATE accounts SET billing_reserved_micros=billing_reserved_micros+NEW.reserved_micros WHERE id=NEW.account_id;
END;
CREATE TRIGGER metering_settle AFTER UPDATE OF state ON metered_requests
WHEN OLD.state='reserved' AND NEW.state<>'reserved' BEGIN
 UPDATE metered_requests SET charged_micros=MIN(NEW.cost_micros,MAX(0,(SELECT credit_balance*10000+credit_remainder_micros-billing_reserved_micros+OLD.reserved_micros FROM accounts WHERE id=NEW.account_id))) WHERE id=NEW.id;
 UPDATE accounts SET
  billing_blocked=CASE WHEN NEW.cost_micros>(SELECT charged_micros FROM metered_requests WHERE id=NEW.id) THEN 1 ELSE billing_blocked END,
  credit_remainder_micros=(credit_balance*10000+credit_remainder_micros-(SELECT charged_micros FROM metered_requests WHERE id=NEW.id))%10000,
  credit_balance=(credit_balance*10000+credit_remainder_micros-(SELECT charged_micros FROM metered_requests WHERE id=NEW.id))/10000,
  billing_reserved_micros=billing_reserved_micros-OLD.reserved_micros
 WHERE id=NEW.account_id;
 UPDATE metered_requests SET state=CASE WHEN NEW.cost_micros>charged_micros THEN 'review' ELSE NEW.state END, settled_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
END;

CREATE INDEX web_chat_turns_expiry ON web_chat_turns(created_at);
CREATE TABLE account_grants (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 actor_id TEXT NOT NULL REFERENCES accounts(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0 AND amount_cents<=100000000),
 reason TEXT NOT NULL, balance_before INTEGER NOT NULL DEFAULT 0, balance_after INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER account_grant_apply AFTER INSERT ON account_grants BEGIN
 UPDATE account_grants SET balance_before=(SELECT credit_balance FROM accounts WHERE id=NEW.account_id) WHERE id=NEW.id;
 UPDATE accounts SET credit_balance=credit_balance+NEW.amount_cents WHERE id=NEW.account_id;
 UPDATE account_grants SET balance_after=(SELECT credit_balance FROM accounts WHERE id=NEW.account_id) WHERE id=NEW.id;
END;
ALTER TABLE model_catalog ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;

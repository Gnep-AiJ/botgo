CREATE TABLE opcpay_recharges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  action_id TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  price_version INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  points INTEGER NOT NULL CHECK (points > 0 AND amount_cents = points * 100),
  callback_url TEXT NOT NULL,
  purchase_url TEXT,
  purchase_expires_at TEXT,
  payment_status TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (payment_status IN ('UNKNOWN', 'PENDING', 'PAID', 'REFUNDED')),
  trade_no TEXT UNIQUE,
  checked_at TEXT,
  queried_at_ms INTEGER NOT NULL DEFAULT 0,
  consumption_reason TEXT NOT NULL,
  consume_started_at TEXT,
  consume_order_id TEXT UNIQUE,
  credited_at TEXT CHECK (credited_at IS NULL OR (consume_started_at IS NOT NULL AND trade_no IS NOT NULL)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, action_id)
);

CREATE INDEX opcpay_recharges_by_account ON opcpay_recharges (account_id, created_at DESC, id);

-- Store the receipt and apply the credit in the same database statement.
CREATE TRIGGER opcpay_recharge_credit
AFTER UPDATE OF credited_at ON opcpay_recharges
WHEN OLD.credited_at IS NULL AND NEW.credited_at IS NOT NULL
BEGIN
  UPDATE accounts SET credit_balance = credit_balance + NEW.amount_cents WHERE id = NEW.account_id;
END;

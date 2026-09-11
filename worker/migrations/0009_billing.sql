CREATE TABLE IF NOT EXISTS billing_settings (
  id TEXT PRIMARY KEY CHECK (id = 'pro'),
  name TEXT NOT NULL DEFAULT 'Pro',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 1),
  included_credits INTEGER NOT NULL CHECK (included_credits >= 1),
  period_days INTEGER NOT NULL DEFAULT 30 CHECK (period_days = 30),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO billing_settings (id, name, price_cents, included_credits, period_days)
VALUES ('pro', 'Pro', 9900, 1000, 30);

CREATE TABLE IF NOT EXISTS billing_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT 'pro',
  amount_cents INTEGER NOT NULL,
  included_credits INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'closed', 'failed')),
  provider TEXT NOT NULL DEFAULT 'alipay',
  provider_trade_no TEXT UNIQUE,
  idempotency_key TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_order_idempotency
ON billing_orders(account_id, idempotency_key);

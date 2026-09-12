ALTER TABLE billing_orders ADD COLUMN out_trade_no TEXT;
ALTER TABLE billing_orders ADD COLUMN subject TEXT;
ALTER TABLE billing_orders ADD COLUMN trade_status TEXT;
ALTER TABLE billing_orders ADD COLUMN notify_id TEXT;
ALTER TABLE billing_orders ADD COLUMN refunded_amount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE billing_orders ADD COLUMN closed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS billing_orders_out_trade_no
ON billing_orders(out_trade_no);

CREATE TABLE IF NOT EXISTS alipay_notify_events (
  id TEXT PRIMARY KEY,
  notify_id TEXT NOT NULL UNIQUE,
  out_trade_no TEXT NOT NULL,
  trade_no TEXT,
  trade_status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES billing_orders(id),
  out_request_no TEXT NOT NULL UNIQUE,
  refund_amount_cents INTEGER NOT NULL CHECK (refund_amount_cents >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS billing_refunds_order_idx
ON billing_refunds(order_id, created_at);

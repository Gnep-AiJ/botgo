CREATE TABLE shop_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  action_id TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  state TEXT NOT NULL DEFAULT 'paid' CHECK (state IN ('paid', 'purchasing', 'delivered', 'refunded')),
  handled_by TEXT REFERENCES accounts(id),
  supplier_order TEXT UNIQUE,
  card_fingerprint TEXT UNIQUE,
  card_ciphertext TEXT,
  card_iv TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (account_id, action_id),
  CHECK (state NOT IN ('purchasing', 'delivered', 'refunded') OR handled_by IS NOT NULL),
  CHECK (state <> 'delivered' OR (supplier_order IS NOT NULL AND card_fingerprint IS NOT NULL
    AND card_ciphertext IS NOT NULL AND card_iv IS NOT NULL))
);

CREATE INDEX shop_orders_by_account ON shop_orders (account_id, created_at DESC);
CREATE INDEX shop_orders_by_state ON shop_orders (state, created_at);

CREATE TRIGGER shop_order_charge
AFTER INSERT ON shop_orders
BEGIN
  UPDATE accounts SET credit_balance = credit_balance - NEW.amount_cents WHERE id = NEW.account_id;
END;

CREATE TRIGGER shop_order_refund
AFTER UPDATE OF state ON shop_orders
WHEN OLD.state IN ('paid', 'purchasing') AND NEW.state = 'refunded'
BEGIN
  UPDATE accounts SET credit_balance = credit_balance + NEW.amount_cents WHERE id = NEW.account_id;
END;

CREATE TABLE shop_card_checks (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  window_minute INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts BETWEEN 1 AND 8)
);

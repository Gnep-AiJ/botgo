-- Monetary balances are stored as integer fen/cents from this migration on.
-- Existing quota values represented whole yuan units, so multiplying by 100
-- preserves the visible balance and the one-unit-per-request accounting.
UPDATE accounts SET credit_balance = credit_balance * 100;
UPDATE invite_codes SET credits = credits * 100;
UPDATE billing_orders SET included_credits = included_credits * 100;

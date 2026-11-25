CREATE TABLE shop_alert_throttle (
  kind TEXT PRIMARY KEY,
  retry_after_ms INTEGER NOT NULL
);

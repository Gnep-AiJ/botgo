ALTER TABLE metering_settings ADD COLUMN fx_auto INTEGER NOT NULL DEFAULT 1;
ALTER TABLE metering_settings ADD COLUMN fx_updated_at TEXT;
ALTER TABLE metering_settings ADD COLUMN fx_source TEXT;

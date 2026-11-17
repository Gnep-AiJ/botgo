-- Keep user-renamed titles separate from automatic first-message titles.
-- Existing conversations keep their current title behavior and retention.
ALTER TABLE web_conversations ADD COLUMN renamed_at TEXT;

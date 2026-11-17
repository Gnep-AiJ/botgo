-- Add fields without changing existing accounts, balances or conversations.
ALTER TABLE web_conversations ADD COLUMN topic TEXT NOT NULL DEFAULT 'general'
 CHECK(topic IN ('general','doctor','tarot'));
ALTER TABLE web_conversations ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX web_conversations_topic ON web_conversations(account_id,topic,updated_at);

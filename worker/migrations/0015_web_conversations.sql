CREATE TABLE web_conversations (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
 title TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_conversations_account_time ON web_conversations(account_id,updated_at);
CREATE TABLE web_chat_turns (
 request_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES web_conversations(id) ON DELETE CASCADE,
 content TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '', model TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','completed','stopped','failed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_chat_turns_conversation ON web_chat_turns(conversation_id,created_at);
CREATE TRIGGER web_chat_single_generation BEFORE INSERT ON web_chat_turns BEGIN
 SELECT RAISE(ABORT,'CONVERSATION_BUSY') WHERE EXISTS(
  SELECT 1 FROM web_chat_turns WHERE conversation_id=NEW.conversation_id AND state='running'
 );
END;
UPDATE metering_settings SET default_model='gpt-5.6-sol' WHERE default_model='gpt-5.4';
DELETE FROM model_catalog WHERE id='gpt-5.4';

-- Durable cancellation across the Pages service binding and Worker isolates.
CREATE TABLE web_chat_cancellations (
 request_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES web_conversations(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_chat_cancel_expiry ON web_chat_cancellations(created_at);

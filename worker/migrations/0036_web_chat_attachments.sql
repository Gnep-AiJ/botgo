CREATE TABLE web_chat_attachments (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL UNIQUE REFERENCES web_chat_turns(request_id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE,
 iv TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=3145728),
 manifest_json TEXT NOT NULL
);
CREATE TRIGGER web_chat_attachments_deleted AFTER DELETE ON web_chat_attachments BEGIN
 INSERT OR IGNORE INTO web_chat_image_gc(storage_key) VALUES(OLD.storage_key);
END;

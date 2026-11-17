ALTER TABLE web_chat_turns ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat','image'));
ALTER TABLE web_chat_turns ADD COLUMN params_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE web_chat_turns ADD COLUMN error_code TEXT;
CREATE TABLE web_chat_images (
 id TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES web_chat_turns(request_id) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 storage_key TEXT NOT NULL UNIQUE,
 iv TEXT NOT NULL,
 bytes INTEGER NOT NULL CHECK(bytes>0 AND bytes<=12582912),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX web_chat_images_turn ON web_chat_images(request_id);
CREATE TABLE web_chat_image_gc (
 storage_key TEXT PRIMARY KEY,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER web_chat_image_deleted AFTER DELETE ON web_chat_images BEGIN
 INSERT OR IGNORE INTO web_chat_image_gc(storage_key) VALUES(OLD.storage_key);
END;

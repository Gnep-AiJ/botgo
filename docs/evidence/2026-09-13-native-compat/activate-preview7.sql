-- Release metadata only. No schema migration or account changes.
-- Run only after immutable R2 upload and full SHA-256 readback pass.
INSERT INTO desktop_releases (id,version,object_key,file_name,size_bytes,sha256,notes)
SELECT 'd39917d9-88ee-43a0-9078-56402ca4b90a','1.2.1-preview.7',
 'desktop/1.2.1-preview.7/BotGo-Setup-1.2.1-preview.7.exe',
 'BotGo Desktop Setup 1.2.1-preview.7.exe',182253752,
 '2c8453e6f25f8bfd8dc1a94759b8542a2d7eba7fb444a57454eab62028ae5075',
 'Self-signed preview; signer from local CODE_SIGN_THUMBPRINT. Production fault-matrix and cross-device install, upgrade, uninstall and history acceptance deferred to user testing. Source 2d16e7b0afb7f157464efd6da00af10bdec27468.'
WHERE EXISTS (SELECT 1 FROM desktop_releases WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND version='1.2.1-preview.3' AND status='published')
 AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE id='d39917d9-88ee-43a0-9078-56402ca4b90a' OR version='1.2.1-preview.7');
UPDATE desktop_releases SET status='retired',updated_at=CURRENT_TIMESTAMP
WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND status='published'
 AND EXISTS (SELECT 1 FROM desktop_releases WHERE id='d39917d9-88ee-43a0-9078-56402ca4b90a' AND status IN ('draft','retired') AND sha256='2c8453e6f25f8bfd8dc1a94759b8542a2d7eba7fb444a57454eab62028ae5075' AND size_bytes=182253752 AND object_key='desktop/1.2.1-preview.7/BotGo-Setup-1.2.1-preview.7.exe');
UPDATE desktop_releases SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE id='d39917d9-88ee-43a0-9078-56402ca4b90a' AND status IN ('draft','retired')
 AND sha256='2c8453e6f25f8bfd8dc1a94759b8542a2d7eba7fb444a57454eab62028ae5075' AND size_bytes=182253752 AND object_key='desktop/1.2.1-preview.7/BotGo-Setup-1.2.1-preview.7.exe'
 AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE platform='win-x64' AND status='published');
SELECT id,version,status,sha256,size_bytes,object_key FROM desktop_releases ORDER BY created_at DESC;

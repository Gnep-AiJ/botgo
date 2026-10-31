-- Release metadata only. No schema migration or account changes.
-- Run only after the installer upload and full SHA-256 readback pass.
INSERT INTO desktop_releases (id,version,object_key,file_name,size_bytes,sha256,notes)
SELECT 'cfb5988a-f4da-455e-a89c-7fdf377e9ad3','1.2.1-preview.3',
 'desktop/1.2.1-preview.3/BotGo-Setup-1.2.1-preview.3.exe',
 'BotGo Desktop Setup 1.2.1-preview.3.exe',182232224,
 '8119bcfc9181808c5d8696dbfe9a7ecf763e74e313fd79552c21d7fbb374317e',
 'Self-signed preview; signer from local CODE_SIGN_THUMBPRINT. Cross-device install, upgrade, uninstall and history acceptance pending. User authorized preview before acceptance. Source 60d48f9d2c10d68aa8d090413538eef69510dda3.'
WHERE EXISTS (SELECT 1 FROM desktop_releases WHERE id='4c197d77-6130-4c87-9153-8ca6d9ec4ecc' AND status='published')
 AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' OR version='1.2.1-preview.3');
UPDATE desktop_releases SET status='retired',updated_at=CURRENT_TIMESTAMP
WHERE id='4c197d77-6130-4c87-9153-8ca6d9ec4ecc' AND status='published'
 AND EXISTS (SELECT 1 FROM desktop_releases WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND status IN ('draft','retired') AND sha256='8119bcfc9181808c5d8696dbfe9a7ecf763e74e313fd79552c21d7fbb374317e' AND size_bytes=182232224 AND object_key='desktop/1.2.1-preview.3/BotGo-Setup-1.2.1-preview.3.exe');
UPDATE desktop_releases SET status='published',published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND status IN ('draft','retired')
 AND sha256='8119bcfc9181808c5d8696dbfe9a7ecf763e74e313fd79552c21d7fbb374317e' AND size_bytes=182232224 AND object_key='desktop/1.2.1-preview.3/BotGo-Setup-1.2.1-preview.3.exe'
 AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE platform='win-x64' AND status='published');
SELECT id,version,status,sha256,size_bytes FROM desktop_releases ORDER BY created_at DESC;

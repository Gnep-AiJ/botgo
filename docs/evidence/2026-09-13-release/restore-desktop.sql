-- Restore only the exact prior metadata pointer if this preview fails readback.
-- The old package is retained; its present-day runtime compatibility is unverified.
UPDATE desktop_releases SET status='retired',updated_at=CURRENT_TIMESTAMP
WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND status='published';
UPDATE desktop_releases SET status='published',updated_at=CURRENT_TIMESTAMP
WHERE id='4c197d77-6130-4c87-9153-8ca6d9ec4ecc' AND status='retired'
 AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE platform='win-x64' AND status='published');
SELECT id,version,status FROM desktop_releases ORDER BY created_at DESC;

UPDATE desktop_releases SET status='retired',updated_at=CURRENT_TIMESTAMP WHERE id='a26db6c6-e173-4516-bd77-07954634734d' AND status='published';
UPDATE desktop_releases SET status='published',updated_at=CURRENT_TIMESTAMP WHERE id='cfb5988a-f4da-455e-a89c-7fdf377e9ad3' AND NOT EXISTS (SELECT 1 FROM desktop_releases WHERE platform='win-x64' AND status='published');

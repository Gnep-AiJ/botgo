CREATE TABLE IF NOT EXISTS desktop_releases (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'win-x64',
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  notes TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS one_published_desktop_release
ON desktop_releases(platform, status) WHERE status = 'published';

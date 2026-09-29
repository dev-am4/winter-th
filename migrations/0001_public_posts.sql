CREATE TABLE IF NOT EXISTS public_posts (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  author_name TEXT,
  content TEXT,
  thumbnail_url TEXT,
  media_type TEXT NOT NULL DEFAULT 'post',
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  location_label TEXT,
  location_accuracy TEXT NOT NULL DEFAULT 'approximate',
  event_type TEXT NOT NULL DEFAULT 'flood',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  posted_at TEXT,
  ingested_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_public_posts_bbox
ON public_posts (lat, lon);

CREATE INDEX IF NOT EXISTS idx_public_posts_status_time
ON public_posts (status, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_event_time
ON public_posts (event_type, posted_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_platform
ON public_posts (platform);

CREATE TABLE IF NOT EXISTS post_submissions (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  platform TEXT,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  location_label TEXT,
  submitted_note TEXT,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_post_submissions_status
ON post_submissions (status, submitted_at DESC);

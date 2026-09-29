ALTER TABLE public_posts ADD COLUMN observed_at TEXT;
ALTER TABLE public_posts ADD COLUMN grid_z4 TEXT;
ALTER TABLE public_posts ADD COLUMN grid_z6 TEXT;
ALTER TABLE public_posts ADD COLUMN grid_z8 TEXT;
ALTER TABLE public_posts ADD COLUMN grid_z10 TEXT;

UPDATE public_posts
SET
  observed_at = COALESCE(posted_at, ingested_at),
  grid_z4 = CAST(CAST(lon * 2 AS INTEGER) AS TEXT) || ':' || CAST(CAST(lat * 2 AS INTEGER) AS TEXT),
  grid_z6 = CAST(CAST(lon * 4 AS INTEGER) AS TEXT) || ':' || CAST(CAST(lat * 4 AS INTEGER) AS TEXT),
  grid_z8 = CAST(CAST(lon * 16 AS INTEGER) AS TEXT) || ':' || CAST(CAST(lat * 16 AS INTEGER) AS TEXT),
  grid_z10 = CAST(CAST(lon * 64 AS INTEGER) AS TEXT) || ':' || CAST(CAST(lat * 64 AS INTEGER) AS TEXT)
WHERE observed_at IS NULL OR grid_z4 IS NULL OR grid_z6 IS NULL OR grid_z8 IS NULL OR grid_z10 IS NULL;

CREATE INDEX IF NOT EXISTS idx_public_posts_live_observed
ON public_posts (status, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_live_bbox
ON public_posts (status, lat, lon, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_grid_z4
ON public_posts (status, grid_z4, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_grid_z6
ON public_posts (status, grid_z6, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_grid_z8
ON public_posts (status, grid_z8, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_posts_grid_z10
ON public_posts (status, grid_z10, observed_at DESC);

CREATE TABLE IF NOT EXISTS discovery_queries (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'brave',
  query_text TEXT NOT NULL,
  province TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  freshness TEXT NOT NULL DEFAULT 'pd',
  priority INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT NOT NULL,
  last_result_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_queries_due
ON discovery_queries (enabled, next_run_at, priority DESC);

CREATE TABLE IF NOT EXISTS discovery_candidates (
  id TEXT PRIMARY KEY,
  query_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_url TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  thumbnail_url TEXT,
  province TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  discovered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  FOREIGN KEY (query_id) REFERENCES discovery_queries(id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status
ON discovery_candidates (status, discovered_at DESC);

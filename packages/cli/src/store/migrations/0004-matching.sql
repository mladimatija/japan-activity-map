-- What the lists say about each activity. Rebuilt from build_cache results by `jam match`.

-- Where an activity happened: in Japan, outside it, or unknown (no track and no coordinates),
-- with its distance and climb per prefecture.
CREATE TABLE activity_areas (
  activity_id TEXT PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  location TEXT NOT NULL CHECK (location IN ('japan', 'outside', 'none')),
  -- {"13": {"distanceM": 1234.5, "gainM": 210}, ...}
  prefectures TEXT NOT NULL CHECK (json_valid(prefectures)),
  gain_method TEXT,                         -- elevations | distance | NULL
  updated_at TEXT NOT NULL
) STRICT;

-- Automatic matches: places a track passed close to, and stretches of reference routes it covered.
CREATE TABLE matches (
  activity_id TEXT NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('place', 'route')),
  target_id TEXT NOT NULL,                  -- place id or route item id
  distance_m REAL,                          -- place: nearest approach
  covered_m REAL,                           -- route: length covered by this activity
  intervals TEXT CHECK (intervals IS NULL OR json_valid(intervals)),
  matched INTEGER NOT NULL CHECK (matched IN (0, 1)),   -- 0: a near miss kept for review
  uncertain INTEGER NOT NULL DEFAULT 0 CHECK (uncertain IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  PRIMARY KEY (activity_id, target_kind, target_id)
) STRICT;
CREATE INDEX matches_target ON matches (target_kind, target_id);

CREATE TABLE match_runs (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  inputs_hash TEXT NOT NULL,
  activities INTEGER NOT NULL DEFAULT 0,
  computed INTEGER NOT NULL DEFAULT 0,
  reused INTEGER NOT NULL DEFAULT 0,
  new_matches INTEGER NOT NULL DEFAULT 0
) STRICT;

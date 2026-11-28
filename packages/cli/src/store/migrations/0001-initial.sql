-- Initial schema. Times are ISO 8601 strings; local times carry no offset and go with time_zone.
-- JSON columns hold arrays or objects and are checked with json_valid.

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE activities (
  -- Generated locally, never changes.
  id TEXT PRIMARY KEY,
  -- Derived from id and the secret salt in meta; safe to publish.
  public_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,                     -- strava | sheet | gpx
  strava_id INTEGER UNIQUE,                 -- kept locally even when links are not published
  start_time TEXT NOT NULL,                 -- UTC
  start_local TEXT,                         -- wall-clock time at the start
  time_zone TEXT,                           -- IANA name, for example Asia/Tokyo
  activity_type TEXT NOT NULL,              -- hike | walk | run | trail_run | ride
  sport_type TEXT,                          -- Strava's own type, as received
  event_tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(event_tags)),
  name TEXT,
  distance_m REAL,
  elevation_gain_m REAL,
  moving_time_s INTEGER,
  elapsed_time_s INTEGER,
  visibility TEXT,                          -- Strava: everyone | followers_only | only_me
  has_track INTEGER NOT NULL DEFAULT 0 CHECK (has_track IN (0, 1)),
  start_lat REAL,
  start_lon REAL,
  end_lat REAL,
  end_lon REAL,
  raw TEXT CHECK (raw IS NULL OR json_valid(raw)),   -- the source record as received
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX activities_start_time ON activities (start_time);
CREATE INDEX activities_type ON activities (activity_type);

CREATE TABLE tracks (
  activity_id TEXT PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  detail TEXT NOT NULL,                     -- summary | full
  -- [[lon, lat], ...]
  coordinates TEXT NOT NULL CHECK (json_valid(coordinates)),
  point_count INTEGER NOT NULL,
  elevations TEXT CHECK (elevations IS NULL OR json_valid(elevations)),
  times TEXT CHECK (times IS NULL OR json_valid(times)),
  fetched_at TEXT NOT NULL
) STRICT;

CREATE TABLE pulls (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,                     -- strava | sheet | gpx
  started_at TEXT NOT NULL,
  finished_at TEXT,
  range_from TEXT,
  range_to TEXT,
  activity_types TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(activity_types)),
  include_private INTEGER CHECK (include_private IN (0, 1)),
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  outcome TEXT NOT NULL DEFAULT 'running',  -- running | ok | partial | failed
  error TEXT
) STRICT;
CREATE INDEX pulls_source_started ON pulls (source, started_at);

CREATE TABLE sheet_rows (
  -- Stable key for the row, from its id column or a hash of its content.
  row_key TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  data TEXT NOT NULL CHECK (json_valid(data)),
  activity_id TEXT REFERENCES activities (id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL
) STRICT;

CREATE TABLE overrides (
  id INTEGER PRIMARY KEY,
  target_kind TEXT NOT NULL,                -- activity | place | route
  target_id TEXT NOT NULL,
  field TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  source TEXT NOT NULL,                     -- cli | sheet | review
  created_at TEXT NOT NULL,
  UNIQUE (target_kind, target_id, field)
) STRICT;

CREATE TABLE routes (
  id TEXT PRIMARY KEY,
  representative_activity_id TEXT REFERENCES activities (id) ON DELETE SET NULL,
  name TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE route_members (
  route_id TEXT NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
  activity_id TEXT NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  variant_of TEXT REFERENCES routes (id) ON DELETE SET NULL,
  PRIMARY KEY (route_id, activity_id)
) STRICT;
CREATE INDEX route_members_activity ON route_members (activity_id);

CREATE TABLE build_cache (
  activity_id TEXT PRIMARY KEY REFERENCES activities (id) ON DELETE CASCADE,
  inputs_hash TEXT NOT NULL,
  results TEXT NOT NULL CHECK (json_valid(results)),
  updated_at TEXT NOT NULL
) STRICT;

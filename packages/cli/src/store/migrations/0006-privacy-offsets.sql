-- One random shift per privacy zone, made the first time the zone is used and kept, so
-- the published cut points stay put from build to build. Keyed by a hash of the zone's label and
-- position; the position itself is only in config/privacy-zones.jsonc.
CREATE TABLE privacy_zone_offsets (
  zone_key TEXT PRIMARY KEY,
  bearing_rad REAL NOT NULL,
  -- How far the centre moves, as a share of the largest shift (thresholds privacy.centreShiftShare).
  offset_share REAL NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

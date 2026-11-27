-- Grouped routes. Members are kept by activity reference (strava:<id> or the act_ id)
-- rather than a foreign key, so routes, their ids and their names survive `strava wipe` and a
-- refetch: the activities rejoin the same routes when they come back.
DROP TABLE route_members;
DROP TABLE routes;

CREATE TABLE routes (
  id TEXT PRIMARY KEY,                      -- route_..., never changes
  activity_type TEXT NOT NULL,
  auto_name TEXT NOT NULL,
  -- The member most like all the others, and its shape: what new activities are compared with.
  representative_ref TEXT NOT NULL,
  cells TEXT NOT NULL CHECK (json_valid(cells)),   -- ordered grid cells of the representative
  start_lon REAL NOT NULL,
  start_lat REAL NOT NULL,
  end_lon REAL NOT NULL,
  end_lat REAL NOT NULL,
  distance_m REAL NOT NULL,
  -- A shorter route that mostly follows this one.
  variant_of TEXT REFERENCES routes (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX routes_type ON routes (activity_type);

CREATE TABLE route_members (
  member_ref TEXT PRIMARY KEY,              -- strava:<id> or act_...; one route per activity
  route_id TEXT NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  -- How well it matches the representative (0 to 1), for the review.
  similarity REAL NOT NULL,
  -- auto | merge | split: why it is in this route.
  reason TEXT NOT NULL DEFAULT 'auto',
  joined_at TEXT NOT NULL
) STRICT;
CREATE INDEX route_members_route ON route_members (route_id);

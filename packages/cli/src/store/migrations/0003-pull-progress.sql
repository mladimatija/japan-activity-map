-- Strava pulls resume where they stopped, so a pull keeps its position, and its details
-- (granted scope, skipped sport types) for the report.
ALTER TABLE pulls ADD COLUMN cursor TEXT CHECK (cursor IS NULL OR json_valid(cursor));
ALTER TABLE pulls ADD COLUMN details TEXT CHECK (details IS NULL OR json_valid(details));

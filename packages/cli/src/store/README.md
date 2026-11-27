# Local store

SQLite in `data/jam.sqlite`, through Node's built-in `node:sqlite`.

- Only `sqlite.ts` imports `node:sqlite`. Everything else uses its `Database` class, so a
  switch to better-sqlite3 (the fallback if the built-in module changes) touches one file.
- Migrations are `migrations/NNNN-name.sql`, numbered without gaps, applied in order by
  `openStore`, each in its own transaction. An applied migration is never edited: its checksum
  is recorded and a changed file is refused. Change the schema with a new file.
- Backups: before migrating a database that already has a schema, and before any wipe, the
  store is copied to `data/backups/jam-<date>-<time>-<reason>.sqlite`. If a migration fails, its
  transaction is rolled back and that copy is put back. Automatic copies are pruned to the newest
  20; manual ones (`jam backup`) are kept.
- Ids: internal ids (`act_…`) are made locally, start with the time and never change. Public
  ids are an HMAC of the internal id with a secret salt kept only in `meta.id_salt`, so a
  published id says nothing about the Strava id.

| Table                     | Holds                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `activities`              | One row per activity, from Strava or the sheet: times, type, tags, distance, visibility, start and end points, the source record |
| `tracks`                  | Geometry per activity, with optional elevations and times, and whether it is the summary or full track                           |
| `pulls`                   | Each sync: when, range, types, private setting, counts, outcome                                                                  |
| `sheet_rows`              | Rows of the manual sheet, linked to an activity where one exists                                                                 |
| `overrides`               | Hand corrections to an activity, place or route field                                                                            |
| `routes`, `route_members` | Activities grouped as the same route, with direction and variants                                                                |
| `build_cache`             | Cached match results per activity, keyed by a hash of the inputs                                                                 |
| `meta`                    | Schema version, the id salt, and later the per-zone privacy offsets                                                              |
| `schema_migrations`       | Which migrations were applied, when, with their checksums                                                                        |

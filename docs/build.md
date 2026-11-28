# The build

`pnpm jam build` turns the local store into the files the public site reads, in `dist/data`:

```sh
pnpm jam build              # --report also prints new and uncertain matches
pnpm jam build --dry-run    # everything, written to data/build-failed instead, nothing replaced
```

It runs in a fixed order: match activities (`jam match`, cached), group routes (`jam routes`),
apply the privacy zones and publish rules, work out list statuses and totals, write every file to a
fresh folder, validate each file against its schema, check the size budget, and audit the result
(`jam audit`). Only a build that passes all of that replaces `dist/data`. A failed build leaves the
previous output as it was and keeps the failed files in `data/build-failed` (local, never
published), so you can see what went wrong.

The summary lists what was published and left out (with reasons), the routes, every file with its
size, the compressed size of the files loaded at start against the budget, and the audit.

## What is counted

The site is built from one activity source, `activities.source` in `config/site.jsonc`: `strava`
(the default), `gpx` (docs/gpx.md) or `garmin` (docs/garmin.md). Activities of the others stay in the store and are listed
under "Left out". The sheet's own rows count with either. Changing the setting and building again
gives the other site; nothing is deleted.

Everything public is worked out from the published activities only: list statuses, visits, route
coverage, totals and charts. An activity left out (the other source, outside Japan, hidden in the sheet,
Only You, no GPS) doesn't make a summit done on the site, though it still does in `jam match`, which is
your own view. Statuses you write in the sheet (done, DNS, want) count as usual.

Privacy zones apply to everything with a position: tracks, route lines, start and end points,
the stretches of reference routes marked as covered, and the places an activity is said to have
reached. A list place inside a zone shows its status, but not how often or when you went.

## Files

| File                              | Holds                                                                                                                                                                                                                                                               | Loaded                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `meta.json`                       | Schema version, build time, counts, track years, publish settings, saved views, map styles, shown area and terrain source, credits                                                                                                                                  | at start                        |
| `activities.json`                 | One record per activity: public id, date, type, tags, source (Strava, GPX or sheet), name, distance, climb, times, distance and climb per prefecture, places reached, reference route items covered, grouped route, link (if on), track year, bounds, start and end | at start                        |
| `lists.json`                      | Every list (with what it is, in a sentence) and item (with how its name is read, where given) with its status, visits, first and latest date; coverage for routes, with the covered stretches                                                                       | at start                        |
| `prefectures.geojson`             | Simplified outlines with your totals in each                                                                                                                                                                                                                        | at start                        |
| `mask.geojson`                    | Everything outside Japan and a 20 km band of sea, which the map covers (see docs/web.md)                                                                                                                                                                            | at start                        |
| `stats.json`                      | Totals by type, year, month and prefecture; starts by hour and weekday, overall and per type; completion over time per list                                                                                                                                         | at start                        |
| `routes.json`                     | Routes with two or more published activities: counts, dates, times or paces, the representative line                                                                                                                                                                | at start                        |
| `reference-routes/<list>.geojson` | A route list's geometry and the stretches covered                                                                                                                                                                                                                   | when the list is shown          |
| `prefectures/<code>.geojson`      | One prefecture in detail, from `jam lists fetch outlines` (left out until that has run): its area (coast to about 25 m) and its land borders with its neighbours (to about 5 m)                                                                                     | when the prefecture is selected |
| `tracks/<year>.geojson`           | Tracks of that year, cut at privacy zones and simplified; heights as each point's third number, and seconds per point (`t`, from each stretch's start) with `publish.paceAlongTracks`                                                                               | when the year is shown          |

`lists.json` also gets a Municipalities list when `lists/sources/n03-municipalities` is there
(`pnpm jam lists fetch municipalities`): every municipality, done when a published track passes
through it. Only the stretches outside privacy zones count, as everywhere else.

Every file carries `schemaVersion`. The schemas are in `packages/core/src/output/schema.ts`; the
build validates against them, and the web app uses the same types. A change that an older web app
couldn't read bumps the version. A new value an older app passes over, as `gpx` in an activity's
`source` is (that app shows the activity and offers no filter for it), doesn't.

`meta.json` also carries `"demo": true` when the store is the demo's (`pnpm jam demo`,
docs/demo.md), and only then; the site shows a badge and the audit warns. A demo store is never
built into `dist/data`, and a build of your own data never replaces a folder that holds a demo
build.

## Size and precision

In `config/site.jsonc` under `output`:

- `simplifyM` (5): tracks and route lines are simplified so no point moves more than this.
- `decimals` (5): coordinates keep 5 decimals, about 1 m.
- `startBudgetKB` (1024): the gzip-compressed size of the files loaded at start may not exceed this;
  a build over budget fails.

Tracks are split by year so the site loads only what is on screen. If a year grows too large, the
next step is one tiled track file.

The same inputs give byte-for-byte the same files, apart from the build time in `meta.json`.

## Trying it

`pnpm check:build` builds made-up activities twice in a temporary folder and checks the files, the
budget, that the two builds match, and that a failed audit or an over-budget build keeps the
previous output.

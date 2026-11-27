# Matching activities to the lists

`pnpm jam match` works out, for every activity in the local store, which list places and route
stretches it reached and which prefectures it passed through, then combines that with the
activity sheet. Run it after syncing:

```sh
pnpm jam sync strava
pnpm jam sync sheet
pnpm jam match            # --report also prints new and uncertain matches
```

It prints progress per list and writes `data/match-review.md` with the details.

## What is matched

- Places (peaks, temples, castles, high points): a place counts when the track passes within
  `matching.pointRadiusM` of it (200 m by default), measured to the track's line, not just its
  points. `matching.perList` sets a different radius for one list. A place in several lists, such as
  雲取山 in the 100 Famous Mountains and the prefecture high points, is matched once and counts in
  each list.
- Routes (old highways, cycle routes, long trails, pilgrimage routes): a track covers the stretches of a route it
  follows, checked on a grid of about 60 m cells (`routeGrouping.gridZoom`). Stretches shorter than
  `matching.routes.minStretchM` (300 m) are dropped, so crossing a route doesn't count, and gaps
  up to `bridgeGapM` (100 m) are bridged. Coverage adds up across activities without counting the
  same stretch twice. A route item is done at `completeShare` (95%) and partly done before that.
- Prefectures: each track is split at prefecture borders, with distance and climb recorded per
  prefecture. The figures are scaled to the activity's recorded distance and climb, so a simplified
  track still adds up. Climb is split by the track's own elevations where it has them, otherwise
  by distance.
- Japan or not: an activity is in Japan if any part of its track is inside a prefecture or
  within `matching.japanMarginM` (2 km) of one. Without a track, a sheet row counts as Japan
  unless its coordinates are elsewhere; a Strava activity without GPS has no location. The public
  site leaves out activities outside Japan, and those without GPS unless
  `publish.activitiesWithoutGps` is on (then only those in the Asia/Tokyo time zone).

## Statuses

| Status | Comes from                                                                           |
| ------ | ------------------------------------------------------------------------------------ |
| done   | A track reached the place (or covered the route), or a sheet row says done or repeat |
| partly | Routes only: some of it is covered                                                   |
| DNS    | A sheet row says DNS; never set automatically                                        |
| want   | A sheet row says want; never set automatically                                       |

What the sheet says about an activity always wins for that activity: a row marked DNS keeps the
place at DNS even if the track reached the summit. A later visit marked done, or matched, makes the
place done. Visits are counted per activity, with the first and latest dates.

## Uncertain and false matches

Strava's activity list only has a simplified track. When it passes within
`matching.uncertainMarginM` (50 m) of the radius, the match is marked uncertain in
`data/match-review.md`, counted if it is inside the radius and not if it is outside. Fetching the
full track settles it: `pnpm jam sync strava --streams <id>`, then `pnpm jam match`.

For a false match, such as a road tunnel under a summit:

```sh
pnpm jam match ignore 12345678901 peak-363          # Strava id, or the act_ id of a sheet row
pnpm jam match ignore 12345678901 peak-363 --undo
```

The ignore is kept by Strava id, so it survives `strava wipe` and a refetch.

## Speed

Results are cached per activity, keyed by its track and figures, the list files and the thresholds.
A run with nothing changed takes milliseconds; a change to a list or a threshold recomputes
everything (a few seconds per thousand Strava activities). `--force` recomputes regardless.

## Trying it

`pnpm check:match` runs the checks on made-up activities (a hike to 雲取山, a DNS on 甲斐駒ヶ岳, a ride
from Tokyo to Yokohama, a walk on the 東海道, a run in Zagreb) in a temporary folder.

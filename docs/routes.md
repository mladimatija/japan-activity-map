# Grouped routes

`pnpm jam routes` collapses activities you've done more than once into routes: the riverside
loop you run every week becomes one route with a count, dates and times, instead of fifty
overlapping tracks. Run it after `jam match`, which it uses for names:

```sh
pnpm jam match
pnpm jam routes            # --all lists every route, not just the most repeated
pnpm jam routes review     # merge and split candidates
```

Every run writes `data/routes-review.md`, listing every route with its activities.

## How activities are grouped

Each track becomes the ordered list of grid cells it passes through (about 60 m across,
`routeGrouping.gridZoom`). An activity joins a route when all of these hold:

- the same activity type;
- starts and ends within `startToleranceM` and `endToleranceM` (200 m) of the route's, either way
  round;
- the length of distinct street it covers is within `distanceTolerancePct` (10%) of the route's.
  Laps and retraced stretches count once, so the same route with one lap of a section or three is one
  route. Set `ignoreLaps` to false to compare total distance instead;
- at least `minOverlapShare` (80%) of its cells lie on the route, and 80% of the route's lie on it.
  A cell next to one of the route's counts, so GPS drift doesn't matter.

It joins the first route it matches, oldest first; otherwise it starts a new route. A run the
other way round, whether along a loop or from B back to A, joins the same route and is counted as
reversed. A shorter activity that starts or ends where a longer route does and mostly follows it,
such as turning back half way, is a route of its own, linked to the longer one as a variant. Activities without a track are never
grouped.

Each route keeps a representative: the member most like all the others. New activities are
compared with it, and it is chosen again only when the members change. Once representatives are
settled, two routes that now match each other are merged, the older one keeping its id.

Run `jam match` before `jam routes`: it tags each activity as in Japan or not, and the list of most
repeated routes and the review only show routes in Japan unless you pass `--all`.

## Stable ids

Routes and their members are kept in the store, so a rerun only adds new activities and every
route keeps its id. Members are recorded by Strava id (or the sheet row's act_ id), so after
`strava wipe` and a full pull the activities rejoin the same routes. `pnpm jam routes regroup`
regroups everything from scratch, for example after changing the tolerances; routes whose members
are mostly the same keep their ids.

## Names

Routes are named automatically: the highest list place the route reaches, otherwise the nearest one
within 3 km of the start, otherwise the prefecture, then the type and distance. For example,
"雲取山 · Hike 20.5 km" or "東京都 · Run 5.5 km loop". Routes whose names would be the same get a number.
The site gets these as their parts and says them in its language ("東京都・ランニング 5.5 km 周回");
a name given in `config/routes.jsonc` is shown as written.

Better names, and corrections, go in `config/routes.jsonc` (copy the example). Activities are named
by Strava id, or by the act_ id for a sheet row; `data/routes-review.md` lists them for every route.

```jsonc
{
  "names": { "12345678901": "Tamagawa riverside loop" }, // any activity in the route
  "merge": [[12345678901, 12345678955]], // their routes become one
  "split": [[12345678977]], // these leave and form their own route
}
```

A merge moves the members of the newer routes into the oldest. A split route holds exactly the
activities listed, and nothing joins it automatically. To undo a merge or split, remove it from the
file and run `pnpm jam routes regroup`.

## Review

`pnpm jam routes review` lists merge candidates, most alike first. These are pairs of routes kept
apart although they are close: their ends are within twice the tolerance, their distances within
twice the percentage, and their shapes share at least 70% of cells. Each pair says what differs:
the same streets with more distance on them (repeated stretches), the longer one going beyond the
shorter, or both leaving the other. It also says what kept them apart, such as "end 326 m apart
(limit 200 m)". If most candidates are kept apart by their ends, for example because you stop the
watch at different corners near home, raise `startToleranceM` and `endToleranceM`. It also lists split candidates: routes with a
member far from the representative, or members whose distances vary widely. Merge or split them in
`config/routes.jsonc`.

The review covers routes in Japan, since only those are published; `--all` includes the rest.
`data/routes-review.md` has the full lists.

## Statistics

For each route: how many times, how many of those reversed, the first and latest date, and the
fastest and median moving time. When laps make the members' distances differ by more than 5%, it
shows the distance range and the best and median pace instead, since times no longer compare.

## Trying it

`pnpm check:routes` runs the checks on made-up runs around 東京駅 in a temporary folder.

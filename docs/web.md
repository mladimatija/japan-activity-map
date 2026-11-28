# The map

`packages/web` is the public site: React 19, MapLibre (through react-map-gl), Tailwind CSS and
shadcn/ui on Base UI, over the files
`pnpm jam build` writes into `dist/data`. It has no server and no secrets; everything it shows is
in those files, which have already passed the privacy audit.

```sh
pnpm jam build      # dist/data
pnpm web:dev        # http://localhost:5173, serving dist/data at /data
pnpm web:build      # dist/index.html and dist/assets, beside dist/data
pnpm web:preview    # dist as it will be published
pnpm check:web      # render the pane for every list and selection against dist/data
```

`pnpm demo:web` is `web:dev` over the demo build in `data/demo/dist/data` (docs/demo.md): the dev
and preview servers serve the folder `JAM_WEB_DATA` names at `/data` when it is set, and
`dist/data` otherwise. The demo is never shown unless asked for like this. While the data is a
demo (`demo` in `meta.json`), the top bar shows a "Demo data" badge (`shell/DemoBadge.tsx`); on a
phone, where the bar is full, it is a slim strip under the bar that also says what it means
("Demo data · made-up activities").
`pnpm check:web:demo` runs the web check against a demo build made in a temporary folder.

`web:build` replaces only `dist/index.html` and `dist/assets`; `dist/data` belongs to `jam build`.
The two can be run in either order. The site uses relative paths, so `dist` works from any folder
or subpath.

## Layout

A bar across the top, a pane on the left and the map filling the rest. The page opens on the map,
with the first list's overview in the pane. The pane is 400 px wide to start; drag its right edge
(or focus it and use the arrow keys, Shift for bigger steps, Home and End for the limits) for
anything from 320 to 720 px, always leaving the map at least 360 px. A double-click puts it back.
The width is remembered. Phones have a bottom sheet instead.

- Top bar: the site title, the list picker (every list by theme, each with its completion and a
  small bar), the pages (Map, and Statistics, Goals, Repeats and Compare under Insights; a menu on
  phones), search, **Filters** (with how many are on), and the **Layers** menu.
- Search finds places, prefectures, routes and activities (by name or date), grouped by kind,
  five of each. It ignores case, accents, width and spacing, so `fuji`, `Fuji`, `ｆｕｊｉ` and
  `富士` all work. Arrow keys move through the results, `Enter` opens one, `Esc` closes, and `/`
  jumps to the box from anywhere. Opening a result from a chart page goes to the map.
- Layers: list places, my tracks, my routes and prefectures as switches, plus hillshade and 3D
  relief when a terrain source is set, and the prefecture colouring.
- Map key, in the map's bottom-left corner: what the colours and marks on the map mean, for
  what is on it now (prefecture colours, list places, a route list's coverage, the heatmap, activity
  types). It folds to one button; it starts open on wider screens and folded on phones, and
  whether it is open is remembered. The loading note sits under it.
- The pane has three tabs, each with its count: **List**, **Activities** and **Prefectures**
  (see Filters below). The list tab shows the active list's overview: its name in the chosen language with the other below, the
  progress (`5 / 100`, the share, and a bar split by status), status chips (all, and each status the
  list has; several can be on) that filter both the rows and the pins, and the items grouped by region from Hokkaido to
  Kyushu and Okinawa, each region with its own count. Regions start open when 40 or fewer items show.
  Choosing an item opens its detail in the same pane, with **Back** (and `Esc`) returning to the
  row it came from.
- Details: a place has its facts, every visit, the nearby places on the list not done yet, and
  the other lists it is on; an activity its pace or speed, prefectures, places and route, with a
  link to Strava; a prefecture its totals, the split by activity type, and each list's progress
  there, which opens that list filtered to the prefecture; a route its runs over time.

Hovering a row lights its pin and hovering a pin lights its row; hovering an activity row lights its
track. The hover state lives in its own
small store (`src/hover.ts`) so this doesn't re-render the pane or the map.

On a phone (under 768 px) the pane is a bottom sheet (shadcn's Drawer, non-modal, that never
closes) with three stops: low (the list's progress), half (the list or a detail, the map keeping
what it describes above it) and full. Swipe it, tap the handle, or use the arrow keys on the
handle; a hard swipe down drops it to the lowest stop. The map's controls and its camera padding
follow the sheet, and the first view frames the four main islands. Layers open as a sheet of
their own, search is a button that opens over the whole screen (the box at the top, the keyboard
up, results below; the back arrow, `Esc` or the phone's Back to leave; the page under it is inert
meanwhile), every control is at least 44 px for a
finger, and a detail steps to the next or previous item with a sideways swipe (or the ⌃ ⌄
buttons beside Back, everywhere).

The chart pages give way to the narrow screen too: tables drop to the columns that fit (a
personal record is two lines, a list's "Next" and "Pace" are left to wider screens), a row shows
one name, not both languages, and the hints say "tap" where there is no pointer to hover with (the rest say "select", which is
true of a mouse and a finger).

Long lists render only the rows in view (TanStack Virtual), so a 300-place list or every activity
costs the same as a short one. In a list, the arrow keys (and Home, End) step through the rows,
opening regions on the way; the map pans to the row after a short pause if it is off screen, and
Enter opens it. A list that isn't finished says how many are left and suggests the not-yet
place closest to the latest outing. "Only what's on the map" limits the rows to places in view.
While tracks or a route load, a thin line runs across the top of the map with a short note of how
far along. Empty results offer to clear the filters. With reduced motion asked for, the camera
jumps instead of flying, and menus and sheets appear without animating.

## Styling and components

Almost no hand-written CSS: the components carry Tailwind classes, and `src/index.css` holds only
the theme (colours as CSS variables, light and dark following the system), Base UI's state
variants, and MapLibre's own stylesheet in a layer under the utilities so classes on the map can
adjust its controls and popups.

The controls are [shadcn/ui](https://ui.shadcn.com) components on [Base UI](https://base-ui.com),
in the default look (the Vega style, neutral colours), copied into `src/components/ui` as shadcn
does: they are the app's own code to change. Base UI does the hard parts of accessibility: menus,
popovers and selects with focus management, `Esc` and roving arrow keys; tabs, accordions,
switches, checkboxes, toggle groups and a two-thumb slider with the right roles and states.
`components.json` lets `pnpm dlx shadcn@latest add <component>` add more (the `@/` alias points at
`src`). The one change from shadcn's colours is a slightly darker `--muted-foreground`, so small
quiet text passes WCAG AA on muted backgrounds too. Every view, and every menu, dropdown and
popover open, was checked with axe-core (WCAG 2.2 AA and best practice) in English and Japanese, in
light and dark mode, and at phone width. Base UI's focus guards (hidden spans at a popup's edges
that keep Tab inside it) are the one thing axe reports, by design.

`src/components/app.tsx` has the app's own pieces built on them: list rows, status badges, filter
chips, colour dots, the pane title style, the headline figure ("5 / 100 … 5%"), the look of a
foldable group's heading (filter groups, a list's regions, activity months: same size and height,
chevron on the right, down while folded) and the small sort menus, so every panel and page draws
them alike. The type steps between Tailwind's are named by role in the theme: `text-axis` (10 px,
chart labels), `text-compact` (13 px, secondary text and small headings), `text-row` (15 px, a
row's name or a figure), `text-title` and `text-display` (22 and 28 px on wider screens). The pane's
scroll padding and the offsets that pin bars to its top and bottom live together in
`src/panel/scroll.ts`. Icons are [Lucide](https://lucide.dev).

Text that doesn't fit ends in an ellipsis (`truncate`, or `line-clamp-*` for two lines) and
keeps its full text in the page, so screen readers, copying and find-in-page get all of it.
`src/clip.ts` adds the rest with one listener for the whole app: while the pointer is over clipped
text, that text is its own `title`, and it has none when it fits. On touch, each clipped label has
a fuller view a tap away (a row opens its detail, the list picker its menu).

State is in [Zustand](https://zustand.docs.pmnd.rs) stores: the main one (`src/store.ts`,
`useStore(select)` in components, `useStore.getState()` and `setState()` elsewhere), and two small
ones of their own, the hovered item and the map tooltip, so following the pointer re-renders only
what it touches. Actions (`select`, `setFilters`, `chooseList`, …) are plain functions beside the
store.

## Kilometres or miles

The **km / mi** switch in the top bar (in the layers menu on a phone) changes every distance,
height, pace and speed on the site: panels, charts, the map's scale, hover cards, filter chips and
the share picture. The choice is kept in the browser (`jam.units`). A first-time visitor gets
miles and feet when the browser's language is US English (also Liberia and Myanmar), and
kilometres and metres otherwise.

Only what is shown changes. The published data, the filters and every link stay in kilometres and
metres, so a link reads the same for everyone. A few things follow the units more closely than a
plain conversion:

| What                | Metric                            | Imperial                                                                                          |
| ------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Filter sliders      | round kilometres and metres       | round miles and feet (a dragged value is written to the link in km or m, for example `km=8.047-`) |
| Splits              | per km (5 km on rides)            | per mile (5 mi on rides)                                                                          |
| Steepest stretch    | over 200 m (500 m on rides)       | over 660 ft (1,650 ft on rides)                                                                   |
| Records, runs       | 1 km, 5 km, 10 km, half, marathon | 1 mi, 5K, 10K, half, marathon                                                                     |
| Records, rides      | 10, 40, 100 km                    | 10, 25, 100 mi                                                                                    |
| Distance milestones | next round km                     | next round mile                                                                                   |
| Saved-view names    | as written                        | figures converted: "Long runs (30 km+)" reads "Long runs (19 mi+)"                                |

For code: `src/units.ts` holds the choice and the unit sizes; every figure goes through
`src/format.ts` (`distanceText`, `heightText`, `paceOrSpeed`, `speedText`, `roughly`,
`wholeDistance`). `pnpm check:web` fails on a unit written by hand elsewhere, and renders every
panel and page in imperial, in both languages, to make sure no metric figure is left.

## Names in English or Japanese

Every place, list, route stage, prefecture and region has a Japanese and an English name. The
switch at the right of the top bar (in the Layers menu on a phone) chooses which comes first;
the other follows it, quieter, for reference: "Mount Fuji 富士山", or "富士山 Mount Fuji".
English is the default. The choice is the viewer's own: it is kept in the browser
(`localStorage`, key `jam.lang`), not in links, so a shared link opens in each viewer's language.
Tight places (the back button, eyebrows, chart labels, map pin labels, filter chips) show the
first name only.

The interface follows the switch too: with 日本語 on, every label, message, date
(`2025年7月12日`), duration (`3時間5分`) and MapLibre's own control labels are in Japanese.
Strings are written in English in the code and wrapped in `t()` (`src/i18n.ts`), which looks
them up in `src/i18n-ja.ts`; `{name}` marks a value filled in. Label tables (statuses, themes,
months, seasons, sort orders…) are wrapped in `localized()`, so whatever reads them gets the
current language (ids, select values, keys and queries in them are left alone). A missing
translation shows the English.

Everything built for the site is in both languages, and `pnpm check:web` holds it to that. It fails
on:

- a `t('…')` string with no Japanese in `src/i18n-ja.ts`;
- English written straight into the markup, where `t()` never sees it;
- any string asked for while rendering in Japanese that the dictionary lacks. It renders every
  detail, pane view, page, the top bar and the map key in Japanese to find these, so strings built
  at run time are caught too;
- English left in those Japanese renders that isn't data. Data here means activity names and
  tags, the English name beside a Japanese one, and credits.

Text the build makes is bilingual too:

- Automatic route names. These are published as their parts (the place in both languages, the
  length, loop) and said in the reader's language (`routeName`): "雲取山 · Hike 20.5 km" in English,
  "雲取山・ハイキング 20.5 km" in Japanese.
- Unnamed activities. An activity without a name, or every activity when names aren't
  published, is called by its type (`activityName`).
- Credits. Each source has a Japanese credit and licence where they differ.

The site title comes from `config/site.jsonc`, and saved views in it are named by the owner; neither
is translated.

In code, `src/names.tsx` has the `<Name>` component, `nameIn` / `subName` for plain strings, and
`routeName` / `activityName`; `useLang()` reads the setting.

## Filters

Every filter is a facet; they combine freely, and all of them are in the address. They come in three
scopes (`src/filters.ts`):

| Scope       | Facets                                                                                                                                                                                                                     | Narrows                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Activities  | type, event tag, year range, a window back from today, season, month, day of the week, prefecture, reached a place on any of some lists, new ground only, repeated or one-off routes, source, distance, climb, moving time | the activities, and everything built from them: tracks, routes, prefecture totals, visits |
| Places      | status, region, height, visits, first reached in a window back from today, years since last reached (and the prefecture filter from a prefecture's detail)                                                                 | the active list's rows and pins                                                           |
| Prefectures | has an activity of a type, never had one, at least a number of activities, days, km or metres of climb                                                                                                                     | which prefectures are coloured and listed                                                 |

One function, `derive`, turns the filters into the filtered activities, per-prefecture totals,
visit counts, matching prefectures and the list items that pass; the map, the pane, the tooltips
and the map key all read that one result, so they always agree. With activity filters on, a
prefecture's colour, tooltip and detail count only the matching activities, and a place's visits
count only matching activities (so `year=2025&visits=1-` is "peaks reached in 2025"). Seasons are
spring March–May, summer June–August, autumn September–November and winter December–February.

The filter panel (the Filters button; `Esc` closes it) has a control per facet: dropdowns for
type, event, season, month, day of the week, prefecture (grouped by region), lists reached, status,
region and the prefecture "has" and "never", where any number can be on at once and a result
matches any of them; one-choice dropdowns for the window back from today ("When": last 30 days,
last 12 months, this year, last year), repeated or one-off routes, the source (Strava or GPX,
whichever the site is built from, and the manual sheet; shown when the data has two) and when a place was
first reached; a switch for new ground (activities that reached a place, a route stretch or a
prefecture for the first time, over everything published); two-thumb sliders for years, distance,
climb, moving time, height, visits and years since a place was last reached; and a threshold
field. A dropdown with more than five options has a search box (prefectures match their English
and Japanese names and their region). Every option shows how many results it would give with the
other filters as they are, and options that would give none are dimmed.

The panel's title and Clear all stay at the top while it scrolls. Each group of facets (activities,
the list, prefectures) folds away by its heading; a folded group's filters still apply, and its
heading says how many are on, with a Clear for that group alone.

Saved views are a dropdown at the top: choosing one sets the view and every filter, and the
list if the view names one. The built-in ones work on whichever list is open (still to do, done,
done this year, done more than once, not reached in 3+ years) or on the activities (this year,
the last 12 months, new ground this year, big mountain days of 1,500 m+ climb, long runs of 30 km+,
all-day outings of 6 h+, races, overnight trips), plus everywhere as a heatmap and the prefectures
still to visit. Dates count back from today, so none goes stale, and one about an activity type,
tag or list the build lacks isn't offered. `views` in `config/site.jsonc` replaces them (a name
and the part of an address after `#`, easiest to copy from the address bar after setting the
filters), or `[]` leaves none. **Save this view** keeps the list, the tab and every filter under a
name in the reader's browser; their own views come first in the dropdown, and the one on screen
can be deleted.

The filters in force sit over the top of the map as chips, each removable, with **Clear all**.

Activities lists the matching activities with a summary line (count, distance, climb), sorted
newest first, oldest first, longest first or by climb, a hundred at a time. **Prefectures** lists the
prefectures the prefecture filters pick (all with activities when none are set), by activities,
days, distance or climb. Rows open the detail and move the map to it.

## Pages

Beside the map are four chart pages. They replace the map in the main area (the map stays loaded
underneath, so coming back is instant), keep the pane and the filters, and read the same filtered
activities as the map: change a filter and every chart changes with it. Clicking a chart element
either applies it as a filter or opens the matching selection on the map.

- Statistics: totals; prefectures visited as x / 47 with a small map (Okinawa in an inset;
  click a prefecture to open it); this year so far against the same days last year and all of last
  year; a calendar with a tab per year (or all years), a square per day coloured by distance or
  time (click a day for its longest activity); start hour by weekday; each point list's progress split
  by region (click a list or a region to open it, filtered to that region); places and prefectures
  completed over time, a line per list; and every route list as a strip with its covered stretches.
- Repeats: the most repeated places and routes with count, first and latest date and fastest
  moving time; and a timeline per repeated place, a dot per visit (click one to open it).
- Compare and review: two years on two maps that move together, with **new ground only**
  showing the later year's stretches that no earlier track covered (on a grid of about 500 m); a
  card per year with totals, new prefectures, new places and the longest day; and height profiles
  for activities published with full GPS samples, by climb.

The Activities tab in the pane is the log: every matching activity, newest first and grouped by
month (with each month's count and distance; only the latest month starts open, and a month's
heading opens or folds it), or by length or climb. A route-list section shows a strip of the route
with the stretches covered where they are along it.

An activity's detail analyses its published track (`src/profile.ts` works it out,
`src/panel/TrackAnalysis.tsx` draws it):

- Height. The profile with height and distance axes, and under it a strip coloured by gradient
  (five bands, steep down to steep up, blue and red around a grey "flat"). Pointing at the profile
  (mouse, finger, or the arrow keys once it has focus) reads out the distance, height, gradient,
  moving time and the pace there, and puts a dot at that spot on the map; pointing at the track on
  the map does the same the other way. A thin bar shows how much of the track is in each band.
  Lowest, highest, descent, and the steepest climb and descent over 200 m (500 m for rides);
  pointing at a steepest one marks it on the profile and the map.
- Splits. Moving time per kilometre (per 5 km on rides; longer splits when there would be
  more than 25), each with a bar for its speed and its climb and descent. Pointing at a split marks
  it on the profile and the map. Pauses are left out: between two points, time beyond what the
  slowest moving speed (0.8 m/s running, 1.5 m/s riding, 0.25 m/s otherwise) explains is a pause.

Heights and distances come from the published track, so they are the stretches outside privacy
zones, and the splits restart counting where a stretch resumes. The profile needs heights and the
splits need times: both come from full GPS samples (see "Height profiles" below), and times only
with `publish.paceAlongTracks` (docs/privacy.md). Without either, the detail says so.

The colours, type sizes, components and rules for adding to the interface are in
[docs/design-system.md](design-system.md): Aizome, indigo cloth on paper, with every colour a
token in `src/index.css`.

### Pages and the pane

The top bar has Map and, under one named menu (Insights), the chart pages: Statistics, Goals,
Repeats and Compare. On wider screens a chart page has the whole width: the pane is shown only on
the map, and while filtering (the Filters button brings it back on any page). On a phone the pane
is the sheet everywhere. Until the map's first frame is ready it says "Loading the map…" on the sea
colour.

Charts read out what is pointed at or focused in a line above them (`Readout` in
`src/pages/charts.tsx`, fed by `data-tip` on the marks), the same way the height profile and the
route chart do, instead of browser tooltips. A page's first figure is its headline (`Figures hero`).
Long details keep their main figures in view: an activity's splits and its further height figures
are folds (`Fold`), closed until opened, which is remembered. The map key is open on the first
visit and folded after that, until it is opened by hand.

### Goals

The Goals page (`src/pages/GoalsPage.tsx`, with the sums in `src/goals.ts` and `src/tiles.ts`) is
about what to do next. Everything on it is worked out in the browser from the published files, so
it follows the filters and needs nothing extra from the build.

- Milestones. Distance, activities and prefectures with the next round number for each; and
  each place list with what is done, its next round number, how many were first done in the last
  12 months, and the year it is finished at that pace.
- Next up. What isn't done on the list chosen in the top bar, grouped into trips (places
  within 25 km of another in the group), nearest first. The start is Tokyo station, the middle of a
  prefecture, or where the reader is; it is kept in the reader's browser and never published.
  Distances are straight lines. A peak's season is an estimate from its height and latitude (about
  150 m lower for each degree north of 35°N: under 1,000 m any month, under 1,800 m April to
  November, under 2,500 m June to October, above that July to September), not a forecast.
- Personal records. Per activity type: the longest, most climb and longest moving time; from
  tracks with heights the highest point; from tracks with times the fastest 1 km, 5 km, 10 km, half
  and full marathon inside a run (10, 40 and 100 km on rides), in moving time. Also the longest
  streak of days and of weeks, and the biggest day and week. An activity that holds a record wears
  it as a badge on its detail.
- Explorer tiles. The map in the squares of web-map zoom 14 (about 2 km; the squares
  VeloViewer and Statshunters use). A square is ticked when a published track passes through it.
  The scores are the count, the largest square with every tile ticked, and the largest group joined
  edge to edge. The Layers menu has the tiles as a map layer, with the largest square outlined.
- Races. Activities tagged `race`, with distance, time and pace.

Other things in details that help with planning:

- An activity's height profile flags the list places it reached.
- A place shows the seasons it has been reached in.
- A prefecture lists what is still to do there across every list, highest first.
- A route section that is partly covered names its next uncovered stretch and shows it on the map.
- A route section and a route list say what is left and about how long it would take: the
  median moving pace of your own walks and hikes (rides, for a cycle route) over the distance
  still uncovered. It needs three outings of the kind, of 3 km or more (10 km for rides). The
  reference lines carry no heights, so the route's own climb isn't counted, and the note says so.
- A place has "Open in maps", and a route section "Open the start in maps": a link to the
  device's maps app (Apple Maps, the phone's own choice on Android, Google Maps elsewhere) for
  directions. Nothing is asked of any maps service until the link is clicked.
- A route section, and a whole route list, can be saved as a GPX file ("Download GPX") to follow
  in a navigation app. On a phone it goes to the share sheet, so it can be handed straight to one.
  The file holds the reference line and its source's credit, nothing of yours.
- A route's chart has a trend line (least squares, with four runs or more) and can keep to one
  season.
- Each year's card on the Compare page can be shared as a picture (the device's share sheet where
  it takes pictures, a PNG otherwise).

### Municipalities

The Municipalities list (1,747 市区町村: Tokyo's wards one by one, a designated city once) is made
by the site build, not by `jam lists build`: a municipality is done when a published track passes
through it. It needs `pnpm jam lists fetch municipalities` once (docs/build.md). Its visits are in
each activity's `areas`, apart from `places`, so municipalities stay out of "places reached",
repeats and new ground.

A grouped route's detail charts every time it was done (`src/panel/RouteTimes.tsx`): one dot per
run, across by date and up by how fast it went, so a course run faster over the months climbs to
the right. On a course of one length that is the moving time; where the distance varies it is the
pace (speed on rides). The median is a line, the fastest is marked, and pointing at a dot, or at its
row in "Every time" (which shows each run's time and pace), reads it out and lights its track on
the map. Clicking a dot opens the run.

Some charts can't follow every filter, and say so under the chart:

- Start hours. Times of day aren't published, so this chart uses counts made at build time per
  activity type and follows only the type filter.
- Covered stretches. These count every published activity. A route with no matching activity
  is dimmed.
- Height profiles. These need full GPS samples. The list Strava gives a sync has only a
  simplified track without heights; each `pnpm jam sync strava` then fetches full samples for
  `fullTracksPerSync` activities in Japan (docs/strava-setup.md), and
  `pnpm jam sync strava --streams missing --limit 400` fetches the rest in one go.

The charts are plain SVG drawn by React, not a chart library. Observable Plot measured about 95 KB
gzip for the four mark types needed, as much as the whole app, where the pages are 8 KB and load
only when one is opened. They take their colours from the same palette as the map.

## What is on the map

- Prefectures, coloured by visited or not, or by activities, days, distance or climb (up to
  seven steps, colour-blind safe), drawn under the base map's labels so place names stay sharp.
  The colouring sits under the base map's water, so the coast is always the map's own. The
  prefecture shapes are simplified to keep the start small, so they only draw outlines while
  zoomed out; from zoom 6 to 7.5 they hand over to lines from the base map's own tiles, which
  sit exactly on its drawing: the prefecture borders (OpenMapTiles `boundary`, `admin_level` 4,
  including where a border runs on across a bay or strait) and the coastline (the edge of its
  `ocean` water). The colouring fades out by zoom 10. Hovering outlines one and shows a tooltip with its totals and the
  share of each activity type; clicking opens it.
- The active list. Point lists (peaks, temples, shrines) are pins coloured by status (done,
  want, tried but not reached, not yet), larger the more often visited. Zoomed out they cluster;
  a cluster is a white disc with the total, and a blue disc inside it whose size is the share
  done. Pins have a larger invisible hit area for fingers. Hovering a pin lists every visit date
  (up to twelve; the pane has the rest), except for places inside a privacy zone, which show
  their status only. Route lists (trails, highways, cycle routes) are the reference line, dashed,
  with the covered stretches drawn over it.
- My tracks, coloured by activity type, or as a heatmap: every track faint and in one
  colour, so paths done often glow brighter. Commutes stay out of the heatmap unless
  `publish.commutesInHeatmap` is on. Tracks load a year at a time when the layer is on.
- My routes, the grouped repeated routes, thicker the more often done. Off by default.
- Terrain, only when `site.jsonc` sets a terrain source: hillshade (off by default, kept subtle,
  and under the base map's water, since the elevation tiles include the seabed)
  and 3D relief (off by default) are separate switches. Relief tilts the map, since it only shows
  at an angle; switching it off flattens it.

Clicking a feature selects it: the pane shows its detail and the map highlights it. A selected
activity or route is drawn on top even when its layer is off, so a link from the pane always shows
it. Clicks and taps count within a few pixels of a line, and when several features are there, a
place wins over a route line, a route over a track, and a track over a prefecture. Choosing
something in the pane moves the map to it; choosing it on the map doesn't. `Esc`, the pane's
**Back** or the browser's Back button (a phone's back gesture) closes the detail; with a menu open,
`Esc` closes only the menu.

Light and dark follow the system. Dark viewers get `map.darkStyleUrl`, by default OpenFreeMap's
Dark (Dark Matter, Positron's dark sibling on the same OpenMapTiles layers, so the land mask, the
prefecture borders and the labels work the same), and the map's own labels and outlines switch to
light ink. `null` gives everyone `map.styleUrl`, with a dark pane beside a light map. Map labels use a regular (not italic) font from the base map's style, since its glyph server
may not have MapLibre's default font.

Tooltips show only where there is a mouse; on touch screens a tap selects instead.

## Links

The address keeps the view, so a link opens the same thing:
`#list=nihyakumeizan&item=nihyakumeizan-001`, `#activity=a1b2c3`, `#prefecture=13`, `#route=r4d5e6`,
the pane's tab (`view=activities`, `prefectures` or `filters`) and every filter:

| Parameter                                                             | Example                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `type`, `tag`, `season`, `source`, `region`, `status`, `has`, `lacks` | `type=run,trail_run`, `status=none,want`                              |
| `month`, `pref` (prefecture codes)                                    | `month=7,8`, `pref=13,14`                                             |
| `on` (activities that reached a place on any of these lists), `in`    | `on=hyakumeizan,nihyakumeizan`, `in=20`                               |
| `when`, `firstin` (a window back from today)                          | `when=12m`, `firstin=this-year` (also `30d`, `last-year`)             |
| `day`, `repeat`, `firsts`                                             | `day=sat,sun`, `repeat=repeated` or `once`, `firsts=1`                |
| `h` (moving hours), `idle` (years since last reached): ranges         | `h=6-`, `idle=3-`                                                     |
| `page`, `layers`, `fill`, `tracks` (map modes)                        | `page=stats`, `layers=tracks,prefectures`, `fill=days`, `tracks=heat` |
| `a`, `b`, `new` (years compared, new ground only)                     | `page=compare&a=2025&b=2026&new=1`                                    |
| `year`, `km`, `gain`, `elev`, `visits`: a range, either end open      | `year=2024-2026`, `gain=1000-`, `elev=-2000`                          |
| `min`: a prefecture threshold                                         | `min=activities:5`, `min=km:100`                                      |

For example `#view=activities&type=trail_run&pref=20&year=2026&gain=1000-` is trail runs in Nagano
in 2026 with over 1,000 m of climb. The default list, the list tab and unset filters are left out.
Opening something adds a history entry; switching lists, tabs, filters or layers doesn't. Anything
malformed or unknown in a link (a value that isn't one, a list or prefecture that doesn't exist) is
dropped quietly, and a link to something no longer published (an activity behind a new privacy
zone, a regrouped route) opens with nothing selected.

### Remembered choices

Choices are kept in the browser's local storage, so the next visit carries on where the last one
left off:

- The view (`jam.view`): everything the address carries except the open detail. The bare
  address opens it; a link with a `#` always wins and shows exactly what it says.
- The pane's width (`jam.paneWidth`) and your saved views (`jam.savedViews`).
- Other choices (`jam.prefs`): whether the map key is open, which filter groups are folded, which activity months you opened or folded, the activity sort, the prefecture column, the calendar's measure
  and year, Repeats' places or routes, and which regions are open in a list.
- "Only what's on the map" (`jam.onMapOnly`) and the language (`jam.lang`).

A stored value that is no longer an option falls back to the default. Without storage (private mode,
storage turned off) choices last until the page is closed.

## Loading

At start the site loads `meta.json`, `activities.json`, `lists.json`, `prefectures.geojson`,
`mask.geojson`, `stats.json` and `routes.json` in parallel (the build reports their compressed size against
`output.startBudgetKB`), then the code: about 103 KB for the app and 300 KB for MapLibre, gzip, and 8 KB more when a chart
page is opened. The compare page loads every year of tracks.
The code has a size budget of its own: `pnpm check:bundle`, after `pnpm web:build`, fails when
the first load, all the code together or any one chunk outgrows it, and CI runs it. The budgets
are in `packages/web/dev/check-bundle.ts`; raise one there when an increase is meant.
With the tracks layer on, tracks load a year at a time, newest first, and the older years once the
page is idle; with activity filters on, only the years that have a matching track. With it off,
selecting an activity loads only its year. A route list's geometry loads when that list is chosen. A file that fails to load shows a note in the pane; the
rest keeps working.

If the start files are missing the page says to run `pnpm jam build`; if they come from a
different version of the build (`schemaVersion`), it says to rebuild. In development the files
are also checked against the output schema, so a mismatch shows up while working rather than as a
broken page.

## Map style

MapLibre does its tile work in a web worker. It looks for the worker file next to its own module,
which bundling moves, so `MapView.tsx` passes the real file (`maplibre-gl-worker.mjs?url`) as
`workerUrl`. The build ships it as `assets/maplibre-gl-worker-*.mjs`; the host has to serve `.mjs`
as JavaScript, as GitHub Pages, Cloudflare Pages and Netlify do.

`map.styleUrl` is any MapLibre style. The default is OpenFreeMap's Positron, a quiet grey style
that needs no key and lets the pins, tracks and prefecture colours carry the map.
The style and the terrain tiles credit themselves in the map's attribution control. The lists and
the prefecture boundaries ask for longer wording, so the control links to the pane's **Sources**
section, which gives each one's wording, link and licence from `meta.credits`.

## Only Japan

The map shows Japan and nothing else. Everything more than 20 km out from Japanese land is covered
by `mask.geojson` in the base map's own sea colour, so neighbouring countries are simply not
there; it reads as open sea. The cover sits under the base map's labels, so a coastal name that
reaches out over the sea isn't cut off, and the labels are limited to Japan's area (a `within`
filter on each label layer), so foreign names stay hidden too. All of this is done to the style
before the map is made (`src/map/baseStyle.ts`): the app fetches the style file, adds the cover in
the style's own sea colour and the label filters, and hands MapLibre the result, so the first frame
is already final and nothing flashes (no other countries, no wrong sea colour). Our layers go in at
their places as they are added (`beforeId`): the hillshade and prefecture colours under the base
map's water, the prefecture borders from its tiles under the cover, the prefecture outline under
its labels. A selected prefecture is drawn in full detail, not with the simplified shape: its own
file (`prefectures/<code>.geojson`) loads when it is selected. The file has its area (coast to
about 25 m) and its land borders with its neighbours (to about 5 m). The land borders are outlined
at every zoom. The coast is outlined only while zoomed out, and the tint fades by zoom 14.5. The
outline is the government's survey (N03) and the base map is OpenStreetMap, and close in the two
are metres apart, so there the base map's own coastline marks the coast. For the same reason the
base map's prefecture borders step back from zoom 11 to 12 while a prefecture is selected in
detail, so only one border line shows. (The style's own copy of prefecture borders is left out
altogether; the map draws them from the same tiles itself.) The tiles still arrive in patches, so a map stays hidden over the style's sea colour
until its first complete frame and then fades in (`useReveal`; after 6 seconds it shows anyway, in
case tiles fail). The same goes for the year maps on the compare page. The view is locked to that area plus about 150 km of the
same open sea on every side (`meta.map.bounds`), so Japan never has to sit against the edge of the
window, and the map can't be moved or zoomed out further. The base map's tiles still come from its
own server, and only for what is in view.

`jam build` works the area out from the detailed prefecture outlines
(`packages/cli/src/build/japan-area.ts`): the land is drawn on a grid of about 1 km, widened by
20 km from the coast cells, enclosed sea is filled in, the edge is traced, and its grid steps are
smoothed away (moving it by at most 0.5 km). Measured against the coastline, the edge ends up
between 18.7 and 21.4 km out, 99% of it within 19.2 to 21 km. It takes about 0.4 s, and the file is
about 20 KB compressed. The nearest foreign coasts are well beyond that: Sakhalin is 43 km from
Hokkaido, Korea about 50 km from Tsushima. The boundaries come from the national land data, so the
Northern Territories count as part of Hokkaido and are shown.

## Terrain

`map.terrain` in `config/site.jsonc` takes either a TileJSON address (`sourceUrl`), which carries
its own encoding and credit, or a tile address (`tiles`, with `{z}`, `{x}` and `{y}`) with its
`encoding` (`terrarium` for most free sources, `mapbox` for Terrain-RGB), `tileSize`, `maxzoom` and
the `attribution` the provider asks for, which is required with `tiles`. The example file has
Mapzen's Terrain Tiles on AWS Open Data, which are free and need no key:

```jsonc
"terrain": {
  "enabled": true,
  "tiles": "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
  "encoding": "terrarium",
  "maxzoom": 15,
  "attribution": "<a href=\"https://github.com/tilezen/joerd/blob/master/docs/attribution.md\">Mapzen Terrain Tiles</a>"
}
```

The map uses the tiles twice, as one source for 3D relief and another for hillshade, which is how
MapLibre works best. A wrong `encoding` gives no error, just wrong heights: flat or spiky relief
means it should be the other one.

## Code

| File                                                | What                                                                                                                                                         |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/App.tsx`                                       | The layout: top bar, pane, map                                                                                                                               |
| `src/data.ts`                                       | Loads and checks the start files, builds the lookups                                                                                                         |
| `src/filters.ts`                                    | The filter state, its address form, and `derive`: every result                                                                                               |
| `src/store.ts`                                      | The main store (Zustand): list, selection, filters, layers, sheet stop, language                                                                             |
| `src/hover.ts`                                      | The hovered item, shared by rows and pins without re-rendering (a small store of its own)                                                                    |
| `src/index.css`                                     | Tailwind, the theme's colours (light and dark), Base UI variants, MapLibre's stylesheet                                                                      |
| `src/components/ui/*`                               | shadcn/ui components on Base UI (`components.json` for adding more)                                                                                          |
| `src/components/app.tsx`                            | The app's rows, badges, chips, titles and sort menus                                                                                                         |
| `src/components/VirtualRows.tsx`                    | Rows that render only what is in view, and bring a row into focus                                                                                            |
| `src/i18n.ts`, `src/i18n-ja.ts`                     | `t()`, `localized()` and the Japanese for every interface string                                                                                             |
| `src/hooks/use-mobile.ts`                           | Whether the window is phone-sized (the sheet, the Layers sheet)                                                                                              |
| `src/map/viewport.ts`                               | The map's bounds, for "Only what's on the map" (the switch is remembered)                                                                                    |
| `src/map/LoadingLine.tsx`                           | The loading line and note over the map                                                                                                                       |
| `src/map/MapKey.tsx`                                | The map key in the map's bottom-left corner                                                                                                                  |
| `src/map/baseStyle.ts`                              | The base map's style, made ready for Japan before the first frame (cover, sea colour, label filters)                                                         |
| `src/profile.ts`                                    | A track's points, heights, gradients and splits; where its profile and the map point along it                                                                |
| `src/panel/TrackAnalysis.tsx`                       | An activity's height profile, gradient bar, steepest parts and splits                                                                                        |
| `src/goals.ts`, `src/tiles.ts`                      | Records, streaks, milestones, trips to what is left; explorer tiles and their scores                                                                         |
| `src/pages/GoalsPage.tsx`                           | The Goals page                                                                                                                                               |
| `src/pages/shareCard.ts`                            | A year's figures as a picture to share                                                                                                                       |
| `src/panel/RouteTimes.tsx`                          | A route's times: every run by date and speed, the median and the fastest                                                                                     |
| `src/pages/PrefectureMap.tsx`                       | The small prefecture map with the Okinawa inset                                                                                                              |
| `src/url.ts`                                        | Keeps the address and the store in step, and remembers the last view                                                                                         |
| `src/prefs.ts`                                      | Local storage: `usePref`, a remembered `useState`, and the storage the stores share                                                                          |
| `src/lists.ts`                                      | Region groups, progress                                                                                                                                      |
| `src/search.ts`                                     | The search index and matching                                                                                                                                |
| `src/lazy.ts`                                       | Loads tracks and route geometry when the view needs them                                                                                                     |
| `src/shell/*`                                       | Top bar, list picker, search, Layers menu, filter chips on the map                                                                                           |
| `src/panel/Pane.tsx`                                | The pane and the phone sheet (stops, drag, focus, `Esc`)                                                                                                     |
| `src/panel/*`                                       | List overview, filter panel and its controls, results, details                                                                                               |
| `src/map/MapView.tsx`                               | The map itself: hover, click priority, camera and the view lock                                                                                              |
| `src/map/MapLayers.tsx`, `src/map/useMapSources.ts` | The layer groups, and the data each one draws                                                                                                                |
| `src/map/palette.ts`                                | Status and type colours (Okabe–Ito), the status markers                                                                                                      |
| `src/map/HoverTip.tsx`                              | Tooltips for places and prefectures                                                                                                                          |
| `src/pages/*`                                       | The chart pages and their SVG parts, loaded on demand                                                                                                        |
| `dev/check-web.tsx`                                 | The pane rendered under Node for every list, filter and selection, as a wide screen and as a phone; the example queries checked against an independent count |

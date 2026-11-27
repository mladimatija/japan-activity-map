# Demo data

`pnpm jam demo` makes a complete, believable site out of made-up activities, so you can see what
the project does before you connect Strava or fill in a sheet.

Everything in it is made up. No track comes from a real person, from Strava or from a GPX
site. The home is Tokyo Station and the workplace a point by the bay at 豊洲: nobody's address. The
race names are invented and aren't real events. The summits, temples, castles and routes are real
places from the committed lists; the visits to them aren't real.

## Try it

```sh
pnpm install
pnpm jam demo        # about 10 seconds: writes data/demo and builds it
pnpm demo:web        # http://localhost:5183, showing the demo
```

The site shows a "Demo data" badge (デモデータ in Japanese) in the top bar for as long as it is
looking at demo data.

```sh
pnpm jam demo --seed 7                # another made-up history; the default seed is fixed
pnpm jam demo --until 2026-06-30      # last day of the history (default: today in Japan)
pnpm jam demo --years 3               # years of history (default 5, at most 10)
pnpm jam demo --lang ja               # activity names in Japanese (default en)
pnpm jam demo --dry-run               # say what would happen, write nothing
pnpm jam demo --clear                 # delete the demo
```

Running `pnpm jam demo` again replaces the demo. The same seed, end date, years and language give
the same sheet and the same GPX files, byte for byte. Dates are laid out backwards from the end
date, so a new demo always looks current; an old one goes stale and one command renews it.

## What is in it

Five years of about 150 activities each (a quieter first year, and six weeks of walks only in the
third, as after an injury):

- Runs from home: laps of the Imperial Palace moat, the 隅田川, loops through new streets, long
  runs along the 荒川. The same courses many times, in both directions and with a shorter variant,
  so the Repeats page and route grouping have something to show, and times improve over the years.
- Rides: the 多摩川 to 二子玉川, 府中 or 羽村 (over 100 km), the 荒川, and commutes to work.
- Races tagged `race` at 5 km, 10 km, half marathon and marathon distances, for the records.
- Hikes to about forty 百名山 and other list summits: Kanto first, then the Alps, Kansai and
  Shikoku, then Tohoku, Hokkaido and Kyushu, so each year breaks new ground. A few two-day trips
  with a night at a hut, 高尾山 many times, and trail runs.
- Stretches of committed route lists: しまなみ海道 end to end, half of ビワイチ over two
  outings, つくば霞ヶ浦りんりんロード, 熊野古道, stages of the 関東ふれあいの道, 九州オルレ, a start on
  フジイチ. Walks to castles, temples and waterfalls of the lists.
- Rows that aren't ordinary: two DNS hikes that turned back below the summit, six summits
  marked `want`, treadmill runs without GPS, a hidden row, a run in Seoul and a walk above Taipei
  (left out of the map of Japan, with the reason in the build summary).
- Two privacy zones, home and work, so cut tracks and activities that lie entirely inside a
  zone both show.

Every track has a height and a time at each point, so height profiles, gradient, splits, pace and
the timed records work. Every activity's source is the sheet: nothing is shown under Strava's
name, and there are no Strava ids or links.

## Where it lives, and what keeps it apart

```
data/demo/              git-ignored, like the rest of data/
  demo.json             the marker: seed, end date, years, language
  jam.sqlite            the demo store, carrying the same marker
  config/               generated: the example settings, a demo title, the two zones; no secrets
  source/sheet.csv      the generated sheet (a worked example of templates/README.md)
  source/tracks/*.gpx   the generated tracks
  dist/data/            the demo build; its meta.json has "demo": true
  logs/
```

- `jam demo` runs the ordinary pipeline (`sync sheet`, then `build`, which matches, groups routes,
  applies the zones and audits) as child processes with `JAM_DATA_DIR` set to the demo folder. Your
  own store in `data/jam.sqlite` is never opened by a demo run, and nothing is written to
  `config/` or `dist/`.
- The demo build goes to `data/demo/dist/data`, never to `dist/data`, which is what gets
  published. `pnpm web:dev` keeps showing your own build; the demo is shown only when asked for,
  with `pnpm demo:web` (or `JAM_WEB_DATA=<folder> pnpm web:dev`).
  `demo:web` uses its own port, so what the browser remembers for the demo (saved views, the
  km / mi and language choices) is kept apart from your real site's on port 5173. The year's
  share picture is marked "Demo data" too.
- On the demo store, `jam status` and `jam build` say so, and these refuse: `strava auth`,
  `sync strava`, `deploy`, `update`, `build` into `dist/data`, and `sync sheet` with a file from outside the
  demo folder. A build of your own data refuses to replace a folder that holds a demo build.
- `jam audit` passes demo output (it isn't private) but prints a warning that it is demo data.
- `jam demo --clear` deletes `data/demo` only, and only when its `demo.json` says it is demo
  data. `jam demo` itself refuses to write into a folder that has files but no such marker.
- `jam status` on your own store mentions a demo lying beside it.

To move to your own data there is nothing to migrate: set up Strava or a sheet as the README says,
run `pnpm jam build`, and `pnpm web:dev` shows it. `pnpm jam demo --clear` removes the demo.

To work on the demo store by hand (for example `jam zones` or `jam routes`):

```sh
JAM_DATA_DIR=data/demo pnpm jam --config data/demo/config status
```

## How the tracks are made

No routing engine or elevation data is used, and nothing is downloaded.

- Route lists: a track follows the committed line of the route, moved by a few metres as a GPS
  track is. These look right at any zoom. The 五街道 are never used: their files aren't committed,
  so a fresh clone gives the same demo.
- Home courses: hand-drawn lines along the moat, the rivers and the bay, with rounded corners.
  They follow the real roads roughly, not exactly.
- Summits: a wandering line from a point a few kilometres below the summit up to its list
  coordinates and back the same way. This is the weakest part: it looks like a path at the zoom the
  site opens at, and plainly drawn against a real trail map.
- Heights are a model: fixed at the trailhead and the summit, with hills between. They aren't
  the ground, so with 3D terrain on a track floats or sinks. The demo config leaves terrain off.
- Times follow the type and the slope: walking by Tobler's hiking function, running and
  riding slower uphill and a little faster down, a few percent of drift, short stops, a long rest
  on a summit, a night at a hut.

A route item ridden or walked end to end also names the item in the sheet's `place` column, as a
person who finished it would, because a track alone seldom reaches the share that counts as done on
a route drawn in many short pieces.

The privacy zones of a store are normally moved once in a random direction. The demo fixes the
move, so the same demo cuts its tracks at the same points on every machine. Public ids and the
build time still differ from run to run.

## Code and checks

| File                                   | What                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `packages/cli/src/demo/rng.ts`         | The seeded generator                                                |
| `packages/cli/src/demo/track.ts`       | Lines, GPS drift, the height and pace models, the GPX writer        |
| `packages/cli/src/demo/story.ts`       | The made-up home, the hand-drawn courses and the trips of each year |
| `packages/cli/src/demo/names.ts`       | Every activity name, in English and Japanese                        |
| `packages/cli/src/demo/lists.ts`       | Places and route lines read from `lists/`                           |
| `packages/cli/src/demo/generate.ts`    | The history: schedule, sheet rows and tracks                        |
| `packages/cli/src/demo/index.ts`       | The folder, the generated config, the pipeline run, `--clear`       |
| `packages/cli/src/demo/marker.ts`      | The marker in the store and the folder                              |
| `packages/web/src/shell/DemoBadge.tsx` | The badge                                                           |

`pnpm check:demo` runs the demo in a temporary folder (never `data/`) on lists without the 五街道
files, and checks that two runs give the same files, the counts per year and type, list and route
content, races, the marker, the warning, every refusal above and `--clear`.
`pnpm check:web:demo` builds a demo in a temporary folder and runs the web check against it, so
the web check can run on a fresh clone. `JAM_DEMO_DIR` puts the demo folder somewhere else than
`data/demo`; the checks use it.

## The demo site

The repository can host its own demo: the whole site over demo data, on its own GitHub Pages, so
someone reading the code can click through a working map without installing anything.

```sh
pnpm demo:site          # jam demo, the web app, and both put together in dist-demo/
pnpm demo:site --keep   # only put together what is already built
```

`dist-demo/` is a complete static site (git-ignored). The page carries its content security policy
as a `<meta>` element, since GitHub Pages sends no headers of a site's choosing, and it says "Demo
data" in the top bar like every view of the demo. The script refuses a data folder that isn't
marked as the demo's, so it can't put your own build there.

`.github/workflows/demo-site.yml` runs it on every push to the default branch, once a week (the
demo's history ends "today") and on request, and publishes the folder with GitHub's own Pages
actions. It uses no secrets and no token of yours. It is off until the repository asks for it:

1. _Settings > Secrets and variables > Actions > Variables_: add `DEMO_SITE` with the value `true`.
2. _Settings > Pages > Build and deployment > Source_: choose **GitHub Actions**.
3. Push, or run "Demo site" from the Actions tab. The address is
   `https://<owner>.github.io/<repository>/`; for this repository,
   <https://mladimatija.github.io/japan-activity-map/>.

While a repository is private, GitHub Pages needs a paid plan (Pro or above), and a site published
from a private repository is still public. On a free plan the demo site starts working when the
repository is made public.

Repository variables aren't copied to forks or to a clone pushed elsewhere, so only a repository
whose owner set the variable publishes a demo. To stop, delete the variable.

This is separate from `pnpm jam deploy`, which publishes your own site and still refuses demo
data. A repository has one Pages site: if the demo is on this repository's Pages, publish your own
map on Cloudflare Pages or Netlify, or with `deploy.host` `github` and another `repository`
(docs/deploy.md).

# Development helpers

Not part of the `jam` command; nothing here runs in normal use.

## Fake Strava

`fake-strava.ts` stands in for the Strava API (sign-in, activity list, streams and rate-limit
headers) with made-up activities, so the Strava sync can be tried without an account or network.

```sh
pnpm check:strava                                     # all Strava sync checks, in a temporary folder
node packages/cli/dev/fake-strava.ts --port 8724      # just the server
```

To try commands by hand, point a copy of the config at it:

- `config/strava.jsonc`: `api.baseUrl` `http://127.0.0.1:8724/api/v3`, `api.oauthUrl`
  `http://127.0.0.1:8724/oauth`
- `config/secrets.jsonc`: any `clientId`, `clientSecret` `"fake-secret"`

and run with `--config <that folder>` and these environment variables:

| Variable            | Effect                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `JAM_DATA_DIR`      | Use this folder instead of `data/` (store, token, backups, logs) |
| `JAM_NO_BROWSER=1`  | `strava auth` prints the sign-in address instead of opening it   |
| `JAM_SLEEP_SCALE=0` | Skip the waits for rate limits and retries (any factor works)    |

Send JSON to `POST /__control` to make the server fail or change; the options are listed at the
top of `fake-strava.ts`. The checks end with a pull of one range of days: what it reports, what
`--full` removes, and that the next plain pull is still an incremental one. Then full tracks from
exported files (`--tracks-from`): matched by the id in the name, by `activities.csv` and by start
time, a file for an unknown id reported, full tracks left alone without `--replace`, a gzipped
file from an account export matched through its list, and files refused for starting on another
day than their activity or for having their ends cut off.

## Shared check harness

`harness.ts` is what the checks below share: `sandbox(name)` makes a temporary data and config
folder (the example configs copied in), runs `jam` there (`jam` throws on failure, `jamResult`
returns the exit code and output), writes fixtures, prints PASS/FAIL lines and, at `finish()`,
exits 1 and keeps the folder if anything failed.

## Matching checks

`check-match.ts` writes made-up activities with `match-fixtures.ts` (a sheet and GPX tracks), imports
them into a temporary data folder and checks the matches. Run it with `pnpm check:match`.
`node packages/cli/dev/match-fixtures.ts <folder>` writes just the fixtures.

## Route grouping checks

`check-routes.ts` writes made-up runs around 東京駅 with `route-fixtures.ts` (two loops from one
start, a run from A to B and back, a shorter variant), imports them into a temporary data folder and
checks the grouped routes, including the routes file. Run it with `pnpm check:routes`.

## GPX import checks

`check-gpx.ts` writes made-up GPX files around 東京駅 into a temporary data folder, some loose, some
in a subfolder and some in an archive made by `zip-writer.ts` (a tiny zip writer, also used by the
unit tests). It imports them from the folder and from an archive, twice, with `--replace` and
through `gpx wipe`, feeds it archives that must be refused, and builds the site from Strava, from
GPX files and from Strava again, checking the source of every published activity and route. Run it
with `pnpm check:gpx`.

## Garmin checks

`fake-garmin.ts` stands in for the Garmin Connect Personal API: the key-for-token exchange, the
paged activity list and each activity's file, a FIT file written by `fit-writer.ts` (Garmin's FIT
SDK) inside a zip. `check-garmin.ts` starts it on a spare port and runs `jam sync garmin` against
it in a temporary folder: a missing and a refused key, a dry run, the first pull and the ones
after, a new and a renamed activity, Only Me activities, being told to slow down part of the way
through, an expired token, `garmin wipe` with the same public ids afterwards, a full pull that
removes what is gone, and a build from Garmin. It also covers a pull of some days (`--from`,
`--to`), Garmin counting days by either clock, gateway timeouts on files and on list pages, a
token sent as plain text, a recording sent unzipped, a file Garmin refuses, and a `Retry-After`
that is waited out or, when it is an hour, ends the run. Run it with `pnpm check:garmin`. To try it by hand:

```sh
node packages/cli/dev/fake-garmin.ts --port 8726    # accepts the key "good-key"
```

and point `activities.garmin.api.baseUrl` in a sandbox's `site.jsonc` at `http://127.0.0.1:8726`.

## Privacy checks

`check-privacy.ts` reuses the route fixtures with a home zone at their start and an office zone on
the way from A to B, writes a small output folder the way the build will, and checks the cuts, the
publish rules, the Strava link option and the audit. Run it with `pnpm check:privacy`.

## Build checks

`check-build.ts` builds the match fixtures with a privacy zone twice into a temporary folder and
checks every file against its schema, the size budget, that the builds are identical apart from
the build time, and that a failed audit, an over-budget build or a dry run leaves the output as it
was. Run it with `pnpm check:build`.

## Demo checks

`check-demo.ts` runs `jam demo` (docs/demo.md) in a temporary folder, on a copy of the lists
without the 五街道 files, and checks that the same seed gives the same sheet and tracks, what the
history contains, the marker in `meta.json`, the audit warning, the commands that refuse on the
demo store, and that `--clear` deletes only a demo folder. Run it with `pnpm check:demo`.
`JAM_DEMO_DIR` puts the demo folder somewhere else than `data/demo`.

## Progress

A command run by the setup wizard as a process of its own gets `JAM_PROGRESS=1` and prints its
progress as lines starting `@@jam-progress`, which the wizard turns back into a bar.

## Deploy checks

`check-deploy.ts` runs `jam deploy`, `jam update` and `jam schedule` (docs/deploy.md) in a
temporary folder for each host: `fake-wrangler.ts` and `fake-netlify.ts` in place of the uploaders
and a bare repository in place of GitHub, all three named in one JSON file that
`JAM_DEPLOY_STAND_INS` points at, so nothing is uploaded. Deploy says so every time it uses one. It checks what deploy refuses, the `_headers` file
or the policy in the pushed page, that a token is passed in the environment and never printed or
logged, that a folder failing the audit isn't published, that a code branch is never pushed over,
and that `update` stops at the first failing step. Run it with `pnpm check:deploy`.
`JAM_DEPLOY_NO_LOOKUP` stops deploy reading the map style over the network, and `JAM_UPDATE_DIST`
points `update` at another folder than `dist` (the web app is then not built).

## Setup checks

`check-setup.ts` runs `jam setup` from answers files against the fake Strava server, in a temporary
folder that starts with only the example configs: the files it writes are valid and keep the
example comments, secrets stay out of logs, state and output, `--change` touches one key, a dry
run writes nothing, and a run that fails half-way continues on the next run. Run it with
`pnpm check:setup`. `JAM_SETUP_BUILD_OUT` makes the wizard's build step write somewhere else than
`dist/data`; only the checks set it.

`check-setup-web.ts` starts `jam setup --web` the same way and checks the server from outside: no
token, a used token, a wrong `Host` or `Origin` and a POST without the page's header are refused;
only listed actions run; no path leaves the page's folder; no response, event or log line holds
the secret; applying answers writes the same files as the terminal wizard; shutdown stops it. Run
it with `pnpm check:setup-web`. `JAM_SETUP_BUNDLE` points the server at a stand-in page, so the
check doesn't need the web build.

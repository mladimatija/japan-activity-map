# YAMAP

`pnpm jam sync yamap` fetches your own YAMAP activities and their tracks, so you don't have to
export each one by hand. It keeps them in the local store beside whatever came from Strava,
Garmin or files, and `activities.source` says which of them the site is built from.

Read this part first.

YAMAP has no official way to do this. There is no public API and no key to ask for. The command
talks to the same web API that yamap.com uses in your browser, and signs in with the token your
browser got when you signed in. That has three consequences:

- It can stop working whenever YAMAP changes its site. Nothing is lost when it does; the
  activities already fetched stay in the store.
- YAMAP's terms of service don't mention this kind of use either way. They let you reuse your own
  posted data on your own site and tell you to keep your own backups, and they also let YAMAP
  restrict an account that uses the service in a way it doesn't provide for. Fetching your own
  tracks slowly for your own map is in the spirit of the first; whether it falls under the second
  is YAMAP's call. If that matters to you, ask YAMAP before using this, or keep exporting GPX
  files by hand and use `pnpm jam sync gpx` (docs/gpx.md). This isn't legal advice.
- The token works like a password for your YAMAP account. It's kept only in
  `config/secrets.jsonc`, which is git-ignored and readable only by you, and it's sent only to
  YAMAP. It is never printed, logged or put in the built site.

Only your own activities are fetched, one request at a time with a pause between them. Photos,
journal text and other people's activities aren't touched.

## 1. Find your user id

Open your profile on yamap.com. The address looks like `https://yamap.com/users/1234567`; the
number is your user id.

## 2. Copy the sign-in token

1. Sign in at <https://yamap.com> in your browser.
2. Open the developer tools (F12, or right-click and Inspect).
3. Go to Application (Chrome, Edge) or Storage (Firefox, Safari), then Cookies, then
   `https://yamap.com`.
4. Find the cookie named `yamap_token` and copy its value.

## 3. Store both

The setup wizard asks for them, in the terminal or on the page:

```sh
pnpm jam setup          # choose YAMAP under "Where activities come from"
pnpm jam setup --web    # the same in your browser
```

The token field doesn't show what you paste. Or do it by hand: the user id goes in
`config/site.jsonc`, and one command stores the token:

```jsonc
"activities": {
  "source": "yamap",          // build the site from YAMAP
  "yamap": { "userId": "1234567" }
}
```

```sh
pnpm jam yamap token              # paste the token; it isn't shown
pbpaste | pnpm jam yamap token    # or pipe it in from the clipboard (macOS)
```

`yamap token` takes the value however you copied it (bare, as `yamap_token=…`, or a whole cookie
line), stores it in `config/secrets.jsonc` and tries it straight away. For a scheduled run you can
set `JAM_YAMAP_TOKEN` in the environment instead.

`pnpm jam yamap check` tries the user id and the token at any time without storing anything.

## 4. Pull

```sh
pnpm jam sync yamap --dry-run      # what would change
pnpm jam sync yamap                # the list, then the first tracks
pnpm jam sync yamap --tracks all   # every track still missing, however many
pnpm jam sync yamap --full         # read the whole list again
pnpm jam sync yamap --from 2026-01-01 --tracks all   # only this year
pnpm jam sync yamap --last 30d     # only the last 30 days
```

A pull has two halves.

The list comes first, a page at a time: each activity's name, start, distance and climb as YAMAP
gives them. YAMAP lists the newest first and has no "since", so a plain pull stops at the first
page with nothing new on it. That order is checked on every page; a list in any other order is
read to its end.

Then the tracks. Each activity's recording is YAMAP's own GPX export, one request each, so a run
fetches at most `tracksPerSync` of them (100 unless you set it), newest first, and the next run
carries on. Until its track is fetched an activity counts as one without GPS and is left off the
map. The track is read like any GPX file: GPS jumps are left out and the moving time is worked out
from the points (docs/gpx.md). YAMAP's own distance and climb are kept.

`--from`, `--to` and `--last` work as for Strava and Garmin: this run only, the settings untouched,
and the next plain sync unaffected.

## When the token expires

The token lasts until YAMAP signs that browser out: when you sign out there yourself, or after
however long YAMAP keeps a session. You can't refresh it; you copy a new one.

You'll know, because every place that could notice says so:

- `pnpm jam sync yamap` still brings in the list, then stops asking for tracks and ends with an
  error that says the token was refused and how to renew it. No activity is marked as having no
  track because of it; they wait.
- `pnpm jam update` (the weekly run) goes on and builds with what there is, then ends as a failure
  with the same reminder, so a scheduled job is seen to need you.
- `pnpm jam status` shows the day YAMAP last refused the token.
- The setup page and `pnpm jam setup --change source:yamap` open with a notice above the token
  field.

To renew: sign in at yamap.com again, copy the `yamap_token` cookie as in step 2, and run
`pnpm jam yamap token` (or paste it into the setup page). The next sync fetches the tracks that
were waiting.

## Settings

In `config/site.jsonc`, under `activities.yamap`:

| Setting         | Default | What it does                                                       |
| --------------- | ------- | ------------------------------------------------------------------ |
| `userId`        | none    | The number in your profile address                                 |
| `from`, `to`    | none    | First and last day to fetch, `YYYY-MM-DD`                          |
| `defaultType`   | `hike`  | YAMAP doesn't say what kind of activity a recording is; all get it |
| `tracksPerSync` | 100     | Tracks downloaded per run                                          |
| `api.pauseMs`   | 2000    | Milliseconds between two requests; it grows when YAMAP is slow     |

## Good to know

- Private activities. The list is what YAMAP shows for your profile. Whether activities you've
  set to private are in it when the token is sent hasn't been confirmed; if some are missing,
  export those by hand and use `pnpm jam sync gpx`.
- Edits. A rename on an old activity is past where a plain pull stops reading. `--full` reads the
  whole list, picks it up, and removes activities YAMAP no longer has, after copying the store to
  `data/backups`.
- Activities without a recording (a photo-only entry) are stored without a track and aren't
  asked for.
- Two-day recordings are one activity, dated by its first point (docs/gpx.md).
- The same outing in two sources. An activity recorded in both YAMAP and Strava is two activities
  in the store. Only one is published, because the site is built from one source.
- Limits. There is never more than one request under way, each waits `api.pauseMs` after the one
  before, and the wait doubles when YAMAP fails to answer. A track that gets no answer is left for
  the next run; after five in a row the run ends, keeping what it has.
- `pnpm jam yamap wipe --yes` deletes the YAMAP activities from the store, after a copy, and
  nothing else. A fresh pull gives them the same ids, so links to them keep working.

## Trying it without YAMAP

`pnpm check:yamap` runs the sync against a stand-in server with made-up activities
(`packages/cli/dev/fake-yamap.ts`): the list, the tracks, an expired token and its renewal, a
range of days, timeouts, and a build. Thanks to
[yamap-export](https://github.com/akiyama709/yamap-export) for showing which requests are needed.

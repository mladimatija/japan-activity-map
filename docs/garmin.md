# Garmin Connect

`pnpm jam sync garmin` reads your activities from Garmin Connect through Garmin's Personal API, with
a key you create for yourself. Nothing is shared with anyone else: the key stays on your machine,
and Garmin lets it read your own account only.

It is a third source beside Strava and GPX files. The store can hold all three; `config/site.jsonc`
says which one the site is built from.

## What you need

- A Garmin Connect account with activities in it.
- A personal API key. It's free and needs no approval.

## 1. Create a key

1. Sign in to Garmin Connect on the web and open
   [Settings, Personal API Key](https://connect.garmin.com/app/settings/personalApiToken).
2. Choose Create Key, read and accept the terms, and pick how long the key lasts: 30, 90 or 180
   days, or one year.
3. Copy the key. Garmin shows it once.

Garmin's terms for the key are short: it is for your own tools, it may not be shared, and Garmin
may limit how often it is used.

## 2. Put it in `config/secrets.jsonc`

Copy `config/secrets.example.jsonc` to `config/secrets.jsonc` (git-ignored) if you haven't, and add:

```jsonc
{
  "garmin": {
    "apiKey": "…",
  },
}
```

`pnpm jam setup` does the same: choose Garmin under "Where activities come from" and type the key,
which is not shown as you type (docs/setup.md). For a scheduled run you can set `JAM_GARMIN_API_KEY` in the environment instead; it wins over the
file. The key is never printed or logged.

```sh
pnpm jam garmin check     # asks Garmin for one page of activities and says whether the key works
```

## 3. Choose what to fetch

In `config/site.jsonc`, under `activities`:

```jsonc
"activities": {
  "source": "garmin",
  "garmin": {
    // "from": "2024-01-01",   // first day to fetch; left out, everything
    // "to": "2026-12-31",
    "includePrivate": false,   // also fetch activities set to Only Me
    "filesPerSync": 100,       // recordings downloaded per run
    // "typeMap": { "backcountry_skiing": "hike" }
  },
},
```

Garmin has many activity types; this project keeps five. Running, trail running, hiking, walking
and cycling in their variants are mapped for you (`packages/cli/src/garmin/types.ts`). Anything
else, such as yoga or swimming, is skipped and counted in the summary; `typeMap` adds a Garmin type
key to one of the five.

## 4. Pull

```sh
pnpm jam sync garmin --dry-run     # what would change
pnpm jam sync garmin               # the list, then the first recordings
pnpm jam sync garmin --files all   # every recording still missing, however many
pnpm jam sync garmin --full        # list everything again
pnpm jam sync garmin --from 2026-01-01 --files all   # only this year, with its recordings
pnpm jam sync garmin --last 30d    # only the last 30 days
```

`--from` and `--to` take a day as YYYY-MM-DD, by the activity's local start, and either works alone.
`--last` takes `30d`, `6w`, `3m` or `1y` instead of `--from`. They apply to this run only: the
list and the recordings are both limited to those days, the settings stay as they are, and the
next plain sync carries on as if this pull had not happened. They narrow `from` and `to` in the
config and never reach outside them. With `--full`, activities in those days that Garmin no longer
has are removed, after a copy of the store; nothing outside them is touched.

A pull has two halves.

The list comes first: one request per 99 activities, with each one's name, type, start, distance,
times and climb. A later pull asks only for what started in the week before the last one, or since, so
running it twice changes nothing.

Then the recordings. The list has no track, so each activity's own file is downloaded (a FIT file
from a Garmin device, read with Garmin's FIT SDK) for its points, heights and times. That is one
request per activity, so a run fetches at most `filesPerSync` of them, newest first, and the next
run carries on. Until its file is fetched an activity has no track: it counts as one without GPS
and is left off the map.

- Settings. After you change `includePrivate`, `from`, `to` or `typeMap`, the next pull lists
  everything again, so the change reaches old activities too.
- Edits. A rename or a changed type on an old activity is outside what a later pull asks for. A
  full pull (`--full`) picks it up, and also removes activities Garmin no longer has, after copying
  the store to `data/backups`.
- Indoor sessions. A treadmill run has no positions, so it has no track. Where Garmin says so in
  the list, its file isn't asked for.
- Files that give nothing. A file Garmin refuses, or one with no track in it, is noted on its
  activity and not asked for again. A full pull asks again.
- Only Me. Activities whose privacy on Garmin Connect is Only Me are skipped unless
  `includePrivate` is on; then they are stored as such, and published only with
  `publish.includeOnlyMeActivities` (docs/privacy.md). An activity you set to Only Me after it was
  fetched is removed by the next pull that lists it, which means within a week; for an older one,
  run a full pull.
- Limits. Garmin doesn't publish its limits, and it throttles. There is never more than one
  request under way, and each waits `activities.garmin.api.pauseMs` (2 seconds unless you set it)
  after the one before. Every time Garmin fails to answer, the wait doubles, up to 30 seconds; it
  comes back down as the answers return. If Garmin says outright to slow down, the run keeps what
  it fetched, says so, and the next run carries on. A first pull of 1,500 recordings takes about
  an hour at this pace.
- Timeouts. Garmin's servers sometimes answer "gateway timeout" (HTTP 504), mostly on a long
  first pull. Each request is tried four times. A recording that still gets no answer is left for
  the next run and the others go on, more slowly; after five in a row the run ends, keeping what
  it has. A list page that gets no answer is asked for again in smaller pieces. If it keeps
  happening, raise `api.pauseMs` to 5000 or more, or pull a stretch at a time with `--from` and `--to`.
- The key's date. A key lasts at most a year, and Garmin emails you about a week before it ends.
  When Garmin refuses the key, the command says so and how to make a new one.
- Weekly runs. With `activities.source` set to `garmin`, `pnpm jam update` fetches from Garmin
  instead of Strava (docs/deploy.md).

## Building the site from Garmin

```jsonc
{ "activities": { "source": "garmin" } }
```

`pnpm jam build` then publishes the Garmin activities and the sheet's own rows, and leaves Strava
and GPX activities out, listing them under "Left out". Switch back and build again to get the other
site; switching deletes nothing. On the site the Source filter offers "Garmin", and a Garmin
activity never carries a link to Garmin Connect.

The same outing synced from your watch to both Garmin and Strava is two activities in the store.
Only one is published, because the site is built from one source.

## Starting over

```sh
pnpm jam garmin wipe          # what would be deleted
pnpm jam garmin wipe --yes    # delete Garmin activities and their tracks, after a copy
pnpm jam sync garmin --full --files all
```

An activity keeps its public id, and its place in a grouped route, through a wipe and a fresh pull.

## FIT files without the API

`pnpm jam sync gpx` reads `.fit` files too, alone or in a `.zip`, so Garmin's full account export
or files copied from a watch can be imported from a folder (docs/gpx.md). Those count as the GPX
source, not as Garmin.

## When something fails

| Message                               | What to do                                                   |
| ------------------------------------- | ------------------------------------------------------------ |
| `No Garmin personal API key`          | Create one (step 1) and put it in `config/secrets.jsonc`     |
| `did not accept the personal API key` | The key is wrong, deleted or past its date: create a new one |
| `Garmin Connect is limiting requests` | Run it again later; it carries on                            |
| `Could not reach Garmin Connect`      | Network; run it again                                        |

## Trying it without Garmin

`pnpm check:garmin` runs the whole flow against a stand-in for the API
(`packages/cli/dev/fake-garmin.ts`) in a temporary folder: no key, no network.

This project is not affiliated with Garmin. It uses the Personal API under your own key and
Garmin's terms, and Garmin's FIT SDK under the FIT Protocol License.

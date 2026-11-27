# Strava setup

`jam sync strava` reads your activities through the Strava API with an API application that you
register yourself. Nothing is shared with anyone else: the app, its secret and the sign-in token
stay on your machine.

## What you need

- An active **Strava subscription**. Since June 2026 the API only serves subscribers.
- About ten minutes, once.

## 1. Register an API application

1. Go to <https://www.strava.com/settings/api> and create an application.
   - Application name / website / description: anything; it is only shown to you.
   - Authorization Callback Domain: `localhost`
2. New applications start at the **single-athlete level**, which only works through Strava's own
   connector. On the same page, use the self-service upgrade to **"up to 10 athletes"**. Without it
   every request is refused with 403, and `jam` says so.
3. Note the **Client ID** and **Client Secret**.

## 2. Put the credentials in `config/secrets.jsonc`

Copy `config/secrets.example.jsonc` to `config/secrets.jsonc` (git-ignored) and fill in:

```jsonc
{
  "strava": {
    "clientId": "123456",
    "clientSecret": "…",
  },
}
```

## 3. Choose what to import

Copy `config/strava.example.jsonc` to `config/strava.jsonc` and set:

- `import.from` / `import.to`: the first and last day to fetch (leave out for all history).
- `import.activityTypes`: the types to keep; `sportTypeMap` maps Strava sport types onto them.
  Sport types that aren't mapped are skipped and listed after each pull.
- `import.includePrivate`: whether to fetch activities set to **Only You** (see below).

## 4. Sign in

```sh
pnpm jam strava auth
```

A browser opens Strava's consent page; after you approve, Strava redirects to a short-lived server
on `localhost:8723` (change `api.redirectPort` if that port is taken) and the token is saved to
`data/strava-token.json` (readable only by you). On a machine without a browser, open the address
the command prints.

Leave **"View data about your activities"** ticked. With `includePrivate` on, also tick **"View
data about your private activities"**.

| `includePrivate` | Access requested         | Activities fetched               |
| ---------------- | ------------------------ | -------------------------------- |
| `false`          | `read,activity:read`     | Everyone and Followers           |
| `true`           | `read,activity:read_all` | Everyone, Followers and Only You |

`pnpm jam status` shows who is signed in, the access Strava granted and whether it covers the
setting. The access token lasts six hours and is refreshed at the start of each run; Strava may
replace the refresh token, so the file is rewritten each time.

## 5. Pull

```sh
pnpm jam sync strava --dry-run   # what would change
pnpm jam sync strava             # the first pull fetches everything in range
pnpm jam sync strava             # later pulls start at the day of the last successful one
```

- Incremental. Later pulls start at the beginning of the day of the last successful pull and
  update activities by Strava id, so running it twice changes nothing. Strava's list can't tell
  which old activities were edited, so an edit to an activity older than the last pull (a renamed
  hike, a changed type) is picked up only by a full pull: `pnpm jam strava wipe --yes`, then sync.
- Location. Every activity in range is kept, wherever it is. Activities outside Japan are
  tagged when they are matched to places (`pnpm jam match`) and left out of the public site; they stay in
  the local store.
- Settings changes. Changing the types, dates or private option makes the next pull a full one.
- Interruptions. Each page is saved as it arrives. If a pull is interrupted (network, Ctrl-C,
  the daily limit), the next run resumes at the page where it stopped.
- Rate limits. Strava allows a number of read requests per 15 minutes and per day (shown after
  each pull). Close to the 15-minute limit the command waits for the next window; close to the
  daily limit it stops and resumes after midnight UTC. A full pull of 2,000 activities is about
  ten requests.
- Weekly runs. `pnpm jam update` does the whole run, the upload included (docs/deploy.md).
  `pnpm jam sync strava --if-stale 7d` alone does nothing when the last successful pull is newer
  than seven days.
- Tracks. The list includes a simplified track for each activity, without heights or times,
  which is stored. Activities without GPS (treadmill, manual entries) are stored without one. After
  each pull, the sync also fetches the complete GPS samples (heights and times, for height profiles
  and splits) for up to `fullTracksPerSync` (80) activities in Japan, newest first, one request
  each; the next sync carries on. `pnpm jam sync strava --streams missing --limit 400` does a bigger
  batch now, Japan first, waiting out Strava's 15-minute limits (about an hour for 400).
  `--streams 123,456` picks activities by Strava id. Full tracks are kept by later pulls.

## Private activities

- Turning `includePrivate` **on** needs a new sign-in. Until then `jam sync strava` stops and says
  so.
- Turning it **off** removes stored Only You activities on the next sync, after copying the store
  to `data/backups`. The count is reported.
- Privacy zones and publishing rules apply at build time (docs/privacy.md); nothing from Strava is
  published by a sync.

## Starting over

```sh
pnpm jam strava wipe          # what would be deleted
pnpm jam strava wipe --yes    # delete Strava activities and their tracks
pnpm jam sync strava          # full pull with the range and types from config/strava.jsonc
```

The wipe copies the store to `data/backups` first and keeps sheet rows, overrides and route names.
Sheet rows that point at Strava activities (`strava_id`) apply again once those activities are
back; after a full pull, `jam` lists any that point at activities Strava no longer returns.

## When something fails

| Message                                                              | What to do                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Not signed in to Strava`                                            | `pnpm jam strava auth`                                                                                             |
| `Strava refused the sign-in` / `no longer accepts the saved sign-in` | Check `config/secrets.jsonc`; the app may have been revoked under **My Apps** in Strava's settings. Sign in again. |
| 403 mentioning the athlete level                                     | Upgrade the app to "up to 10 athletes" (step 1) and check your subscription                                        |
| `Private activities are on … only covers`                            | `pnpm jam strava auth` and tick the private box, or turn `includePrivate` off                                      |
| `Close to Strava's daily request limit`                              | Run it again after midnight UTC; it resumes                                                                        |
| `Could not reach Strava`                                             | Network; run it again                                                                                              |

Every run is recorded, including failed ones; `pnpm jam status` shows the latest and the last
successful pull. Logs are in `data/logs`.

## Upcoming Strava change

Strava announced a new API address, `https://api-v3.strava.com`, available from 4 January 2027
and required by 1 June 2027. When it is time, change `api.baseUrl` in `config/strava.jsonc`.
Tokens are already sent in headers, as the new address requires.

## Trying it without Strava

`packages/cli/dev/check-strava.sh` runs the whole flow (sign-in, pulls, interruption, wipe,
private option) against a fake Strava server in a temporary folder; see
`packages/cli/dev/README.md`.

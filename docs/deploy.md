# Publishing the site

The site is a folder of files (`dist/`): no server, no database. `pnpm jam deploy` publishes that
folder on one of three hosts, and `pnpm jam update` does a whole weekly run: fetch, group, build,
publish.

Nothing is published that the privacy audit hasn't passed. The local store, the config files, the
privacy zones and everything else in `data/` never leave the computer.

## Choosing a host

Set it in `config/site.jsonc` (`"deploy": { "host": "…" }`) or with
`pnpm jam setup --change deploy`. All three are free for a site like this.

|                             | Cloudflare Pages (`cloudflare`) | Netlify (`netlify`)  | GitHub Pages (`github`)                    |
| --------------------------- | ------------------------------- | -------------------- | ------------------------------------------ |
| How the site gets there     | upload (wrangler)               | upload (Netlify CLI) | `git push` to a branch                     |
| Needs                       | API token and account id        | access token         | the git sign-in this computer has          |
| Address                     | `<name>.pages.dev`              | `<name>.netlify.app` | `<owner>.github.io/<repository>`           |
| Security headers            | yes (`_headers`)                | yes (`_headers`)     | no; the policy goes into the page          |
| Previews (`--branch`)       | yes                             | yes                  | no                                         |
| A private source repository | not involved                    | not involved         | on a free account the repository is public |

Cloudflare Pages is the default. GitHub Pages is the simplest if the repository is on GitHub and
public anyway; it can't send headers, so the site there has no `X-Frame-Options` and its hashed
files aren't cached for long.

## Set up, once

### Cloudflare Pages

1. A Cloudflare account. The free plan is enough.
2. The account id. In the dashboard, open _Workers & Pages_; the account id is in the side
   panel (32 characters, 0-9 and a-f).
3. An API token. _My Profile > API Tokens > Create Token > Custom token_, with one permission:
   _Account > Cloudflare Pages > Edit_, for that account only.
4. In `config/secrets.jsonc` (git-ignored): `"deploy": { "apiToken": "…", "accountId": "…" }`.
5. In `config/site.jsonc`: `"deploy": { "host": "cloudflare", "projectName": "my-japan-map" }`.
   The name is public and has to be free across all of Cloudflare Pages.

### Netlify

1. A Netlify account.
2. An access token. _User settings > Applications > Personal access tokens > New access token_.
   It can do everything your account can; Netlify has no narrower kind.
3. In `config/secrets.jsonc`: `"deploy": { "netlifyToken": "…" }`.
4. In `config/site.jsonc`: `"deploy": { "host": "netlify", "projectName": "my-japan-map" }`, and
   `"team": "…"` (the team's slug) if the account has more than one team.

### GitHub Pages

1. A repository on GitHub that `git push` from this computer already works for. It can be this
   project's own repository: the site goes to a branch of its own (`gh-pages`), never to your code.
   If that repository's Pages already shows the demo site (docs/demo.md), use another repository:
   one repository has one Pages site.
2. In `config/site.jsonc`: `"deploy": { "host": "github", "repository": "owner/name" }`.
3. After the first deploy, turn Pages on: the repository's _Settings > Pages > Deploy from a
   branch_, branch `gh-pages`, folder `/ (root)`.

No token is stored. Deploy copies `dist/` to a temporary folder, commits it there and force-pushes
that one commit over the branch, so the branch never holds more than the site as it is now, and
this repository's own history, index and settings aren't touched. It refuses a `pagesBranch`
named `main`, `master`, `develop` or `trunk`, and whichever branch the repository itself names as
its default.

`pnpm jam setup --change deploy` asks for all of this, tokens included, and writes both files.

### Then, for any of them

```sh
pnpm jam build && pnpm web:build
pnpm jam deploy --dry-run     # every check, nothing sent
pnpm jam deploy --create      # the first time (Cloudflare, Netlify); plain `deploy` on GitHub
```

A site that is never deployed works locally as before.

## What `jam deploy` does

1. Stops unless what the chosen host needs is set, `dist/data` holds a build of your own data
   (never the demo) and `dist/` holds the web app.
2. Works out which addresses the page loads from: the map styles in `site.jsonc`, what those styles
   point at (it reads them), the terrain source when it is on, and `deploy.extraHosts`.
3. Writes the content security policy: scripts and the map's worker only from the site itself,
   connections only to the site and those map addresses.
   - Cloudflare Pages and Netlify: in `dist/_headers`, with no framing by other sites, no MIME
     sniffing, a short referrer, no camera, microphone or location access, and the app's hashed
     files in `assets/` cached for a year. On Cloudflare, when `site.baseUrl` is an address of
     your own, the `pages.dev` copies are marked `noindex`.
   - GitHub Pages: as a `<meta>` element in the pushed copy of `index.html`. `dist/` isn't
     changed.
4. Runs the privacy audit over the whole folder (`docs/privacy.md`). A failure stops here.
5. Publishes, with the host's own tool as a separate program: `wrangler@4`, `netlify-cli@27`
   (both downloaded by pnpm when needed, neither a dependency of this repository), or `git`. A
   token is handed over in the tool's environment, never on the command line, and is replaced in
   anything it prints.

| Option            | What it does                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `--dry-run`       | Every check and the audit; writes nothing, sends nothing                                         |
| `--create`        | Create the project first (Cloudflare Pages, Netlify)                                             |
| `--branch <name>` | Publish as a preview under that name (Cloudflare Pages, Netlify); the public site stays as it is |
| `--dir <folder>`  | Publish another folder than `dist`                                                               |

If the map is empty on the published site but fine locally, the style loads tiles from an address
deploy couldn't see. The browser console names it; add it to `deploy.extraHosts`.

### An address of your own

Add the domain in the host's settings (Cloudflare: the project > _Custom domains_; Netlify:
_Domain management_; GitHub: _Settings > Pages > Custom domain_). Then set `site.baseUrl` in
`site.jsonc`, and build and deploy again.

### Changing host

Change `deploy.host` and deploy. The old host keeps serving its last upload until you delete the
project there.

### Taking the site down

Delete the project (Cloudflare, Netlify) or turn Pages off and delete the branch (GitHub), and
revoke the token if you stop deploying. Hosts keep old uploads until then. On GitHub a replaced
commit can stay reachable by its id for a while after a force-push.

## The weekly run

```sh
pnpm jam update
```

| Step                                   | Skipped when                             |
| -------------------------------------- | ---------------------------------------- |
| Fetch new Strava activities            | not signed in to Strava, or `--no-sync`  |
| Import the activity sheet              | there is no sheet file, or `--no-sync`   |
| Match, group routes, build `dist/data` |                                          |
| Build the web app                      |                                          |
| Deploy                                 | deploying isn't set up, or `--no-deploy` |

When the site is built from GPX files (`activities.source` is `gpx`, docs/gpx.md), the first step
is "Import GPX files" instead: `pnpm jam sync gpx` on the default folder. It is skipped when that
folder doesn't exist, or with `--no-sync`. Strava isn't asked at all then.

It stops at the first step that fails, so a failed fetch or a failed audit never reaches the public
site: the site stays as it was. It doesn't run on the demo store.

### Running it by itself

```sh
pnpm jam schedule                        # Sundays at 06:30
pnpm jam schedule --day wed --at 21:15
```

On a Mac this writes a launchd job to `data/schedule/` and prints the two commands that install it,
the one that runs it once now, and the one that removes it. It installs nothing itself. If the Mac
is asleep at that time, the job runs when it next wakes. Elsewhere, or with `--cron`, it prints a
crontab line instead.

Each run appends to `data/logs/update.log`, and every command's own log is in `data/logs/` as
always. The job holds the paths of this repository and of Node as they are today: after moving the
repository or changing the Node version, run `pnpm jam schedule` and install it again.

Strava limits how much one application may fetch in a day. A weekly run is far below that; if a
run does hit the limit it stops there and the next run carries on.

## Checks

`pnpm check:deploy` runs all of this against stand-ins for wrangler and the Netlify CLI and a
repository in a temporary folder: nothing is uploaded. What it can't show is a real upload, which
needs your account.

# Security

This project handles personal location data. The command-line tool keeps it on your own machine;
only the built site, after the privacy audit, is meant to be published. A security problem here is
anything that breaks that: a way for private data to reach the build output, a token or secret
ending up somewhere it should not, or a flaw in the published site.

## Reporting a problem

Report it privately. Don't open a public issue, discussion or pull request for it.

Use GitHub's private vulnerability reporting: on the
[repository page](https://github.com/mladimatija/japan-activity-map) open **Security**, then
**Report a vulnerability**. If that button is missing, I haven't turned the feature on yet. Open a
public issue that says only "I have a security report, please enable private reporting" and
nothing else.

Please include:

- what the problem is and what it exposes;
- how to reproduce it, with **made-up data**: `pnpm jam demo` builds a whole site from invented
  activities with a privacy zone at Tokyo Station, and the fixtures in `packages/cli/dev` are
  smaller;
- the commit you tested.

This is a personal project that I maintain in my spare time, so expect a first answer within about
a week.

## Never share these, in a report or anywhere else

- Anything under `data/`: the store (`jam.sqlite`), backups, logs, review files, the privacy
  preview and the Strava sign-in file (`strava-token.json`).
- `config/secrets.jsonc` or any value from it: the Strava client secret, the Cloudflare API token
  and account id, the Netlify access token.
- The address of a running setup page (`pnpm jam setup --web`): it carries a one-time token.
- `config/privacy-zones.jsonc`, or any coordinates, addresses or screenshots that show a privacy
  zone, a home or a workplace.
- Unclipped tracks. If a track is needed to show the problem, draw a made-up one.

If you've already posted one of these in public, delete it, then treat the secret as leaked:
create a new Strava client secret and run `pnpm jam strava auth` again, revoke and replace the
Cloudflare or Netlify token, and move the privacy zone question to a private report. If a
published site showed something private, take it down at the host first (docs/deploy.md, "Taking
the site down"), then rebuild it.

## In scope

- The privacy rules: zones, publish rules, the leak audit (`docs/privacy.md`). A track point
  inside a zone, an excluded activity or an internal id reaching `dist/` is the most serious kind
  of report.
- The build output written to `dist/data` and the web app that reads it.
- Publishing (`docs/deploy.md`): what `jam deploy` uploads, how a token reaches the host's tool,
  the content security policy and other headers it writes, and the branch it force-pushes for
  GitHub Pages.
- The setup page (`docs/setup.md`): its local server, the token in its address, what it will run
  and what it sends back to the browser.
- How the command-line tool stores and logs credentials and tokens (`data/logs`, `secrets.jsonc`,
  the Strava sign-in file).
- The demo: made-up data must never be mixed into, or published in place of, a real store, and
  the reverse.
- The repository's workflows (`.github/workflows`) and dependency configuration.

Not in scope: the hosts themselves (Cloudflare Pages, Netlify, GitHub Pages), Strava, and the map
tile provider a site is configured to use. Report those to their owners.

## Supported versions

Only the latest commit on the default branch.

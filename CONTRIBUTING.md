# Contributing

Thanks for looking. This is a personal project, so the bar for a change is simple: it keeps private
data private, it passes the checks, and it reads like the code around it.

## The one rule that matters most

Nothing personal is ever committed, pushed, pasted into an issue or attached to a pull request:

- nothing under `data/` (the store, logs, backups, review files, the Strava sign-in file);
- no real config file. Only `config/*.example.jsonc` is committed; `config/secrets.jsonc` and
  `config/privacy-zones.jsonc` stay on your machine;
- no coordinates, tracks or screenshots that show a home, a workplace or a privacy zone.

`.gitignore` already covers these. Check `git status` before every commit anyway, and use made-up
activities for fixtures (`packages/cli/dev` has examples). If something private does get pushed,
see `SECURITY.md`.

## Setup

You need Node.js 26.13.1 (`.node-version`) and pnpm 12.21.0 (`packageManager` in `package.json`).
The [Vite+](https://viteplus.dev) command `vp` can pick both for you.

```sh
pnpm install
pnpm jam --help
pnpm check
pnpm jam demo && pnpm demo:web     # a complete site from made-up activities, on port 5183
```

The demo is the way to work on the map, the pages or the build without any data of your own
(docs/demo.md). `pnpm jam setup` sets up a real site (docs/setup.md).

Five reference lists (the 五街道 highways) aren't in the repository because their source is
non-commercial. To have them, and to run the checks that use them, fetch and build them once:

```sh
pnpm jam lists fetch gokaido
pnpm jam lists build
```

The README lists every command; `docs/` explains each part (`web.md`, `design-system.md`,
`build.md`, `privacy.md`, `matching.md`, `routes.md`, `strava-setup.md`, `setup.md`, `demo.md`,
`deploy.md`). `lists/README.md` covers the reference lists and their known gaps.

## Where to start

The lists are the easiest place for a first change: a road of 日本の道100選 without a point needs
four values in `lists/sources/michi-100/roads.json`, and a wrong English name one line in
`lists/overrides.jsonc` (`lists/README.md`, "Known gaps", says what is missing). Unit tests for the
pure logic (filters, clipping, matching) are welcome too: `pnpm test` runs what exists so far.
Other activity sources, social features, weather and photos are left out on purpose; open an issue before building one.

| Path            | What lives there                                                              |
| --------------- | ----------------------------------------------------------------------------- |
| `packages/core` | Config schemas and the types of the build output; runs in Node.js and browser |
| `packages/cli`  | The `jam` command (`src/commands`), one folder per part; checks in `dev/`     |
| `packages/web`  | The site (`src/`), the setup page (`src/setup/`), web checks in `dev/`        |
| `lists/`        | Sources, hand corrections (`overrides.jsonc`) and the built lists             |

## Checks

Run `pnpm check` before every commit, and the checks for what you touched:

| Command                | Covers                                            | Needs                         |
| ---------------------- | ------------------------------------------------- | ----------------------------- |
| `pnpm check`           | Format (Oxfmt), lint (Oxlint), types (TypeScript) | Nothing                       |
| `pnpm test`            | Unit tests of the pure logic (`packages/*/test`)  | Nothing                       |
| `pnpm check:lists`     | Reading list sources and building place lists     | Nothing                       |
| `pnpm check:match`     | Matching activities to places and routes          | Nothing                       |
| `pnpm check:routes`    | Grouping repeated activities into routes          | Nothing                       |
| `pnpm check:privacy`   | Privacy zones, publish rules and the audit        | Nothing                       |
| `pnpm check:build`     | The build output, its schemas and its size budget | Nothing                       |
| `pnpm check:strava`    | Strava sync against a fake local server           | `curl`                        |
| `pnpm check:demo`      | `jam demo`: the made-up history and its guards    | Nothing                       |
| `pnpm check:deploy`    | Deploy to each host, the weekly run, the schedule | `git`                         |
| `pnpm check:setup`     | The setup wizard in the terminal                  | Nothing                       |
| `pnpm check:setup-web` | The setup page's local server                     | Nothing                       |
| `pnpm check:setup-ui`  | Renders every screen of the setup page            | Nothing                       |
| `pnpm check:web:demo`  | Renders every pane and page, on a demo build      | Nothing                       |
| `pnpm check:web`       | The same, on your own build                       | Your own build in `dist/data` |

`pnpm fix` applies automatic format and lint fixes. All checks except `check:web` use made-up
activities in a temporary folder and never touch `data/`. None of them uses the network or uploads
anything: Strava, the uploaders and GitHub are stand-ins.

The 五街道 route files aren't committed (their source's licence doesn't allow it). Without
them the checks walk a stand-in 東海道, and commands leave those lists out with one warning.

CI (`.github/workflows/ci.yml`) runs every check except `check:web`, plus `pnpm web:build`.
`.github/workflows/demo-site.yml` publishes the site over demo data to the repository's GitHub
Pages; it runs only where the repository variable `DEMO_SITE` is `true` (docs/demo.md).

## Conventions

- Arrow functions throughout (`const f = () => {}`; the linter enforces it), two-space indent,
  single quotes, lines up to 100 characters. `.editorconfig` and the formatter handle the rest.
- TypeScript runs directly on Node.js, so only erasable syntax: no enums, no namespaces, no
  parameter properties. Imports carry their `.ts` or `.tsx` extension.
- No new dependency in `packages/cli` without asking first. Versions are pinned exactly.
- `packages/core` runs in Node.js and the browser, so it never imports Node.js built-ins.

### Web app

- Every interface string goes through `t()`, with its Japanese in `packages/web/src/i18n-ja.ts`
  (the setup page's in `packages/web/src/setup/i18n-ja-setup.ts`). `pnpm check:web` and
  `check:setup-ui` fail on a string that has none. The command line stays in English.
- Every distance, height, pace and speed goes through `packages/web/src/format.ts`, so the
  km / mi switch reaches it.
- Colours come from the tokens in `packages/web/src/index.css`. Never write a hex in a component;
  data colours the map needs as literals live in `packages/web/src/map/palette.ts`.
- Follow `docs/design-system.md` and its checklist: it works at 375 px wide and with the keyboard,
  focus is visible, and motion respects `prefers-reduced-motion`.

### Command line

- Pure logic gets a unit test in `packages/<name>/test/*.test.ts`, on Node's own test runner
  (`node:test`, `node:assert`): no test library to install. Geometry that the command line and
  the site both need lives in `packages/core/src/geo.ts`.
- Another program is run through `runLines` (`packages/cli/src/process.ts`), which hides secrets
  in everything it passes on.
- A message someone can act on is thrown as a `JamError` (`packages/cli/src/errors.ts`); anything
  else prints a stack. Files a run could be interrupted in are written with `writeFileAtomic`.
- A command that takes a while reports through `log.progress(done, total, what)`: a bar in the
  terminal and on the setup page.
- Tokens go to other programs in their environment, never as arguments, and never into a log line.

### Reference lists

- Every source has a `lists/sources/<id>/SOURCE.md` naming where it came from and its licence, and
  an entry in `lists/credits.json` with the attribution line.
- Data with a non-commercial or unclear licence isn't committed. Add a fetch step instead, as
  `gokaido` does.

## Commits and pull requests

- Small commits with a message that says what changed and why.
- Open a pull request from a branch; the template has the checklist. Say how you checked the
  change, and for interface changes what you looked at.
- For anything larger than a fix, open an issue first so the approach can be agreed.

## Licence

The code is under the licence in `LICENSE`. Reference data under `lists/` keeps the licences of its
sources (`lists/credits.json`). By contributing you agree that your contribution is shared on the
same terms.

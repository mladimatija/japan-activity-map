## What and why

<!-- What this changes and the reason. Link the issue if there is one. -->

## How it was checked

<!-- The commands you ran and, for interface changes, what you looked at (375 px wide, keyboard, light and dark). -->

## Checklist

Privacy

- [ ] Nothing from `data/` is in this pull request: no store, logs, backups, review files or sign-in file.
- [ ] No real config file is added (`config/*.jsonc`); only `*.example.jsonc` files are committed.
- [ ] No secret, token, privacy zone or home or work location appears in code, fixtures, docs, screenshots or the description.
- [ ] Fixtures use made-up activities.

Checks

- [ ] `pnpm check` (format, lint, types) and `pnpm test` pass.
- [ ] The checks for what I touched pass: `pnpm check:web` (or `check:web:demo`), `check:build`, `check:privacy`, `check:routes`, `check:gpx`, `check:garmin`, `check:yamap`, `check:match`, `check:strava`, `check:lists`, `check:demo`, `check:deploy`, `check:setup`, `check:setup-web`, `check:setup-ui`.

Interface (skip if `packages/web` is untouched)

- [ ] Every new interface string goes through `t()` and has its Japanese in `packages/web/src/i18n-ja.ts` (the setup page's in `src/setup/i18n-ja-setup.ts`); distances, heights and paces go through `src/format.ts`.
- [ ] Colours come from the tokens in `packages/web/src/index.css`; no hex in a component (map data colours live in `map/palette.ts`).
- [ ] It follows `docs/design-system.md`, works at 375 px wide and with the keyboard, and focus is visible.

Code and docs

- [ ] Arrow functions, two-space indent.
- [ ] No new dependency in `packages/cli` without it being agreed first.
- [ ] New list data names its source and licence (`lists/sources/<id>/SOURCE.md`, `lists/credits.json`); nothing non-commercial is committed.
- [ ] The docs in `docs/` and the README still describe what the code does.

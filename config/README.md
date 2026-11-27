# Config

Each setting lives in its own JSONC file (JSON with comments).

- `<name>.example.jsonc` files are committed and show every option with its default.
- To change a setting, copy the example to `<name>.jsonc` and edit the copy. Real files are git-ignored.
- When a real file is missing, the example is used instead, except for `secrets`, which never falls back.
- Run `pnpm jam status` to see which file each setting comes from and to list every validation problem.
- The files are strict JSONC: comments, but no comma after the last entry of an object or list. Commented-out
  options are placed so that uncommenting one keeps the file valid.

| File            | Holds                                                                      |
| --------------- | -------------------------------------------------------------------------- |
| `site`          | Site title, map styles, what the build may show, where it is published     |
| `thresholds`    | Distances and shares used by matching, route grouping and privacy clipping |
| `routes`        | Route names, merges and splits, keyed by activity                          |
| `privacy-zones` | Places whose surroundings are cut from every published track               |
| `strava`        | Strava import filters, including whether to fetch private activities       |
| `sheet`         | Where the manual activity sheet is, and the time zone for its dates        |
| `secrets`       | Strava app credentials; the Cloudflare or Netlify token for deploying      |

`pnpm jam setup` writes these files for you: it asks, shows a diff and changes one value where it
stands, keeping your comments (docs/setup.md). Editing by hand stays equally valid.

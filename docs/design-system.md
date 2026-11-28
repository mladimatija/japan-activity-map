# Design system

Aizome (藍染, indigo-dyed): indigo cloth on paper. Indigo is the site's material as well as its
accent, places you finish are dyed in, and a red seal marks a list you have completed. This file is
the reference for anyone adding to the site's interface: what the colours and sizes are called,
what each is for, and which component to reach for. The values live in one place,
`packages/web/src/index.css`; the token table below repeats them, and `pnpm check:web` fails when
the two disagree.

## Rules

1. Never write a colour in a component. Use the token's Tailwind name (`bg-background`,
   `text-muted-foreground`, `bg-primary`). A hex in a `.tsx` file is a bug, except in
   `map/palette.ts` (data colours for the map, which MapLibre needs as literals).
2. Indigo is the only accent. It marks what can be acted on or is selected: primary buttons,
   links, the open page, pressed chips, focus. Indigo `cloth` is a surface, not an accent (rule
   4). The seal's red marks only the logo and a finished list: it is never a status, never on
   the map, and never on a control.
3. Data colours mean something and are never chrome. Blue is done, orange a run, green a hike,
   and so on (see Data colours). Don't use them for buttons, borders or decoration, and don't
   use indigo for data.
4. Cloth, paper, white. The page is `background` (paper). Things that sit on it (cards, menus,
   the pane) are `card` / `popover` (white). Hover and quiet fills are `muted`. `cloth` (indigo)
   is only for the masthead and a list's cover, with its own text, controls and borders
   (`cloth-foreground`, `cloth-accent`, `cloth-border`) and the title slip (`slip`) on a cover.
5. Two text colours. `foreground` for what is read, `muted-foreground` for what supports it.
   No opacity on text.
6. Both modes. Every token has a dark value; a component that uses only tokens works in both.
7. Both languages. Every string goes through `t()` with Japanese in `src/i18n-ja.ts`
   (docs/web.md, "The interface follows the switch").
   The setup page (`src/setup/`) keeps its Japanese in `src/setup/i18n-ja-setup.ts`, added with
   `registerTranslations()`, so the public bundle doesn't grow.
   Every distance, height, pace and speed goes through `src/format.ts`, which follows the
   km / mi switch; never write a unit by hand.
8. Reuse before adding. If a component below fits, use it. A new token or component needs a
   line in this file.

## Tokens

Light and dark values, and the Tailwind names that use them.

| Token                      | Light     | Dark      | Use                                                                             |
| -------------------------- | --------- | --------- | ------------------------------------------------------------------------------- |
| `--background`             | `#f1f2f4` | `#0c1130` | The page: paper, or night indigo in dark mode. `bg-background`                  |
| `--foreground`             | `#181b27` | `#e8eaf4` | Text that is read. `text-foreground`                                            |
| `--card`                   | `#ffffff` | `#141a40` | Cards and panels on the page. `bg-card`                                         |
| `--popover`                | `#ffffff` | `#141a40` | Menus, popovers, the map key. `bg-popover`                                      |
| `--primary`                | `#2f3f8f` | `#a3aef0` | The accent: primary buttons, links, pressed chips. `bg-primary`, `text-primary` |
| `--primary-foreground`     | `#ffffff` | `#151a3a` | Text on `primary`. `text-primary-foreground`                                    |
| `--accent`                 | `#e2e6f4` | `#222b68` | Indigo tint: the open page, a highlighted menu row. `bg-accent`                 |
| `--accent-foreground`      | `#232f6b` | `#dde1fb` | Text on `accent`. `text-accent-foreground`                                      |
| `--secondary`              | `#e4e7ed` | `#1c2352` | Secondary buttons. `bg-secondary`                                               |
| `--muted`                  | `#e4e7ed` | `#1c2352` | Hover washes, quiet fills, empty bars. `bg-muted`                               |
| `--muted-foreground`       | `#545a6c` | `#a3a9c4` | Supporting text, labels, axes. `text-muted-foreground`                          |
| `--border`                 | `#d8dbe3` | `#232b58` | Hairlines and card edges. `border-border` (the default)                         |
| `--input`                  | `#c6cbd6` | `#3a4479` | Edges of fields and switches. `border-input`                                    |
| `--ring`                   | `#5a68bf` | `#6f7bc8` | Focus ring. `ring-ring`                                                         |
| `--destructive`            | `#b3261e` | `#f2857d` | Errors and deleting. `text-destructive`                                         |
| `--cloth`                  | `#17224f` | `#1b2766` | Indigo cloth: the masthead and a list's cover, nothing else. `bg-cloth`         |
| `--cloth-foreground`       | `#f3f1ea` | `#eef0fa` | Text on cloth. `text-cloth-foreground`                                          |
| `--cloth-muted-foreground` | `#b9c0e0` | `#aab3dc` | Supporting text on cloth. `text-cloth-muted-foreground`                         |
| `--cloth-accent`           | `#223070` | `#26337a` | A control on cloth: the list picker, the search field. `bg-cloth-accent`        |
| `--cloth-border`           | `#2b3a78` | `#2a3880` | Dividers on cloth, and the contour lines dyed into it. `border-cloth-border`    |
| `--slip`                   | `#fbf8ef` | `#ece6d6` | The title slip (題箋) on a cover; light in both modes, like a label. `bg-slip`  |
| `--slip-foreground`        | `#1d2030` | `#1d2030` | Text on the slip. `text-slip-foreground`                                        |
| `--seal`                   | `#bd2f28` | `#c13d33` | The seal (朱): the logo and a finished list, nothing else. `bg-seal`            |
| `--seal-foreground`        | `#fff7f2` | `#fff5f2` | The glyph on a seal. `text-seal-foreground`                                     |

Measured contrast (WCAG): text on the page 15.3:1 light and 15.4:1 dark; supporting text at least
5.5:1 on page, card and muted fill in both modes; indigo links 8.4:1 and 8.7:1; text on a primary
button 9.4:1 and 8.0:1. On cloth: text 13.5:1 and 12.1:1, supporting text 8.5:1 and 6.7:1 (5.5:1 on
`cloth-accent`). Text on the slip 15.2:1 and 13.0:1; a seal's glyph 5.5:1 and 4.9:1.

### Data colours

The Okabe–Ito set, safe for colour-blind readers, with one change: **done is the site's indigo**,
a step lighter than the buttons so it reads as data, and lighter again on a dark page. The five
were checked together for colour-blind separation in both modes. In CSS as `--status-*`; in
`src/map/palette.ts` for the map and the canvas (`statusHex(dark)`), where the map's other inks
(`mapColors(dark)`: labels, halo, hover accent, heat, hillshade) and the chart series also live.
`pnpm check:web` fails on a colour written anywhere else in the code.

| Meaning                              | Colour                                                    | Where                                 |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------- |
| Done                                 | `#3647a3` (dark: `#5a69dc`)                               | `bg-status-done`, pins, progress bars |
| Partly done                          | `#56b4e9`                                                 | `bg-status-partial`                   |
| Tried, not reached                   | `#d55e00`                                                 | `bg-status-dns`                       |
| Want to go                           | `#e69f00`                                                 | `bg-status-want`                      |
| Not yet                              | `#8c8c8c`                                                 | `bg-status-none`                      |
| Hike / trail run / run / walk / ride | `#009e73` / `#e69f00` / `#d55e00` / `#cc79a7` / `#0072b2` | `TYPE_COLORS`                         |
| Gradient, steep down to steep up     | `--grade-1` … `--grade-5`                                 | blue and red arms round grey          |

Status always comes with an icon or label, never colour alone.

### Type

Four voices. The Latin faces ship with the site (`src/fonts.ts`, from Fontsource): a published
site allows fonts from its own origin only, and a reader downloads only the Latin files: about
130 kB, and up to 100 kB more where names have macrons (Tōhoku). Japanese is set in the reader's system fonts, so it costs nothing to download: a gothic
for text and a mincho for titles and names (Hiragino, Yu, or Noto).

| Class         | Face                                         | Use                                                                                                 |
| ------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `font-sans`   | IBM Plex Sans; Japanese in the system gothic | Everything not below (the default)                                                                  |
| `font-title`  | IBM Plex Sans Condensed; Japanese in mincho  | Titles and names: a pane's title (`PANE_TITLE`), a page's, a name's second language under its title |
| `font-figure` | IBM Plex Sans Condensed; Japanese in gothic  | Figures: the headline, `Figures`, `Facts`, a count beside its total                                 |
| `font-mono`   | IBM Plex Mono; Japanese in the system gothic | Small capitals over a title (`Eyebrow`), coordinates                                                |

Sizes, as Tailwind classes:

| Class          | Size  | Use                                                      |
| -------------- | ----- | -------------------------------------------------------- |
| `text-axis`    | 10 px | Chart axes and labels only                               |
| `text-xs`      | 12 px | Captions, supporting lines                               |
| `text-compact` | 13 px | Tables, small headings, secondary text                   |
| `text-sm`      | 14 px | Body (the default)                                       |
| `text-row`     | 15 px | A row's name, a figure's value                           |
| `text-title`   | 22 px | A pane's title                                           |
| `text-display` | 28 px | A setup step's headline                                  |
| `text-figure`  | 44 px | A headline figure: a list's score, a page's first figure |

Weights: normal and `font-semibold`; `font-bold` for titles and headline figures. The condensed
face comes in 500 to 700, so its normal text shows at 500. Numbers that line up in columns get
`tabular-nums`. Only names and titles go in mincho: running Japanese text stays in the gothic.

### Shape and space

- Radius: `rounded-sm` for small hits, `rounded-md` controls, `rounded-lg` cards, `rounded-full`
  pills and chips.
- Space: Tailwind's scale. Inside a card `px-3 py-2.5`; between sections of a detail `mt-6`;
  between panels on a page `mb-4`.
- A control is at least 44 px for touch (`touch-target`) and 36 px for a pointer.
- Motion is short and optional: everything respects `prefers-reduced-motion` (set once in
  `index.css`).

## Components

Reach for these before writing markup. All are in `packages/web/src`.

| Need                                     | Use                                                                                                                                        | From                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| A button                                 | `Button` (`variant`: default = indigo, `outline`, `ghost`, `secondary`, `link` for an action in text; on cloth, `cloth` and `cloth-ghost`) | `components/ui/button.tsx`                   |
| A button that stays pressed              | `Toggle` (`variant`: `outline`; on cloth, `cloth`, which turns light when pressed)                                                         | `components/ui/toggle.tsx`                   |
| A name that opens something              | `TextLink`                                                                                                                                 | `components/app.tsx`                         |
| A filter that is on or off               | `Chip`                                                                                                                                     | `components/app.tsx`                         |
| One of a few options                     | `ChoiceField` (select up to 5 options, searchable from 6)                                                                                  | `panel/controls.tsx`                         |
| On or off with a label                   | `SwitchField`                                                                                                                              | `panel/controls.tsx`                         |
| A page of charts                         | `ChartPage`, with `Panel` for each block                                                                                                   | `pages/charts.tsx`                           |
| Headline numbers                         | `Figures` (`hero` makes the first the headline)                                                                                            | `pages/charts.tsx`                           |
| A chart that says what is pointed at     | `Panel readout`, and `data-tip` on each mark                                                                                               | `pages/charts.tsx`                           |
| A titled part of a detail                | `Section`; `Fold` when it should start closed                                                                                              | `components/app.tsx`                         |
| Term and value pairs                     | `Facts`                                                                                                                                    | `components/app.tsx`                         |
| A share done                             | `MiniBar` with the fraction beside it                                                                                                      | `shell/ListPicker.tsx`                       |
| A status                                 | `StatusIcon`, `StatusBadge`                                                                                                                | `panel/StatusIcon.tsx`, `components/app.tsx` |
| A place or list name in both languages   | `Name`, `nameIn`                                                                                                                           | `names.tsx`                                  |
| Something loading, nothing there, a note | `Loading`, `Empty`, `Note`                                                                                                                 | `components/app.tsx`                         |
| A remembered choice                      | `usePref`                                                                                                                                  | `prefs.ts`                                   |
| The site's mark                          | `SealMark` (the seal with 踏, beside the site's name)                                                                                      | `components/app.tsx`                         |
| Names in, and units                      | `PrefsMenu` in the masthead; on phones `LangSwitch` and `UnitsSwitch` in the layers menu                                                   | `shell/PrefsMenu.tsx`                        |

Patterns:

- Chart: 2 px lines, an area at about 10 % of the line's colour, hairline grid in
  `stroke-border`, axis text `fill-muted-foreground text-axis`, a readout line above instead of
  tooltips, and the same facts reachable without hovering (a table, a list or an `aria-label`).
- Table: `text-compact tabular-nums`, header cells `text-axis text-muted-foreground`, rows
  divided by a hairline, the column that matters `font-semibold`.
- Row that opens something: the whole row is the button, `hover:bg-muted`, at least 44 px.
- Empty and loading: say what is missing and what to do in one sentence; never a blank.
- Masthead: the top bar is `cloth`, with the seal and the site's name in `font-title`. Its controls
  use the cloth variants, never `outline` or `primary`, and a focus ring in `cloth-foreground`.
  The page tabs are text the height of the bar, the open page underlined. Settings that are set
  once (names in, units) sit in one menu at the end, labelled with what they are ("EN · km").

## Checklist for a change

- Only token classes for colour; no hex outside `index.css` and `map/palette.ts`.
- Indigo only on what acts or is selected; data colours only on data.
- Works at 375 px wide and with the keyboard; focus is visible.
- Strings in `t()` with Japanese added.
- `pnpm check` and `pnpm check:web` pass.

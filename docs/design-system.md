# Design system

Indigo on warm paper. This file is the reference for anyone adding to the site's
interface: what the colours and sizes are called, what each is for, and which component to reach
for. The values live in one place, `packages/web/src/index.css`; the token table below repeats
them, and `pnpm check:web` fails when the two disagree.

## Rules

1. Never write a colour in a component. Use the token's Tailwind name (`bg-background`,
   `text-muted-foreground`, `bg-primary`). A hex in a `.tsx` file is a bug, except in
   `map/palette.ts` (data colours for the map, which MapLibre needs as literals).
2. Indigo is the only accent. It marks what can be acted on or is selected: primary buttons,
   links, the open page, pressed chips, focus. Nothing else is indigo.
3. Data colours mean something and are never chrome. Blue is done, orange a run, green a hike,
   and so on (see Data colours). Don't use them for buttons, borders or decoration, and don't
   use indigo for data.
4. Paper, then white. The page is `background` (warm paper). Things that sit on it (cards,
   menus, the pane) are `card` / `popover` (white). Hover and quiet fills are `muted`.
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

| Token                  | Light     | Dark      | Use                                                                             |
| ---------------------- | --------- | --------- | ------------------------------------------------------------------------------- |
| `--background`         | `#faf8f3` | `#15171f` | The page. `bg-background`                                                       |
| `--foreground`         | `#1f2433` | `#eceaf2` | Text that is read. `text-foreground`                                            |
| `--card`               | `#ffffff` | `#1d202b` | Cards and panels on the page. `bg-card`                                         |
| `--popover`            | `#ffffff` | `#1d202b` | Menus, popovers, the map key. `bg-popover`                                      |
| `--primary`            | `#2f3f8f` | `#a3aef0` | The accent: primary buttons, links, pressed chips. `bg-primary`, `text-primary` |
| `--primary-foreground` | `#ffffff` | `#151a3a` | Text on `primary`. `text-primary-foreground`                                    |
| `--accent`             | `#e6e8f5` | `#2a3160` | Indigo tint: the open page, a highlighted menu row. `bg-accent`                 |
| `--accent-foreground`  | `#232f6b` | `#dde1fb` | Text on `accent`. `text-accent-foreground`                                      |
| `--secondary`          | `#f1eee6` | `#262a37` | Secondary buttons. `bg-secondary`                                               |
| `--muted`              | `#f1eee6` | `#262a37` | Hover washes, quiet fills, empty bars. `bg-muted`                               |
| `--muted-foreground`   | `#5f6470` | `#a2a6b5` | Supporting text, labels, axes. `text-muted-foreground`                          |
| `--border`             | `#e7e2d6` | `#2f3342` | Hairlines and card edges. `border-border` (the default)                         |
| `--input`              | `#d9d3c5` | `#3a3f51` | Edges of fields and switches. `border-input`                                    |
| `--ring`               | `#5a68bf` | `#6f7bc8` | Focus ring. `ring-ring`                                                         |
| `--destructive`        | `#b3261e` | `#f2857d` | Errors and deleting. `text-destructive`                                         |

Measured contrast (WCAG): text on the page 14.6:1 light and 15.0:1 dark; supporting text at least
5.1:1 on page, card and muted fill in both modes; indigo links 8.9:1 and 8.4:1; text on a primary
button 9.4:1 and 8.0:1.

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

One family (the system sans). Sizes, as Tailwind classes:

| Class          | Size  | Use                                    |
| -------------- | ----- | -------------------------------------- |
| `text-axis`    | 10 px | Chart axes and labels only             |
| `text-xs`      | 12 px | Captions, supporting lines             |
| `text-compact` | 13 px | Tables, small headings, secondary text |
| `text-sm`      | 14 px | Body (the default)                     |
| `text-row`     | 15 px | A row's name, a figure's value         |
| `text-title`   | 22 px | A pane's title                         |
| `text-display` | 28 px | A page's headline figure               |

Weights: normal and `font-semibold`; `font-bold` for page titles. Numbers that line up in columns
get `tabular-nums`.

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

| Need                                     | Use                                                                                                   | From                                         |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| A button                                 | `Button` (`variant`: default = indigo, `outline`, `ghost`, `secondary`, `link` for an action in text) | `components/ui/button.tsx`                   |
| A name that opens something              | `TextLink`                                                                                            | `components/app.tsx`                         |
| A filter that is on or off               | `Chip`                                                                                                | `components/app.tsx`                         |
| One of a few options                     | `ChoiceField` (select up to 5 options, searchable from 6)                                             | `panel/controls.tsx`                         |
| On or off with a label                   | `SwitchField`                                                                                         | `panel/controls.tsx`                         |
| A page of charts                         | `ChartPage`, with `Panel` for each block                                                              | `pages/charts.tsx`                           |
| Headline numbers                         | `Figures` (`hero` makes the first the headline)                                                       | `pages/charts.tsx`                           |
| A chart that says what is pointed at     | `Panel readout`, and `data-tip` on each mark                                                          | `pages/charts.tsx`                           |
| A titled part of a detail                | `Section`; `Fold` when it should start closed                                                         | `components/app.tsx`                         |
| Term and value pairs                     | `Facts`                                                                                               | `components/app.tsx`                         |
| A share done                             | `MiniBar` with the fraction beside it                                                                 | `shell/ListPicker.tsx`                       |
| A status                                 | `StatusIcon`, `StatusBadge`                                                                           | `panel/StatusIcon.tsx`, `components/app.tsx` |
| A place or list name in both languages   | `Name`, `nameIn`                                                                                      | `names.tsx`                                  |
| Something loading, nothing there, a note | `Loading`, `Empty`, `Note`                                                                            | `components/app.tsx`                         |
| A remembered choice                      | `usePref`                                                                                             | `prefs.ts`                                   |

Patterns:

- Chart: 2 px lines, an area at about 10 % of the line's colour, hairline grid in
  `stroke-border`, axis text `fill-muted-foreground text-axis`, a readout line above instead of
  tooltips, and the same facts reachable without hovering (a table, a list or an `aria-label`).
- Table: `text-compact tabular-nums`, header cells `text-axis text-muted-foreground`, rows
  divided by a hairline, the column that matters `font-semibold`.
- Row that opens something: the whole row is the button, `hover:bg-muted`, at least 44 px.
- Empty and loading: say what is missing and what to do in one sentence; never a blank.

## Checklist for a change

- Only token classes for colour; no hex outside `index.css` and `map/palette.ts`.
- Indigo only on what acts or is selected; data colours only on data.
- Works at 375 px wide and with the keyboard; focus is visible.
- Strings in `t()` with Japanese added.
- `pnpm check` and `pnpm check:web` pass.

/**
 * The app's own building blocks on top of shadcn/ui: list rows, status badges, filter chips,
 * headings and the small sort menus, so every panel and page draws them the same way.
 */
import { ChevronDownIcon } from 'lucide-react';
import { cva } from 'class-variance-authority';
import { type ComponentProps, type ReactNode, useState } from 'react';

import { filterCount, NO_FILTERS } from '../filters.ts';
import { STATUS_LABELS } from '../format.ts';
import { cn } from '../lib/utils.ts';
import type { Status } from '../map/palette.ts';
import { type Named, nameIn, otherLang, subName, useLang } from '../names.tsx';
import { useStore } from '../store.ts';
import { usePref } from '../prefs.ts';
import { Button } from './ui/button.tsx';
import { Empty as EmptyBlock, EmptyContent, EmptyDescription } from './ui/empty.tsx';
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from './ui/item.tsx';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.tsx';
import { Spinner } from './ui/spinner.tsx';
import { Toggle } from './ui/toggle.tsx';
import { t } from '../i18n.ts';

/**
 * Classes for a row's first and second name (pass to `Name`). Both stay on one line; a long one ends
 * in an ellipsis, the second name giving way first.
 */
export const ROW_MAIN = 'min-w-0 truncate text-row font-semibold';
export const ROW_SUB = 'min-w-0 shrink-3 truncate text-xs font-normal text-muted-foreground';

/**
 * A name inside a table or a sentence that opens what it names (a list, an activity, a year):
 * in the text's own colour, underlined when pointed at. An action ("Show on the map", "Show all")
 * is a `Button variant="link"` instead, which wears the link colour.
 */
export const TextLink = ({ className, ...props }: ComponentProps<'button'>) => (
  <button
    type="button"
    className={cn(
      'block max-w-full min-w-0 truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
      className,
    )}
    {...props}
  />
);

/** A detail's figures, two to a row in a grid of cells: term above, value below. */
export const Facts = ({ rows, className }: { rows: [string, ReactNode][]; className?: string }) => (
  <dl
    className={cn(
      'my-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border',
      className,
    )}
  >
    {rows.map(([term, value]) => (
      <div key={term} className="min-w-0 bg-background px-3 py-2.5 last:odd:col-span-2">
        <dt className="text-xs text-muted-foreground">{t(term)}</dt>
        <dd className="mt-0.5 font-figure text-lg leading-snug font-semibold tabular-nums">
          {value}
        </dd>
      </div>
    ))}
  </dl>
);

/** A titled part of a detail, with an optional count beside the title. */
export const Section = ({
  title,
  children,
  count,
}: {
  title: string;
  children: ReactNode;
  count?: number;
}) => (
  <section className="mt-6">
    <h3 className="mb-2 text-compact font-semibold">
      {t(title)}
      {count !== undefined && (
        <span className="font-normal text-muted-foreground tabular-nums"> {count}</span>
      )}
    </h3>
    {children}
  </section>
);

/**
 * A part of a detail that starts folded, so a long detail keeps its main figures in view: its
 * title is the button, with a line saying what is inside. Whether it is open is remembered.
 * `nested` is for a fold inside a section: smaller, without the section's space above.
 */
export const Fold = ({
  pref,
  title,
  count,
  summary,
  nested = false,
  children,
}: {
  pref: string;
  title: string;
  count?: number;
  summary?: ReactNode;
  nested?: boolean;
  children: ReactNode;
}) => {
  const [open, setOpen] = usePref<boolean>(`fold.${pref}`, false);
  const Heading = nested ? 'h4' : 'h3';
  return (
    <section className={nested ? 'mt-3' : 'mt-6'}>
      <Heading className="text-compact font-semibold">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="group -mx-1 flex min-h-9 w-[calc(100%+0.5rem)] items-center gap-2 rounded-sm px-1 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span>
            {t(title)}
            {count !== undefined && (
              <span className="font-normal text-muted-foreground tabular-nums"> {count}</span>
            )}
          </span>
          {!open && summary && (
            <span className="min-w-0 flex-1 truncate text-xs font-normal text-muted-foreground tabular-nums">
              {summary}
            </span>
          )}
          <ChevronDownIcon
            className={cn(
              'ml-auto size-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
      </Heading>
      {open && <div className="mt-1">{children}</div>}
    </section>
  );
};

/** A pane's title (a list, a detail, the filters). It takes focus when its view opens. */
export const PANE_TITLE =
  'rounded-sm font-title text-xl leading-tight font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-title';

/**
 * The chevron of a heading that folds its group away, on the right: down while folded, up while
 * open, as on the list's regions. Its trigger needs `group` and `aria-expanded`.
 */
export const GroupChevron = () => (
  <ChevronDownIcon
    aria-hidden
    className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180"
  />
);

/** How a foldable group's heading row looks: filter groups, a list's regions, activity months. */
export const GROUP_ROW = 'min-h-11 rounded-sm px-1 text-sm font-semibold hover:bg-muted';

/** A headline figure: how far along, out of what, and the share: "5 / 100 … 5%". */
export const Headline = ({ value, of, share }: { value: ReactNode; of: string; share: string }) => (
  <p className="mb-2 flex items-baseline gap-1 font-figure tabular-nums">
    <strong className="text-3xl leading-none font-bold md:text-figure">{value}</strong>
    <span className="text-lg text-muted-foreground"> {of}</span>
    <span className="ml-auto text-lg font-semibold">{share}</span>
  </p>
);

/** A small colour dot beside a label: an activity type's colour, a status's. */
export const Dot = ({ color }: { color: string }) => (
  <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: color }} />
);

/** One clickable row of a list: the list's places, activities, prefectures. */
export const RowButton = ({
  hovered = false,
  className,
  ...props
}: ComponentProps<'button'> & { hovered?: boolean }) => (
  <Item
    size="sm"
    render={<button type="button" />}
    data-hovered={hovered || undefined}
    className={cn(
      'min-h-13 flex-nowrap gap-3 px-2 py-1.5 text-left hover:bg-accent data-hovered:bg-accent',
      className,
    )}
    {...(props as ComponentProps<'div'>)}
  />
);

/** A row's middle: its name(s) over a quieter line of figures. */
export const RowBody = ({ title, meta }: { title: ReactNode; meta?: ReactNode }) => (
  <ItemContent className="min-w-0 gap-0">
    <ItemTitle className="line-clamp-none flex w-full min-w-0 items-baseline gap-2">
      {title}
    </ItemTitle>
    {meta !== undefined && (
      <ItemDescription className="line-clamp-none flex items-center gap-2 text-xs tabular-nums">
        {meta}
      </ItemDescription>
    )}
  </ItemContent>
);

/** A row's right-hand figure or date. */
export const RowSide = ({ className, ...props }: ComponentProps<'div'>) => (
  <ItemActions
    className={cn('flex-none text-xs text-muted-foreground tabular-nums', className)}
    {...props}
  />
);

export const STATUS_TEXT: Partial<Record<Status, string>> = {
  done: 'text-status-done',
  dns: 'text-status-dns',
};

const statusBadge = cva(
  'grid size-7.5 flex-none place-items-center rounded-full border-[1.5px] text-xs font-bold tabular-nums',
  {
    variants: {
      status: {
        done: 'border-status-done bg-status-done text-white',
        partial:
          'border-status-partial bg-linear-to-r from-status-partial from-50% to-transparent to-50%',
        dns: 'border-dashed border-status-dns text-status-dns',
        want: 'border-status-want shadow-[inset_0_0_0_2px_var(--status-want)]',
        none: 'border-status-none text-muted-foreground',
      },
    },
  },
);

/** A list item's number, drawn like its pin: filled when done, half when partial, and so on. */
export const StatusBadge = ({
  status,
  children,
  className,
}: {
  status: Status;
  children?: ReactNode;
  className?: string;
}) => (
  <span
    className={cn(statusBadge({ status }), className)}
    role="img"
    aria-label={STATUS_LABELS[status]}
  >
    {children}
  </span>
);

/** A filter chip: a pill that is on or off. */
export const Chip = ({
  on,
  onToggle,
  dot,
  dim = false,
  className,
  children,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  /** A colour dot before the label (a status or a type). */
  dot?: string;
  /** Nothing would match: shown quieter, still choosable. */
  dim?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <Toggle
    variant="outline"
    size="sm"
    pressed={on}
    onPressedChange={onToggle}
    className={cn(
      'h-auto min-h-8 rounded-full px-3 py-1 text-left font-normal whitespace-normal aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary/90 [&_[data-count]]:opacity-75',
      dim && !on && 'text-muted-foreground opacity-70',
      className,
    )}
  >
    {dot && <Dot color={dot} />}
    {children}
  </Toggle>
);

/** A count inside a chip or tab. */
export const Count = ({ children }: { children: ReactNode }) => (
  <span data-count className="tabular-nums">
    {children}
  </span>
);

/**
 * The site's mark: a square seal (印) carved with 踏, "to tread", the first character of 踏破
 * (walking a route to its end). Seal red is for this and a finished list only.
 */
export const SealMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8 shrink-0 -rotate-3', className)}>
    <rect x="1.5" y="1.5" width="29" height="29" rx="3.5" className="fill-seal" />
    <rect
      x="4.5"
      y="4.5"
      width="23"
      height="23"
      rx="1.5"
      className="fill-none stroke-seal-foreground"
      strokeWidth="1.2"
    />
    <text
      x="16"
      y="16.5"
      textAnchor="middle"
      dominantBaseline="central"
      className="fill-seal-foreground font-title text-[17px] font-bold"
    >
      踏
    </text>
  </svg>
);

/**
 * A line over a chart (or the stamp grid) that says what the pointer or the keyboard focus is on: any mark inside with
 * a `data-tip` speaks through it, the way the height profile and the route chart read out. `idle`
 * is what the line says otherwise.
 */
export const Readout = ({ idle, children }: { idle?: ReactNode; children: ReactNode }) => {
  const [tip, setTip] = useState<string | null>(null);
  const read = (target: EventTarget) =>
    setTip((target as Element).closest?.('[data-tip]')?.getAttribute('data-tip') ?? null);
  return (
    <div
      onPointerOver={(event) => read(event.target)}
      onPointerLeave={() => setTip(null)}
      onFocus={(event) => read(event.target)}
      onBlur={() => setTip(null)}
    >
      <p
        className={cn(
          'mb-1 min-h-5 truncate text-compact tabular-nums',
          tip ? 'font-semibold' : 'text-muted-foreground',
        )}
        aria-hidden
      >
        {tip ?? idle}
      </p>
      {children}
    </div>
  );
};

/** Small capitals over a title. */
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <p className="mb-1 font-mono text-xs font-medium tracking-wide text-muted-foreground uppercase">
    {children}
  </p>
);

/** A name as a title, in the viewer's language, with the other language under it. */
export const NameTitle = ({
  name,
  id,
  as: Heading = 'h2',
  focusable = false,
}: {
  name: Named;
  id?: string;
  as?: 'h1' | 'h2';
  /** A detail's title takes focus when it opens. */
  focusable?: boolean;
}) => {
  const lang = useLang();
  const sub = subName(name, lang);
  return (
    <>
      <Heading
        id={id}
        lang={lang}
        className={PANE_TITLE}
        {...(focusable ? { tabIndex: -1, 'data-detail-title': '' } : {})}
      >
        {nameIn(name, lang)}
      </Heading>
      {sub && (
        <p className="mt-0.5 font-title text-row text-muted-foreground" lang={otherLang(lang)}>
          {sub}
        </p>
      )}
    </>
  );
};

/** What is shown when nothing is there, with a next step when there is one. */
export const Empty = ({
  className,
  children,
  action,
}: {
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}) => (
  <EmptyBlock className={cn('gap-3 p-6', className)}>
    <EmptyDescription>{children}</EmptyDescription>
    {action && <EmptyContent>{action}</EmptyContent>}
  </EmptyBlock>
);

/** A quiet explanatory line under a heading. */
export const Note = ({ className, ...props }: ComponentProps<'p'>) => (
  <p className={cn('mb-2 text-xs text-muted-foreground', className)} {...props} />
);

/** A small menu for a sort order or a measure. */
export const SortSelect = <T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) => (
  <Select
    items={options}
    value={value}
    onValueChange={(next: T | null) => next !== null && onChange(next)}
  >
    <SelectTrigger size="sm" aria-label={label} className={className}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="w-auto min-w-(--anchor-width) whitespace-nowrap">
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

/** A loading line: a spinner and what is being loaded, announced politely. */
export const Loading = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p
    role="status"
    className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}
  >
    <Spinner aria-hidden="true" role="presentation" />
    {children}
  </p>
);

/** The next step for an empty result: clearing the filters, when any are on. */
export const ClearFilters = () => {
  const on = useStore((state) => filterCount(state.filters) > 0);
  if (!on) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => useStore.setState({ filters: NO_FILTERS })}>
      {t('Clear filters')}
    </Button>
  );
};

import { type ReactNode, useState } from 'react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { cn } from '../lib/utils.ts';
import { touchOnly } from '../hooks/use-mobile.ts';
import { t } from '../i18n.ts';

export { SERIES_COLORS } from '../map/palette.ts';

export const DAY_MS = 86_400_000;
export const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const toDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Round-number ticks between two values, about `count` of them. */
export const niceTicks = (min: number, max: number, count = 5): number[] => {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step / 1e6; value += step)
    out.push(Number(value.toFixed(10)));
  return out;
};

export const linear =
  (d0: number, d1: number, r0: number, r1: number) =>
  (value: number): number =>
    d1 === d0 ? (r0 + r1) / 2 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);

/** Quantile class breaks for colouring, like the prefecture metric on the map. */
export const quantiles = (values: number[], classes: number): number[] => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const out: number[] = [sorted[0] ?? 0];
  for (let i = 1; i < classes; i++) {
    const value =
      sorted[Math.min(sorted.length - 1, Math.floor((i / classes) * sorted.length))] ?? 0;
    if (value > (out.at(-1) ?? 0)) out.push(value);
  }
  return out;
};

export const classOf = (breaks: number[], value: number) => {
  let index = -1;
  for (let i = 0; i < breaks.length; i++) if (value >= (breaks[i] ?? Infinity)) index = i;
  return index;
};

/** A chart page: a centred column with its heading (which takes focus when the page opens). */
export const ChartPage = ({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) => (
  <article className="mx-auto max-w-260 px-3 pt-4 pb-[calc(var(--sheet-height,30vh)+24px)] md:px-6 md:pt-5 md:pb-12">
    <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 tabIndex={-1} className="text-2xl font-bold outline-none">
        {t(title)}
      </h1>
      {intro && (
        <p className="text-muted-foreground">{typeof intro === 'string' ? t(intro) : intro}</p>
      )}
    </header>
    {children}
  </article>
);

/** A titled block on a chart page, with an optional control on the right and a note under it. */
export const Panel = ({
  id,
  title,
  control,
  note,
  readout = false,
  className,
  children,
}: {
  id: string;
  title: string;
  control?: ReactNode;
  note?: ReactNode;
  /** A line over the chart that reads out the mark pointed at (marks with `data-tip`). */
  readout?: boolean;
  className?: string;
  children: ReactNode;
}) => (
  <Card
    size="sm"
    role="region"
    aria-labelledby={`${id}-title`}
    className={cn('mb-4 md:[--card-spacing:--spacing(4.5)]', className)}
  >
    <CardHeader>
      <CardTitle>
        <h2 id={`${id}-title`} className="font-semibold">
          {t(title)}
        </h2>
      </CardTitle>
      {note && (
        <CardDescription className="text-xs">
          {typeof note === 'string' ? t(note) : note}
        </CardDescription>
      )}
      {control && <CardAction>{control}</CardAction>}
    </CardHeader>
    <CardContent>
      {readout ? (
        <Readout
          idle={
            touchOnly()
              ? t('Tap the chart to read a value.')
              : t('Point at the chart to read a value.')
          }
        >
          {children}
        </Readout>
      ) : (
        children
      )}
    </CardContent>
  </Card>
);

/** A two- or three-way switch for a chart (distance or time, and so on). */
export const Toggle = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) => (
  <ToggleGroup
    variant="outline"
    size="sm"
    spacing={0}
    aria-label={t(label)}
    value={[value]}
    onValueChange={(next) => {
      const chosen = options.find(([option]) => option !== value && next.includes(option));
      if (chosen) onChange(chosen[0]);
    }}
  >
    {options.map(([option, text]) => (
      <ToggleGroupItem key={option} value={option} className="text-xs">
        {t(text)}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

/** Key for a sequential scale: the class colours with their lower bounds. */
export const ScaleKey = ({
  breaks,
  colors,
  format,
}: {
  breaks: number[];
  colors: string[];
  format: (value: number) => string;
}) => {
  if (breaks.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {t('Less')}
      {breaks.map((value, i) => (
        <span
          key={value}
          className="size-3.5 rounded-sm"
          title={t('{value} or more', { value: format(value) })}
          style={{ background: colors[i] }}
        />
      ))}
      {t('More')}
      <span className="tabular-nums">
        ({format(breaks[0] ?? 0)} to {format(breaks.at(-1) ?? 0)}+)
      </span>
    </p>
  );
};

/**
 * Summary figures across the top of a page. With `hero`, the first is the page's headline: twice
 * as wide and larger, so the eye has one place to start.
 */
export const Figures = ({ items, hero = false }: { items: [string, string][]; hero?: boolean }) => (
  <dl className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
    {items.map(([label, value], i) => (
      <Card
        key={label}
        size="sm"
        className={cn('gap-0.5 px-3.5 py-3', hero && i === 0 && 'col-span-2 justify-center')}
      >
        <dt className="text-xs text-muted-foreground">{t(label)}</dt>
        <dd
          className={cn('font-semibold', hero && i === 0 ? 'text-display' : 'text-xl tabular-nums')}
        >
          {value}
        </dd>
      </Card>
    ))}
  </dl>
);

/**
 * A line over a chart that says what the pointer or the keyboard focus is on: any mark inside with
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

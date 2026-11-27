import { useState, useSyncExternalStore } from 'react';

import { Chip, Note } from '../components/app.tsx';
import { type Season, SEASONS, seasonOf } from '../filters.ts';

import type { ActivityRecord, Route } from '../data.ts';
import { clock, date, distanceText, niceStep, speedText } from '../format.ts';
import { distanceM, distanceUnit } from '../units.ts';
import { getHover, setHover, subscribeHover } from '../hover.ts';
import { useWidth } from '../hooks/use-width.ts';
import { t } from '../i18n.ts';
import { typeColorOf } from '../map/palette.ts';
import { select } from '../store.ts';

/** What the dots compare: the moving time on a fixed course, else the pace (speed on a ride). */
type Measure = 'time' | 'pace' | 'speed';

/** Round steps for a time axis, in seconds. */
const TIME_STEPS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

const H = 132;
// The right margin holds the median's label, clear of the dots.
const PAD = { left: 46, right: 48, top: 12 };
const PLOT_BOTTOM = H - 22;

/**
 * Every time a route was done, as a dot: across by date, up by how fast it went (the moving time,
 * or the pace when the distance varies), with the median as a line and the fastest marked. Pointing
 * at a dot, or at its row in the list below, reads it out and lights its track on the map; a click
 * opens it.
 */
export const RouteTimes = ({
  route,
  activities,
}: {
  route: Route;
  activities: ActivityRecord[];
}) => {
  const [measureRef, width] = useWidth();
  const hovered = useSyncExternalStore(subscribeHover, getHover, getHover);
  // Summer and winter paces do not compare: the chart can keep to one season.
  const [season, setSeason] = useState<Season | null>(null);
  const timed = activities.filter((activity) => activity.movingS && (activity.distanceM ?? 0) > 0);
  const present = SEASONS.filter((entry) =>
    timed.some((activity) => seasonOf(Number(activity.date.slice(5, 7))) === entry.id),
  );
  const runs = timed.filter(
    (activity) => !season || seasonOf(Number(activity.date.slice(5, 7))) === season,
  );
  if (timed.length < 2) return null;
  const picker = present.length > 1 && (
    <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={t('Season')}>
      {[{ id: null, label: t('All seasons') }, ...present].map((entry) => (
        <Chip key={entry.id ?? 'all'} on={season === entry.id} onToggle={() => setSeason(entry.id)}>
          {entry.label}
        </Chip>
      ))}
    </div>
  );
  if (runs.length < 2)
    return (
      <figure className="mt-4">
        {picker}
        <Note>{t('Fewer than two runs in this season.')}</Note>
      </figure>
    );

  const varies = route.maxDistanceM > route.minDistanceM * 1.05;
  const measure: Measure = !varies ? 'time' : route.type === 'ride' ? 'speed' : 'pace';
  const value = (activity: ActivityRecord) => {
    const seconds = activity.movingS ?? 0;
    const lengths = (activity.distanceM ?? 0) / distanceM();
    return measure === 'time'
      ? seconds
      : measure === 'pace'
        ? seconds / lengths
        : lengths / (seconds / 3600);
  };
  const format = (v: number) =>
    measure === 'time'
      ? clock(v)
      : measure === 'pace'
        ? `${clock(v)}/${distanceUnit()}`
        : speedText(v);
  const faster = (a: number, b: number) => (measure === 'speed' ? a > b : a < b);
  const amountOf = (change: number) =>
    measure === 'time'
      ? clock(Math.abs(change))
      : measure === 'pace'
        ? `${clock(Math.abs(change))}/${distanceUnit()}`
        : speedText(Math.abs(change));

  const values = runs.map(value);
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  const median =
    sorted.length % 2
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const best = runs.reduce((top, activity) =>
    faster(value(activity), value(top)) ? activity : top,
  );

  // Axes: dates across; the measure up, faster at the top, with a little room round the dots.
  const W = Math.max(240, width || 320);
  const plotW = W - PAD.left - PAD.right;
  const times = runs.map((activity) => Date.parse(activity.date));
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const x = (day: string) =>
    t1 > t0 ? PAD.left + ((Date.parse(day) - t0) / (t1 - t0)) * plotW : PAD.left + plotW / 2;
  const spread = Math.max(...values) - Math.min(...values);
  const room = Math.max(spread * 0.12, measure === 'speed' ? 0.5 : 10);
  const raw = spread + room * 2;
  const step =
    measure === 'speed'
      ? niceStep(raw, 3)
      : (TIME_STEPS.find((candidate) => candidate >= raw / 3) ?? 7200);
  const low = Math.floor((Math.min(...values) - room) / step) * step;
  const high = Math.ceil((Math.max(...values) + room) / step) * step;
  const y = (v: number) => {
    const share = (v - low) / Math.max(1e-9, high - low);
    return PAD.top + (measure === 'speed' ? 1 - share : share) * (PLOT_BOTTOM - PAD.top);
  };
  const ticks: number[] = [];
  for (let v = low; v <= high + 1e-9; v += step) ticks.push(v);
  const tick = (v: number) => (measure === 'speed' ? v.toFixed(step < 1 ? 1 : 0) : clock(v));

  // The trend: a straight line through the dots (least squares), from the first run to the last.
  const mean = (numbers: number[]) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  const [mt, mv] = [mean(times), mean(values)];
  const spreadT = times.reduce((sum, time) => sum + (time - mt) ** 2, 0);
  const slope =
    spreadT > 0
      ? times.reduce((sum, time, i) => sum + (time - mt) * ((values[i] ?? 0) - mv), 0) / spreadT
      : 0;
  const clamp = (v: number) => Math.max(low, Math.min(high, v));
  const trend =
    runs.length >= 4 && t1 > t0
      ? [clamp(mv + slope * (t0 - mt)), clamp(mv + slope * (t1 - mt))]
      : null;
  // Faster or slower per 30 days, in the measure's own terms.
  const drift = slope * 30 * 86_400_000;
  const quicker = measure === 'speed' ? drift > 0 : drift < 0;

  const pointed = runs.find((activity) => activity.id === hovered);
  const label = measure === 'time' ? t('Moving time') : measure === 'pace' ? t('Pace') : t('Speed');
  const colour = typeColorOf(route.type);

  return (
    <figure className="mt-4">
      {picker}
      <p className="mb-1 flex min-h-5 justify-between gap-3 text-compact tabular-nums" aria-hidden>
        {pointed ? (
          <span className="truncate font-semibold">
            {[
              date(pointed.date),
              format(value(pointed)),
              distanceText(pointed.distanceM),
              ...(pointed === best ? [t('fastest')] : []),
            ].join(' · ')}
          </span>
        ) : (
          <span className="truncate">
            {t('{measure}: median {median}, fastest {fastest} (ringed)', {
              measure: label,
              median: format(median),
              fastest: format(value(best)),
            })}
          </span>
        )}
      </p>
      <svg
        ref={measureRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full select-none"
        role="img"
        aria-label={t(
          '{measure} each of the {count} times, {from} to {to}: median {median}, fastest {fastest} on {day}',
          {
            measure: label,
            count: runs.length,
            from: date(runs.at(-1)?.date),
            to: date(runs[0]?.date),
            median: format(median),
            fastest: format(value(best)),
            day: date(best.date),
          },
        )}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" />
            <text
              x={PAD.left - 6}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              className="fill-muted-foreground text-axis"
            >
              {tick(v)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={y(median)}
          y2={y(median)}
          className="stroke-foreground/35"
        />
        {trend && (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(trend[0] ?? 0)}
            y2={y(trend[1] ?? 0)}
            stroke={colour}
            strokeOpacity={0.45}
            strokeWidth={2}
            strokeLinecap="round"
          />
        )}
        <text
          x={W - PAD.right + 6}
          y={y(median)}
          dy="0.32em"
          className="fill-muted-foreground text-axis"
        >
          {t('median')}
        </text>
        {runs.map((activity) => {
          const on = activity.id === hovered;
          return (
            <g
              key={activity.id}
              className="cursor-pointer"
              onPointerEnter={() => setHover(activity.id)}
              onPointerLeave={() => setHover(null)}
              onClick={() => select({ kind: 'activity', id: activity.id }, true)}
            >
              {/* A bigger target than the dot, so it is easy to point at. */}
              <circle cx={x(activity.date)} cy={y(value(activity))} r={12} fill="transparent" />
              <circle
                cx={x(activity.date)}
                cy={y(value(activity))}
                r={on ? 6 : 4.5}
                fill={colour}
                className="stroke-background"
                strokeWidth={2}
              />
              {/* The fastest wears a ring; the readout above names it. */}
              {activity === best && (
                <circle
                  cx={x(activity.date)}
                  cy={y(value(activity))}
                  r={on ? 9.5 : 8}
                  fill="none"
                  className="stroke-foreground"
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        })}
        <text x={PAD.left} y={H - 4} className="fill-muted-foreground text-axis">
          {date(runs.at(-1)?.date)}
        </text>
        <text
          x={W - PAD.right}
          y={H - 4}
          textAnchor="end"
          className="fill-muted-foreground text-axis"
        >
          {date(runs[0]?.date)}
        </text>
      </svg>
      <figcaption className="mt-1 text-xs text-muted-foreground">
        {trend && Math.abs(drift) >= (measure === 'speed' ? 0.05 : 1) && (
          <span className="mb-0.5 block text-foreground tabular-nums">
            {quicker
              ? t('Trend: {amount} faster per month', { amount: amountOf(drift) })
              : t('Trend: {amount} slower per month', { amount: amountOf(drift) })}
          </span>
        )}
        {t(
          'One dot per run: across by date, higher is faster. Point at one to read it; click to open it.',
        )}
      </figcaption>
    </figure>
  );
};

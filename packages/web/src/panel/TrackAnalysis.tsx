import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useMemo } from 'react';

import { Facts, Fold, Loading, Note, Section } from '../components/app.tsx';
import type { ActivityRecord, Data } from '../data.ts';
import { metresBetween } from '../format.ts';
import { nameIn, useLang } from '../names.tsx';
import { clock, distanceText, heightText, niceStep, numberText, paceOrSpeed } from '../format.ts';
import { distanceM, distanceUnit, heightM } from '../units.ts';
import { useWidth } from '../hooks/use-width.ts';
import { t } from '../i18n.ts';
import { tracksByYear, useLoaded } from '../lazy.ts';
import { cn } from '../lib/utils.ts';
import { typeColorOf } from '../map/palette.ts';
import {
  type Analysis,
  gradeBand,
  analysisOf,
  getTrackCursor,
  pointSplit,
  pointTrack,
  releaseTrack,
  type Sample,
  useTrackPoint,
  useTrackRange,
  valueAt,
} from '../profile.ts';

/** Gradient bands, steepest downhill first, as named in the key; colours in index.css. */
const BANDS = [
  { name: 'Steep down', range: '8%+' },
  { name: 'Down', range: '3–8%' },
  { name: 'Flat', range: '±3%' },
  { name: 'Up', range: '3–8%' },
  { name: 'Steep up', range: '8%+' },
] as const;
const bandColour = (band: number) => `var(--grade-${band + 1})`;

const signed = (grade: number) =>
  `${grade > 0.0005 ? '+' : grade < -0.0005 ? '−' : ''}${Math.abs(grade * 100).toFixed(1)}%`;

/** The track's heights, gradients and splits, under the activity's figures. */
export const TrackAnalysis = ({ data, activity }: { data: Data; activity: ActivityRecord }) => {
  useLoaded();
  // Whatever points along this track lets go when another activity opens or the detail closes.
  useEffect(() => () => releaseTrack(), [activity.id]);
  const loaded = activity.trackYear !== undefined && tracksByYear.has(activity.trackYear);
  if (!loaded) return <Loading>{t('Loading the track…')}</Loading>;
  const analysis = analysisOf(activity);
  if (!analysis?.heights && !analysis?.splits)
    return <Note>{t('No heights or times are published for this track.')}</Note>;
  return (
    <>
      {analysis.heights && <HeightProfile data={data} activity={activity} analysis={analysis} />}
      {analysis.splits && <Splits activity={activity} analysis={analysis} />}
    </>
  );
};

const H = 140;
const PAD = { left: 40, right: 8, top: 10 };
const PLOT_BOTTOM = H - 30;
const STRIP = { top: PLOT_BOTTOM + 4, height: 5 };

const HeightProfile = ({
  data,
  activity,
  analysis,
}: {
  data: Data;
  activity: ActivityRecord;
  analysis: Analysis;
}) => {
  const lang = useLang();
  const { samples, total, grades } = analysis;
  const heights = analysis.heights as NonNullable<Analysis['heights']>;
  const colour = typeColorOf(activity.type);
  const point = useTrackPoint(activity.id);
  const range = useTrackRange(activity.id);
  const [measure, width] = useWidth();
  const W = Math.max(240, width || 320);
  const plotW = W - PAD.left - PAD.right;
  const zs = useMemo(() => samples.map((sample) => sample.z ?? 0), [samples]);
  const times = useMemo(
    () => (analysis.splits ? samples.map((sample) => sample.t ?? 0) : null),
    [samples, analysis.splits],
  );
  // The list places this activity reached, where the track comes nearest each (within 400 m).
  const flags = useMemo(
    () =>
      activity.places.flatMap((place) => {
        const item = data.itemsByPlace.get(place)?.[0]?.item;
        if (!item?.at) return [];
        let best = 400;
        let at: Sample | undefined;
        for (const sample of samples) {
          const away = metresBetween([sample.lon, sample.lat], item.at);
          if (away < best) {
            best = away;
            at = sample;
          }
        }
        return at ? [{ id: place, d: at.d, z: at.z ?? 0, name: item.name }] : [];
      }),
    [activity, data, samples],
  );

  // A flat run is not drawn as mountains: at least 40 m of height on the axis.
  const middle = (heights.low + heights.high) / 2;
  const span = Math.max(40, heights.high - heights.low);
  // Steps are round in the units shown (metres or feet), then placed in metres.
  const yStep = niceStep(span / heightM(), 3) * heightM();
  const yLow = Math.floor(Math.min(heights.low, middle - span / 2) / yStep) * yStep;
  const yHigh = Math.ceil(Math.max(heights.high, middle + span / 2) / yStep) * yStep;
  const x = (d: number) => PAD.left + (d / Math.max(1, total)) * plotW;
  const y = (z: number) =>
    PLOT_BOTTOM - ((z - yLow) / Math.max(1, yHigh - yLow)) * (PLOT_BOTTOM - PAD.top);
  const yTicks: number[] = [];
  for (let value = yLow; value <= yHigh + 0.001; value += yStep) yTicks.push(value);
  const xStep = niceStep(total / distanceM(), Math.max(2, Math.floor(plotW / 64))) * distanceM();
  const xTicks: number[] = [];
  for (let d = 0; d <= total + 1; d += xStep) xTicks.push(d);

  const { line, area, strip } = useMemo(() => {
    const byStretch = new Map<number, Sample[]>();
    for (const sample of samples) {
      const part = byStretch.get(sample.stretch);
      if (part) part.push(sample);
      else byStretch.set(sample.stretch, [sample]);
    }
    const xy = (sample: Sample) => `${x(sample.d).toFixed(1)},${y(sample.z ?? 0).toFixed(1)}`;
    const parts = [...byStretch.values()];
    // The gradient strip: one block per run of points in the same band.
    const blocks: { from: number; to: number; band: number }[] = [];
    samples.forEach((sample, i) => {
      const next = samples[i + 1];
      if (!next || next.d <= sample.d) return;
      const band = gradeBand(((grades?.[i] ?? 0) + (grades?.[i + 1] ?? 0)) / 2);
      const last = blocks.at(-1);
      if (last && last.band === band && last.to === sample.d) last.to = next.d;
      else blocks.push({ from: sample.d, to: next.d, band });
    });
    return {
      line: parts.map((part) => `M${part.map(xy).join('L')}`).join(''),
      area: parts
        .map(
          (part) =>
            `M${x(part[0]?.d ?? 0).toFixed(1)},${PLOT_BOTTOM}L${part.map(xy).join('L')}L${x(part.at(-1)?.d ?? 0).toFixed(1)},${PLOT_BOTTOM}Z`,
        )
        .join(''),
      strip: blocks,
    };
    // x and y are drawn from these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, grades, W, yLow, yHigh, total]);

  /** What the readout says about a point along the track. */
  const describe = (d: number) => {
    const parts = [
      distanceText(d, 2),
      heightText(valueAt(samples, zs, d)),
      signed(grades ? valueAt(samples, grades, d) : 0),
    ];
    if (times) {
      parts.push(clock(valueAt(samples, times, d)));
      const a = Math.max(0, d - 150);
      const b = Math.min(total, d + 150);
      const here = paceOrSpeed(
        activity.type,
        b - a,
        valueAt(samples, times, b) - valueAt(samples, times, a),
      );
      if (here !== '–') parts.push(t('{pace} here', { pace: here }));
    }
    return parts.join(' · ');
  };

  const at = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share =
      (event.clientX - box.left - (PAD.left / W) * box.width) / ((plotW / W) * box.width);
    return Math.max(0, Math.min(1, share)) * total;
  };
  const step = (event: KeyboardEvent<HTMLDivElement>) => {
    const unit = total / 100;
    const now = point ?? 0;
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? now + unit
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? now - unit
          : event.key === 'PageUp'
            ? now + unit * 10
            : event.key === 'PageDown'
              ? now - unit * 10
              : event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? total
                  : undefined;
    if (event.key === 'Escape') releaseTrack('profile');
    if (next === undefined) return;
    event.preventDefault();
    pointTrack(activity.id, Math.max(0, Math.min(total, next)), 'profile');
  };

  return (
    <Section title="Height">
      <p className="mb-1 flex min-h-5 justify-between gap-3 text-compact tabular-nums" aria-hidden>
        {point === null ? (
          <>
            <span>
              {heightText(heights.low)} – {heightText(heights.high)}
            </span>
            <span className="text-muted-foreground">{distanceText(total)}</span>
          </>
        ) : (
          <span className="truncate font-semibold">{describe(point)}</span>
        )}
      </p>
      <div
        ref={measure}
        role="slider"
        tabIndex={0}
        aria-label={t('Point along the track, shown on the map')}
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(point ?? 0)}
        aria-valuetext={describe(point ?? 0)}
        onKeyDown={step}
        // From the keyboard, focus starts at the beginning; a click says where itself.
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible') && getTrackCursor().id !== activity.id)
            pointTrack(activity.id, 0, 'profile');
        }}
        onBlur={() => releaseTrack('profile')}
        className="rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full touch-pan-y select-none"
          onPointerMove={(event) => pointTrack(activity.id, at(event), 'profile')}
          onPointerDown={(event) => pointTrack(activity.id, at(event), 'profile')}
          onPointerLeave={(event) => event.pointerType === 'mouse' && releaseTrack('profile')}
          aria-hidden
        >
          {yTicks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(value)}
                y2={y(value)}
                className="stroke-border"
              />
              <text
                x={PAD.left - 6}
                y={y(value)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted-foreground text-axis"
              >
                {numberText(Math.round(value / heightM()))}
              </text>
            </g>
          ))}
          {range && (
            <rect
              x={x(range[0])}
              y={PAD.top}
              width={Math.max(1, x(range[1]) - x(range[0]))}
              height={PLOT_BOTTOM - PAD.top}
              className="fill-foreground/8"
            />
          )}
          <path d={area} fill={colour} fillOpacity={0.12} />
          <path
            d={line}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {strip.map((block) => (
            <rect
              key={block.from}
              x={x(block.from)}
              y={STRIP.top}
              width={Math.max(0.5, x(block.to) - x(block.from))}
              height={STRIP.height}
              fill={bandColour(block.band)}
            />
          ))}
          {xTicks.map((d, i) => (
            <text
              key={d}
              x={x(d)}
              y={H - 4}
              textAnchor={i === 0 ? 'start' : x(d) > W - PAD.right - 20 ? 'end' : 'middle'}
              className="fill-muted-foreground text-axis"
            >
              {(d / distanceM()).toLocaleString('en', { maximumFractionDigits: 1 })}
              {i === xTicks.length - 1 ? ` ${distanceUnit()}` : ''}
            </text>
          ))}
          {flags.map((flag, i) => (
            <g key={flag.id}>
              <title>{nameIn(flag.name, lang)}</title>
              {/* Room to point at: the marker itself is a few pixels. */}
              <circle cx={x(flag.d)} cy={y(flag.z) - 8} r={11} fill="transparent" />
              <path
                d={`M${x(flag.d)},${y(flag.z) - 3}l-4,-8h8z`}
                className="fill-foreground stroke-background"
                strokeWidth={1}
              />
              {/* Names for the first three; the rest keep their marker. */}
              {i < 3 && (
                <text
                  x={x(flag.d)}
                  y={Math.max(9, y(flag.z) - 14)}
                  textAnchor={
                    x(flag.d) < PAD.left + 40 ? 'start' : x(flag.d) > W - 50 ? 'end' : 'middle'
                  }
                  className="fill-foreground text-axis font-semibold"
                >
                  {nameIn(flag.name, lang)}
                </text>
              )}
            </g>
          ))}
          {point !== null && (
            <g className="pointer-events-none">
              <line
                x1={x(point)}
                x2={x(point)}
                y1={PAD.top}
                y2={STRIP.top + STRIP.height}
                className="stroke-foreground/40"
              />
              <circle
                cx={x(point)}
                cy={y(valueAt(samples, zs, point))}
                r={4.5}
                fill={colour}
                className="stroke-background"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      </div>
      <GradeBar bands={heights.bands} />
      <Fold
        pref="heightFigures"
        title="More figures"
        summary={`${t('Highest')} ${heightText(heights.high)} · ${t('Descent')} ${heightText(heights.descent)}`}
        nested
      >
        <Facts
          className="mt-2 mb-0"
          rows={[
            ['Lowest', heightText(heights.low)],
            ['Highest', heightText(heights.high)],
            ['Descent', heightText(heights.descent)],
            [
              'Steepest climb',
              <Steepest key="up" id={activity.id} stretch={heights.up} metres={heights.steepM} />,
            ],
            [
              'Steepest descent',
              <Steepest
                key="down"
                id={activity.id}
                stretch={heights.down}
                metres={heights.steepM}
              />,
            ],
          ]}
        />
      </Fold>
    </Section>
  );
};

/** The steepest part, which shows itself on the profile and the map when pointed at. */
const Steepest = ({
  id,
  stretch,
  metres,
}: {
  id: string;
  stretch: NonNullable<Analysis['heights']>['up'];
  metres: number;
}) => {
  if (!stretch) return '–';
  const show = () => pointSplit(id, [stretch.from, stretch.to]);
  const hide = () => releaseTrack('split');
  return (
    <button
      type="button"
      className="-mx-1 rounded-sm px-1 text-left hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={show}
      title={t('Show it on the map')}
    >
      {signed(stretch.grade)}{' '}
      <span className="text-xs font-normal text-muted-foreground">
        {t('over {length} at {distance}', {
          length: heightText(metres),
          distance: distanceText(stretch.from),
        })}
      </span>
    </button>
  );
};

/** How much of the track is in each gradient band: a thin bar and its key. */
const GradeBar = ({ bands }: { bands: number[] }) => {
  const sum = bands.reduce((total, metres) => total + metres, 0) || 1;
  const share = (metres: number) => Math.round((metres / sum) * 100);
  const label = BANDS.map((band, i) => `${t(band.name)} ${share(bands[i] ?? 0)}%`).join(', ');
  return (
    <figure className="mt-3">
      <div
        className="flex h-2 gap-0.5"
        role="img"
        aria-label={t('Gradient: {bands}', { bands: label })}
      >
        {bands.map((metres, i) =>
          metres > 0 ? (
            <div
              key={BANDS[i]?.name}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{ flexGrow: metres, background: bandColour(i) }}
              title={`${t(BANDS[i]?.name ?? '')} ${BANDS[i]?.range ?? ''}: ${share(metres)}%`}
            />
          ) : null,
        )}
      </div>
      <figcaption
        className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
        aria-hidden
      >
        {BANDS.map((band, i) => (
          <span key={band.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-xs" style={{ background: bandColour(i) }} />
            {t(band.name)}
            <span className="font-semibold text-foreground tabular-nums">
              {share(bands[i] ?? 0)}%
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
};

/** Moving time per kilometre (or per few, on long rides), with each one's climb and descent. */
const Splits = ({ activity, analysis }: { activity: ActivityRecord; analysis: Analysis }) => {
  const splits = analysis.splits ?? [];
  const range = useTrackRange(activity.id);
  const speed = (split: { from: number; to: number; seconds: number }) =>
    split.seconds > 0 ? (split.to - split.from) / split.seconds : 0;
  // The fastest among the whole ones; a short last split is easy to run fast.
  const whole = splits.filter((split) => split.to - split.from >= analysis.splitM * 0.5);
  const fastest = whole.reduce<(typeof splits)[number] | undefined>(
    (best, split) => (!best || speed(split) > speed(best) ? split : best),
    undefined,
  );
  const top = Math.max(...splits.map(speed), 0.001);
  const colour = typeColorOf(activity.type);
  const heights = analysis.heights !== null;
  return (
    <Fold
      pref="splits"
      title="Splits"
      count={splits.length}
      summary={
        fastest
          ? t('fastest {pace}', {
              pace: paceOrSpeed(activity.type, fastest.to - fastest.from, fastest.seconds),
            })
          : undefined
      }
    >
      <table className="w-full text-compact tabular-nums">
        <caption className="sr-only">
          {t('Moving time per {length}', { length: distanceText(analysis.splitM, 0) })}
        </caption>
        <thead className="text-axis text-muted-foreground">
          <tr>
            <th scope="col" className="pr-3 pb-1 text-left font-normal">
              {distanceUnit()}
            </th>
            <th scope="col" className="pb-1 text-left font-normal">
              {t(activity.type === 'ride' ? 'Speed' : 'Pace')}
            </th>
            <th scope="col" className="pb-1 font-normal">
              <span className="sr-only">{t('Compared')}</span>
            </th>
            {heights && (
              <th scope="col" className="pb-1 text-right font-normal whitespace-nowrap">
                {t('Up / down')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {splits.map((split) => {
            const active = range?.[0] === split.from && range[1] === split.to;
            return (
              <tr
                key={split.from}
                className={cn('h-8 border-t first:border-t-0', active && 'bg-muted')}
                onPointerEnter={() => pointSplit(activity.id, [split.from, split.to])}
                onPointerLeave={() => releaseTrack('split')}
              >
                <td className="pr-3 whitespace-nowrap text-muted-foreground">
                  {(split.to / distanceM()).toLocaleString('en', { maximumFractionDigits: 1 })}
                </td>
                <td className="pr-3 whitespace-nowrap">
                  <span className="font-semibold">
                    {paceOrSpeed(activity.type, split.to - split.from, split.seconds)}
                  </span>
                  {split === fastest && splits.length > 1 && (
                    <span className="ml-1.5 text-xs text-muted-foreground">{t('fastest')}</span>
                  )}
                </td>
                <td className="w-full pr-3">
                  <div
                    className="h-2 rounded-r-[4px]"
                    style={{
                      width: `${Math.max(4, (speed(split) / top) * 100)}%`,
                      background: colour,
                    }}
                  />
                </td>
                {heights && (
                  <td className="text-right text-xs whitespace-nowrap text-muted-foreground">
                    +{numberText(Math.round(split.climb / heightM()))} / −
                    {heightText(split.descent)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <SplitsNote moving={analysis.moving} />
    </Fold>
  );
};

const SplitsNote = ({ moving }: { moving: number | null }): ReactNode =>
  moving === null ? null : (
    <p className="mt-2 text-xs text-muted-foreground">
      {t('Moving time along the published track, {time}; pauses are left out.', {
        time: clock(moving),
      })}
    </p>
  );

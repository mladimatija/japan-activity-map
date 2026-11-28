import type { ActivityRecord, Data, List } from '../data.ts';
import { derive, type Derived, type Filters, summarise, weekdayIndex } from '../filters.ts';
import { REGIONS } from '@jam/core/prefectures';
import { date, distanceText, duration, heightText, percent, typeLabel } from '../format.ts';
import { METRIC_SCALE, STATUS_COLORS, UNKNOWN_TYPE_COLOR } from '../map/palette.ts';
import { usePref } from '../prefs.ts';
import { showOnMap, useStore } from '../store.ts';
import { cn } from '../lib/utils.ts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.tsx';
import { PrefectureMap } from './PrefectureMap.tsx';
import {
  ChartPage,
  classOf,
  DAY_MS,
  Figures,
  linear,
  niceTicks,
  Panel,
  quantiles,
  ScaleKey,
  SERIES_COLORS,
  toDay,
  toTime,
  Toggle,
} from './charts.tsx';
import { Name, nameIn, SUB_ON_WIDE, useLang } from '../names.tsx';
import { localized, t } from '../i18n.ts';

const WEEKDAYS = localized(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
const MONTH_SHORT = localized([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);
// Monday first.
const weekdayOf = (day: string) => (weekdayIndex(day) + 6) % 7;

/** Opens a list on the map, narrowed by place filters, as a chart click does. */
const openList = (list: string, place: Partial<Filters> = {}) => {
  useStore.setState((state) => ({
    page: 'map',
    list,
    view: 'list',
    selection: null,
    filters: { ...state.filters, status: [], in: null, regions: [], ...place },
  }));
};

/** Days with activities: count, distance, time, and the longest activity (what a click opens). */
export const byDay = (activities: readonly ActivityRecord[]) => {
  const days = new Map<
    string,
    { count: number; distanceM: number; movingS: number; longest: ActivityRecord }
  >();
  for (const activity of activities) {
    const entry = days.get(activity.date);
    if (!entry)
      days.set(activity.date, {
        count: 1,
        distanceM: activity.distanceM ?? 0,
        movingS: activity.movingS ?? 0,
        longest: activity,
      });
    else {
      entry.count++;
      entry.distanceM += activity.distanceM ?? 0;
      entry.movingS += activity.movingS ?? 0;
      if ((activity.distanceM ?? 0) > (entry.longest.distanceM ?? 0)) entry.longest = activity;
    }
  }
  return days;
};

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const LEFT = 28;
const TOP = 16;

/** One row of weeks per year, a square per day, coloured by distance or time. */
const Calendar = ({ activities }: { activities: readonly ActivityRecord[] }) => {
  const [metric, setMetric] = usePref<'distance' | 'time'>('calendarMetric', 'distance', [
    'distance',
    'time',
  ]);
  const days = byDay(activities);
  const value = (entry: { distanceM: number; movingS: number }) =>
    metric === 'distance' ? entry.distanceM : entry.movingS;
  const breaks = quantiles([...days.values()].map(value), METRIC_SCALE.length);
  const years = [...new Set([...days.keys()].map((day) => Number(day.slice(0, 4))))].sort(
    (a, b) => b - a,
  );
  const format = (amount: number) =>
    metric === 'distance' ? distanceText(amount, 0) : duration(amount);
  // One year at a time, the latest first; a year the filters leave out falls back to it.
  const [chosen, setShown] = usePref<string>('calendarYear', '');
  const shown =
    chosen === 'all' || years.includes(Number(chosen)) ? chosen : String(years[0] ?? '');
  const figure = (year: number) => {
    const start = Date.UTC(year, 0, 1);
    const offset = (new Date(start).getUTCDay() + 6) % 7;
    const total = (Date.UTC(year + 1, 0, 1) - start) / DAY_MS;
    const yearDays = [...days].filter(([day]) => day.startsWith(String(year)));
    const width = LEFT + 54 * STEP;
    return (
      <figure key={year} className="mb-3">
        <figcaption>
          <strong className="tabular-nums">{year}</strong>{' '}
          <span className="text-muted-foreground tabular-nums">
            {t('{count} days', { count: yearDays.length })} ·{' '}
            {format(yearDays.reduce((sum, [, entry]) => sum + value(entry), 0))}
          </span>
        </figcaption>
        <svg
          viewBox={`0 0 ${width} ${TOP + 7 * STEP}`}
          role="img"
          aria-label={t('{year}: {count} days with activities', { year, count: yearDays.length })}
        >
          {MONTH_SHORT.map((month, i) => {
            const first = (Date.UTC(year, i, 1) - start) / DAY_MS;
            return (
              <text
                key={month}
                x={LEFT + Math.floor((first + offset) / 7) * STEP}
                y={10}
                className="fill-muted-foreground text-axis"
              >
                {month}
              </text>
            );
          })}
          {[0, 2, 4].map((row) => (
            <text
              key={row}
              x={0}
              y={TOP + row * STEP + 9}
              className="fill-muted-foreground text-axis"
            >
              {WEEKDAYS[row]}
            </text>
          ))}
          {Array.from({ length: total }, (_, index) => {
            const day = toDay(start + index * DAY_MS);
            const entry = days.get(day);
            const column = Math.floor((index + offset) / 7);
            const row = (index + offset) % 7;
            const k = entry ? classOf(breaks, value(entry)) : -1;
            return (
              <rect
                key={day}
                x={LEFT + column * STEP}
                y={TOP + row * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                className={
                  entry
                    ? 'cursor-pointer fill-muted hover:stroke-foreground hover:stroke-[1.5]'
                    : 'fill-muted'
                }
                style={entry ? { fill: METRIC_SCALE[Math.max(0, k)] } : undefined}
                data-tip={
                  entry
                    ? `${date(day)}: ${entry.count === 1 ? t('1 activity') : t('{count} activities', { count: entry.count })}, ${distanceText(entry.distanceM)}, ${duration(entry.movingS)}`
                    : date(day)
                }
                onClick={
                  entry ? () => showOnMap({ kind: 'activity', id: entry.longest.id }) : undefined
                }
              ></rect>
            );
          })}
        </svg>
      </figure>
    );
  };
  return (
    <Panel
      id="calendar"
      title="Every day out"
      readout
      control={
        <Toggle
          label="Colour days by"
          value={metric}
          options={[
            ['distance', 'Distance'],
            ['time', 'Time'],
          ]}
          onChange={setMetric}
        />
      }
      note="Select a day to see its longest activity on the map."
    >
      {years.length === 0 && (
        <p className="py-2 text-muted-foreground">{t('No activities match these filters.')}</p>
      )}
      {years.length > 0 && (
        <Tabs value={shown} onValueChange={(value: string) => setShown(value)} className="gap-3">
          <TabsList variant="line" aria-label={t('Year')} className="flex-wrap">
            {years.map((year) => (
              <TabsTrigger key={year} value={String(year)} className="flex-none">
                {year}
              </TabsTrigger>
            ))}
            <TabsTrigger value="all" className="flex-none">
              {t('All years')}
            </TabsTrigger>
          </TabsList>
          {years.map((year) => (
            <TabsContent key={year} value={String(year)}>
              {figure(year)}
            </TabsContent>
          ))}
          <TabsContent value="all">{years.map(figure)}</TabsContent>
        </Tabs>
      )}
      <ScaleKey breaks={breaks} colors={METRIC_SCALE} format={format} />
    </Panel>
  );
};

/** When activities start: hour across, weekday down. */
const HourGrid = ({ data, derived }: { data: Data; derived: Derived }) => {
  const timed = data.activities.some((activity) => activity.time);
  const types = derived.filters.types;
  let grid: number[][];
  let note: string;
  if (timed) {
    grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const activity of derived.activities) {
      if (!activity.time) continue;
      const row = grid[weekdayOf(activity.date)];
      const hour = Number(activity.time.slice(0, 2));
      if (row) row[hour] = (row[hour] ?? 0) + 1;
    }
    note = 'Start times of the matching activities.';
  } else {
    const byType = data.stats.hourByWeekdayByType as Record<string, number[][] | undefined>;
    const chosen = types.length ? types : Object.keys(byType);
    grid = Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 24 }, (_, hour) =>
        chosen.reduce((sum, type) => sum + (byType[type]?.[day]?.[hour] ?? 0), 0),
      ),
    );
    note = derived.activityIds
      ? t('Times of day are not published, so this follows only the type filter{types}.', {
          types: types.length ? ` (${types.map(typeLabel).join(', ')})` : '',
        })
      : 'Counted at build time from start times, which are not published themselves.';
  }
  const breaks = quantiles(grid.flat(), METRIC_SCALE.length);
  const width = LEFT + 24 * 22;
  return (
    <Panel id="hours" title="When activities start" note={note} readout>
      <svg
        viewBox={`0 0 ${width} ${TOP + 7 * 22}`}
        role="img"
        aria-label={t('Activities by start hour and weekday')}
        className="block h-auto w-full max-w-150"
      >
        {[0, 6, 12, 18].map((hour) => (
          <text key={hour} x={LEFT + hour * 22} y={10} className="fill-muted-foreground text-axis">
            {String(hour).padStart(2, '0')}:00
          </text>
        ))}
        {grid.map((row, day) => (
          <g key={WEEKDAYS[day]}>
            <text x={0} y={TOP + day * 22 + 14} className="fill-muted-foreground text-axis">
              {WEEKDAYS[day]}
            </text>
            {row.map((count, hour) => (
              <rect
                key={hour}
                x={LEFT + hour * 22}
                y={TOP + day * 22}
                width={20}
                height={20}
                rx={3}
                className="fill-muted"
                style={
                  count ? { fill: METRIC_SCALE[Math.max(0, classOf(breaks, count))] } : undefined
                }
                data-tip={`${WEEKDAYS[day]} ${String(hour).padStart(2, '0')}:00: ${count}`}
              />
            ))}
          </g>
        ))}
      </svg>
      <ScaleKey breaks={breaks} colors={METRIC_SCALE} format={String} />
    </Panel>
  );
};

/** Done for a list item: its status, or with activity filters on, reached by a matching activity. */
const doneIn = (derived: Derived) => (item: List['items'][number]) =>
  derived.activityIds ? derived.visits(item) > 0 : item.status === 'done';

/** Done out of total for every point list, the bar split into regions north to south. */
const ListBars = ({ data, derived }: { data: Data; derived: Derived }) => {
  const lang = useLang();
  const done = doneIn(derived);
  const lists = data.lists.filter((list) => list.kind === 'point');
  return (
    <Panel
      id="lists"
      title="Lists, region by region"
      readout
      note={
        derived.activityIds
          ? 'Done here means reached by a matching activity. Select a region to open it on the map.'
          : 'Select a list or a region to open it on the map.'
      }
    >
      <ul className="flex flex-col gap-2.5">
        {lists.map((list) => {
          const regions = REGIONS.map((region) => {
            const items = list.items.filter(
              (item) =>
                data.prefectureByCode.get(item.prefectures[0] ?? '')?.properties.region ===
                region.id,
            );
            return { region, total: items.length, done: items.filter(done).length };
          }).filter((entry) => entry.total > 0);
          const total = list.items.length;
          const doneCount = list.items.filter(done).length;
          let x = 0;
          return (
            <li key={list.id}>
              <button
                type="button"
                className="group/name mb-1 flex w-full items-baseline gap-2 text-left [&_[data-name=main]]:group-hover/name:underline"
                onClick={() => openList(list.id)}
              >
                {/* A phone has room for one name beside the figures. */}
                <Name name={list.title} sub={SUB_ON_WIDE} />
                <span className="ml-auto flex-none tabular-nums">
                  {doneCount} / {total} · {percent(doneCount, total)}
                </span>
              </button>
              <svg
                viewBox="0 0 1000 18"
                preserveAspectRatio="none"
                className="block h-4.5 w-full rounded-sm"
                aria-hidden="true"
              >
                {regions.map(({ region, total: count, done: reached }) => {
                  const width = (count / total) * 1000;
                  const left = x;
                  x += width;
                  return (
                    <g
                      key={region.id}
                      className="group/segment cursor-pointer"
                      data-tip={`${nameIn(list.title, lang)} · ${nameIn(region, lang)}: ${t('{done} of {total}', { done: reached, total: count })}`}
                      onClick={() => openList(list.id, { regions: [region.id] })}
                    >
                      <rect
                        x={left}
                        y={0}
                        width={Math.max(0, width - 3)}
                        height={18}
                        className="fill-muted group-hover/segment:fill-border"
                      />
                      <rect
                        x={left}
                        y={0}
                        width={Math.max(0, (reached / count) * width - 3)}
                        height={18}
                        style={{ fill: STATUS_COLORS.done }}
                      />
                    </g>
                  );
                })}
              </svg>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};

interface Series {
  id: string;
  label: string;
  color: string;
  points: { t: number; n: number }[];
  open: () => void;
}

/** Places (or prefectures) completed over time, a line per list. */
const Cumulative = ({ data, derived }: { data: Data; derived: Derived }) => {
  const lang = useLang();
  const series: Series[] = [];
  const firsts = (dates: (string | undefined)[]) => {
    const sorted = dates.filter((day): day is string => Boolean(day)).sort();
    return sorted.map((day, i) => ({ t: toTime(day), n: i + 1 }));
  };
  const firstReached = new Map<string, string>();
  for (const activity of derived.activities)
    for (const place of activity.places)
      if (!firstReached.has(place) || (firstReached.get(place) ?? '') > activity.date)
        firstReached.set(place, activity.date);
  for (const list of data.lists) {
    if (list.kind !== 'point') continue;
    const points = derived.activityIds
      ? firsts(
          list.items.map((item) => (item.placeId ? firstReached.get(item.placeId) : undefined)),
        )
      : (data.stats.completion[list.id] ?? []).map((entry) => ({
          t: toTime(entry.date),
          n: entry.done,
        }));
    if (points.length)
      series.push({
        id: list.id,
        label: nameIn(list.title, lang),
        color: SERIES_COLORS[series.length % SERIES_COLORS.length] ?? UNKNOWN_TYPE_COLOR,
        points,
        open: () => openList(list.id),
      });
  }
  const firstInPrefecture = new Map<string, string>();
  for (const activity of derived.activities)
    for (const code of Object.keys(activity.prefectures))
      if (!firstInPrefecture.has(code) || (firstInPrefecture.get(code) ?? '') > activity.date)
        firstInPrefecture.set(code, activity.date);
  const prefectures = firsts([...firstInPrefecture.values()]);
  if (prefectures.length)
    series.push({
      id: 'prefectures',
      label: t('Prefectures'),
      color: 'var(--foreground)',
      points: prefectures,
      open: () => useStore.setState({ page: 'map', view: 'prefectures', selection: null }),
    });
  const all = series.flatMap((entry) => entry.points);
  if (all.length === 0)
    return (
      <Panel id="cumulative" title="Completed over time">
        <p className="py-2 text-muted-foreground">{t('Nothing completed with these filters.')}</p>
      </Panel>
    );
  const t0 = Math.min(...all.map((point) => point.t));
  const t1 = Math.max(toTime(data.meta.builtAt.slice(0, 10)), ...all.map((point) => point.t));
  const n1 = Math.max(...all.map((point) => point.n));
  const W = 720;
  const H = 240;
  const x = linear(t0, t1, 40, W - 12);
  const y = linear(0, n1, H - 24, 10);
  const yearTicks: number[] = [];
  for (let year = new Date(t0).getUTCFullYear() + 1; Date.UTC(year, 0, 1) <= t1; year++)
    yearTicks.push(Date.UTC(year, 0, 1));
  return (
    <Panel
      id="cumulative"
      title="Completed over time"
      readout
      note="Places on each list, and prefectures, as they were first reached. Select a line or a name to open it."
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={t('Places and prefectures completed over time')}
      >
        {niceTicks(0, n1, 4).map((tick) => (
          <g key={tick}>
            <line x1={40} x2={W - 12} y1={y(tick)} y2={y(tick)} className="stroke-border" />
            <text
              x={34}
              y={y(tick) + 4}
              className="fill-muted-foreground text-axis"
              textAnchor="end"
            >
              {tick}
            </text>
          </g>
        ))}
        {yearTicks.map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={H - 6}
            className="fill-muted-foreground text-axis"
            textAnchor="middle"
          >
            {new Date(tick).getUTCFullYear()}
          </text>
        ))}
        {series.map((entry) => {
          // A step line, held to the build date.
          let path = `M${x(t0)},${y(0)}`;
          for (const point of entry.points) path += `H${x(point.t)}V${y(point.n)}`;
          path += `H${x(t1)}`;
          return (
            <path
              key={entry.id}
              d={path}
              className={cn(
                'cursor-pointer fill-none stroke-[2.5] hover:stroke-4',
                entry.id === 'prefectures' && '[stroke-dasharray:6_4]',
              )}
              style={{ stroke: entry.color }}
              onClick={entry.open}
              data-tip={`${entry.label}: ${entry.points.at(-1)?.n ?? 0}`}
            />
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1">
        {series.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 py-0.5 text-compact hover:underline"
              onClick={entry.open}
            >
              <span
                className={cn('w-4.5 border-t-3', entry.id === 'prefectures' && 'border-dashed')}
                style={{ borderTopColor: entry.color }}
              />
              <span lang={lang}>{entry.label}</span>{' '}
              <span className="text-muted-foreground tabular-nums">{entry.points.at(-1)?.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
};

/** Every route list as a bar, with the covered stretches filled. */
const Strips = ({ data, derived }: { data: Data; derived: Derived }) => {
  const lists = data.lists.filter((list) => list.kind === 'route');
  if (lists.length === 0) return null;
  return (
    <Panel
      id="strips"
      title="Long trails and routes"
      note={
        derived.activityIds
          ? 'Covered stretches count every published activity; lists with no matching activity on them are dimmed.'
          : 'Covered stretches filled. Select a route to open it on the map.'
      }
    >
      <ul className="flex flex-col gap-2.5">
        {lists.map((list) => {
          const length = list.items.reduce((sum, item) => sum + (item.lengthM ?? 0), 0);
          const covered = list.items.reduce((sum, item) => sum + (item.coveredM ?? 0), 0);
          const touched =
            !derived.activityIds ||
            list.items.some((item) =>
              (data.activitiesByRouteItem.get(item.id) ?? []).some((a) =>
                derived.activityIds?.has(a.id),
              ),
            );
          let offset = 0;
          return (
            <li key={list.id} className={touched ? undefined : 'opacity-40'}>
              <button
                type="button"
                className="group/name mb-1 flex w-full items-baseline gap-2 text-left [&_[data-name=main]]:group-hover/name:underline"
                onClick={() => openList(list.id)}
              >
                {/* A phone has room for one name beside the figures. */}
                <Name name={list.title} sub={SUB_ON_WIDE} />
                <span className="ml-auto flex-none tabular-nums">
                  {t('{done} of {total}', {
                    done: distanceText(covered, 1),
                    total: distanceText(length, 0),
                  })}{' '}
                  · {percent(covered, length)}
                </span>
              </button>
              <svg
                viewBox="0 0 1000 12"
                preserveAspectRatio="none"
                className="block h-3 w-full rounded-sm"
                aria-hidden="true"
              >
                <rect
                  x={0}
                  y={0}
                  width={1000}
                  height={12}
                  className="fill-muted group-hover/segment:fill-border"
                />
                {list.items.flatMap((item) => {
                  const start = offset;
                  offset += item.lengthM ?? 0;
                  return (item.covered ?? []).map(([from, to]) => (
                    <rect
                      key={`${item.id}-${from}`}
                      x={((start + from) / length) * 1000}
                      y={0}
                      width={Math.max(1.5, ((to - from) / length) * 1000)}
                      height={12}
                      style={{ fill: STATUS_COLORS.done }}
                    />
                  ));
                })}
              </svg>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};

/** The statistics page: totals, then every chart, all of the filtered activities. */
/** Prefectures with matching activities, as x / 47 and a small map that opens each on the map. */
const PrefecturesCard = ({ data, derived }: { data: Data; derived: Derived }) => {
  const total = data.prefectures.features.length;
  const visited = new Set(derived.totals.keys());
  return (
    <Panel
      id="prefectures-visited"
      title="Prefectures visited"
      readout
      className="mb-0"
      note="Select a prefecture to see it on the map."
    >
      <p className="mb-2 flex items-baseline gap-1 tabular-nums">
        <strong className="text-2xl font-bold">{visited.size}</strong>
        <span className="text-muted-foreground">/ {total}</span>
        <span className="ml-auto font-semibold">{percent(visited.size, total)}</span>
      </p>
      <PrefectureMap
        data={data}
        visited={visited}
        className="mx-auto max-w-80"
        onChoose={(code) => showOnMap({ kind: 'prefecture', code })}
      />
    </Panel>
  );
};

/** This year so far against the same days last year, and all of last year. */
const ThisYear = ({ activities }: { activities: readonly ActivityRecord[] }) => {
  const latest = activities.reduce(
    (best, activity) => (activity.date > best ? activity.date : best),
    '',
  );
  if (!latest) return null;
  const year = Number(latest.slice(0, 4));
  const day = latest.slice(4);
  const figures = (keep: (date: string) => boolean) => {
    const chosen = activities.filter((activity) => keep(activity.date));
    const sum = summarise(chosen);
    return {
      count: sum.count,
      distanceM: sum.distanceM,
      gainM: sum.gainM,
      days: new Set(chosen.map((activity) => activity.date)).size,
    };
  };
  const now = figures((date) => date.startsWith(String(year)) && date.slice(4) <= day);
  const then = figures((date) => date.startsWith(String(year - 1)) && date.slice(4) <= day);
  const last = figures((date) => date.startsWith(String(year - 1)));
  const change = (a: number, b: number) =>
    b === 0 ? '' : `${a >= b ? '+' : '−'}${Math.round((Math.abs(a - b) / b) * 100)}%`;
  const rows: [string, (f: typeof now) => string, (f: typeof now) => number][] = [
    ['Activities', (f) => f.count.toLocaleString('en'), (f) => f.count],
    ['Days out', (f) => f.days.toLocaleString('en'), (f) => f.days],
    ['Distance', (f) => distanceText(f.distanceM, 0), (f) => f.distanceM],
    ['Climb', (f) => heightText(f.gainM), (f) => f.gainM],
  ];
  return (
    <Panel
      id="this-year"
      title={t('{year} so far', { year })}
      className="mb-0"
      note={t('Against {last} up to the same day ({day}), and all of {last}.', {
        last: year - 1,
        day: date(latest)
          .replace(/ \d{4}$/, '')
          .replace(/^\d{4}年/, ''),
      })}
    >
      {/* On a phone the four columns fit only with tighter cells, and the change on a line of its own. */}
      <Table className="text-compact max-md:[&_td]:px-1 max-md:[&_th]:px-1 max-md:[&_th]:whitespace-normal">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">
              <span className="sr-only">{t('Measure')}</span>
            </TableHead>
            <TableHead scope="col" className="text-right">
              {year}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('{year} to date', { year: year - 1 })}
            </TableHead>
            <TableHead scope="col" className="text-right">
              {t('All {year}', { year: year - 1 })}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(([label, show, value]) => (
            <TableRow key={label}>
              <TableHead scope="row" className="font-normal text-muted-foreground">
                {t(label)}
              </TableHead>
              <TableCell className="text-right font-semibold tabular-nums">
                {show(now)}{' '}
                <span className="text-xs font-normal text-muted-foreground max-md:block">
                  {change(value(now), value(then))}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{show(then)}</TableCell>
              <TableCell className="text-right tabular-nums">{show(last)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
};

export const StatsPage = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const derived = derive(data, filters);
  const total = summarise(derived.activities);
  const moving = derived.activities.reduce((sum, activity) => sum + (activity.movingS ?? 0), 0);
  const days = new Set(derived.activities.map((activity) => activity.date)).size;
  return (
    <ChartPage
      title="Statistics"
      intro={derived.activityIds ? 'Of the activities matching the filters.' : undefined}
    >
      <Figures
        hero
        items={[
          ['Distance', distanceText(total.distanceM, 0)],
          ['Activities', total.count.toLocaleString('en')],
          ['Climb', heightText(total.gainM)],
          ['Moving time', duration(moving)],
          ['Days out', days.toLocaleString('en')],
          ['Prefectures', String(derived.totals.size)],
        ]}
      />
      <div className="mb-4 grid gap-4 wide:grid-cols-2">
        <PrefecturesCard data={data} derived={derived} />
        <ThisYear activities={derived.activities} />
      </div>
      <Calendar activities={derived.activities} />
      <HourGrid data={data} derived={derived} />
      <ListBars data={data} derived={derived} />
      <Cumulative data={data} derived={derived} />
      <Strips data={data} derived={derived} />
    </ChartPage>
  );
};

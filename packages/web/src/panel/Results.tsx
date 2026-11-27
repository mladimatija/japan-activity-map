import type { ReactNode } from 'react';

import {
  ClearFilters,
  Empty,
  GROUP_ROW,
  GroupChevron,
  Note,
  ROW_MAIN,
  ROW_SUB,
  RowBody,
  RowButton,
  RowSide,
  SortSelect,
} from '../components/app.tsx';
import { cn } from '../lib/utils.ts';
import { Badge } from '../components/ui/badge.tsx';
import { VirtualRows } from '../components/VirtualRows.tsx';

import type { ActivityRecord, Data } from '../data.ts';
import { derive, figuresOf, type Metric, METRICS, summarise } from '../filters.ts';
import { REGIONS } from '@jam/core/prefectures';
import { date, distanceText, heightText, typeLabel } from '../format.ts';
import { setHover, useHovered } from '../hover.ts';
import { TypeIcon } from '../icons.tsx';
import { TYPE_COLORS } from '../map/palette.ts';
import { usePref } from '../prefs.ts';
import { select, useStore } from '../store.ts';
import { activityName, Name, nameIn, useLang } from '../names.tsx';
import { locale, localized, t } from '../i18n.ts';

type Sort = 'newest' | 'oldest' | 'distance' | 'gain';
type Row =
  | { kind: 'month'; month: string; count: number; distanceM: number }
  | { kind: 'activity'; activity: ActivityRecord };

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const SORTS: {
  value: Sort;
  label: string;
  compare: (a: ActivityRecord, b: ActivityRecord) => number;
}[] = localized([
  { value: 'newest', label: 'Newest first', compare: (a, b) => b.date.localeCompare(a.date) },
  { value: 'oldest', label: 'Oldest first', compare: (a, b) => a.date.localeCompare(b.date) },
  {
    value: 'distance',
    label: 'Longest first',
    compare: (a, b) => (b.distanceM ?? 0) - (a.distanceM ?? 0),
  },
  { value: 'gain', label: 'Most climb first', compare: (a, b) => (b.gainM ?? 0) - (a.gainM ?? 0) },
]);

const ActivityRow = ({ activity }: { activity: ActivityRecord }) => {
  const hovered = useHovered(activity.id);
  return (
    <RowButton
      hovered={hovered}
      data-key={`activity:${activity.id}`}
      onClick={() => select({ kind: 'activity', id: activity.id }, true)}
      onMouseEnter={() => setHover(activity.id)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(activity.id)}
      onBlur={() => setHover(null)}
    >
      <span
        className="grid size-7.5 flex-none place-items-center"
        style={{ color: TYPE_COLORS[activity.type] }}
      >
        <TypeIcon type={activity.type} label={typeLabel(activity.type)} />
      </span>
      <RowBody
        title={<span className={ROW_MAIN}>{activityName(activity)}</span>}
        meta={
          <>
            {[
              distanceText(activity.distanceM),
              activity.gainM ? t('{height} climb', { height: heightText(activity.gainM) }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {activity.tags.includes('race') && (
              <Badge variant="secondary" className="h-4 px-1.5 text-xs">
                {t('Race')}
              </Badge>
            )}
          </>
        }
      />
      <RowSide>{date(activity.date)}</RowSide>
    </RowButton>
  );
};

/** The heading of a result list: the count and totals, and how it is sorted. */
const ResultsHead = ({ title, sort }: { title: ReactNode; sort: ReactNode }) => (
  <header className="mb-2 flex items-center justify-between gap-3">
    <h2 id="results-title" className="text-sm font-normal">
      {title}
    </h2>
    {sort}
  </header>
);

/** The matching activities: a summary line, then every one, sortable, each linked to the map. */
export const ActivityResults = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const [sort, setSort] = usePref<Sort>(
    'activitySort',
    'newest',
    SORTS.map((entry) => entry.value),
  );
  // Only the latest month starts open. The months opened or folded by hand are remembered as the
  // ones that differ from that, so the open one moves on when a new month begins.
  const [toggled, setToggled] = usePref<string[]>('toggledMonths', []);
  const toggle = (month: string) =>
    setToggled((current) =>
      current.includes(month) ? current.filter((entry) => entry !== month) : [...current, month],
    );
  const { activities, activityIds } = derive(data, filters);
  const latest = activities.reduce((top, activity) => {
    const month = activity.date.slice(0, 7);
    return month > top ? month : top;
  }, '');
  const isOpen = (month: string) => (month === latest) !== toggled.includes(month);
  const total = summarise(activities);
  const sorted = activities.toSorted(SORTS.find((entry) => entry.value === sort)?.compare);
  // In date order the log is grouped by month, each with its count and distance; a folded month
  // keeps its heading.
  const rows: Row[] = [];
  if (sort === 'newest' || sort === 'oldest') {
    for (const activity of sorted) {
      const month = activity.date.slice(0, 7);
      const last = rows.findLast((entry) => entry.kind === 'month');
      if (last?.kind !== 'month' || last.month !== month)
        rows.push({ kind: 'month', month, count: 0, distanceM: 0 });
      const header = rows.findLast((entry) => entry.kind === 'month');
      if (header?.kind === 'month') {
        header.count++;
        header.distanceM += activity.distanceM ?? 0;
      }
      if (isOpen(month)) rows.push({ kind: 'activity', activity });
    }
  } else for (const activity of sorted) rows.push({ kind: 'activity', activity });
  return (
    <section aria-labelledby="results-title">
      <ResultsHead
        title={
          <>
            <strong className="font-semibold tabular-nums">
              {total.count.toLocaleString('en')}
            </strong>{' '}
            {total.count === 1 ? t('activity') : t('activities')}
            <span className="text-muted-foreground tabular-nums">
              {' '}
              · {distanceText(total.distanceM, 0)} ·{' '}
              {t('{height} climb', { height: heightText(total.gainM) })}
            </span>
          </>
        }
        sort={<SortSelect label={t('Sort')} value={sort} options={SORTS} onChange={setSort} />}
      />
      {!activityIds && <Note>{t('Every published activity. Filters narrow this.')}</Note>}
      {sorted.length === 0 ? (
        <Empty action={<ClearFilters />}>{t('No activities match these filters.')}</Empty>
      ) : (
        <VirtualRows
          items={rows}
          keyOf={(entry) =>
            entry.kind === 'month' ? `month:${entry.month}` : `activity:${entry.activity.id}`
          }
          row={(entry) =>
            entry.kind === 'month' ? (
              <h3 className="border-t bg-background">
                <button
                  type="button"
                  aria-expanded={isOpen(entry.month)}
                  onClick={() => toggle(entry.month)}
                  className={cn(
                    GROUP_ROW,
                    'group flex w-full items-center gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                  )}
                >
                  <span className="flex-1">{monthName(entry.month)}</span>
                  <span className="text-compact font-normal text-muted-foreground tabular-nums">
                    {entry.count} · {distanceText(entry.distanceM, 0)}
                  </span>
                  <GroupChevron />
                </button>
              </h3>
            ) : (
              <ActivityRow activity={entry.activity} />
            )
          }
        />
      )}
    </section>
  );
};

const metricText = (metric: Metric, figures: ReturnType<typeof figuresOf>) =>
  metric === 'km'
    ? distanceText(figures.distanceM, 0)
    : metric === 'gain'
      ? heightText(figures.gainM)
      : metric === 'days'
        ? figures.days === 1
          ? t('1 day')
          : t('{count} days', { count: figures.days })
        : figures.activities === 1
          ? t('1 activity')
          : t('{count} activities', { count: figures.activities });
const metricValue = (metric: Metric, figures: ReturnType<typeof figuresOf>) =>
  metric === 'km' ? figures.distanceM : metric === 'gain' ? figures.gainM : figures[metric];

/** Prefectures the prefecture filters pick (all with activities when none are set), by a metric. */
export const PrefectureResults = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const lang = useLang();
  // Until a column is chosen, the one a metric filter is on.
  const [metric, setMetric] = usePref<Metric>(
    'prefectureMetric',
    filters.metric?.key ?? 'activities',
    METRICS.map((entry) => entry.id),
  );
  const derived = derive(data, filters);
  const rows = data.prefectures.features
    .map((feature) => ({
      p: feature.properties,
      figures: figuresOf(data, derived, feature.properties.code),
    }))
    .filter(({ p, figures }) =>
      derived.matching ? derived.matching.has(p.code) : figures.activities > 0,
    )
    .sort((a, b) => metricValue(metric, b.figures) - metricValue(metric, a.figures));
  return (
    <section aria-labelledby="results-title">
      <ResultsHead
        title={
          <>
            <strong className="font-semibold tabular-nums">{rows.length}</strong>{' '}
            {rows.length === 1 ? t('prefecture') : t('prefectures')}
            <span className="text-muted-foreground">
              {' '}
              {t('of {total}', { total: data.prefectures.features.length })}
            </span>
          </>
        }
        sort={
          <SortSelect
            label={t('Sort by')}
            value={metric}
            options={METRICS.map((entry) => ({
              value: entry.id,
              label: t('By {measure}', { measure: entry.label.toLowerCase() }),
            }))}
            onChange={setMetric}
          />
        }
      />
      {!derived.matching && (
        <Note>{t('Where you have been. Prefecture filters pick by what you did there.')}</Note>
      )}
      {rows.length === 0 ? (
        <Empty action={<ClearFilters />}>{t('No prefecture matches these filters.')}</Empty>
      ) : (
        <ol>
          {rows.map(({ p, figures }) => {
            const region = REGIONS.find((entry) => entry.id === p.region);
            return (
              <li key={p.code}>
                <RowButton onClick={() => select({ kind: 'prefecture', code: p.code }, true)}>
                  <RowBody
                    title={<Name name={p} main={ROW_MAIN} sub={ROW_SUB} />}
                    meta={
                      <>
                        {region ? nameIn(region, lang) : ''}
                        {figures.activities > 0 &&
                          ` · ${Object.keys(figures.byType).map(typeLabel).join(', ')}`}
                      </>
                    }
                  />
                  <RowSide>{metricText(metric, figures)}</RowSide>
                </RowButton>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};

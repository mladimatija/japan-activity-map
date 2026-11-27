import { useState } from 'react';

import { ClearFilters, Empty } from '../components/app.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table.tsx';

import type { ActivityRecord, Data, List, ListItem } from '../data.ts';
import { derive } from '../filters.ts';
import { date, duration } from '../format.ts';
import { TYPE_COLORS } from '../map/palette.ts';
import { usePref } from '../prefs.ts';
import { showOnMap, useStore } from '../store.ts';
import { ChartPage, linear, Panel, toTime, Toggle } from './charts.tsx';
import { activityName, Name, nameIn, routeName, useLang } from '../names.tsx';
import { t } from '../i18n.ts';

interface Repeat {
  key: string;
  ja: string;
  en: string;
  count: number;
  first: string;
  latest: string;
  fastestS: number | null;
  activities: ActivityRecord[];
  open: () => void;
}

const fastest = (activities: readonly ActivityRecord[]) => {
  const times = activities
    .map((activity) => activity.movingS)
    .filter((s): s is number => Boolean(s));
  return times.length ? Math.min(...times) : null;
};

/** Places reached by two or more of the matching activities. */
export const repeatedPlaces = (data: Data, activities: readonly ActivityRecord[]): Repeat[] => {
  const byPlace = new Map<string, ActivityRecord[]>();
  for (const activity of activities)
    for (const place of activity.places)
      byPlace.set(place, [...(byPlace.get(place) ?? []), activity]);
  const active = useStore.getState().list;
  return [...byPlace]
    .filter(([, visits]) => visits.length >= 2)
    .flatMap(([place, visits]) => {
      const entries = data.itemsByPlace.get(place) ?? [];
      // Open it in the active list when it is on it, else in the first list that has it.
      const entry: { list: List; item: ListItem } | undefined =
        entries.find((candidate) => candidate.list.id === active) ?? entries[0];
      if (!entry) return [];
      const dates = visits.map((visit) => visit.date).sort();
      return [
        {
          key: place,
          ja: entry.item.name.ja,
          en: entry.item.name.en,
          count: visits.length,
          first: dates[0] ?? '',
          latest: dates.at(-1) ?? '',
          fastestS: fastest(visits),
          activities: visits,
          open: () => {
            useStore.setState({ list: entry.list.id });
            showOnMap({ kind: 'item', list: entry.list.id, id: entry.item.id });
          },
        },
      ];
    })
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));
};

/** Grouped routes with two or more of the matching activities. */
export const repeatedRoutes = (data: Data, ids: Set<string> | null): Repeat[] =>
  data.routes
    .map((route) => {
      const runs = route.activities
        .map((id) => data.activityById.get(id))
        .filter(
          (activity): activity is ActivityRecord =>
            Boolean(activity) && (!ids || ids.has(activity?.id ?? '')),
        );
      const dates = runs.map((run) => run.date).sort();
      return {
        key: route.id,
        // The route's name already says its type and where it is.
        ja: routeName(route),
        en: '',
        count: runs.length,
        first: dates[0] ?? '',
        latest: dates.at(-1) ?? '',
        fastestS: fastest(runs),
        activities: runs,
        open: () => showOnMap({ kind: 'route', id: route.id }),
      };
    })
    .filter((route) => route.count >= 2)
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));

const RepeatTable = ({ rows, what }: { rows: Repeat[]; what: string }) => {
  const [limit, setLimit] = useState(15);
  if (rows.length === 0)
    return (
      <Empty action={<ClearFilters />}>
        {what === 'places'
          ? t('No places done twice with these filters.')
          : t('No routes done twice with these filters.')}
      </Empty>
    );
  return (
    <>
      <Table className="text-compact">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{what === 'places' ? t('Place') : t('Route')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('Times')}
            </TableHead>
            <TableHead scope="col" className="max-md:hidden">
              {t('First')}
            </TableHead>
            <TableHead scope="col">{t('Latest')}</TableHead>
            <TableHead scope="col" className="text-right">
              {t('Fastest')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, limit).map((row) => (
            <TableRow key={row.key}>
              <TableHead scope="row" className="font-normal whitespace-normal">
                <button
                  type="button"
                  className="text-left [&_[data-name=main]]:font-semibold hover:[&_[data-name=main]]:underline"
                  onClick={row.open}
                >
                  <Name name={row} />
                </button>
              </TableHead>
              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
              <TableCell className="tabular-nums max-md:hidden">{date(row.first)}</TableCell>
              <TableCell className="tabular-nums">{date(row.latest)}</TableCell>
              <TableCell className="text-right tabular-nums">{duration(row.fastestS)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length > limit && (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setLimit(rows.length)}>
          {t('Show all {count}', { count: rows.length })}
        </Button>
      )}
    </>
  );
};

/** One row per repeated place, a dot per visit along time. */
const Timeline = ({ rows }: { rows: Repeat[] }) => {
  const lang = useLang();
  if (rows.length === 0)
    return (
      <Empty action={<ClearFilters />}>{t('No place reached twice with these filters.')}</Empty>
    );
  const shown = rows.slice(0, 30);
  const times = shown.flatMap((row) => row.activities.map((activity) => toTime(activity.date)));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const W = 720;
  const ROW = 26;
  const LABEL = 180;
  const x = linear(t0, t1, LABEL + 10, W - 10);
  const years: number[] = [];
  for (let year = new Date(t0).getUTCFullYear(); Date.UTC(year, 0, 1) <= t1; year++)
    if (Date.UTC(year, 0, 1) >= t0) years.push(year);
  return (
    <svg
      viewBox={`0 0 ${W} ${shown.length * ROW + 24}`}
      className="block h-auto w-full"
      role="img"
      aria-label={t('Visits to {count} places over time', { count: shown.length })}
    >
      {years.map((year) => (
        <g key={year}>
          <line
            x1={x(Date.UTC(year, 0, 1))}
            x2={x(Date.UTC(year, 0, 1))}
            y1={0}
            y2={shown.length * ROW}
            className="stroke-border"
          />
          <text
            x={x(Date.UTC(year, 0, 1))}
            y={shown.length * ROW + 16}
            className="fill-muted-foreground text-axis"
            textAnchor="middle"
          >
            {year}
          </text>
        </g>
      ))}
      {shown.map((row, i) => (
        <g key={row.key} transform={`translate(0, ${i * ROW})`}>
          <text x={0} y={17} className="cursor-pointer fill-foreground text-xs" onClick={row.open}>
            {nameIn(row, lang)}
          </text>
          <line
            x1={LABEL + 10}
            x2={W - 10}
            y1={13}
            y2={13}
            className="stroke-border [stroke-dasharray:2_4]"
          />
          {row.activities.map((activity) => (
            <circle
              key={activity.id}
              cx={x(toTime(activity.date))}
              cy={13}
              r={6}
              className="cursor-pointer stroke-background stroke-[1.5] hover:stroke-foreground"
              style={{ fill: TYPE_COLORS[activity.type] }}
              onClick={() => showOnMap({ kind: 'activity', id: activity.id })}
              data-tip={`${nameIn(row, lang)}: ${date(activity.date)}, ${activityName(activity)}`}
            />
          ))}
        </g>
      ))}
    </svg>
  );
};

/** Repeats: what was done more than once, as tables and a timeline. */
export const RepeatsPage = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const [kind, setKind] = usePref<'places' | 'routes'>('repeatsKind', 'places', [
    'places',
    'routes',
  ]);
  const derived = derive(data, filters);
  const places = repeatedPlaces(data, derived.activities);
  const routes = repeatedRoutes(data, derived.activityIds);
  return (
    <ChartPage
      title="Repeats"
      intro={derived.activityIds ? 'Counting only the activities matching the filters.' : undefined}
    >
      <Panel
        id="most"
        title="Most repeated"
        control={
          <Toggle
            label="Show"
            value={kind}
            options={[
              ['places', t('Places {count}', { count: places.length })],
              ['routes', t('Routes {count}', { count: routes.length })],
            ]}
            onChange={setKind}
          />
        }
        note="Fastest is the shortest moving time of those activities. Click a name to see it on the map."
      >
        <RepeatTable rows={kind === 'places' ? places : routes} what={kind} />
      </Panel>
      <Panel
        id="timeline"
        title="Places over time"
        readout
        note="A dot per visit, coloured by activity type. Click a dot to open that activity."
      >
        <Timeline rows={places} />
      </Panel>
    </ChartPage>
  );
};

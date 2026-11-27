import type { FeatureCollection, Position } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useMemo, useState } from 'react';
import MapGL, { Layer, NavigationControl, Source, type ViewState } from 'react-map-gl/maplibre';

import { ClearFilters, Empty, Loading, SortSelect, TextLink } from '../components/app.tsx';
import { Share2Icon } from 'lucide-react';

import { Button } from '../components/ui/button.tsx';
import { Card } from '../components/ui/card.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import { Item } from '../components/ui/item.tsx';
import { FieldLabel } from '../components/ui/field.tsx';
import type { ActivityRecord, Data, TracksFile } from '../data.ts';
import { derive, type Derived, NO_FILTERS, summarise } from '../filters.ts';
import { date, distanceText, heightText, metresBetween, roughly } from '../format.ts';
import { tracksByYear, useLoaded } from '../lazy.ts';
import { profileOf } from '../profile.ts';
import { useBaseStyle, useReveal } from '../map/baseStyle.ts';
import { shareYear } from './shareCard.ts';
import { collapseAttribution, JAPAN } from '../map/MapView.tsx';
import { TYPE_COLORS, UNKNOWN_TYPE_COLOR } from '../map/palette.ts';
import { showOnMap, useStore } from '../store.ts';
import { byDay } from './StatsPage.tsx';
import { ChartPage, linear, Panel } from './charts.tsx';
import { activityName, nameIn, useLang } from '../names.tsx';
import { t } from '../i18n.ts';
import { densify as densifyBy } from '@jam/core/geo';

const CELL = 0.005; // about 500 m
const key = (lon: number, lat: number) => `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;

/** Points along a line no more than 200 m apart, so a grid of cells catches every stretch. */
const densify = (line: Position[]): Position[] => densifyBy(line, 200);

/** The tracks of a year, limited to the matching activities. */
const tracksOf = (year: number | null, ids: Set<string> | null): TracksFile['features'] => {
  if (year === null) return [];
  return (tracksByYear.get(year)?.features ?? []).filter(
    (feature) => !ids || ids.has(feature.properties.id),
  );
};

/**
 * The stretches of a year's tracks on ground no earlier track covered (cells of about 500 m), as
 * new features: "new ground only".
 */
export const newGround = (
  features: TracksFile['features'],
  earlier: TracksFile['features'],
): TracksFile['features'] => {
  const seen = new Set<string>();
  for (const feature of earlier)
    for (const line of feature.geometry.coordinates)
      for (const point of densify(line as Position[])) seen.add(key(point[0] ?? 0, point[1] ?? 0));
  return features.flatMap((feature) => {
    const runs: Position[][] = [];
    for (const line of feature.geometry.coordinates) {
      let run: Position[] = [];
      for (const point of densify(line as Position[])) {
        if (seen.has(key(point[0] ?? 0, point[1] ?? 0))) {
          if (run.length > 1) runs.push(run);
          run = [];
        } else run.push(point);
      }
      if (run.length > 1) runs.push(run);
    }
    return runs.length
      ? [
          {
            ...feature,
            geometry: {
              type: 'MultiLineString' as const,
              coordinates: runs as [number, number][][],
            },
          },
        ]
      : [];
  });
};

const typeColor = [
  'match',
  ['get', 'type'],
  ...Object.entries(TYPE_COLORS).flat(),
  UNKNOWN_TYPE_COLOR,
];

const YearMap = ({
  data,
  features,
  view,
  onMove,
  label,
}: {
  data: Data;
  features: TracksFile['features'];
  view: ViewState | undefined;
  onMove: (view: ViewState) => void;
  label: string;
}) => {
  // Made ready for Japan before the first frame, like the main map (see useBaseStyle).
  const base = useBaseStyle(data.meta.map.styleUrl, data.mask);
  const { style, reveal } = useReveal();
  return (
    // The map's canvas is the labelled region (MapLibre's own), named for its year.
    <div
      className="mt-1.5 h-75 overflow-hidden rounded-md border md:h-105"
      style={{ backgroundColor: base?.sea }}
    >
      {base && (
        <MapGL
          workerUrl={workerUrl}
          // Two maps side by side: each canvas names its year, not just "Map".
          locale={{ 'Map.Title': label }}
          mapStyle={base.style}
          style={style}
          {...(view
            ? view
            : { initialViewState: { bounds: JAPAN, fitBoundsOptions: { padding: 16 } } })}
          onMove={(event) => onMove(event.viewState)}
          maxBounds={data.meta.map.bounds as [number, number, number, number]}
          minZoom={2.5}
          renderWorldCopies={false}
          attributionControl={{ compact: true }}
          onLoad={(event) => {
            event.target.once('idle', () => collapseAttribution(event.target));
            reveal(event.target);
          }}
        >
          <NavigationControl position="top-right" showCompass={false} />
          <Source
            id="tracks"
            type="geojson"
            data={{ type: 'FeatureCollection', features } as unknown as FeatureCollection}
          >
            <Layer
              id="tracks"
              type="line"
              layout={{ 'line-join': 'round', 'line-cap': 'round' }}
              paint={{ 'line-color': typeColor as never, 'line-width': 2, 'line-opacity': 0.8 }}
            />
          </Source>
        </MapGL>
      )}
    </div>
  );
};

const YearTotals = ({ activities, extra }: { activities: ActivityRecord[]; extra?: string }) => {
  const total = summarise(activities);
  return (
    <p className="mt-1.5 text-compact text-muted-foreground tabular-nums">
      {t('{count} activities', { count: total.count })} · {distanceText(total.distanceM, 0)} ·{' '}
      {heightText(total.gainM)}
      {extra ? ` · ${extra}` : ''}
    </p>
  );
};

/** Two years side by side on two maps that move together, or the later year's new ground only. */
const YearAgainstYear = ({
  data,
  derived,
  years,
}: {
  data: Data;
  derived: Derived;
  years: number[];
}) => {
  const compare = useStore((state) => state.compare);
  useLoaded();
  const [view, setView] = useState<ViewState | undefined>();
  const b = compare.b && years.includes(compare.b) ? compare.b : (years[0] ?? null);
  const a =
    compare.a && years.includes(compare.a) && compare.a !== b
      ? compare.a
      : (years.find((year) => year !== b) ?? null);
  const set = (change: Partial<typeof compare>) =>
    useStore.setState((state) => ({ compare: { ...state.compare, a, b, ...change } }));
  const ids = derived.activityIds;
  const featuresA = tracksOf(a, ids);
  const featuresB = tracksOf(b, ids);
  const loading = [a, b].some((year) => year !== null && !tracksByYear.has(year));
  const fresh = useMemo(
    () =>
      compare.newOnly && b !== null
        ? newGround(
            featuresB,
            years.filter((year) => year < b).flatMap((year) => tracksOf(year, ids)),
          )
        : null,
    // `featuresB` is rebuilt each render; what it depends on is listed instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare.newOnly, b, ids, years, tracksByYear.size],
  );
  const inYear = (year: number | null) =>
    derived.activities.filter(
      (activity) => year !== null && activity.date.startsWith(String(year)),
    );
  const select = (value: number | null, onChange: (year: number) => void, label: string) => (
    <SortSelect
      label={label}
      value={String(value ?? '')}
      options={years.map((year) => ({ value: String(year), label: String(year) }))}
      onChange={(year) => onChange(Number(year))}
      className="font-semibold"
    />
  );
  if (years.length < 2)
    return (
      <Panel id="years" title="Year against year">
        <Empty>{t('Comparing needs activities in at least two years.')}</Empty>
      </Panel>
    );
  return (
    <Panel
      id="years"
      title="Year against year"
      control={
        <FieldLabel className="cursor-pointer gap-2 text-compact font-normal">
          <Checkbox
            checked={compare.newOnly}
            onCheckedChange={(checked) => set({ newOnly: checked })}
          />
          {t('New ground only')}
        </FieldLabel>
      }
      note={
        compare.newOnly
          ? t(
              'The right-hand map shows only the stretches of {year} that no earlier track covered (to about {size}).',
              { year: b ?? '', size: roughly(500) },
            )
          : 'The two maps move together.'
      }
    >
      {loading && <Loading className="mb-2">{t('Loading tracks…')}</Loading>}
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          {select(a, (year) => set({ a: year }), t('First year'))}
          <YearMap
            data={data}
            features={featuresA}
            view={view}
            onMove={setView}
            label={t('Tracks in {year}', { year: a ?? '' })}
          />
          <YearTotals activities={inYear(a)} />
        </div>
        <div>
          {select(b, (year) => set({ b: year }), t('Second year'))}
          <YearMap
            data={data}
            features={fresh ?? featuresB}
            view={view}
            onMove={setView}
            label={
              compare.newOnly
                ? t('New ground in {year}', { year: b ?? '' })
                : t('Tracks in {year}', { year: b ?? '' })
            }
          />
          <YearTotals
            activities={inYear(b)}
            extra={
              fresh
                ? `${distanceText(
                    fresh.reduce(
                      (sum, feature) =>
                        sum + lineLength(feature.geometry.coordinates as Position[][]),
                      0,
                    ),
                    0,
                  )} ${t('new')}`
                : undefined
            }
          />
        </div>
      </div>
    </Panel>
  );
};

const lineLength = (lines: Position[][]) =>
  lines.reduce(
    (sum, line) =>
      sum + line.slice(1).reduce((s, point, i) => s + metresBetween(line[i] as Position, point), 0),
    0,
  );

/** A card per year: totals, firsts, and the longest day. */
const YearCards = ({ data, derived }: { data: Data; derived: Derived }) => {
  const lang = useLang();
  const firstPrefecture = new Map<string, string>();
  const firstPlace = new Map<string, string>();
  const sorted = derived.activities.toSorted((x, y) => x.date.localeCompare(y.date));
  for (const activity of sorted) {
    for (const code of Object.keys(activity.prefectures))
      if (!firstPrefecture.has(code)) firstPrefecture.set(code, activity.date);
    for (const place of activity.places)
      if (!firstPlace.has(place)) firstPlace.set(place, activity.date);
  }
  const years = [...new Set(sorted.map((activity) => Number(activity.date.slice(0, 4))))].sort(
    (x, y) => y - x,
  );
  return (
    <Panel
      id="review"
      title="Year in review"
      note="New means first time with the matching activities. Click a year to filter the map to it."
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
        {years.map((year) => {
          const activities = sorted.filter((activity) => activity.date.startsWith(String(year)));
          const total = summarise(activities);
          const days = byDay(activities);
          const longest = [...days].sort((x, y) => y[1].distanceM - x[1].distanceM)[0];
          const newPrefectures = [...firstPrefecture]
            .filter(([, day]) => day.startsWith(String(year)))
            .map(([code]) => code);
          const newPlaces = [...firstPlace]
            .filter(([, day]) => day.startsWith(String(year)))
            .map(([place]) => place);
          const names = newPlaces
            .map((place) => {
              const item = data.itemsByPlace.get(place)?.[0]?.item;
              return item ? nameIn(item.name, lang) : undefined;
            })
            .filter((name): name is string => Boolean(name));
          return (
            // Grid cells shrink to their column, so nothing inside pushes past the card.
            <li key={year} className="min-w-0">
              <Card size="sm" className="h-full min-w-0 gap-0 px-3.5 py-3">
                <TextLink
                  className="w-fit text-xl font-bold"
                  onClick={() =>
                    useStore.setState((state) => ({
                      page: 'map',
                      view: 'activities',
                      selection: null,
                      filters: { ...state.filters, years: { min: year, max: year } },
                    }))
                  }
                >
                  {year}
                </TextLink>
                <dl className="mt-2 text-compact [&_dd]:min-w-0 [&_dd]:text-right [&_dt]:shrink-0 [&_dt]:whitespace-nowrap [&_dt]:text-muted-foreground [&>div]:flex [&>div]:justify-between [&>div]:gap-2 [&>div]:border-t [&>div]:py-0.5">
                  <div>
                    <dt>{t('Activities')}</dt>
                    <dd className="tabular-nums">{total.count}</dd>
                  </div>
                  <div>
                    <dt>{t('Distance')}</dt>
                    <dd className="tabular-nums">{distanceText(total.distanceM, 0)}</dd>
                  </div>
                  <div>
                    <dt>{t('Climb')}</dt>
                    <dd className="tabular-nums">{heightText(total.gainM)}</dd>
                  </div>
                  <div>
                    <dt>{t('Days out')}</dt>
                    <dd className="tabular-nums">{days.size}</dd>
                  </div>
                  <div>
                    <dt>{t('New prefectures')}</dt>
                    <dd>
                      <span className="tabular-nums">{newPrefectures.length}</span>{' '}
                      <span className="text-muted-foreground" lang={lang}>
                        {newPrefectures
                          .slice(0, 4)
                          .map((code) => {
                            const feature = data.prefectureByCode.get(code)?.properties;
                            return feature ? nameIn(feature, lang) : code;
                          })
                          .join(lang === 'ja' ? '・' : ', ')}
                        {newPrefectures.length > 4 ? ' …' : ''}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>{t('New places')}</dt>
                    <dd>
                      <span className="tabular-nums">{names.length}</span>{' '}
                      <span className="text-muted-foreground" lang={lang}>
                        {names.slice(0, 3).join(lang === 'ja' ? '・' : ', ')}
                        {names.length > 3 ? ' …' : ''}
                      </span>
                    </dd>
                  </div>
                  {longest && (
                    <div>
                      <dt>{t('Longest day')}</dt>
                      <dd>
                        <TextLink
                          className="ml-auto text-right whitespace-normal"
                          onClick={() => showOnMap({ kind: 'activity', id: longest[1].longest.id })}
                        >
                          {date(longest[0])}, {distanceText(longest[1].distanceM)}
                        </TextLink>
                      </dd>
                    </div>
                  )}
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-fit"
                  onClick={() =>
                    void shareYear({
                      year,
                      title: data.meta.site.title,
                      rows: [
                        [t('Activities'), String(total.count)],
                        [t('Distance'), distanceText(total.distanceM, 0)],
                        [t('Climb'), heightText(total.gainM)],
                        [t('Days out'), String(days.size)],
                        [t('New prefectures'), String(newPrefectures.length)],
                        [t('New places'), String(names.length)],
                      ],
                      note: names.join(lang === 'ja' ? '・' : ', '),
                      demo: data.meta.demo === true,
                    })
                  }
                >
                  <Share2Icon /> {t('Share as a picture')}
                </Button>
              </Card>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};

/** Small height profiles of every matching activity that has them, by climb. */
const ProfileWall = ({ data, derived }: { data: Data; derived: Derived }) => {
  useLoaded();
  const withTrack = derived.activities.filter((activity) => activity.trackYear !== undefined);
  const profiles = withTrack
    .map((activity) => ({ activity, profile: profileOf(activity) }))
    .filter(
      (entry): entry is { activity: ActivityRecord; profile: { d: number; z: number }[] } =>
        entry.profile !== null,
    )
    .sort((x, y) => (y.activity.gainM ?? 0) - (x.activity.gainM ?? 0))
    .slice(0, 60);
  const loading = data.meta.trackYears.some((year) => !tracksByYear.has(year));
  return (
    <Panel
      id="profiles"
      title="Height profiles"
      note={t(
        'Only activities published with full GPS samples have heights: {count} of {total} here. Sorted by climb.',
        { count: profiles.length, total: withTrack.length },
      )}
    >
      {loading && profiles.length === 0 && <Loading>{t('Loading tracks…')}</Loading>}
      {!loading && profiles.length === 0 && (
        <Empty action={<ClearFilters />}>{t('None of the matching activities has heights.')}</Empty>
      )}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2.5">
        {profiles.map(({ activity, profile }) => {
          const zs = profile.map((point) => point.z);
          const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
          const total = profile.at(-1)?.d ?? 1;
          const x = linear(0, total, 0, 200);
          const y = linear(z0, z1 === z0 ? z0 + 1 : z1, 58, 4);
          const path = `M0,60${profile.map((point) => `L${x(point.d).toFixed(1)},${y(point.z).toFixed(1)}`).join('')}L200,60Z`;
          return (
            <li key={activity.id} className="min-w-0">
              <Item
                variant="outline"
                size="sm"
                render={<button type="button" />}
                className="w-full min-w-0 flex-col flex-nowrap items-stretch gap-0.5 bg-card p-2 text-left hover:border-ring"
                onClick={() => showOnMap({ kind: 'activity', id: activity.id })}
              >
                <svg
                  viewBox="0 0 200 60"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                  className="h-15 w-full opacity-80"
                >
                  <path d={path} style={{ fill: TYPE_COLORS[activity.type] }} />
                </svg>
                <span className="truncate font-semibold">{activityName(activity)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {date(activity.date)} ·{' '}
                  {t('{height} climb', { height: heightText(activity.gainM) })} ·{' '}
                  {t('{height} top', { height: heightText(z1) })}
                </span>
              </Item>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};

/** Comparison and review: year against year, a card per year, and height profiles. */
export const ComparePage = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  // Years are chosen here, so the year filter is set aside for the year maps.
  const derived = derive(data, filters);
  const unyeared = derive(data, { ...filters, years: NO_FILTERS.years });
  const years = [
    ...new Set(
      unyeared.activities
        .filter((a) => a.trackYear !== undefined)
        .map((a) => Number(a.date.slice(0, 4))),
    ),
  ].sort((x, y) => y - x);
  return (
    <ChartPage
      title="Compare and review"
      intro={derived.activityIds ? 'Of the activities matching the filters.' : undefined}
    >
      <YearAgainstYear data={data} derived={unyeared} years={years} />
      <YearCards data={data} derived={derived} />
      <ProfileWall data={data} derived={derived} />
    </ChartPage>
  );
};

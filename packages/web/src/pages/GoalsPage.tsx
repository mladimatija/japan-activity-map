import { LocateFixedIcon, MapIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TextLink } from '../components/app.tsx';
import { Button } from '../components/ui/button.tsx';
import { MiniBar } from '../shell/ListPicker.tsx';
import type { ActivityRecord, Data } from '../data.ts';
import { derive, MONTHS } from '../filters.ts';
import {
  clock,
  date,
  distanceText,
  duration,
  heightText,
  paceOrSpeed,
  percent,
  typeLabel,
  roughly,
} from '../format.ts';
import { distanceM } from '../units.ts';
import {
  inSeason,
  listPaces,
  nextRound,
  type PersonalRecord,
  recordLabel,
  recordsOf,
  snowFreeMonths,
  streaksOf,
  tripsOf,
} from '../goals.ts';
import { t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';
import { TypeIcon } from '../icons.tsx';
import { TYPE_COLORS } from '../map/palette.ts';
import { activityName, Name, nameIn, useLang } from '../names.tsx';
import { ChoiceField } from '../panel/controls.tsx';
import { usePref } from '../prefs.ts';
import { showOnMap, useStore } from '../store.ts';
import { coverageOf, squareBounds } from '../tiles.ts';
import { ChartPage, Figures, Panel } from './charts.tsx';
import { useLoaded } from '../lazy.ts';

const TABLE =
  'w-full text-compact tabular-nums [&_td]:py-1.5 [&_th]:pb-1 [&_th]:text-left [&_th]:text-axis [&_th]:font-normal [&_th]:text-muted-foreground [&_tr+tr]:border-t';

const recordValue = (record: PersonalRecord): string =>
  record.kind === 'distance'
    ? distanceText(record.value)
    : record.kind === 'climb' || record.kind === 'highest'
      ? heightText(record.value)
      : record.kind === 'time'
        ? duration(record.value)
        : `${clock(record.value)} · ${paceOrSpeed(record.type, record.metres ?? 0, record.value)}`;

const Milestones = ({
  data,
  activities,
}: {
  data: Data;
  activities: readonly ActivityRecord[];
}) => {
  const paces = useMemo(() => listPaces(data), [data]);
  // The lists furthest along; the rest are a click away.
  const SHOWN = 5;
  // With nothing first done in the last 12 months there is no pace to show: no column of dashes.
  const paced = paces.some((pace) => pace.lastYear > 0 && pace.finish !== null);
  const [all, setAll] = useState(false);
  const [thisYear] = useState(() => new Date().getFullYear());
  const year = Number((data.meta.latestActivity ?? '').slice(0, 4)) || thisYear;
  const distance =
    activities.reduce((sum, activity) => sum + (activity.distanceM ?? 0), 0) / distanceM();
  const prefectures = new Set(activities.flatMap((activity) => Object.keys(activity.prefectures)));
  const totals: [string, number, number | null, (n: number) => string][] = [
    [
      'Distance',
      distance,
      nextRound(Math.floor(distance)),
      (n) => distanceText(n * distanceM(), 0),
    ],
    ['Activities', activities.length, nextRound(activities.length), (n) => n.toLocaleString('en')],
    ['Prefectures', prefectures.size, nextRound(prefectures.size, 47), (n) => String(n)],
  ];
  return (
    <Panel
      id="milestones"
      title="Milestones"
      note="The next round number for each, and when a list is finished at the pace of the last 12 months."
    >
      <ul className="mb-4 grid gap-2 sm:grid-cols-3">
        {totals.map(([label, now, next, format]) => (
          <li key={label} className="rounded-lg border px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{t(label)}</p>
            <p className="text-row font-semibold tabular-nums">{format(Math.floor(now))}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {next === null
                ? t('All done')
                : t('{left} to go to {next}', {
                    left: format(Math.max(0, Math.ceil(next - now))),
                    next: format(next),
                  })}
            </p>
          </li>
        ))}
      </ul>
      {paces.length === 0 ? (
        <p className="text-muted-foreground">{t('Nothing done on a list yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col">{t('List')}</th>
                <th scope="col">{t('Done')}</th>
                <th scope="col" className="max-md:hidden">
                  {t('Next')}
                </th>
                {paced && (
                  <th scope="col" className="max-md:hidden">
                    {t('Pace')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {(all ? paces : paces.slice(0, SHOWN)).map(
                ({ list, done, total, next, lastYear, finish }) => (
                  <tr key={list.id}>
                    <td className="max-w-56 pr-3 max-md:max-w-44">
                      <TextLink
                        onClick={() =>
                          useStore.setState({
                            page: 'map',
                            list: list.id,
                            view: 'list',
                            selection: null,
                          })
                        }
                      >
                        <Name name={list.title} only />
                      </TextLink>
                      {/* The "Next" column, on a phone: under the name. */}
                      {next !== null && (
                        <span className="block text-xs text-muted-foreground md:hidden">
                          {t('{left} to go to {next}', { left: next - done, next })}
                        </span>
                      )}
                    </td>
                    {/* The same fraction and bar as the list picker and a prefecture's lists. */}
                    <td className="pr-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {done} / {total}
                        </span>
                        <MiniBar share={done / total} label={percent(done, total)} />
                      </span>
                    </td>
                    <td className="pr-3 font-semibold whitespace-nowrap max-md:hidden">
                      {next === null
                        ? t('All done')
                        : t('{left} to go to {next}', { left: next - done, next })}
                    </td>
                    {paced && (
                      <td className="text-xs whitespace-nowrap text-muted-foreground max-md:hidden">
                        {done >= total || lastYear === 0 || finish === null
                          ? '–'
                          : t('{count} in 12 months · done by {year}', {
                              count: lastYear,
                              year: finish - year > 50 ? t('50+ years') : finish,
                            })}
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {paces.length > SHOWN && (
            <Button
              variant="link"
              className="mt-1 h-auto p-0 text-compact"
              onClick={() => setAll(!all)}
            >
              {all ? t('Show fewer') : t('Show all {count} lists', { count: paces.length })}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
};

const Records = ({ activities }: { activities: readonly ActivityRecord[] }) => {
  const loaded = useLoaded();
  const records = recordsOf(activities, loaded);
  const streaks = useMemo(() => streaksOf(activities), [activities]);
  const types = [...new Set(records.map((record) => record.type))];
  const order = ['distance', 'climb', 'time', 'highest', 'effort'];
  return (
    <Panel
      id="records"
      title="Personal records"
      note="Fastest stretches and highest points come from the tracks, where they are published with times and heights."
    >
      <Figures
        items={[
          ['Longest streak', streaks.days ? t('{count} days', { count: streaks.days.count }) : '–'],
          [
            'Weeks in a row',
            streaks.weeks ? t('{count} weeks', { count: streaks.weeks.count }) : '–',
          ],
          ['Biggest day', streaks.bigDay ? distanceText(streaks.bigDay.distanceM) : '–'],
          ['Biggest week', streaks.bigWeek ? distanceText(streaks.bigWeek.distanceM) : '–'],
        ]}
      />
      <div className="grid gap-x-8 gap-y-4 wide:grid-cols-2">
        {types.map((type) => (
          <section key={type}>
            <h3 className="mb-1 flex items-center gap-1.5 text-compact font-semibold">
              <span style={{ color: TYPE_COLORS[type] }}>
                <TypeIcon type={type} />
              </span>
              {typeLabel(type)}
            </h3>
            {/* On a phone each record is two lines: what and how much, then when. */}
            <table className={cn(TABLE, 'max-md:block')}>
              <tbody className="max-md:block">
                {records
                  .filter((record) => record.type === type)
                  .sort(
                    (a, b) =>
                      order.indexOf(a.kind) - order.indexOf(b.kind) ||
                      (a.metres ?? 0) - (b.metres ?? 0),
                  )
                  .map((record) => (
                    <tr
                      key={record.id}
                      className="max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-baseline max-md:gap-x-3 max-md:py-1.5 max-md:[&>*]:py-0"
                    >
                      <th scope="row" className="pr-3 align-top md:w-2/5">
                        {recordLabel(record)}
                      </th>
                      <td className="pr-3 font-semibold whitespace-nowrap">
                        {recordValue(record)}
                      </td>
                      <td className="text-xs text-muted-foreground max-md:col-span-2 md:max-w-40">
                        <TextLink
                          onClick={() => showOnMap({ kind: 'activity', id: record.activity.id })}
                        >
                          {date(record.activity.date)} · {activityName(record.activity)}
                        </TextLink>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </Panel>
  );
};

const Tiles = ({ activities }: { activities: readonly ActivityRecord[] }) => {
  const loaded = useLoaded();
  // `loaded` changes as each year of tracks arrives.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const coverage = useMemo(() => coverageOf(activities), [activities, loaded]);
  const count = coverage.tiles.size;
  const years = [...coverage.byYear].sort((a, b) => a[0].localeCompare(b[0]));
  const top = Math.max(1, ...years.map(([, n]) => n));
  const next = nextRound(count);
  const show = () => {
    useStore.setState((state) => ({
      page: 'map',
      selection: null,
      layers: { ...state.layers, tiles: true },
      fit: coverage.square ? squareBounds(coverage.square) : state.fit,
    }));
  };
  return (
    <Panel
      id="tiles"
      title="Explorer tiles"
      note={
        <>
          {t(
            'The map in squares of about {size} (web-map zoom 14); a square is ticked when a track passes through it.',
            { size: roughly(2000) },
          )}
        </>
      }
      control={
        <Button variant="outline" size="sm" onClick={show} disabled={count === 0}>
          <MapIcon /> {t('Show on the map')}
        </Button>
      }
    >
      <Figures
        items={[
          ['Tiles', count.toLocaleString('en')],
          [
            'Largest square',
            coverage.square ? `${coverage.square.size} × ${coverage.square.size}` : '–',
          ],
          ['Largest cluster', coverage.cluster.toLocaleString('en')],
          ['Next', next === null ? '–' : t('{left} to go to {next}', { left: next - count, next })],
        ]}
      />
      {years.length > 0 && (
        <table className={TABLE}>
          <caption className="sr-only">{t('New tiles by year')}</caption>
          <tbody>
            {years.map(([year, n]) => (
              <tr key={year}>
                <th scope="row" className="w-14">
                  {year}
                </th>
                <td className="w-full pr-3">
                  <div
                    className="h-2 rounded-r-[4px] bg-foreground/70"
                    style={{ width: `${Math.max(1, (n / top) * 100)}%` }}
                  />
                </td>
                <td className="text-right whitespace-nowrap">
                  {t('{count} new', { count: n.toLocaleString('en') })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
};

/** Tokyo station: where planning starts from until the reader says otherwise. */
const TOKYO: [number, number] = [139.7671, 35.6812];

const NextUp = ({ data }: { data: Data }) => {
  const lang = useLang();
  const listId = useStore((state) => state.list);
  const list = data.listById.get(listId);
  // Kept in this browser only: 'tokyo', a prefecture code, or "here:lon,lat".
  const [from, setFrom] = usePref<string>('planFrom', 'tokyo');
  const start = useMemo((): [number, number] => {
    if (from.startsWith('here:')) {
      const [lon, lat] = from.slice(5).split(',').map(Number);
      if (Number.isFinite(lon) && Number.isFinite(lat)) return [lon as number, lat as number];
    }
    const geometry = data.prefectureByCode.get(from)?.geometry;
    if (!geometry) return TOKYO;
    const points =
      geometry.type === 'Polygon' ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
    const lons = points.map((point) => point[0] ?? 0);
    const lats = points.map((point) => point[1] ?? 0);
    return [
      (Math.min(...lons) + Math.max(...lons)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ];
  }, [from, data]);
  const trips = useMemo(() => (list?.kind === 'point' ? tripsOf(list, start) : []), [list, start]);
  const [month] = useState(() => new Date().getMonth() + 1);
  const locate = () =>
    navigator.geolocation.getCurrentPosition((position) =>
      setFrom(
        `here:${position.coords.longitude.toFixed(3)},${position.coords.latitude.toFixed(3)}`,
      ),
    );
  const options = [
    { value: 'tokyo', label: t('Tokyo station') },
    ...(from.startsWith('here:') ? [{ value: from, label: t('Where I am') }] : []),
    ...data.prefectures.features.map((feature) => ({
      value: feature.properties.code,
      label: nameIn(feature.properties, lang),
    })),
  ];
  return (
    <Panel
      id="next-up"
      title="Next up"
      note={
        <>
          {t(
            'What is not done yet on a list, grouped into trips of places within {distance} of each other, nearest first. Distances are straight lines; seasons are estimates from height and latitude.',
            { distance: roughly(25_000) },
          )}
        </>
      }
    >
      {/* Which list and where from: the two things that decide the trips, right above them. */}
      <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] [&>:first-child]:col-span-2 sm:[&>:first-child]:col-span-1">
        <div>
          <ChoiceField
            label="List"
            options={data.lists
              .filter((entry) => entry.kind === 'point')
              .map((entry) => ({ value: entry.id, label: nameIn(entry.title, lang) }))}
            chosen={list?.kind === 'point' ? [list.id] : []}
            multiple={false}
            required
            onChange={(next) => next[0] && useStore.setState({ list: next[0] })}
          />
        </div>
        <ChoiceField
          label="From"
          options={options}
          chosen={[from]}
          multiple={false}
          required
          onChange={(next) => setFrom(next[0] ?? 'tokyo')}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={locate}
          aria-label={t('Use where I am')}
          title={t('Use where I am')}
        >
          <LocateFixedIcon />
        </Button>
      </div>
      {!list || list.kind !== 'point' ? (
        <p className="text-muted-foreground">{t('Choose a list of places to plan from.')}</p>
      ) : trips.length === 0 ? (
        <p className="text-muted-foreground">{t('Everything on this list is done.')}</p>
      ) : (
        <ol className="grid gap-2 wide:grid-cols-2">
          {trips.slice(0, 12).map((trip) => (
            <li key={trip.items[0]?.id} className="rounded-lg border px-3 py-2.5">
              <p className="mb-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground tabular-nums">
                <span>
                  {trip.items.length === 1
                    ? t('1 place')
                    : t('{count} places within {span}', {
                        count: trip.items.length,
                        span: distanceText(trip.spanM, 0),
                      })}
                  {' · '}
                  {t('{distance} away', { distance: distanceText(trip.distanceM, 0) })}
                </span>
                <span className="shrink-0">
                  <Button
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() => {
                      const lons = trip.items.map((item) => item.at?.[0] ?? 0);
                      const lats = trip.items.map((item) => item.at?.[1] ?? 0);
                      useStore.setState({
                        page: 'map',
                        selection: null,
                        // A little room round a single place.
                        fit: [
                          Math.min(...lons) - 0.05,
                          Math.min(...lats) - 0.05,
                          Math.max(...lons) + 0.05,
                          Math.max(...lats) + 0.05,
                        ],
                      });
                    }}
                  >
                    {t('Show on the map')}
                  </Button>
                </span>
              </p>
              <ul className="flex flex-col gap-0.5">
                {trip.items.slice(0, 8).map((item) => {
                  const months = snowFreeMonths(list, item);
                  return (
                    <li key={item.id} className="flex items-baseline justify-between gap-3">
                      <TextLink
                        onClick={() => showOnMap({ kind: 'item', list: list.id, id: item.id })}
                      >
                        <span className="font-semibold">{nameIn(item.name, lang)}</span>
                        {item.elevationM !== undefined && (
                          <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                            {heightText(item.elevationM)}
                          </span>
                        )}
                      </TextLink>
                      {months && (
                        <span className="flex shrink-0 items-baseline gap-1.5 text-xs text-muted-foreground">
                          {inSeason(months, month) && (
                            <span className="rounded-full bg-status-done/15 px-1.5 font-semibold text-foreground">
                              {t('In season')}
                            </span>
                          )}
                          {MONTHS[months[0] - 1]}–{MONTHS[months[1] - 1]}
                        </span>
                      )}
                    </li>
                  );
                })}
                {trip.items.length > 8 && (
                  <li className="text-xs text-muted-foreground">
                    {t('and {count} more', { count: trip.items.length - 8 })}
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
};

const Races = ({ activities }: { activities: readonly ActivityRecord[] }) => {
  const races = activities
    .filter((activity) => activity.tags.includes('race'))
    .toSorted((a, b) => b.date.localeCompare(a.date));
  if (races.length === 0) return null;
  return (
    <Panel id="races" title="Races" note="Activities tagged as a race, newest first.">
      <div className="overflow-x-auto">
        <table className={TABLE}>
          <thead>
            <tr>
              <th scope="col">{t('Date')}</th>
              <th scope="col">{t('Race')}</th>
              <th scope="col">{t('Distance')}</th>
              <th scope="col">{t('Moving time')}</th>
              <th scope="col">{t('Pace')}</th>
              <th scope="col">{t('Climb')}</th>
            </tr>
          </thead>
          <tbody>
            {races.map((race) => (
              <tr key={race.id}>
                <td className="pr-3 whitespace-nowrap text-muted-foreground">{date(race.date)}</td>
                <td className="max-w-56 pr-3">
                  <TextLink onClick={() => showOnMap({ kind: 'activity', id: race.id })}>
                    <span className="font-semibold">{activityName(race)}</span>
                  </TextLink>
                  <span className="block text-xs text-muted-foreground">
                    {typeLabel(race.type)}
                  </span>
                </td>
                <td className="pr-3 whitespace-nowrap">{distanceText(race.distanceM)}</td>
                <td className="pr-3 whitespace-nowrap font-semibold">
                  {race.movingS ? clock(race.movingS) : '–'}
                </td>
                <td className="pr-3 whitespace-nowrap">
                  {paceOrSpeed(race.type, race.distanceM ?? 0, race.movingS)}
                </td>
                <td className="whitespace-nowrap">{heightText(race.gainM)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

/** What to aim at next: milestones, bests, tiles, trips to what is left, and races. */
export const GoalsPage = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const derived = derive(data, filters);
  return (
    <ChartPage
      title="Goals"
      intro={derived.activityIds ? 'Of the activities matching the filters.' : undefined}
    >
      <NextUp data={data} />
      <Milestones data={data} activities={derived.activities} />
      <Records activities={derived.activities} />
      <Tiles activities={derived.activities} />
      <Races activities={derived.activities} />
    </ChartPage>
  );
};

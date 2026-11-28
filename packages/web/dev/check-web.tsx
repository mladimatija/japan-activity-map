// Renders the panel for every list and every kind of selection against a real build (dist/data),
// and checks the links between the files. Run with dev/check-web.sh.
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';
import { pushed, replaced, setPhone } from './shims.ts';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToString } from 'react-dom/server';

import { DEFAULT_VIEWS } from '@jam/core';
import { loadData } from '../src/data.ts';
import { derive, filterCount, NO_FILTERS, presentIn, settleFilters } from '../src/filters.ts';
import { FilterPanel } from '../src/panel/FilterPanel.tsx';
import { ensureLoaded, lazyErrors, referenceByList, tracksByYear } from '../src/lazy.ts';
import { PlaceTip, PrefectureTip } from '../src/map/HoverTip.tsx';
import { prefectureBreaks, selectionShape } from '../src/map/useMapSources.ts';
import { groupByRegion, visibleItems } from '../src/lists.ts';
import { ListCover } from '../src/panel/ListCover.tsx';
import { Pane } from '../src/panel/Pane.tsx';
import { buildIndex, search } from '../src/search.ts';
import { TopBar } from '../src/shell/TopBar.tsx';
import { JA } from '../src/i18n-ja.ts';
import { SETUP_JA } from '../src/setup/i18n-ja-setup.ts';
import { untranslated } from '../src/i18n.ts';
import { MapKey } from '../src/map/MapKey.tsx';
import { LayersMenu } from '../src/shell/LayersMenu.tsx';
import { REGIONS } from '@jam/core/prefectures';
import {
  distanceText,
  heightText,
  paceOrSpeed,
  roughly,
  wholeDistance,
  withUnits,
} from '../src/format.ts';
import { DEFAULT_LIST, setLang, setUnits, type Selection, useStore } from '../src/store.ts';
import { decode, encode, openView, settle, syncWithAddress } from '../src/url.ts';
import { ActiveFilters, filterChips } from '../src/shell/ActiveFilters.tsx';
import { ComparePage, newGround } from '../src/pages/ComparePage.tsx';
import { profileOf } from '../src/profile.ts';
import { repeatedPlaces, repeatedRoutes, RepeatsPage } from '../src/pages/RepeatsPage.tsx';
import { byDay, StatsPage } from '../src/pages/StatsPage.tsx';
import { GoalsPage } from '../src/pages/GoalsPage.tsx';

let failures = 0;
const check = (ok: boolean, message: string) => {
  if (!ok) {
    failures++;
    console.log(`  fail  ${message}`);
  }
};
const BROKEN = ['This item is not in the list', 'not published', 'Unknown prefecture'];
const render = (data: Awaited<ReturnType<typeof loadData>>) => renderToString(<Pane data={data} />);

const data = await loadData();
console.log(
  `Loaded ${data.activities.length} activities, ${data.lists.length} lists, ${data.routes.length} routes, ${data.prefectures.features.length} prefectures.`,
);
check(data.prefectures.features.length === 47, 'all 47 prefectures are in prefectures.geojson');

// Links between the files.
for (const activity of data.activities) {
  if (activity.route)
    check(data.routeById.has(activity.route), `${activity.id} points at route ${activity.route}`);
  for (const code of Object.keys(activity.prefectures))
    check(data.prefectureByCode.has(code), `${activity.id} prefecture ${code}`);
}
for (const route of data.routes) {
  for (const id of route.activities)
    check(data.activityById.has(id), `route ${route.id} lists activity ${id}`);
  if (route.variantOf)
    check(data.routeById.has(route.variantOf), `route ${route.id} variant of ${route.variantOf}`);
}
for (const list of data.lists)
  for (const item of list.items)
    for (const code of item.prefectures)
      check(data.prefectureByCode.has(code), `${list.id}/${item.id} prefecture ${code}`);

const settled = async (done: () => boolean) => {
  for (let waited = 0; waited < 5000 && !done(); waited += 50)
    await new Promise((resolve) => setTimeout(resolve, 50));
};

// Lazy files. With the tracks layer off, a selected activity loads only its own year.
const oldest = data.activities
  .filter((activity) => activity.trackYear !== undefined)
  .sort((a, b) => a.date.localeCompare(b.date))[0];
if (oldest && data.meta.trackYears.length > 1) {
  useStore.setState({
    layers: { ...useStore.getState().layers, tracks: false },
    selection: { kind: 'activity', id: oldest.id },
  });
  ensureLoaded(useStore.getState(), data);
  await settled(() => tracksByYear.size > 0);
  await new Promise((resolve) => setTimeout(resolve, 400));
  check(
    tracksByYear.size === 1 && tracksByYear.has(oldest.trackYear ?? -1),
    `with tracks off, only the selected activity's year loads (${[...tracksByYear.keys()].join(', ')})`,
  );
}
// With it on, every year (the rest once the page is idle), and every route list's geometry.
useStore.setState({ layers: { ...useStore.getState().layers, tracks: true }, selection: null });
for (const list of data.lists) {
  useStore.setState({ list: list.id });
  ensureLoaded(useStore.getState(), data);
}
const routeListCount = data.lists.filter((list) => list.kind === 'route').length;
await settled(
  () =>
    tracksByYear.size === data.meta.trackYears.length && referenceByList.size === routeListCount,
);
check(lazyErrors.length === 0, `lazy files load (${lazyErrors.join('; ')})`);
check(
  tracksByYear.size === data.meta.trackYears.length,
  `all ${data.meta.trackYears.length} track years load`,
);
const routeLists = data.lists.filter((list) => list.kind === 'route');
check(referenceByList.size === routeLists.length, `all ${routeLists.length} route lists load`);
const tracked = new Set(
  [...tracksByYear.values()].flatMap((file) =>
    file.features.map((feature) => String(feature.properties.id)),
  ),
);
for (const activity of data.activities)
  if (activity.trackYear !== undefined)
    check(tracked.has(activity.id), `track for ${activity.id} is in tracks/${activity.trackYear}`);

// Every list, then every kind of selection.
let renders = 0;
for (const list of data.lists) {
  useStore.setState({ list: list.id, selection: null });
  const html = render(data);
  renders++;
  check(html.includes(list.title.ja), `list ${list.id} renders its title`);
}
const selections: Selection[] = [
  ...data.lists.flatMap((list) =>
    list.items.map((item) => ({ kind: 'item' as const, list: list.id, id: item.id })),
  ),
  ...data.activities.map((activity) => ({ kind: 'activity' as const, id: activity.id })),
  ...data.prefectures.features.map((feature) => ({
    kind: 'prefecture' as const,
    code: feature.properties.code,
  })),
  ...data.routes.map((route) => ({ kind: 'route' as const, id: route.id })),
];
for (const selection of selections) {
  useStore.setState({ selection, ...(selection.kind === 'item' ? { list: selection.list } : {}) });
  let html = '';
  try {
    html = render(data);
  } catch (error) {
    check(false, `${JSON.stringify(selection)} throws ${String(error)}`);
    continue;
  }
  renders++;
  check(
    !BROKEN.some((text) => html.includes(text)),
    `${JSON.stringify(selection)} finds what it shows`,
  );
}
console.log(`Rendered the panel ${renders} times.`);

// Hover tooltips for every place and prefecture.
for (const list of data.lists.filter((entry) => entry.kind === 'point'))
  for (const item of list.items) {
    const html = renderToString(<PlaceTip data={data} list={list.id} id={item.id} />);
    // (A name with quotation marks in it is written with &quot; in the markup.)
    check(
      html.replaceAll('&quot;', '"').includes(item.name.ja),
      `the tooltip for ${list.id}/${item.id} names it`,
    );
    const shown = item.placeId ? (data.visitsByPlace.get(item.placeId)?.length ?? 0) : 0;
    if (item.visits !== undefined && shown > 0)
      check(
        html.includes(shown === 1 ? '1 visit' : `${shown} visits`),
        `the tooltip for ${item.id} lists its visits`,
      );
    if (item.visits === undefined)
      check(
        !html.includes('visit'),
        `the tooltip for ${item.id} keeps a private place's visits out`,
      );
  }
for (const feature of data.prefectures.features) {
  const html = renderToString(<PrefectureTip data={data} code={feature.properties.code} />);
  check(
    html.includes(feature.properties.ja),
    `the tooltip for prefecture ${feature.properties.code} names it`,
  );
  if (Object.keys(feature.properties.byType).length > 0)
    check(html.includes('%'), `the tooltip for ${feature.properties.code} shows type shares`);
}

// The Sources section carries the wording each source asks for.
useStore.setState({ selection: null });
const footer = render(data);
for (const credit of data.meta.credits)
  check(
    footer.includes(credit.attribution.replace(/&/g, '&amp;').replace(/"/g, '&quot;')) ||
      footer.includes(credit.attribution),
    `Sources credits ${credit.name}`,
  );

// The mask covers the rest of the world but none of Japan.
{
  const [world, ...holes] = data.mask.features[0]?.geometry.coordinates ?? [];
  check(Boolean(world) && holes.length > 0, 'the mask has a hole for Japan');
  const inside = ([x, y]: number[], ring: number[][]) => {
    let c = false;
    for (let i = 0; i + 1 < ring.length; i++) {
      const [ax = 0, ay = 0] = ring[i] ?? [];
      const [bx = 0, by = 0] = ring[i + 1] ?? [];
      if (
        ay > (y ?? 0) !== by > (y ?? 0) &&
        (x ?? 0) < ax + (((y ?? 0) - ay) * (bx - ax)) / (by - ay)
      )
        c = !c;
    }
    return c;
  };
  const shown = (point: number[]) => holes.some((ring) => inside(point, ring));
  for (const feature of data.prefectures.features) {
    const polygons =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    const hidden = polygons
      .flatMap((polygon) => (polygon[0] ?? []).filter((_, i) => i % 5 === 0))
      .filter((point) => !shown(point));
    check(
      hidden.length === 0,
      `prefecture ${feature.properties.code} is not covered (${hidden.length} points)`,
    );
  }
  for (const list of data.lists)
    for (const item of list.items)
      if (item.at) check(shown(item.at), `${list.id}/${item.id} is not covered`);
  const abroad: Record<string, [number, number]> = {
    Busan: [129.04, 35.1],
    Seoul: [126.98, 37.57],
    Taipei: [121.56, 25.03],
    Shanghai: [121.47, 31.23],
    Vladivostok: [131.89, 43.12],
    Korsakov: [142.79, 46.64],
  };
  for (const [place, point] of Object.entries(abroad)) check(!shown(point), `${place} is covered`);
  const [west, south, east, north] = data.meta.map.bounds;
  check(
    west < 123 && east > 153 && south < 24.1 && north > 45.5,
    `the bounds reach Yonaguni, Minamitorishima, Hateruma and Wakkanai (${data.meta.map.bounds.join(', ')})`,
  );
}

// The top bar renders, naming the active list in either language. (Its menu of every list opens
// in a portal, so it is not in a server render.)
for (const lang of ['en', 'ja'] as const) {
  const list = data.listById.get(DEFAULT_LIST);
  useStore.setState({ list: DEFAULT_LIST, lang });
  const html = renderToString(<TopBar data={data} />);
  check(
    Boolean(list) && html.includes(lang === 'ja' ? (list?.title.ja ?? '') : (list?.title.en ?? '')),
    `the top bar names the active list in ${lang}`,
  );
}
useStore.setState({ lang: 'en' });

// Made-up data (`jam demo`) says so in the top bar, in both languages; a real build never does.
for (const lang of ['en', 'ja'] as const) {
  setLang(lang);
  const html = renderToString(<TopBar data={data} />);
  check(
    html.includes(lang === 'ja' ? '>デモデータ<' : '>Demo data<') === (data.meta.demo === true),
    `the demo badge shows on demo data only, in ${lang}`,
  );
}
setLang('en');

// A finished list wears the seal on its cover, with the day its last place was first reached; a list
// with anything left does not.
{
  const list = data.lists.find((entry) => entry.kind === 'point' && entry.items.length > 1);
  if (list) {
    const finished = {
      ...list,
      items: list.items.map((item, at) => ({
        ...item,
        status: 'done' as const,
        first: at === 1 ? '2026-05-01' : '2024-08-15',
      })),
    };
    const sealed = renderToString(<ListCover list={finished} />);
    check(
      sealed.includes('Finished on 1 May 2026'),
      `a finished list has the seal and its day (${list.id})`,
    );
    check(
      !renderToString(
        <ListCover
          list={{
            ...finished,
            items: [...finished.items.slice(1), { ...list.items[0], status: 'want' as const }],
          }}
        />,
      ).includes('Finished'),
      'a list with a place left has no seal',
    );
  }
}

// Region groups hold every item once; status filters keep exactly that status.
for (const list of data.lists) {
  const all = visibleItems(data, list, NO_FILTERS);
  const grouped = groupByRegion(data, list, all).flatMap((group) => group.items);
  check(
    grouped.length === list.items.length &&
      new Set(grouped.map((item) => item.id)).size === list.items.length,
    `${list.id}: every item is in one region`,
  );
  for (const status of ['done', 'partial', 'dns', 'want', 'none'] as const) {
    const filters = { ...NO_FILTERS, status: [status] };
    const shown = visibleItems(data, list, filters);
    check(
      shown.length === ((list.counts as Record<string, number>)[status] ?? 0),
      `${list.id}: the ${status} chip shows ${shown.length} items`,
    );
    useStore.setState({ list: list.id, filters, selection: null });
    renderToString(<Pane data={data} />);
  }
  useStore.setState({ filters: NO_FILTERS });
}
{
  const tokyo = visibleItems(data, data.listById.get('hyakumeizan') ?? data.lists[0]!, {
    ...NO_FILTERS,
    in: '13',
  });
  check(
    tokyo.every((item) => item.prefectures.includes('13')),
    'the prefecture filter keeps only that prefecture',
  );
}

// Search finds places by kanji and by romaji without macrons, prefectures, and activities by date.
{
  const index = buildIndex(data);
  const first = (query: string) => search(index, query).flatMap((group) => group.entries);
  // With names in Japanese first, results are titled in Japanese.
  const indexJa = buildIndex(data, 'ja');
  const firstJa = (query: string) => search(indexJa, query).flatMap((group) => group.entries);
  const fuji = data.lists
    .flatMap((list) => list.items)
    .find((item) => item.name.ja.startsWith('富士山'));
  if (fuji) {
    check(
      firstJa('富士山').some((entry) => entry.title.startsWith('富士山')),
      'search finds 富士山 by kanji',
    );
    check(
      firstJa('fuji').some((entry) => entry.title.startsWith('富士')),
      'search finds Fuji by romaji',
    );
    check(
      first('富士山').some((entry) => entry.title === fuji.name.en && entry.lang === 'en'),
      'with names in English (the default), the result is titled in English',
    );
  }
  check(
    first('tokyo').some((entry) => entry.kind === 'prefecture'),
    'search finds Tokyo the prefecture',
  );
  check(
    first('長野').some((entry) => entry.kind === 'prefecture'),
    'search finds 長野',
  );
  const latest = data.activities[0];
  if (latest)
    check(
      first(latest.date).some((entry) => entry.kind === 'activity'),
      `search finds activities by date (${latest.date})`,
    );
  check(first('zzzzqqq').length === 0, 'search returns nothing for nonsense');
}

// The map's own logic: the selection overlay and the prefecture classes.
for (const activity of data.activities) {
  const shape = selectionShape({ kind: 'activity', id: activity.id }, data);
  check(
    shape.features.length === (activity.trackYear === undefined ? 0 : 1),
    `the overlay draws ${activity.id}`,
  );
}
for (const route of data.routes)
  check(
    selectionShape({ kind: 'route', id: route.id }, data).features.length === 1,
    `the overlay draws route ${route.id}`,
  );
for (const metric of ['activities', 'days', 'distanceM', 'gainM']) {
  const values = data.prefectures.features.map((feature) =>
    Number((feature.properties as Record<string, unknown>)[metric] ?? 0),
  );
  const lowest = Math.min(...values.filter((value) => value > 0));
  const classes = prefectureBreaks(data, derive(data, NO_FILTERS), metric);
  check(
    classes[0] === lowest,
    `every prefecture with ${metric} gets a colour (first class from ${lowest})`,
  );
  check(
    classes.every((value, i) => i === 0 || value > (classes[i - 1] ?? 0)),
    `${metric} classes ascend`,
  );
}

// The address: a link opens the same view, a stale link falls back.
const first = data.lists.find((list) => list.id !== DEFAULT_LIST && list.items.length > 0);
const item = first?.items[0];
if (first && item) {
  (globalThis as unknown as { location: { hash: string } }).location.hash =
    `#list=${first.id}&item=${item.id}`;
  const stop = syncWithAddress();
  settle(data);
  const state = useStore.getState();
  check(
    state.list === first.id && state.selection?.kind === 'item' && state.selection.id === item.id,
    'a link opens its item',
  );
  useStore.setState({ selection: { kind: 'prefecture', code: '13' } });
  check(
    replaced.at(-1)?.endsWith(`#list=${first.id}&prefecture=13`) ?? false,
    `the address follows the selection (${replaced.at(-1)})`,
  );
  check(
    pushed.at(-1)?.endsWith('&prefecture=13') ?? false,
    'opening something adds a history entry',
  );
  const entries = pushed.length;
  useStore.setState({ prefectureFill: 'days' });
  check(pushed.length === entries, 'other changes replace the current entry');
  (globalThis as unknown as { location: { hash: string } }).location.hash = `#list=${first.id}`;
  (globalThis as unknown as { window: { dispatch: (name: string) => void } }).window.dispatch(
    'popstate',
  );
  check(useStore.getState().selection === null, 'Back closes the detail');
  stop();
}
useStore.setState({ list: 'no-such-list', selection: { kind: 'activity', id: 'gone' } });
settle(data);
check(
  data.listById.has(useStore.getState().list) && useStore.getState().selection === null,
  'a stale link falls back to a known list and no selection',
);

// Filters. The saved views are the spec's example queries: each gives exactly the right items,
// survives a trip through the address, and renders. Clearing the filters restores everything.
{
  const ids = (records: { id: string }[]) =>
    records
      .map((record) => record.id)
      .sort()
      .join(',');
  const regionOf = (codes: string[]) =>
    data.prefectureByCode.get(codes[0] ?? '')?.properties.region;
  const expected: Record<string, () => { got: string; want: string; count: number }> = {
    'view=activities&type=trail_run&pref=20&year=2026&gain=1000-': () => {
      const want = data.activities.filter(
        (a) =>
          a.type === 'trail_run' &&
          '20' in a.prefectures &&
          a.date.startsWith('2026') &&
          (a.gainM ?? 0) >= 1000,
      );
      const got = derive(
        data,
        decode('view=activities&type=trail_run&pref=20&year=2026&gain=1000-').filters,
      ).activities;
      return { got: ids(got), want: ids(want), count: want.length };
    },
    'list=hyakumeizan&status=done&visits=2-': () => {
      const list = data.listById.get('hyakumeizan');
      if (!list) return { got: '', want: '', count: 0 };
      const want = list.items.filter((item) => item.status === 'done' && (item.visits ?? 0) >= 2);
      const got = derive(data, decode('list=hyakumeizan&status=done&visits=2-').filters).items(
        list,
      );
      return { got: ids(got), want: ids(want), count: want.length };
    },
    'view=prefectures&has=ride&lacks=hike': () => {
      const codesOf = (type: string) =>
        new Set(
          data.activities.filter((a) => a.type === type).flatMap((a) => Object.keys(a.prefectures)),
        );
      const rides = codesOf('ride');
      const hikes = codesOf('hike');
      const want = [...rides]
        .filter((code) => !hikes.has(code))
        .sort()
        .join(',');
      const got = [
        ...(derive(data, decode('view=prefectures&has=ride&lacks=hike').filters).matching ?? []),
      ]
        .sort()
        .join(',');
      return { got, want, count: want ? want.split(',').length : 0 };
    },
    'view=activities&tag=race': () => {
      const want = data.activities.filter((a) => a.tags.includes('race'));
      const got = derive(data, decode('view=activities&tag=race').filters).activities;
      return { got: ids(got), want: ids(want), count: want.length };
    },
    'list=sambyakumeizan&region=kanto&status=none,want,dns,partial&elev=-2000': () => {
      const list = data.listById.get('sambyakumeizan');
      if (!list) return { got: '', want: '', count: 0 };
      const want = list.items.filter(
        (item) =>
          item.status !== 'done' &&
          regionOf(item.prefectures) === 'kanto' &&
          item.elevationM !== undefined &&
          item.elevationM <= 2000,
      );
      const got = derive(
        data,
        decode('list=sambyakumeizan&region=kanto&status=none,want,dns,partial&elev=-2000').filters,
      ).items(list);
      return { got: ids(got), want: ids(want), count: want.length };
    },
  };
  // The examples can be empty on a given build; these variants are not, and use the same facets.
  const variants: [string, (a: (typeof data.activities)[number]) => boolean][] = [
    ['type=trail_run&gain=1000-', (a) => a.type === 'trail_run' && (a.gainM ?? 0) >= 1000],
    [
      'type=run,walk&year=2025&season=summer',
      (a) =>
        ['run', 'walk'].includes(a.type) &&
        a.date.startsWith('2025') &&
        [6, 7, 8].includes(Number(a.date.slice(5, 7))),
    ],
    [
      'pref=13,14&km=10-21',
      (a) =>
        ('13' in a.prefectures || '14' in a.prefectures) &&
        (a.distanceM ?? 0) >= 10_000 &&
        (a.distanceM ?? 0) <= 21_000,
    ],
    [
      'month=1,12&source=strava',
      (a) => [1, 12].includes(Number(a.date.slice(5, 7))) && a.source === 'strava',
    ],
    [
      'on=hyakumeizan',
      (a) =>
        a.places.some((place) =>
          data.listById.get('hyakumeizan')?.items.some((item) => item.placeId === place),
        ),
    ],
  ];
  // The newer facets, each against a count worked out here from the raw records.
  {
    const now = new Date();
    const year = String(now.getFullYear());
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const weekday = (day: string) => dayNames[new Date(`${day}T00:00:00Z`).getUTCDay()];
    const twoLists = data.lists.slice(0, 2);
    const reaches = (a: (typeof data.activities)[number], list: (typeof data.lists)[number]) => {
      const ids = new Set(
        list.items.flatMap((item) =>
          list.kind === 'route' ? [item.id] : item.placeId ? [item.placeId] : [],
        ),
      );
      return (list.kind === 'route' ? a.routeItems : a.places).some((id) => ids.has(id));
    };
    const keysOf = (a: (typeof data.activities)[number]) => [
      ...a.places.map((id) => `place:${id}`),
      ...a.routeItems.map((id) => `route:${id}`),
      ...Object.keys(a.prefectures).map((code) => `pref:${code}`),
    ];
    const order = (a: (typeof data.activities)[number]) => `${a.date} ${a.time ?? ''} ${a.id}`;
    variants.push(
      ['when=this-year', (a) => a.date.startsWith(year)],
      ['when=last-year', (a) => a.date.startsWith(String(now.getFullYear() - 1))],
      ['day=sat,sun', (a) => ['sat', 'sun'].includes(weekday(a.date) ?? '')],
      ['h=6-', (a) => (a.movingS ?? a.elapsedS ?? -1) >= 6 * 3600],
      ['h=-1', (a) => (a.movingS ?? a.elapsedS) !== null && (a.movingS ?? a.elapsedS ?? 0) <= 3600],
      ['repeat=repeated', (a) => a.route !== undefined],
      ['repeat=once', (a) => a.route === undefined],
      [
        `on=${twoLists.map((list) => list.id).join(',')}`,
        (a) => twoLists.some((list) => reaches(a, list)),
      ],
      [
        'firsts=1',
        (a) => {
          const before = data.activities.filter((other) => order(other) < order(a));
          const seen = new Set(before.flatMap(keysOf));
          return keysOf(a).some((key) => !seen.has(key));
        },
      ],
    );
    const list = data.listById.get('hyakumeizan');
    if (list) {
      const want = list.items.filter((item) => item.first?.startsWith(year));
      const got = derive(data, decode('firstin=this-year').filters).items(list);
      check(
        ids(got) === ids(want),
        `"firstin=this-year" gives the ${want.length} peaks first reached this year`,
      );
      const longAgo = list.items.filter((item) => {
        if (!item.latest) return false;
        const then = new Date(`${item.latest}T00:00:00`);
        then.setFullYear(then.getFullYear() + 3);
        return then <= now;
      });
      const idle = derive(data, decode('idle=3-').filters).items(list);
      check(
        ids(idle) === ids(longAgo),
        `"idle=3-" gives the ${longAgo.length} peaks not reached for 3 years`,
      );
    }
  }
  for (const [query, test] of variants) {
    const want = data.activities.filter(test);
    const got = derive(data, decode(query).filters).activities;
    check(ids(got) === ids(want), `"${query}" gives the right ${want.length} activities`);
    if (want.length === 0) console.log(`  note  "${query}" matches nothing on this build`);
  }
  {
    const list = data.listById.get('hyakumeizan');
    if (list) {
      const want = list.items.filter((item) => item.status === 'done' && (item.visits ?? 0) >= 1);
      const got = derive(data, decode('status=done&visits=1-').filters).items(list);
      check(
        ids(got) === ids(want) && want.length > 0,
        `visits and status pick the right ${want.length} peaks`,
      );
      // With an activity filter on, visits count only the matching activities.
      const year = derive(data, decode('year=2025&visits=1-').filters).items(list);
      const reached2025 = new Set(
        data.activities.filter((a) => a.date.startsWith('2025')).flatMap((a) => a.places),
      );
      check(
        ids(year) ===
          ids(list.items.filter((item) => item.placeId && reached2025.has(item.placeId))),
        `visits follow the activity filters (${year.length} peaks reached in 2025)`,
      );
    }
  }
  for (const [query, test] of Object.entries(expected)) {
    const { got, want, count } = test();
    check(got === want, `"${query}" gives the right ${count} results`);
    const once = decode(query);
    const again = decode(encode({ ...once, selection: null }));
    check(
      JSON.stringify(once) === JSON.stringify(again),
      `"${query}" reads back the same after a trip through the address`,
    );
  }
  // A saved view without list= works on the list that is open; one with list= opens its own.
  {
    const other = data.lists.find((list) => list.id !== DEFAULT_LIST && list.kind === 'point');
    if (other) {
      useStore.setState({ list: other.id });
      openView('status=done', data);
      check(
        useStore.getState().list === other.id,
        'a saved view without a list keeps the open one',
      );
      openView(`list=${DEFAULT_LIST}&status=done`, data);
      check(useStore.getState().list === DEFAULT_LIST, 'a saved view with a list opens it');
      useStore.setState({ list: DEFAULT_LIST, filters: NO_FILTERS });
    }
  }
  // The spec's example queries, and any saved views the build offers, open as a saved view would.
  const views = [
    ...Object.keys(expected).map((query) => ({ name: query, query })),
    ...DEFAULT_VIEWS,
    ...data.meta.views,
  ];
  for (const view of DEFAULT_VIEWS)
    check(
      JSON.stringify(decode(view.query)) ===
        JSON.stringify(decode(encode({ ...decode(view.query), selection: null }))),
      `the built-in view "${view.name}" is a valid address`,
    );
  {
    // "Prefectures still to visit" is every prefecture no activity reached.
    const query = DEFAULT_VIEWS.find((view) => view.name === 'Prefectures still to visit')?.query;
    const visited = new Set(data.activities.flatMap((a) => Object.keys(a.prefectures)));
    const want = data.prefectures.features
      .map((feature) => feature.properties.code)
      .filter((code) => !visited.has(code));
    const got = query ? [...(derive(data, decode(query).filters).matching ?? [])] : [];
    check(
      got.sort().join() === want.sort().join(),
      `"Prefectures still to visit" gives the ${want.length} with no activity`,
    );
  }
  for (const view of views) {
    openView(view.query, data);
    const state = useStore.getState();
    for (const pane of ['filters', 'activities', 'prefectures', 'list'] as const) {
      useStore.setState({ view: pane });
      render(data);
    }
    renderToString(<ActiveFilters data={data} />);
    check(
      filterChips(state.filters, data).length === filterCount(state.filters) ||
        filterChips(state.filters, data).length >= filterCount(state.filters),
      `"${view.name}" shows a chip for every filter`,
    );
  }
  // A link with a view and filters opens exactly that.
  (globalThis as unknown as { location: { hash: string } }).location.hash =
    '#view=activities&type=run,hike&year=2024-2025&km=5-&pref=13,99&status=bogus&min=km:10';
  const stop = syncWithAddress();
  settle(data);
  const opened = useStore.getState();
  check(opened.view === 'activities', 'a link opens its view');
  check(
    opened.filters.types.join() === 'run,hike' &&
      opened.filters.years.min === 2024 &&
      opened.filters.years.max === 2025 &&
      opened.filters.km.min === 5 &&
      opened.filters.km.max === null,
    'a link opens its filters',
  );
  check(
    opened.filters.prefs.join() === '13' && opened.filters.status.length === 0,
    'unknown prefectures and statuses in a link are dropped',
  );
  check(
    opened.filters.metric?.key === 'km' && opened.filters.metric.min === 10,
    'a prefecture threshold reads back',
  );
  stop();
  for (const bad of ['year=abc', 'km=9-2', 'type=;drop', 'month=13', 'min=km:', 'in=1', 'on=..%2F'])
    check(filterCount(decode(bad).filters) === 0, `a malformed "${bad}" is dropped`);
  useStore.setState({ filters: NO_FILTERS, view: 'list', selection: null });
  const all = derive(data, NO_FILTERS);
  check(
    all.activities.length === data.activities.length &&
      all.activityIds === null &&
      all.matching === null,
    'with no filters, everything is shown',
  );
}

// Chart pages: each renders with everything and with filters, changes when a filter changes, and
// clicking through lands on the matching selection on the map.
{
  const pages = (filters: typeof NO_FILTERS) => {
    useStore.setState({ filters, selection: null });
    return {
      stats: renderToString(<StatsPage data={data} />),
      repeats: renderToString(<RepeatsPage data={data} />),
      compare: renderToString(<ComparePage data={data} />),
    };
  };
  const full = pages(NO_FILTERS);
  for (const [name, html] of Object.entries(full)) {
    check(
      html.length > 1000,
      `the ${name} page renders with every activity (${html.length} characters)`,
    );
    check(
      !html.includes('NaN') && !html.includes('undefined'),
      `the ${name} page has no NaN or undefined`,
    );
  }
  check(
    full.stats.includes('Every day out') && full.stats.includes('Lists, region by region'),
    'the statistics page has its charts',
  );
  for (const query of ['type=run', 'year=2025', 'type=hike&pref=13']) {
    const narrowed = pages(decode(query).filters);
    for (const name of ['stats', 'repeats', 'compare'] as const)
      check(narrowed[name] !== full[name], `the ${name} page changes with "${query}"`);
  }
  useStore.setState({ filters: NO_FILTERS });

  const days = byDay(data.activities);
  check(
    [...days.values()].reduce((sum, day) => sum + day.count, 0) === data.activities.length,
    'the calendar counts every activity once',
  );
  const places = repeatedPlaces(data, data.activities);
  const first = places[0];
  if (first) {
    first.open();
    const state = useStore.getState();
    check(
      state.page === 'map' &&
        state.selection?.kind === 'item' &&
        state.list === state.selection.list &&
        (data.listById
          .get(state.list)
          ?.items.some((item) => item.id === (state.selection as { id: string }).id) ??
          false),
      `clicking the most repeated place (${first.ja}, ${first.count}×) opens it on the map`,
    );
  }
  const route = repeatedRoutes(data, null)[0];
  if (route) {
    useStore.setState({ page: 'repeats', selection: null });
    route.open();
    check(
      useStore.getState().page === 'map' && useStore.getState().selection?.kind === 'route',
      `clicking the most repeated route (${route.count}×) opens it on the map`,
    );
  }
  check(
    repeatedRoutes(data, null).every(
      (entry) => data.routeById.get(entry.key)?.count === entry.count,
    ),
    'route repeat counts match the grouped routes',
  );
  // New ground: a year against itself is nothing new; against nothing, all of it.
  const year = data.meta.trackYears.at(-1);
  const features = year === undefined ? [] : (tracksByYear.get(year)?.features ?? []);
  check(newGround(features, features).length === 0, 'a year against itself has no new ground');
  check(
    newGround(features, []).length === features.length,
    'a year against nothing is all new ground',
  );
  const withHeights = data.activities.filter((activity) => profileOf(activity) !== null);
  check(
    withHeights.every((activity) => (profileOf(activity)?.length ?? 0) > 1),
    `${withHeights.length} activities have height profiles`,
  );
  // The address carries the page and the map's modes.
  const linked = decode(
    'page=compare&a=2024&b=2025&new=1&layers=tracks,prefectures&fill=days&tracks=heat',
  );
  check(
    linked.page === 'compare' &&
      linked.compare.a === 2024 &&
      linked.compare.newOnly &&
      linked.layers.tracks &&
      !linked.layers.places &&
      linked.prefectureFill === 'days' &&
      linked.trackStyle === 'heat',
    'a link opens its page, layers and map modes',
  );
  check(
    encode(linked) ===
      '#page=compare&layers=prefectures,tracks&fill=days&tracks=heat&a=2024&b=2025&new=1',
    `the page and modes read back (${encode(linked)})`,
  );
  useStore.setState({ page: 'map', selection: null, filters: NO_FILTERS });
}

// Only what the data has is offered: a type (or tag, or source) no activity has never shows up.
{
  const noWalks = {
    ...data,
    activities: data.activities.filter(
      (activity) => activity.type !== 'walk' && activity.type !== 'ride',
    ),
  };
  useStore.setState({ filters: NO_FILTERS, view: 'filters', selection: null });
  const panel = renderToString(<FilterPanel data={noWalks} />);
  check(!/>Walk</.test(panel) && !/>Ride</.test(panel), 'types with no activities get no chips');
  check(
    !panel.includes('cycled but never hiked'),
    'a saved view about a missing type is not offered',
  );
  check(
    settleFilters(decode('type=walk,run&has=ride&tag=commute').filters, noWalks).types.join() ===
      'run' && settleFilters(decode('has=ride').filters, noWalks).has.length === 0,
    'a link naming a missing type drops it',
  );
  check(presentIn(data).types.length > 0, `the build has ${presentIn(data).types.join(', ')}`);
  useStore.setState({ view: 'list' });
}

// No activities at all: the lists still render.
const empty = {
  ...data,
  activities: [],
  activityById: new Map(),
  visitsByPlace: new Map(),
  activitiesByRouteItem: new Map(),
  meta: { ...data.meta, counts: { ...data.meta.counts, activities: 0 } },
};
useStore.setState({ selection: null });
check(render(empty).includes('No activities are published yet'), 'an empty build says so');

// Japanese: every interface string has a translation, and the panel, the top bar and the pages
// render in it (dates and all) without a stray English heading.
{
  const source = join(process.cwd(), 'packages/web/src');
  const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(
    (file) => /\.tsx?$/.test(file) && !file.startsWith('components/ui') && !file.startsWith('i18n'),
  );
  const missing = new Set<string>();
  for (const file of files)
    for (const match of readFileSync(join(source, file), 'utf8').matchAll(
      /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g,
    )) {
      const key = (match[2] ?? '').replaceAll("\\'", "'");
      // The setup page keeps its Japanese in its own file, out of the public bundle.
      if (!(key in JA) && !(file.startsWith('setup/') && key in SETUP_JA)) missing.add(key);
    }
  check(
    missing.size === 0,
    `every interface string has Japanese (missing: ${[...missing].join(' | ')})`,
  );
  // And no English written straight into the markup, where t() never sees it: text between tags
  // that starts with a capital ("<p>No activities…</p>"), on one line or on a line of its own.
  const raw: string[] = [];
  for (const file of files.filter((name) => name.endsWith('.tsx'))) {
    const lines = readFileSync(join(source, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      // (Not "=>" or a type's "<string>": a tag's ">" has no "=" or "-" before it.)
      const inline = [...line.matchAll(/(?<![=-])>\s*([A-Z][^<>{}=()|]*?)\s*</g)].map(
        (match) => match[1],
      );
      const alone =
        /^\s*[A-Z][A-Za-z ,.'’!?:–-]+$/.test(line) && /[>}]\s*$/.test(lines[i - 1] ?? '')
          ? [line.trim()]
          : [];
      for (const text of [...inline, ...alone])
        if (text && !['Esc'].includes(text)) raw.push(`${file}:${i + 1} "${text}"`);
    });
  }
  check(raw.length === 0, `no English text straight in the markup (${raw.join(', ')})`);
  setLang('ja');
  useStore.setState({ selection: null, view: 'list', filters: NO_FILTERS, list: DEFAULT_LIST });
  const pane = render(data);
  check(
    pane.includes('都道府県') && !pane.includes('>Activities<'),
    'the pane renders in Japanese',
  );
  const bar = renderToString(<TopBar data={data} />);
  check(
    bar.includes('フィルター') && !bar.includes('>Filters<'),
    'the top bar renders in Japanese',
  );
  const stats = renderToString(<StatsPage data={data} />);
  check(
    stats.includes('活動した日') && /\d{4}年\d{1,2}月\d{1,2}日/.test(stats),
    'the statistics page renders in Japanese, dates too',
  );
  setLang('en');
}

// Japanese everywhere: every detail, every pane view, the top bar, the map's key and menus and every
// page ask only for strings the dictionary has, and show no English of the interface's own (what is
// left is data: activity names, tags, English names beside Japanese ones, credits).
{
  untranslated.clear();
  setLang('ja');
  const pages: string[] = [];
  const renderSafely = (label: string, draw: () => string) => {
    try {
      pages.push(draw());
    } catch (error) {
      check(false, `${label} renders in Japanese (${String(error)})`);
    }
  };
  for (const selection of selections) {
    useStore.setState({
      selection,
      ...(selection.kind === 'item' ? { list: selection.list } : {}),
    });
    renderSafely(JSON.stringify(selection), () => render(data));
  }
  useStore.setState({ selection: null, list: DEFAULT_LIST });
  for (const view of ['list', 'activities', 'prefectures', 'filters'] as const) {
    useStore.setState({ view });
    renderSafely(view, () => render(data));
  }
  useStore.setState({ view: 'list' });
  renderSafely('top bar', () => renderToString(<TopBar data={data} />));
  renderSafely('map key', () => renderToString(<MapKey data={data} />));
  renderSafely('layers', () => renderToString(<LayersMenu data={data} />));
  renderSafely('statistics', () => renderToString(<StatsPage data={data} />));
  renderSafely('repeats', () => renderToString(<RepeatsPage data={data} />));
  renderSafely('compare', () => renderToString(<ComparePage data={data} />));
  renderSafely('goals', () => renderToString(<GoalsPage data={data} />));
  setLang('en');
  // Names from the site config (saved views) are the owner's words, and a string already in
  // Japanese has been translated once (only the second lookup misses).
  const own = new Set(data.meta.views.map((view) => view.name));
  const missing = [...untranslated].filter(
    (text) => !own.has(text) && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(text),
  );
  check(
    missing.length === 0,
    `every string asked for in Japanese has a translation (missing: ${missing.join(' | ')})`,
  );

  // Words that are data, not interface.
  const known = new Set([
    'km',
    'km/h',
    'mi',
    'ft',
    'mph',
    'strava',
    'gps',
    'esc',
    'openstreetmap',
    'osm',
    // The language switch names each language in that language ("EN, English").
    'en',
    'english',
  ]);
  const learn = (text: string | undefined) => {
    for (const word of text?.match(/[A-Za-z][A-Za-z'’]+/g) ?? []) known.add(word.toLowerCase());
  };
  for (const activity of data.activities) {
    learn(activity.name);
    for (const tag of activity.tags) learn(tag);
  }
  for (const list of data.lists) {
    learn(list.title.en);
    for (const item of list.items) learn(item.name.en);
  }
  for (const route of data.routes) learn(route.auto ? route.auto.place.en : route.name);
  for (const feature of data.prefectures.features) learn(feature.properties.en);
  for (const region of REGIONS) learn(region.en);
  for (const credit of data.meta.credits) {
    learn(credit.attribution);
    learn(credit.licence);
  }
  learn(data.meta.site.title);
  learn(data.meta.site.description);
  const decode = (text: string) =>
    text
      .replaceAll('&amp;', '&')
      .replaceAll('&#x27;', "'")
      .replaceAll('&quot;', '"')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>');
  const english = new Map<string, number>();
  for (const html of pages) {
    const texts = [
      ...html.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').split(/<[^>]*>/),
      ...[...html.matchAll(/\s(?:aria-label|title|placeholder|alt)="([^"]*)"/g)].map(
        (match) => match[1] ?? '',
      ),
    ];
    for (const raw of texts) {
      const text = decode(raw).trim();
      const words = text.match(/[A-Za-z][A-Za-z'’]+/g) ?? [];
      if (words.some((word) => !known.has(word.toLowerCase())))
        english.set(text, (english.get(text) ?? 0) + 1);
    }
  }
  check(
    english.size === 0,
    `no English of the interface's own in Japanese (${[...english]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200)
      .map(([text, count]) => `"${text.slice(0, 80)}" ×${count}`)
      .join(', ')})`,
  );
}

// A part of the site that fails is caught and explained, and a missing chunk is told apart.
{
  const stale = ErrorBoundary.getDerivedStateFromError(
    new TypeError('Failed to fetch dynamically imported module: /assets/StatsPage-abc.js'),
  );
  const other = ErrorBoundary.getDerivedStateFromError(new Error('x is undefined'));
  check(
    stale.failed === true && stale.stale === true && other.failed === true && other.stale === false,
    'the error boundary tells a missing chunk from another error',
  );
}

// Units: the switch changes every figure on the site, in both languages, and nothing else. Filters
// and links stay in kilometres and metres.
{
  setUnits('metric');
  check(
    distanceText(1609.344) === '1.6 km' && withUnits('Long runs (30 km+)') === 'Long runs (30 km+)',
    'metric figures and names are as written',
  );
  setUnits('imperial');
  const figures: [string, string][] = [
    [distanceText(1609.344), '1.0 mi'],
    [heightText(1500), '4,921 ft'],
    [paceOrSpeed('run', 1000, 240), '6:26/mi'],
    [paceOrSpeed('ride', 30_000, 3600), '18.6 mph'],
    [wholeDistance(Number(((5 * 1609.344) / 1000).toFixed(3))), '5 mi'],
    [heightText(Number((150 * 0.3048).toFixed(2))), '150 ft'],
    [withUnits('Long runs (30 km+)'), 'Long runs (19 mi+)'],
    [withUnits('大きな山行（獲得標高1,500 m以上）'), '大きな山行（獲得標高4,921 ft以上）'],
    [roughly(2000), '1.2 mi'],
    [roughly(500), '1,600 ft'],
  ];
  const wrong = figures.filter(([got, want]) => got !== want);
  check(
    wrong.length === 0,
    `imperial figures are right (${wrong.map(([got, want]) => `${got} ≠ ${want}`).join(', ')})`,
  );
  // Words that are data may hold a metric figure of their own ("10 km race").
  const data_ = new Set<string>();
  for (const activity of data.activities) data_.add(activity.name);
  for (const route of data.routes) if (!route.auto) data_.add(route.name);
  for (const list of data.lists) {
    data_.add(list.title.en).add(list.title.ja);
    for (const item of list.items) data_.add(item.name.en).add(item.name.ja);
  }
  for (const credit of data.meta.credits) data_.add(credit.attribution);
  for (const lang of ['en', 'ja'] as const) {
    setLang(lang);
    untranslated.clear();
    const pages: string[] = [];
    const draw = (label: string, make: () => string) => {
      try {
        pages.push(make());
      } catch (error) {
        check(false, `${label} renders in imperial (${String(error)})`);
      }
    };
    for (const selection of selections) {
      useStore.setState({
        selection,
        ...(selection.kind === 'item' ? { list: selection.list } : {}),
      });
      draw(JSON.stringify(selection), () => render(data));
    }
    useStore.setState({ selection: null, list: DEFAULT_LIST });
    for (const view of ['list', 'activities', 'prefectures', 'filters'] as const) {
      useStore.setState({ view });
      draw(view, () => render(data));
    }
    useStore.setState({ view: 'list' });
    draw('top bar', () => renderToString(<TopBar data={data} />));
    draw('map key', () => renderToString(<MapKey data={data} />));
    draw('layers', () => renderToString(<LayersMenu data={data} />));
    draw('statistics', () => renderToString(<StatsPage data={data} />));
    draw('repeats', () => renderToString(<RepeatsPage data={data} />));
    draw('compare', () => renderToString(<ComparePage data={data} />));
    draw('goals', () => renderToString(<GoalsPage data={data} />));
    const metric = new Map<string, number>();
    let miles = 0;
    let feet = 0;
    for (const html of pages) {
      const texts = [
        // React writes a comment between adjacent pieces of one text: join them first.
        ...html
          .replace(/<(script|style)[\s\S]*?<\/\1>/g, '')
          .replace(/<!--[\s\S]*?-->/g, '')
          .split(/<[^>]*>/),
        ...[...html.matchAll(/\s(?:aria-label|title|placeholder|alt|data-tip)="([^"]*)"/g)].map(
          (match) => match[1] ?? '',
        ),
      ];
      for (const raw of texts) {
        const text = raw.trim();
        // The switch itself is labelled km and mi.
        if (text === 'km' && /Miles and feet|マイルとフィート/.test(html)) continue;
        if (!text || data_.has(text) || [...data_].some((own) => own && text.includes(own)))
          continue;
        if (/\d ?mi\b|\/mi\b|mph/.test(text)) miles++;
        if (/\d ?ft\b/.test(text)) feet++;
        if (/\d ?(km|m)(?![A-Za-z])|\/km|km\/h|^km$/.test(text))
          metric.set(text, (metric.get(text) ?? 0) + 1);
      }
    }
    check(
      metric.size === 0,
      `no metric figures left in imperial, ${lang} (${[...metric]
        .slice(0, 40)
        .map(([text, count]) => `"${text.slice(0, 80)}" ×${count}`)
        .join(', ')})`,
    );
    check(miles > 0 && feet > 0, `miles and feet are shown in imperial, ${lang}`);
  }
  setLang('en');
  setUnits('metric');

  // No unit written out by hand: figures go through format.ts, which reads the units.
  const byHand: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/(format|units|i18n-ja)\.ts$|UnitsSwitch\.tsx$/.test(entry.name)
      )
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            const code = line.replace(/\/\/.*$/, '');
            if (
              / km['"`<]|\/km\b|km\/h|\bmph\b|['"`] (m|ft|mi)['"`]|\} (m|km)\s*$|\} (m|km)</.test(
                code,
              )
            )
              byHand.push(`${path.split('/src/')[1]}:${i + 1}`);
          });
    }
  };
  walk(join(process.cwd(), 'packages/web/src'));
  check(byHand.length === 0, `no unit written by hand outside format.ts (${byHand.join(', ')})`);
}

// The design system's token table says what index.css says, in both modes.
{
  const css = readFileSync(join(process.cwd(), 'packages/web/src/index.css'), 'utf8');
  const [light = '', dark = ''] = css.split('@media (prefers-color-scheme: dark)');
  const valueOf = (block: string, token: string) =>
    new RegExp(`${token}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
  const doc = readFileSync(join(process.cwd(), 'docs/design-system.md'), 'utf8');
  const rows = [
    ...doc.matchAll(/^\| `(--[a-z-]+)`\s*\| `(#[0-9a-f]{6})`\s*\| `(#[0-9a-f]{6})`\s*\|/gm),
  ];
  const wrong = rows
    .filter(
      ([, token = '', inLight, inDark]) =>
        valueOf(light, token) !== inLight || valueOf(dark, token) !== inDark,
    )
    .map(([, token]) => token);
  check(
    rows.length >= 15 && wrong.length === 0,
    `docs/design-system.md lists the tokens as index.css has them (${rows.length} rows; differ: ${wrong.join(', ')})`,
  );
  // And no colour is written into a component: tokens only (the map's data palette aside).
  const source = join(process.cwd(), 'packages/web/src');
  const literal = readdirSync(source, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx') && !file.startsWith('components/ui'))
    .flatMap((file) =>
      readFileSync(join(source, file), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          /(bg|text|border|fill|stroke)-\[#|(bg|text)-(white|black)\b/.test(line)
            ? [`${file}:${i + 1}`]
            : [],
        ),
    );
  check(literal.length <= 1, `no colour literals in component classes (${literal.join(', ')})`);
  // Nor into code: the map and the charts take theirs from map/palette.ts by name.
  const hex = readdirSync(source, { recursive: true, encoding: 'utf8' })
    .filter(
      (file) =>
        /\.tsx?$/.test(file) && !file.startsWith('components/ui') && file !== 'map/palette.ts',
    )
    .flatMap((file) =>
      readFileSync(join(source, file), 'utf8')
        .split('\n')
        .flatMap((line, i) =>
          !/^\s*(\/\/|\*|\/\*)/.test(line) &&
          /['"`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]|rgba?\(|hsla?\(/.test(line)
            ? [`${file}:${i + 1}`]
            : [],
        ),
    );
  check(
    hex.length === 0,
    `no colour written outside map/palette.ts and index.css (${hex.join(', ')})`,
  );
}

// The phone layout (under 768 px, touch only). A server render cannot measure widths, so this
// holds the phone's own markup to the same rules: it renders, in both languages, with nothing
// untranslated; search is a button, the demo strip explains itself, and the hints say "tap".
{
  setPhone(true);
  untranslated.clear();
  for (const lang of ['en', 'ja'] as const) {
    setLang(lang);
    useStore.setState({ list: DEFAULT_LIST, selection: null, view: 'list', filters: NO_FILTERS });
    const draw = (label: string, make: () => string): string => {
      try {
        return make();
      } catch (error) {
        check(false, `${label} renders on a phone, ${lang} (${String(error)})`);
        return '';
      }
    };
    const bar = draw('top bar', () => renderToString(<TopBar data={data} />));
    check(
      bar.includes('aria-haspopup="dialog"') && !bar.includes('type="search"'),
      `on a phone search is a button, not a box, ${lang}`,
    );
    check(
      bar.includes(lang === 'ja' ? '架空のアクティビティ' : 'made-up activities') ===
        (data.meta.demo === true),
      `on a phone the demo strip says what it means, on demo data only, ${lang}`,
    );
    for (const view of ['list', 'activities', 'prefectures', 'filters'] as const) {
      useStore.setState({ view });
      draw(view, () => render(data));
    }
    useStore.setState({ view: 'list' });
    for (const selection of selections.slice(0, 40)) {
      useStore.setState({
        selection,
        ...(selection.kind === 'item' ? { list: selection.list } : {}),
      });
      draw(JSON.stringify(selection), () => render(data));
    }
    useStore.setState({ selection: null, list: DEFAULT_LIST });
    draw('layers', () => renderToString(<LayersMenu data={data} />));
    draw('map key', () => renderToString(<MapKey data={data} />));
    const stats = draw('statistics', () => renderToString(<StatsPage data={data} />));
    draw('repeats', () => renderToString(<RepeatsPage data={data} />));
    draw('compare', () => renderToString(<ComparePage data={data} />));
    draw('goals', () => renderToString(<GoalsPage data={data} />));
    check(
      stats.includes(lang === 'ja' ? 'タップ' : 'Tap the chart') &&
        !stats.includes(lang === 'ja' ? 'グラフを指す' : 'Point at the chart'),
      `on a phone the chart hints say tap, ${lang}`,
    );
  }
  setLang('en');
  setPhone(false);
  const own = new Set(data.meta.views.map((view) => view.name));
  const missing = [...untranslated].filter(
    (text) => !own.has(text) && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(text),
  );
  check(
    missing.length === 0,
    `every string the phone layout asks for has Japanese (missing: ${missing.join(' | ')})`,
  );
}

console.log(failures ? `${failures} checks failed.` : 'All web checks passed.');
process.exit(failures ? 1 : 0);

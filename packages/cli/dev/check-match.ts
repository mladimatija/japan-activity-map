/**
 * Runs the matching checks on made-up activities in a throwaway data folder (data/ is not touched):
 * a hike marks its summit done, a hand-entered DNS survives a rebuild, a cross-border ride splits
 * sensibly between Tokyo and Kanagawa, and a second run reuses the cache.
 *
 *   node packages/cli/dev/check-match.ts      (or: pnpm check:match)
 */
import { join } from 'node:path';

import { thresholdsSchema } from '@jam/core';

import { AreaIndex } from '../src/match/areas.ts';
import { loadCatalog } from '../src/match/catalog.ts';
import { matchActivity } from '../src/match/match.ts';
import { resolveProgress } from '../src/match/status.ts';
import { Database } from '../src/store/sqlite.ts';
import { sandbox } from './harness.ts';

const { temp, data, listsDir, jam, fixtures, check, finish } = sandbox('match');
fixtures('match-fixtures.ts', join(temp, 'sheet'));
jam('sync', 'sheet', join(temp, 'sheet', 'sheet.csv'));

const thresholds = thresholdsSchema.parse({});
const catalog = loadCatalog(thresholds, listsDir);
const progress = () => {
  const db = new Database(join(data, 'jam.sqlite'), { readOnly: true });
  try {
    const lists = resolveProgress(db, catalog, thresholds);
    return (list: string, item: string) =>
      lists.find((entry) => entry.id === list)?.items.find((entry) => entry.itemId === item);
  } finally {
    db.close();
  }
};
const query = <T>(sql: string) => {
  const db = new Database(join(data, 'jam.sqlite'), { readOnly: true });
  try {
    return db.all(sql) as T[];
  } finally {
    db.close();
  }
};

const first = jam('match');
let item = progress();
const itemFor = (list: string, placeId: string) =>
  catalog.pointItems.find((entry) => entry.listId === list && entry.placeId === placeId)?.id ?? '';
const kumotoriStatus = item('hyakumeizan', itemFor('hyakumeizan', 'peak-363'));
check(
  'a known hike marks its summit as done (雲取山)',
  kumotoriStatus?.status === 'done' && kumotoriStatus.visits === 1,
  JSON.stringify(kumotoriStatus),
);
check(
  '  ...and the same place in its other lists',
  item('prefecture-highpoints', itemFor('prefecture-highpoints', 'peak-363'))?.status === 'done',
);
const kaikoma = itemFor('hyakumeizan', 'peak-578');
check(
  'a hand-entered DNS wins over a track that reached the summit (甲斐駒ヶ岳)',
  item('hyakumeizan', kaikoma)?.status === 'dns',
);
check(
  'a want row shows as want (槍ヶ岳)',
  item('hyakumeizan', 'hyakumeizan-054')?.status === 'want',
);
check(
  'a route marked done by hand counts (しまなみ海道)',
  item('shimanami-kaido', 'shimanami-kaido-001')?.status === 'done',
);
// The 東海道 is split into stages between post towns once they are fetched, so the walk's
// coverage is counted over every 東海道 item.
const tokaidoItems = (lookup: ReturnType<typeof progress>) =>
  catalog.routeItems
    .filter((route) => route.listId === 'tokaido')
    .map((route) => lookup('tokaido', route.id))
    .filter((entry) => entry !== undefined);
const tokaido = tokaidoItems(item);
const tokaidoM = tokaido.reduce((sum, entry) => sum + (entry.coveredM ?? 0), 0);
check(
  'a walk along the 東海道 counts as partial coverage',
  tokaido.some((entry) => entry.status === 'partial') && tokaidoM > 20_000,
  `${Math.round(tokaidoM)} m over ${tokaido.length} items`,
);

const areas = query<{ name: string; location: string; prefectures: string }>(
  'SELECT a.name, l.location, l.prefectures FROM activities a JOIN activity_areas l ON l.activity_id = a.id',
);
const ride = areas.find((row) => row.name === 'Tokyo to Yokohama');
const split = ride ? (JSON.parse(ride.prefectures) as Record<string, { distanceM: number }>) : {};
const tokyo = split['13']?.distanceM ?? 0;
const kanagawa = split['14']?.distanceM ?? 0;
// The fixture crosses the Tama river after about 14.3 km of its 28.4 km.
check(
  'a cross-border ride splits sensibly (Tokyo ≈ 14.3 km, Kanagawa ≈ 14.1 km)',
  Math.abs(tokyo - 14_300) < 700 &&
    Math.abs(kanagawa - 14_100) < 700 &&
    Object.keys(split).length === 2,
  JSON.stringify(split),
);
check(
  'a run in Zagreb is outside Japan',
  areas.find((row) => row.name === 'Zagreb run')?.location === 'outside',
);
check(
  'a sheet row without a track counts as Japan',
  areas.find((row) => row.name === 'Gym treadmill')?.location === 'japan',
);

const second = jam('match');
check(
  'a second run with no changes reuses the cache',
  /: 0 matched, \d+ unchanged/.test(second),
  second.split('\n')[0],
);
jam('match', '--force');
item = progress();
check('the DNS survives a forced rebuild', item('hyakumeizan', kaikoma)?.status === 'dns');
const rideId =
  query<{ id: string }>(`SELECT id FROM activities WHERE name = 'Tokyo to Yokohama'`)[0]?.id ?? '';
// The 東海道 item where the ride adds most to what the walk covers, so ignoring the ride there
// has something to take away.
const rideItem =
  query<{ target_id: string }>(
    `SELECT ride.target_id FROM matches ride
       LEFT JOIN matches walk ON walk.target_kind = 'route' AND walk.target_id = ride.target_id
        AND walk.activity_id = (SELECT id FROM activities WHERE name = '東海道 日本橋から')
     WHERE ride.activity_id = '${rideId}' AND ride.target_kind = 'route'
       AND ride.target_id LIKE 'tokaido-%' AND ride.matched = 1
     ORDER BY ride.covered_m - coalesce(walk.covered_m, 0) DESC`,
  )[0]?.target_id ?? 'tokaido-001';
const before = progress()('tokaido', rideItem)?.coveredM ?? 0;
jam('match', 'ignore', rideId, rideItem);
jam('match');
const after = progress()('tokaido', rideItem)?.coveredM ?? 0;
check('an ignored match stops counting', after < before, `${before} → ${after}`);
check('the first run reported new matches', /New matches: [1-9]/.test(first));

// A summary track passing 230 m from 雲取山's summit point: just outside the 200 m radius.
const near = (detail: 'summary' | 'full') =>
  matchActivity(
    {
      coordinates: [
        [138.944, 35.8576],
        [138.942, 35.8576],
      ],
      detail,
      elevations: null,
      distanceM: null,
      elevationGainM: null,
      point: null,
      hasPlaceLinks: false,
    },
    catalog,
    new AreaIndex(catalog.areasFile),
    thresholds,
  ).places.find((place) => place.id === 'peak-363');
const summary = near('summary');
check(
  'a near miss on a summary track is flagged uncertain, not counted',
  summary?.uncertain === true && !summary.matched,
  JSON.stringify(summary),
);
check('  ...and dropped when the track is detailed', near('full') === undefined);

finish();

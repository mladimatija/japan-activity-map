/**
 * Runs the route grouping checks on made-up runs around 東京駅 in a throwaway data folder (data/ is not
 * touched): a loop run many times is one route with the right count, runs the other way join it
 * flagged as reversed, a different loop from the same start stays separate, ids survive reruns,
 * new activities and a regroup, and the routes file renames, merges and splits.
 *
 *   node packages/cli/dev/check-routes.ts      (or: pnpm check:routes)
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from '../src/store/sqlite.ts';
import { sandbox } from './harness.ts';

const { temp, data, configDir: config, jam, fixtures, check, finish } = sandbox('routes');
const sheet = fixtures('route-fixtures.ts', join(temp, 'sheet'));
const csv = join(sheet, 'sheet.csv');
jam('sync', 'sheet', csv);
jam('match');

const query = <T>(sql: string, params: (string | number)[] = []) => {
  const db = new Database(join(data, 'jam.sqlite'), { readOnly: true });
  try {
    return db.all(sql, params) as T[];
  } finally {
    db.close();
  }
};
/** Route id and reversed flag per activity name. */
const membership = () =>
  new Map(
    query<{ name: string; route_id: string; reversed: number; variant_of: string | null }>(
      `SELECT a.name, m.route_id, m.reversed, r.variant_of FROM route_members m JOIN activities a ON a.id = m.member_ref JOIN routes r ON r.id = m.route_id`,
    ).map((row) => [row.name, row]),
  );
const routeIds = () =>
  query<{ id: string }>('SELECT id FROM routes ORDER BY id').map((row) => row.id);

const first = jam('routes', '--all');
let byName = membership();
const east = byName.get('East loop 1')?.route_id;
const eastMembers = [...byName.values()].filter((row) => row.route_id === east);
check(
  'a loop run many times is one route with the right count',
  eastMembers.length === 8,
  `${eastMembers.length} members`,
);
check('  ...a start 40 m off still joins', byName.get('East loop 4')?.route_id === east);
check(
  'runs the other way round join it, flagged as reversed',
  byName.get('East loop the other way')?.reversed === 1 &&
    byName.get('East loop the other way again')?.reversed === 1 &&
    eastMembers.filter((row) => row.reversed).length === 2,
);
check(
  'a different loop from the same start stays separate',
  byName.get('West loop')?.route_id !== east &&
    byName.get('West loop')?.route_id === byName.get('West loop again')?.route_id,
);
const ab = byName.get('A to B 1')?.route_id;
check(
  'a point-to-point run back the other way joins, reversed',
  byName.get('B to A')?.route_id === ab && byName.get('B to A')?.reversed === 1,
);
check(
  'a shorter run along half of it is a variant, not a member',
  byName.get('A to half way')?.route_id !== ab && byName.get('A to half way')?.variant_of === ab,
);
check(
  'the same route with one, two or three laps of a block is one route',
  byName.get('Block laps three times')?.route_id === byName.get('Block laps once')?.route_id &&
    byName.get('Block laps twice')?.route_id === byName.get('Block laps once')?.route_id,
);
check(
  '  ...but going further out, onto new streets, is a different route',
  byName.get('Block laps further out')?.route_id !== byName.get('Block laps once')?.route_id,
);
check(
  'an activity without a track is not grouped',
  !byName.has('Treadmill') && /1 activities have no track/.test(first),
);
check(
  'the most repeated route shows its stats',
  /8×, 2 reversed, 2025-01-10 to 2025-08-10, fastest/.test(first),
  first,
);

const ids = routeIds();
jam('routes');
check('a rerun keeps every route id', JSON.stringify(routeIds()) === JSON.stringify(ids));
appendFileSync(csv, 'east7,2025-12-10,,,Run,,East loop 7,,done,,,,,,east1.gpx,,,,\n');
jam('sync', 'sheet', csv);
const added = jam('routes');
check(
  'a new run of the loop joins it, ids unchanged',
  membership().get('East loop 7')?.route_id === east &&
    JSON.stringify(routeIds()) === JSON.stringify(ids) &&
    /1 added to existing routes, 0 new routes/.test(added),
  added.split('\n')[0],
);
jam('routes', 'regroup');
check(
  'regrouping from scratch keeps every route id',
  JSON.stringify(routeIds()) === JSON.stringify(ids),
  `${ids.join(',')} vs ${routeIds().join(',')}`,
);

const refOf = (name: string) =>
  query<{ id: string }>('SELECT id FROM activities WHERE name = ?', [name])[0]?.id ?? '';
const write = (routes: object) =>
  writeFileSync(join(config, 'routes.jsonc'), JSON.stringify(routes, null, 2));
write({ names: { [refOf('East loop 2')]: '日本橋 loop' } });
const named = jam('routes');
check('a name in routes.jsonc replaces the automatic one', /日本橋 loop: 9×/.test(named), named);
write({ merge: [[refOf('East loop 1'), refOf('West loop')]] });
jam('routes');
byName = membership();
check(
  'merge in routes.jsonc joins two routes into the older one',
  byName.get('West loop')?.route_id === east && byName.get('West loop again')?.route_id === east,
);
write({ split: [[refOf('A to B 3')]] });
jam('routes', 'regroup');
byName = membership();
check(
  'split in routes.jsonc takes an activity out into its own route',
  byName.get('A to B 3')?.route_id !== byName.get('A to B 1')?.route_id &&
    byName.get('A to B 1')?.route_id === ab,
);
check(
  '  ...and the rest keep their ids',
  routeIds().includes(east ?? '') && routeIds().includes(ab ?? ''),
);
check(
  'the review file is written',
  readFileSync(join(data, 'routes-review.md'), 'utf8').includes('## All routes'),
);

// On the site: a given name as it is, an automatic one as its parts, said there in either language.
write({ names: { [refOf('East loop 2')]: '日本橋 loop' } });
const out = join(temp, 'dist');
jam('build', '--out', out);
const published = (
  JSON.parse(readFileSync(join(out, 'routes.json'), 'utf8')) as {
    routes: {
      name: string;
      auto?: { place: { ja: string; en: string }; km: number; loop: boolean };
    }[];
  }
).routes;
check(
  'a named route is published with its name alone',
  published.some((route) => route.name === '日本橋 loop' && !route.auto),
  JSON.stringify(published.map((route) => route.name)),
);
check(
  'an automatic name is published as its parts, the place in both languages',
  published.some((route) => route.auto) &&
    published.every(
      (route) =>
        route.name === '日本橋 loop' ||
        (route.auto &&
          route.auto.place.ja &&
          route.auto.place.en &&
          // The same name as `jam routes` shows, so the site and the review agree.
          route.name.startsWith(`${route.auto.place.ja} · `) &&
          route.name.includes(` ${route.auto.km.toFixed(1)} km`) &&
          route.name.includes(' loop') === route.auto.loop),
    ),
  JSON.stringify(published.map((route) => route.auto)),
);

finish();

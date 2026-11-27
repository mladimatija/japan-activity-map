/**
 * Checks `jam demo` end to end, in a temporary folder (never data/): the same seed gives the same
 * files, the history has what the site's features need, the marker reaches meta.json, the
 * commands that must not run on made-up data refuse, `--clear` deletes only a demo folder, and a
 * fresh clone without the 五街道 files gives the same history.
 *
 *   pnpm check:demo
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { NAMES } from '../src/demo/names.ts';
import { fingerprint } from './harness.ts';
import { createRng } from '../src/demo/rng.ts';
import { TRIPS } from '../src/demo/story.ts';
import { climbM, densify, lengthM, slopeFactor } from '../src/demo/track.ts';

const root = resolve(import.meta.dirname, '../../..');
const temp = mkdtempSync(join(tmpdir(), 'jam-demo-check-'));
const main = join(root, 'packages/cli/src/main.ts');
const UNTIL = '2026-06-30';

let failed = false;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `: ${detail}`}`);
  if (!ok) failed = true;
};

/** Runs `jam` with the demo folder (and, when given, the data folder and lists) set; never throws. */
const jam = (
  demoDir: string,
  args: string[],
  extra: Record<string, string> = {},
): { code: number; text: string } => {
  const result = spawnSync('node', [main, ...args], {
    cwd: root,
    // The command's own log goes to a temporary data folder too, so data/ is never touched.
    env: {
      ...process.env,
      JAM_DEMO_DIR: demoDir,
      JAM_DATA_DIR: join(temp, 'own-data'),
      NODE_NO_WARNINGS: '1',
      ...extra,
    },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: result.status ?? 1, text: `${result.stdout}${result.stderr}` };
};

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

// The toolkit.
{
  const [a, b] = [createRng(42), createRng(42)];
  check(
    'the seeded generator repeats',
    Array.from({ length: 50 }, () => a.next()).join() ===
      Array.from({ length: 50 }, () => b.next()).join(),
  );
  check('another seed differs', createRng(1).next() !== createRng(2).next());
  const line = densify(
    [
      [139.7, 35.6],
      [139.71, 35.6],
      [139.71, 35.61],
    ],
    25,
  );
  check(
    'densify keeps the length and spaces points evenly',
    Math.abs(lengthM(line) - 2015) < 15 && line.length > 75 && line.length < 85,
    `${Math.round(lengthM(line))} m, ${line.length} points`,
  );
  check('climb counts rises only', climbM([10, 30, 20, 60, 60, 5]) === 60);
  check(
    'uphill is slower for every type, and a ride is faster downhill',
    (['hike', 'walk', 'run', 'trail_run', 'ride'] as const).every(
      (type) => slopeFactor(type, 0.12) < slopeFactor(type, 0),
    ) && slopeFactor('ride', -0.05) > 1,
  );
  check(
    'every name has English and Japanese',
    Object.values(NAMES).every((name) => name.en.length > 0 && /[぀-ヿ一-鿿]/.test(name.ja)),
  );
  check(
    'no trip of the story uses a 五街道 list',
    TRIPS.every(
      (trip) =>
        trip.kind !== 'route' ||
        !['tokaido', 'nakasendo', 'koshu-kaido', 'nikko-kaido', 'oshu-kaido'].includes(trip.list),
    ),
  );
}

// Lists as a fresh clone has them: the 五街道 route files are not committed.
const freshLists = join(temp, 'lists');
cpSync(join(root, 'lists'), freshLists, {
  recursive: true,
  filter: (source) =>
    !/routes[\\/](tokaido|nakasendo|koshu-kaido|nikko-kaido|oshu-kaido)\.geojson$/.test(source) &&
    !/sources[\\/]/.test(source),
});

// A full run, on the fresh-clone lists.
const demo = join(temp, 'demo');
const first = jam(demo, ['demo', '--until', UNTIL], { JAM_LISTS_DIR: freshLists });
check(
  'jam demo runs on a fresh clone (no 五街道 files)',
  first.code === 0,
  first.text.slice(-1500),
);
check('it says how to look at the result', first.text.includes('pnpm demo:web'));
check('no trip is left out', !first.text.includes('Left out'), first.text);
const out = join(demo, 'dist/data');

if (first.code === 0) {
  // The same again elsewhere, with the repository's own lists: the same sheet and tracks.
  const again = join(temp, 'again');
  const second = jam(again, ['demo', '--until', UNTIL]);
  check('a second run works', second.code === 0, second.text.slice(-800));
  check(
    'the same seed and end date give the same sheet and GPX files, with or without the 五街道',
    fingerprint(join(demo, 'source')) === fingerprint(join(again, 'source')),
  );
  const other = join(temp, 'other');
  const third = jam(other, [
    'demo',
    '--until',
    UNTIL,
    '--seed',
    '7',
    '--years',
    '2',
    '--lang',
    'ja',
    '--dry-run',
  ]);
  check('--dry-run writes nothing', third.code === 0 && !existsSync(other), third.text);
  const seeded = jam(other, [
    'demo',
    '--until',
    UNTIL,
    '--seed',
    '7',
    '--years',
    '2',
    '--lang',
    'ja',
  ]);
  check('--seed, --years and --lang work', seeded.code === 0, seeded.text.slice(-800));
  if (seeded.code === 0) {
    check(
      'another seed gives another history',
      fingerprint(join(other, 'source')) !== fingerprint(join(demo, 'source')),
    );
    const meta = json<{ site: { title: string }; demo?: boolean }>(
      join(other, 'dist/data/meta.json'),
    );
    const names = json<{ activities: { name: string; date: string }[] }>(
      join(other, 'dist/data/activities.json'),
    ).activities;
    check(
      '--lang ja gives Japanese names and title',
      meta.site.title.includes('デモ') &&
        names.every((activity) => /[぀-ヿ一-鿿]/.test(activity.name)),
    );
    check(
      '--years 2 gives two years',
      names.every((activity) => activity.date > '2024-06-30' && activity.date <= UNTIL),
    );
  }
  for (const bad of [
    ['--seed', 'x'],
    ['--until', 'tomorrow'],
    ['--years', '0'],
    ['--lang', 'fr'],
  ]) {
    const result = jam(join(temp, 'bad'), ['demo', ...bad]);
    check(`${bad.join(' ')} is refused`, result.code === 1 && !existsSync(join(temp, 'bad')));
  }

  // What was written.
  const sheet = readFileSync(join(demo, 'source/sheet.csv'), 'utf8').trim().split('\n');
  const tracks = readdirSync(join(demo, 'source/tracks'));
  check(
    'a sheet and tracks are written',
    sheet.length > 600 && tracks.length > 550,
    `${sheet.length} rows, ${tracks.length} tracks`,
  );
  const gpx = readFileSync(join(demo, 'source/tracks', tracks[0] ?? ''), 'utf8');
  check(
    'a track has heights and times at every point',
    (gpx.match(/<trkpt/g) ?? []).length === (gpx.match(/<ele>/g) ?? []).length &&
      (gpx.match(/<trkpt/g) ?? []).length === (gpx.match(/<time>/g) ?? []).length,
  );
  check(
    'no secrets file is generated',
    !existsSync(join(demo, 'config/secrets.jsonc')) && !existsSync(join(demo, 'strava-token.json')),
  );
  check(
    'the demo has its own config with a made-up home zone',
    readFileSync(join(demo, 'config/privacy-zones.jsonc'), 'utf8').includes('demo home'),
  );

  // The build: marker, counts, and content for each feature. Ranges, so a list update is fine.
  interface Activity {
    id: string;
    date: string;
    type: string;
    tags: string[];
    source: string;
    name: string;
    distanceM: number;
    movingS?: number;
    prefectures: Record<string, number>;
    places: unknown[];
    trackYear?: number;
  }
  const meta = json<{ demo?: boolean; counts: { activities: number; withTrack: number } }>(
    join(out, 'meta.json'),
  );
  const activities = json<{ activities: Activity[] }>(join(out, 'activities.json')).activities;
  const lists = json<{ lists: { id: string; kind: string; items: { status: string }[] }[] }>(
    join(out, 'lists.json'),
  ).lists;
  const routes = json<{ routes: { count: number }[] }>(join(out, 'routes.json')).routes;
  check('meta.json says demo: true', meta.demo === true);
  check(
    'the build passes its own validation, budget and audit',
    first.text.includes('Nothing private found') && first.text.includes('Loaded at start'),
  );
  check(
    'the build warns that it is demo data',
    first.text.includes('Demo data: made-up activities'),
  );
  const windows = [0, 1, 2, 3, 4].map((back) => {
    const [from, to] = [`${2021 + back}-06-30`, `${2022 + back}-06-30`];
    return activities.filter((activity) => activity.date > from && activity.date <= to).length;
  });
  check(
    'five years of about 150 activities, a quieter first one',
    windows.every((count, i) => count >= (i === 0 ? 90 : 120) && count <= 185),
    windows.join(', '),
  );
  const types = new Map<string, number>();
  for (const activity of activities) types.set(activity.type, (types.get(activity.type) ?? 0) + 1);
  check(
    'all five types, in sensible numbers',
    (types.get('run') ?? 0) >= 300 &&
      (types.get('ride') ?? 0) >= 50 &&
      (types.get('hike') ?? 0) >= 40 &&
      (types.get('walk') ?? 0) >= 30 &&
      (types.get('trail_run') ?? 0) >= 8,
    [...types].map(([type, count]) => `${type} ${count}`).join(', '),
  );
  check(
    'every activity comes from the sheet',
    activities.every((activity) => activity.source === 'sheet'),
  );
  const races = activities.filter((activity) => activity.tags.includes('race'));
  const raced = (km: number) =>
    races.some(
      (race) =>
        race.distanceM >= km * 1000 && race.distanceM < km * 1010 && (race.movingS ?? 0) > 0,
    );
  check(
    'races at 5 km, 10 km, half and full marathon, with times (records)',
    races.length >= 8 && raced(5) && raced(10) && raced(21.0975) && raced(42.195),
    races.map((race) => race.distanceM).join(', '),
  );
  check(
    'some activities without GPS',
    activities.some(
      (activity) => activity.trackYear === undefined && activity.name.includes('Treadmill'),
    ) &&
      first.text.length > 0 &&
      activities.filter((activity) => activity.trackYear === undefined).length >= 5,
  );
  const abroad = jam(
    demo,
    ['--config', join(demo, 'config'), 'build', '--out', join(temp, 'rebuild'), '--dry-run'],
    { JAM_DATA_DIR: demo, JAM_LISTS_DIR: freshLists },
  );
  check(
    'activities abroad are left out of the map of Japan, and said so',
    /\d+: .*(outside Japan|abroad)/i.test(abroad.text),
    abroad.text.slice(0, 1500),
  );
  check(
    'a hidden row and zone-cut tracks',
    /hidden|hide/i.test(abroad.text) &&
      /[1-9]\d* cut at a privacy zone, [1-9]\d* entirely inside one/.test(abroad.text),
  );
  check(
    'a ride of over 100 km',
    activities.some((activity) => activity.type === 'ride' && activity.distanceM > 100_000),
  );
  check(
    'at least 20 prefectures',
    new Set(activities.flatMap((activity) => Object.keys(activity.prefectures))).size >= 20,
  );
  const done = (id: string, status = 'done') =>
    lists.find((list) => list.id === id)?.items.filter((item) => item.status === status).length ??
    0;
  check(
    '百名山: 25 or more climbed, some wanted, a DNS',
    done('hyakumeizan') >= 25 &&
      done('hyakumeizan', 'want') >= 3 &&
      done('hyakumeizan', 'dns') >= 1,
    `${done('hyakumeizan')} done`,
  );
  check(
    'other point lists have visits (3,000 m peaks, temples, castles, waterfalls)',
    done('peaks-3000m') >= 5 &&
      done('bando-33') >= 2 &&
      done('nihon-100-meijo') >= 2 &&
      done('taki-100') >= 2,
  );
  const routeLists = lists.filter((list) => list.kind === 'route');
  check(
    'a route list finished, and others part done',
    routeLists.some(
      (list) => list.items.length > 0 && list.items.every((item) => item.status === 'done'),
    ) &&
      routeLists.filter((list) => list.items.some((item) => item.status === 'partial')).length >= 3,
  );
  check(
    'the 五街道 are absent on a fresh clone and nothing needed them',
    !lists.some((list) => list.id === 'tokaido' && list.items.length > 0),
  );
  const repeats = routes.map((route) => route.count).sort((a, b) => b - a);
  check(
    'grouped routes with repeats: three or more with 10 runs',
    repeats.filter((count) => count >= 10).length >= 3 && routes.length >= 10,
    repeats.slice(0, 8).join(', '),
  );
  const year = json<{
    features: { properties: { t?: number[][] }; geometry: { coordinates: number[][][] } }[];
  }>(join(out, 'tracks/2025.geojson'));
  check(
    'published tracks carry heights and times along them',
    year.features.length > 50 &&
      year.features.every((feature) => feature.geometry.coordinates[0]?.[0]?.length === 3) &&
      year.features.some((feature) => (feature.properties.t?.[0]?.length ?? 0) > 10),
  );

  // Status and the commands that must not touch made-up data.
  const onDemo = { JAM_DATA_DIR: demo, JAM_LISTS_DIR: freshLists };
  const config = ['--config', join(demo, 'config')];
  const status = jam(demo, [...config, 'status'], onDemo);
  check(
    'status says it is the demo store',
    status.code === 0 && status.text.includes('Demo store'),
    status.text.slice(-600),
  );
  for (const [label, args] of [
    ['strava auth', ['strava', 'auth']],
    ['sync strava', ['sync', 'strava']],
    ['deploy', ['deploy']],
    ['build into dist/data', ['build']],
    [
      'sync sheet with a file from outside',
      ['sync', 'sheet', join(root, 'templates/activity-sheet.csv')],
    ],
  ] as const) {
    const result = jam(demo, [...config, ...args], onDemo);
    check(
      `${label} refuses on the demo store`,
      result.code === 1 && result.text.includes('demo store'),
      result.text.slice(0, 300),
    );
  }
  check(
    'nothing was built into dist/data by any of this',
    !existsSync(join(demo, 'dist/data.next')),
  );

  // Audit: demo output is not private, so it passes, but with a warning.
  const audited = jam(demo, [...config, 'audit', join(demo, 'dist')], onDemo);
  check(
    'audit warns about demo output and does not fail',
    audited.code === 0 && /WARN .*demo data/.test(audited.text),
    audited.text.slice(-700),
  );

  // A real store beside a demo: its build never replaces demo output, and status mentions the demo.
  const real = join(temp, 'real');
  mkdirSync(real);
  const realBuild = jam(demo, ['build', '--out', out], {
    JAM_DATA_DIR: real,
    JAM_LISTS_DIR: freshLists,
  });
  check(
    'a real store is not built over demo output',
    realBuild.code === 1 && realBuild.text.includes('holds demo data'),
    realBuild.text.slice(0, 400),
  );
  const realStatus = jam(demo, ['status'], { JAM_DATA_DIR: real });
  check(
    'status on a real store says a demo lies beside it',
    realStatus.text.includes('Demo data:') && !realStatus.text.includes('Demo store'),
  );

  // --clear deletes a demo folder, and only one.
  const plain = join(temp, 'plain');
  mkdirSync(plain);
  writeFileSync(join(plain, 'jam.sqlite'), 'not a demo');
  const refused = jam(plain, ['demo', '--clear']);
  check(
    '--clear refuses a folder without the marker',
    refused.code === 1 && existsSync(join(plain, 'jam.sqlite')),
    refused.text,
  );
  const overwrite = jam(plain, ['demo', '--until', UNTIL]);
  check(
    'jam demo refuses to write into a folder without the marker',
    overwrite.code === 1 && readFileSync(join(plain, 'jam.sqlite'), 'utf8') === 'not a demo',
    overwrite.text,
  );
  const dry = jam(again, ['demo', '--clear', '--dry-run']);
  check(
    '--clear --dry-run deletes nothing',
    dry.code === 0 && existsSync(join(again, 'demo.json')),
  );
  const cleared = jam(again, ['demo', '--clear']);
  check('--clear deletes the demo folder', cleared.code === 0 && !existsSync(again), cleared.text);
  check('--clear with nothing there is fine', jam(again, ['demo', '--clear']).code === 0);
}

if (failed) {
  console.log(`Some checks failed; the data is kept in ${temp}.`);
  process.exit(1);
}
rmSync(temp, { recursive: true, force: true });
console.log('All checks passed.');

/**
 * Runs the build checks in a throwaway data folder (data/ and dist/ are not touched), with the
 * made-up activities of match-fixtures.ts and a privacy zone: every file is written and valid, the
 * start files fit the budget, a second build is identical apart from its build time, and a failed
 * build leaves the previous output as it was.
 *
 *   node packages/cli/dev/check-build.ts      (or: pnpm check:build)
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  activitiesFileSchema,
  listsFileSchema,
  metaFileSchema,
  prefecturesFileSchema,
  referenceRouteFileSchema,
  routesFileSchema,
  statsFileSchema,
  tracksFileSchema,
  prefectureOutlineFileSchema,
} from '@jam/core';
import { filesIn, fingerprint as hashOf, sandbox } from './harness.ts';

const {
  temp,
  data,
  configDir,
  listsDir,
  jamResult: jam,
  fixtures,
  check,
  finish,
} = sandbox('build');
const out = join(temp, 'dist', 'data');
// A zone at Tokyo station, where the ride to Yokohama starts.
const zones = (extra: object = {}) =>
  writeFileSync(
    join(configDir, 'privacy-zones.jsonc'),
    JSON.stringify({
      zones: [{ label: 'start', lat: 35.6812, lon: 139.7671, radiusM: 300, ...extra }],
    }),
  );
zones();
fixtures('match-fixtures.ts', join(temp, 'sheet'));
jam('sync', 'sheet', join(temp, 'sheet', 'sheet.csv'));

/** A hash of the output, with the build time taken out of meta.json. */
const fingerprint = () => hashOf(out, (content) => content.replace(/"builtAt":"[^"]+"/, ''));

const first = jam('build', '--out', out);
check('the build succeeds', first.code === 0, first.text);
const expected = [
  'meta.json',
  'activities.json',
  'lists.json',
  'prefectures.geojson',
  'stats.json',
  'routes.json',
];
// One reference file per built route list.
const routeLists = readdirSync(join(listsDir, 'routes')).filter((file) =>
  file.endsWith('.geojson'),
).length;
const written = existsSync(out) ? filesIn(out).map((file) => relative(out, file)) : [];
const references = written.filter((file) => file.startsWith('reference-routes/'));
const outlines = written.filter((file) => file.startsWith('prefectures/'));
const tracks = written.filter((file) => file.startsWith('tracks/'));
check(
  'it writes every file',
  expected.every((file) => written.includes(file)) &&
    references.length === routeLists &&
    tracks.length >= 1,
  written.join(', '),
);
const read = (file: string) => JSON.parse(readFileSync(join(out, file), 'utf8')) as unknown;
const schemas = [
  ['meta.json', metaFileSchema],
  ['activities.json', activitiesFileSchema],
  ['lists.json', listsFileSchema],
  ['prefectures.geojson', prefecturesFileSchema],
  ['stats.json', statsFileSchema],
  ['routes.json', routesFileSchema],
] as const;
const invalid = [
  ...schemas
    .filter(([file, schema]) => !schema.safeParse(read(file)).success)
    .map(([file]) => file),
  ...references.filter((file) => !referenceRouteFileSchema.safeParse(read(file)).success),
  ...outlines.filter((file) => !prefectureOutlineFileSchema.safeParse(read(file)).success),
  ...tracks.filter((file) => !tracksFileSchema.safeParse(read(file)).success),
];
check('every file validates against its schema', invalid.length === 0, invalid.join(', '));
check(
  'a detailed outline for each of the 47 prefectures',
  outlines.length === 47,
  `${outlines.length}`,
);
const features = tracks.flatMap(
  (file) =>
    (
      read(file) as {
        features: { properties: { t?: number[][] }; geometry: { coordinates: number[][][] } }[];
      }
    ).features,
);
const timed = features.filter((feature) => feature.properties.t);
check(
  "tracks with times publish seconds per point, from each stretch's start",
  timed.length > 0 &&
    timed.every(
      ({ properties: { t = [] }, geometry: { coordinates } }) =>
        t.length === coordinates.length &&
        t.every(
          (seconds, i) =>
            seconds.length === coordinates[i]?.length &&
            seconds[0] === 0 &&
            seconds.every((value, j) => j === 0 || value >= (seconds[j - 1] ?? 0)),
        ),
    ),
  `${timed.length} of ${features.length} tracks have seconds`,
);
check(
  'the summary shows the start files within the budget',
  /Loaded at start: [\d.]+ KB compressed, budget 1024\.0 KB\.\n/.test(first.text) &&
    /Nothing private found/.test(first.text),
);
const activities = (
  read('activities.json') as {
    activities: {
      name: string;
      places: string[];
      routeItems: string[];
      prefectures: Record<string, number>;
      start?: number[];
    }[];
  }
).activities;
check(
  'a summit and a route stretch reach the activity records',
  activities.some((activity) => activity.places.includes('peak-363')) &&
    activities.some((activity) => activity.routeItems.includes('tokaido-001')),
);
check(
  'an activity outside Japan is not published',
  !activities.some((activity) => activity.name === 'Zagreb run'),
);
const ride = activities.find((activity) => activity.name === 'Tokyo to Yokohama');
check(
  'a track starting in a zone starts outside it',
  ride?.start !== undefined &&
    Math.hypot(
      ((ride.start[0] ?? 0) - 139.7671) * 90_400,
      ((ride.start[1] ?? 0) - 35.6812) * 111_000,
    ) > 300,
);
const lists = read('lists.json') as {
  lists: { id: string; items: { placeId?: string | null; status: string }[] }[];
};
check(
  'list statuses are in the output',
  lists.lists
    .find((list) => list.id === 'hyakumeizan')
    ?.items.find((item) => item.placeId === 'peak-363')?.status === 'done',
);

const municipal = (
  read('lists.json') as {
    lists: { id: string; items: { id: string; status: string; name: { en: string } }[] }[];
  }
).lists.find((list) => list.id === 'municipalities');
const rideAreas =
  (read('activities.json') as { activities: { name: string; areas?: string[] }[] }).activities.find(
    (activity) => activity.name === 'Tokyo to Yokohama',
  )?.areas ?? [];
check(
  'the municipality list has every municipality, with an English name each',
  (municipal?.items.length ?? 0) > 1700 && municipal?.items.every((item) => item.name.en) === true,
  `${municipal?.items.length}`,
);
check(
  'a ride from Tokyo to Yokohama ticks Yokohama and the wards on the way, and nothing far off',
  rideAreas.includes('muni-14100') &&
    rideAreas.includes('muni-13109') &&
    !rideAreas.includes('muni-01100') &&
    municipal?.items.find((item) => item.id === 'muni-14100')?.status === 'done' &&
    municipal.items.find((item) => item.id === 'muni-01100')?.status === 'none',
  rideAreas.join(' '),
);

const before = fingerprint();
// The audit run on its own knows the same public geometry as the build did (a reference route or
// a list place inside a zone is not a leak), from what the build left beside the store.
{
  const alone = jam('audit', join(temp, 'dist'));
  check(
    '`jam audit` on its own passes on the build it follows',
    alone.code === 0,
    alone.text.slice(-600),
  );
}
const second = jam('build', '--out', out);
check(
  'a second build with no changes is identical apart from the build time',
  second.code === 0 && fingerprint() === before && /0 recomputed/.test(second.text),
);

// A failing audit: a zone address that appears in the output (an activity name).
zones({ address: 'Tokyo to Yokohama' });
const failing = jam('build', '--out', out);
check(
  'a failed audit stops the build',
  failing.code === 1 &&
    /FAIL {2}Privacy zone addresses/.test(failing.text) &&
    /left as it was/.test(failing.text),
  failing.text,
);
check('  ...and the previous output is left in place', fingerprint() === before);
check(
  '  ...with the failed files kept locally',
  existsSync(join(data, 'build-failed', 'activities.json')),
);
zones();
// Over budget.
writeFileSync(join(configDir, 'site.jsonc'), JSON.stringify({ output: { startBudgetKB: 10 } }));
const big = jam('build', '--out', out);
check(
  'a build over the size budget fails too, keeping the previous output',
  big.code === 1 && /over budget/.test(big.text) && fingerprint() === before,
);
rmSync(join(configDir, 'site.jsonc'));
const dry = jam('build', '--out', out, '--dry-run');
check(
  'a dry run replaces nothing',
  dry.code === 0 && fingerprint() === before && /Dry run/.test(dry.text),
);

finish();

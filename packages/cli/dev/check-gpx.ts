/**
 * Runs the GPX import checks on made-up tracks around 東京駅 in a throwaway data folder (data/ is
 * not touched): a folder and an archive import the same activities, a second import changes
 * nothing, --replace and `gpx wipe` remove GPX activities and nothing else, odd archives are
 * refused, and the site is built from Strava or from GPX files as config/site.jsonc says, with
 * no route mixing the two.
 *
 *   node packages/cli/dev/check-gpx.ts      (or: pnpm check:gpx)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from '../src/store/sqlite.ts';
import { fingerprint, sandbox } from './harness.ts';
import { makeZip } from './zip-writer.ts';

const { temp, data, configDir, jam, jamResult, jamWith, check, finish } = sandbox('gpx');

type Point = [number, number];
const M_LON = 1 / 90_600;
const M_LAT = 1 / 110_950;
const START: Point = [139.7671, 35.6812];
/** A circle of 800 m through START, a point every 15 m: the loop every source has runs of. */
const loop = (): Point[] => {
  const centre: Point = [START[0] + 800 * M_LON, START[1]];
  const n = Math.round((2 * Math.PI * 800) / 15);
  return Array.from({ length: n + 1 }, (_, i) => {
    const angle = Math.PI - (2 * Math.PI * i) / n;
    return [centre[0] + Math.cos(angle) * 800 * M_LON, centre[1] + Math.sin(angle) * 800 * M_LAT];
  });
};
/** A straight line between two points, a point every 15 m. */
const line = (a: Point, b: Point): Point[] => {
  const n = Math.round(Math.hypot((b[0] - a[0]) / M_LON, (b[1] - a[1]) / M_LAT) / 15);
  return Array.from({ length: n + 1 }, (_, i) => [
    a[0] + ((b[0] - a[0]) * i) / n,
    a[1] + ((b[1] - a[1]) * i) / n,
  ]);
};
// A privacy zone where the loop starts: GPX tracks are cut there like any other.
writeFileSync(
  join(configDir, 'privacy-zones.jsonc'),
  JSON.stringify({ zones: [{ label: 'home', lat: START[1], lon: START[0], radiusM: 300 }] }),
);
const A: Point = [139.7501, 35.6652];
const B: Point = [139.7901, 35.6752];
const C: Point = [139.7801, 35.6952];

interface Track {
  name?: string;
  type?: string;
  /** UTC start; left out, the points carry no times. */
  start?: string;
  /** Lists of points: one track segment each. */
  segments: Point[][];
  heights?: boolean;
}
const gpx = ({ name, type, start, segments, heights }: Track): string => {
  let index = 0;
  const t0 = start ? Date.parse(start) : 0;
  const body = segments
    .map((points) => {
      const rows = points.map(([lon, lat]) => {
        const i = index++;
        const ele = heights ? `<ele>${(20 + 30 * Math.sin(i / 40)).toFixed(1)}</ele>` : '';
        const time = start ? `<time>${new Date(t0 + i * 5000).toISOString()}</time>` : '';
        return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${ele}${time}</trkpt>`;
      });
      return `<trkseg>${rows.join('')}</trkseg>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="check-gpx" xmlns="http://www.topografix.com/GPX/1/1"><trk>${name ? `<name>${name}</name>` : ''}${type ? `<type>${type}</type>` : ''}${body}</trk></gpx>\n`;
};

const query = <T>(sql: string, params: (string | number)[] = []) => {
  const db = new Database(join(data, 'jam.sqlite'), { readOnly: true });
  try {
    return db.all(sql, params) as T[];
  } finally {
    db.close();
  }
};
const gpxRows = () =>
  query<{ id: string; public_id: string; name: string; activity_type: string }>(
    `SELECT id, public_id, name, activity_type FROM activities WHERE source = 'gpx' ORDER BY start_time`,
  );
const publicIds = () => new Map(gpxRows().map((row) => [row.name, row.public_id]));
/** Everything of the Strava and sheet activities and their tracks, as one hash. */
const others = () =>
  createHash('sha256')
    .update(
      JSON.stringify([
        query(`SELECT * FROM activities WHERE source != 'gpx' ORDER BY id`),
        query(
          `SELECT t.* FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source != 'gpx' ORDER BY t.activity_id`,
        ),
        query('SELECT * FROM sheet_rows ORDER BY row_key'),
        query('SELECT * FROM overrides ORDER BY id'),
      ]),
    )
    .digest('hex');
const backups = (reason: string) =>
  readdirSync(join(data, 'backups')).filter((name) => name.includes(reason)).length;

// Strava and sheet activities first: two Strava runs of the loop and one from A to B, a sheet run
// of the loop and a sheet walk. The Strava ones are sheet rows turned into Strava's in the store,
// as the privacy check does, since nothing here talks to Strava.
const sheet = join(temp, 'sheet');
mkdirSync(sheet);
const sheetRows: string[] = [];
const sheetRow = (id: string, day: string, type: string, name: string, points: Point[]) => {
  writeFileSync(
    join(sheet, `${id}.gpx`),
    gpx({ name, start: `${day}T21:00:00Z`, segments: [points] }),
  );
  sheetRows.push(`${id},${day},,,${type},,${name},,done,,,,,,${id}.gpx,,,,`);
};
sheetRow('s1', '2025-01-10', 'Run', 'Strava loop 1', loop());
sheetRow('s2', '2025-02-10', 'Run', 'Strava loop 2', loop());
sheetRow('s3', '2025-03-10', 'Run', 'Strava A to B', line(A, B));
sheetRow('m1', '2025-04-10', 'Run', 'Sheet loop', loop());
sheetRow('m2', '2025-04-20', 'Walk', 'Sheet walk', line(B, C));
writeFileSync(
  join(sheet, 'sheet.csv'),
  `row_id,date,end_date,time_zone,activity_type,event_tags,name,place,status,lat,lon,distance_km,elevation_gain_m,duration,gpx_path,strava_id,show_strava_link,hide,notes\n${sheetRows.join('\n')}\n`,
);
jam('sync', 'sheet', join(sheet, 'sheet.csv'));
// From here on the sheet is pointed at nothing, whatever is in data/ beside the repository.
writeFileSync(join(configDir, 'sheet.jsonc'), JSON.stringify({ path: join(temp, 'no-sheet.csv') }));
{
  const db = new Database(join(data, 'jam.sqlite'));
  ['Strava loop 1', 'Strava loop 2', 'Strava A to B'].forEach((name, i) =>
    db.run(`UPDATE activities SET source = 'strava', strava_id = ? WHERE name = ?`, [
      17000000001 + i,
      name,
    ]),
  );
  db.close();
}
const before = others();

// The GPX files, in the default folder (data/activities), some in a subfolder and one archive.
const folder = join(data, 'activities');
mkdirSync(join(folder, '2025'), { recursive: true });
const files: Record<string, string> = {
  'loop-1.gpx': gpx({
    name: 'GPX loop 1',
    type: 'running',
    start: '2025-05-10T21:00:00Z',
    segments: [loop()],
    heights: true,
  }),
  '2025/loop-2.gpx': gpx({
    name: 'GPX loop 2',
    type: 'Run',
    start: '2025-06-10T21:00:00Z',
    segments: [loop()],
    heights: true,
  }),
  '2025/a-to-b.gpx': gpx({
    name: 'GPX A to B',
    type: 'ランニング',
    start: '2025-07-10T21:00:00Z',
    segments: [line(A, B)],
  }),
  // Two segments, no name and no type: one activity, named by its file, of the default type.
  '2025/two-parts.gpx': gpx({
    start: '2025-08-10T00:00:00Z',
    segments: [line(B, C).slice(0, 80), line(B, C).slice(90)],
    heights: true,
  }),
  // No times in it: its date comes from the file name.
  '2025/2025-09-14 no-times.gpx': gpx({
    name: 'GPX without times',
    type: '登山',
    segments: [line(C, A)],
  }),
  'broken.gpx': '<gpx><trk><trkseg><trkpt lat="35.68"',
  'no-track.gpx':
    '<?xml version="1.0"?><gpx version="1.1"><wpt lat="35.6812" lon="139.7671"><name>A point</name></wpt></gpx>',
  'notes.txt': 'not a track',
  '.hidden.gpx': gpx({ name: 'Hidden', start: '2025-01-01T00:00:00Z', segments: [line(A, C)] }),
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
const zipLoop = gpx({
  name: 'GPX loop 3',
  type: 'running',
  start: '2025-10-10T21:00:00Z',
  segments: [loop()],
});
writeFileSync(
  join(folder, 'more.zip'),
  makeZip([
    { name: 'export/loop-3.gpx', data: zipLoop },
    { name: '__MACOSX/export/._loop-3.gpx', data: 'resource fork' },
    { name: 'export/readme.txt', data: 'hello' },
  ]),
);
const EXPECTED = [
  'GPX loop 1',
  'GPX loop 2',
  'GPX A to B',
  'two-parts',
  'GPX without times',
  'GPX loop 3',
];

const dry = jam('sync', 'gpx', '--dry-run');
check(
  'a dry run says what would be added and writes nothing',
  /Would be: 6 added, 0 updated, 0 removed, 0 unchanged, 2 skipped/.test(dry) &&
    gpxRows().length === 0,
  dry,
);
const first = jamWith({}, 'sync', 'gpx');
let rows = gpxRows();
check(
  'the default folder is imported: loose files, a subfolder and an archive in it',
  first.code === 0 &&
    /6 added, 0 updated, 0 removed, 0 unchanged, 2 skipped/.test(first.text) &&
    EXPECTED.every((name) => rows.some((row) => row.name === name)) &&
    rows.length === 6,
  first.text,
);
check(
  'a broken file and one without a track are reported and skipped, not fatal',
  /! broken\.gpx: skipped, /.test(first.text) && /! no-track\.gpx: skipped, /.test(first.text),
  first.text,
);
check(
  'hidden files, other kinds of file and macOS copies in an archive are left alone',
  !rows.some((row) => row.name === 'Hidden') && !/notes\.txt|__MACOSX|readme/.test(first.text),
);
const typeOf = (name: string) => rows.find((row) => row.name === name)?.activity_type;
check(
  'the type comes from the file, in English or Japanese, else the default',
  typeOf('GPX loop 1') === 'run' &&
    typeOf('GPX A to B') === 'run' &&
    typeOf('GPX without times') === 'hike' &&
    typeOf('two-parts') === 'hike',
  JSON.stringify(rows.map((row) => [row.name, row.activity_type])),
);
const stored = query<{
  name: string;
  start_local: string;
  distance_m: number;
  elevation_gain_m: number | null;
  elapsed_time_s: number | null;
  moving_time_s: number | null;
  detail: string;
  point_count: number;
  has_heights: number;
  has_times: number;
}>(
  `SELECT a.name, a.start_local, a.distance_m, a.elevation_gain_m, a.elapsed_time_s, a.moving_time_s, t.detail, t.point_count,
          t.elevations IS NOT NULL AS has_heights, t.times IS NOT NULL AS has_times
     FROM activities a JOIN tracks t ON t.activity_id = a.id WHERE a.source = 'gpx'`,
);
const loop1 = stored.find((row) => row.name === 'GPX loop 1');
check(
  'date, distance, climb and times come from the file, with a full track',
  loop1 !== undefined &&
    loop1.start_local === '2025-05-11T06:00:00' &&
    Math.abs(loop1.distance_m - 5027) < 60 &&
    (loop1.elevation_gain_m ?? 0) > 50 &&
    loop1.elapsed_time_s === (loop1.point_count - 1) * 5 &&
    loop1.moving_time_s === loop1.elapsed_time_s &&
    loop1.detail === 'full' &&
    loop1.has_heights === 1 &&
    loop1.has_times === 1,
  JSON.stringify(loop1),
);
const twoParts = stored.find((row) => row.name === 'two-parts');
const noTimes = stored.find((row) => row.name === 'GPX without times');
check(
  'a file with two segments is one activity; one without times takes its date from its name',
  twoParts?.point_count === line(B, C).length - 10 &&
    noTimes?.start_local === '2025-09-14' &&
    noTimes.has_times === 0 &&
    noTimes.elapsed_time_s === null,
  JSON.stringify([twoParts, noTimes]),
);
check('Strava and sheet activities are untouched by the import', others() === before);

const ids = publicIds();
const again = jam('sync', 'gpx');
check(
  'importing the same folder again changes nothing',
  /0 added, 0 updated, 0 removed, 6 unchanged, 2 skipped/.test(again) &&
    JSON.stringify([...publicIds()]) === JSON.stringify([...ids]),
  again,
);

// The same activities as one archive, with one of them renamed and one more file.
const archive = join(temp, 'export.zip');
const extra = gpx({
  name: 'GPX loop 4',
  type: 'running',
  start: '2025-11-10T21:00:00Z',
  segments: [loop()],
});
writeFileSync(
  archive,
  makeZip([
    { name: 'a/loop-1.gpx', data: files['loop-1.gpx'] ?? '' },
    {
      name: 'a/renamed.gpx',
      data: (files['2025/loop-2.gpx'] ?? '').replace('GPX loop 2', 'GPX loop 2 renamed'),
      store: true,
    },
    { name: 'a/loop-4.gpx', data: extra },
    { name: 'a/z-copy.gpx', data: extra.replace('GPX loop 4', 'A copy') },
  ]),
);
const zipped = jamWith({}, 'sync', 'gpx', archive);
rows = gpxRows();
check(
  'an archive is imported: a new file is added, a changed one updated, the rest left',
  zipped.code === 0 &&
    /1 added, 1 updated, 0 removed, 1 unchanged, 1 skipped/.test(zipped.text) &&
    rows.length === 7 &&
    rows.some((row) => row.name === 'GPX loop 4'),
  zipped.text,
);
check(
  '  ...a second file with the same start time is the same activity, and is skipped',
  /z-copy\.gpx: skipped, starts at the same second/.test(zipped.text),
  zipped.text,
);
check(
  '  ...and the renamed one keeps its public id',
  publicIds().get('GPX loop 2 renamed') === ids.get('GPX loop 2') &&
    publicIds().get('GPX loop 1') === ids.get('GPX loop 1'),
);
jam('sync', 'gpx');
check(
  'importing the folder again puts the old name back, still one activity',
  gpxRows().length === 7 && publicIds().get('GPX loop 2') === ids.get('GPX loop 2'),
);

// Archives that are not read: nothing of them is imported, and the command fails saying why.
const refused = (label: string, bytes: Uint8Array, pattern: RegExp) => {
  const file = join(temp, 'odd.zip');
  writeFileSync(file, bytes);
  const result = jamResult('sync', 'gpx', file);
  check(
    label,
    result.code !== 0 && pattern.test(result.text) && gpxRows().length === 7,
    result.text,
  );
};
refused(
  'an archive with a password is refused',
  makeZip([{ name: 'a.gpx', data: extra, encrypted: true }]),
  /encrypted/,
);
refused(
  'a file that would unpack to more than a GPX file may be is refused',
  makeZip([{ name: 'a.gpx', data: extra, claimBytes: 200 * 1024 * 1024 }]),
  /over the 64 MB/,
);
refused(
  'a zip64 archive is refused',
  makeZip([{ name: 'a.gpx', data: extra, claimBytes: 0xffffffff }]),
  /zip64/,
);
refused('a file that is no archive is refused', Buffer.from('PK nothing here'), /not a zip/);
{
  // A file that unpacks to more than it states is skipped; the rest of the archive is imported.
  const file = join(temp, 'bomb.zip');
  writeFileSync(
    file,
    makeZip([
      { name: 'big.gpx', data: ' '.repeat(2_000_000), claimBytes: 100 },
      { name: 'loop-1.gpx', data: files['loop-1.gpx'] ?? '' },
    ]),
  );
  const result = jamWith({}, 'sync', 'gpx', file);
  check(
    'a file that unpacks to more than it states is skipped, the rest imported',
    result.code === 0 && /big\.gpx: skipped/.test(result.text) && /1 unchanged/.test(result.text),
    result.text,
  );
}
const missing = jamResult('sync', 'gpx', join(temp, 'nowhere'));
check(
  'a path that is not there fails with a sentence',
  missing.code !== 0 && /Nothing at/.test(missing.text),
);

// The switch. With the example config the site is built from Strava and the sheet.
interface Built {
  activities: {
    id: string;
    name: string;
    source: string;
    route?: string;
    link?: string;
    start?: Point;
    end?: Point;
  }[];
  routes: { id: string; count: number; activities: string[] }[];
}
const out = join(temp, 'dist');
const build = (): Built & { text: string; code: number } => {
  const result = jamResult('build', '--out', out);
  const read = (file: string) => JSON.parse(readFileSync(join(out, file), 'utf8')) as Built;
  return result.code === 0
    ? {
        ...result,
        activities: read('activities.json').activities,
        routes: read('routes.json').routes,
      }
    : { ...result, activities: [], routes: [] };
};
const setSource = (source: string) =>
  writeFileSync(join(configDir, 'site.jsonc'), JSON.stringify({ activities: { source } }));
const sourcesOf = (built: Built) => [...new Set(built.activities.map((a) => a.source))].sort();
/** Every route holds only published activities, and its count is theirs. */
const routesWhole = (built: Built) => {
  const published = new Set(built.activities.map((activity) => activity.id));
  return built.routes.every(
    (route) =>
      route.count === route.activities.length && route.activities.every((id) => published.has(id)),
  );
};
const stable = (text: string) => text.replace(/"builtAt":"[^"]+"/, '');

const fromStrava = build();
const stravaPrint = fromStrava.code === 0 ? fingerprint(out, stable) : '';
check(
  'built from Strava: Strava and sheet activities, no GPX one',
  fromStrava.code === 0 &&
    JSON.stringify(sourcesOf(fromStrava)) === '["sheet","strava"]' &&
    fromStrava.activities.length === 5 &&
    /7: from GPX files, and the site is built from Strava/.test(fromStrava.text),
  fromStrava.text,
);
check(
  '  ...the loop is one route of the two Strava runs and the sheet run',
  fromStrava.routes.length === 1 && fromStrava.routes[0]?.count === 3 && routesWhole(fromStrava),
  JSON.stringify(fromStrava.routes),
);
const grouped = query<{ n: number }>(
  `SELECT COUNT(*) AS n FROM route_members m JOIN route_members o ON o.route_id = m.route_id
    WHERE m.member_ref = 'strava:17000000003' AND o.member_ref != m.member_ref`,
)[0]?.n;
check(
  '  ...and the Strava and GPX runs from A to B, one route in the store, are no route on the site',
  grouped === 1 &&
    !fromStrava.activities.find((activity) => activity.name === 'Strava A to B')?.route,
  `${grouped} other members`,
);

setSource('gpx');
const fromGpx = build();
check(
  'built from GPX files: GPX and sheet activities, no Strava one, nothing deleted',
  fromGpx.code === 0 &&
    JSON.stringify(sourcesOf(fromGpx)) === '["gpx","sheet"]' &&
    fromGpx.activities.length === 9 &&
    /3: from Strava, and the site is built from GPX files/.test(fromGpx.text) &&
    others() === before,
  fromGpx.text,
);
check(
  '  ...the loop is one route of the four GPX runs and the sheet run, with no Strava member',
  fromGpx.routes.length === 1 && fromGpx.routes[0]?.count === 5 && routesWhole(fromGpx),
  JSON.stringify(fromGpx.routes),
);
check(
  '  ...the GPX run from A to B is no route either, and no GPX activity has a link',
  !fromGpx.activities.find((activity) => activity.name === 'GPX A to B')?.route &&
    fromGpx.activities.every((activity) => activity.link === undefined),
);
const metresFromStart = ([lon, lat]: Point) =>
  Math.hypot((lon - START[0]) / M_LON, (lat - START[1]) / M_LAT);
check(
  '  ...GPX tracks are cut at the privacy zone, and the audit finds nothing',
  /Published 9 activities: 9 with a track, 6 cut at a privacy zone/.test(fromGpx.text) &&
    fromGpx.text.includes('Nothing private found.') &&
    fromGpx.activities.every(
      (activity) =>
        (!activity.start || metresFromStart(activity.start) >= 295) &&
        (!activity.end || metresFromStart(activity.end) >= 295),
    ),
  fromGpx.text.split('\n').slice(0, 2).join(' / '),
);
check(
  "  ...published ids are the store's public ids",
  [...publicIds()].every(([name, id]) =>
    fromGpx.activities.some((activity) => activity.name === name && activity.id === id),
  ),
);
const status = jam('status');
check(
  'status counts activities by source and says which the site is built from',
  /By source: gpx 7, sheet 2, strava 3/.test(status) &&
    /Site activities: built from GPX files plus the sheet/.test(status),
  status,
);
const update = jamWith({ JAM_UPDATE_DIST: join(temp, 'update') }, 'update', '--no-deploy');
check(
  'update imports the GPX folder instead of asking Strava',
  update.code === 0 &&
    /\[1\/5\] Import GPX files:/.test(update.text) &&
    !update.text.includes('Strava activities'),
  update.text,
);

setSource('strava');
const back = build();
check(
  'switched back, the build is the first one again, byte for byte',
  back.code === 0 && fingerprint(out, stable) === stravaPrint && gpxRows().length === 7,
  back.text,
);

// --replace: what is not in the import goes, after a copy of the store.
renameSync(join(folder, '2025/a-to-b.gpx'), join(temp, 'a-to-b.gpx'));
const replaceDry = jam('sync', 'gpx', '--replace', '--dry-run');
check(
  'a dry run of --replace removes nothing',
  /Would be: 0 added, 0 updated, 2 removed, 5 unchanged/.test(replaceDry) && gpxRows().length === 7,
  replaceDry,
);
const replaced = jam('sync', 'gpx', '--replace');
check(
  '--replace removes the GPX activities that are not in the import, after a copy',
  /0 added, 0 updated, 2 removed, 5 unchanged/.test(replaced) &&
    /- .*GPX A to B \(not in this import\)/.test(replaced) &&
    gpxRows().length === 5 &&
    backups('before-wipe-gpx-replace') === 1 &&
    others() === before,
  replaced,
);
// A file that was imported before and is damaged now does not take its activity with it.
const loopFile = join(folder, '2025/loop-2.gpx');
const whole = readFileSync(loopFile, 'utf8');
writeFileSync(loopFile, whole.slice(0, 200));
const damaged = jamWith({}, 'sync', 'gpx', '--replace').text;
check(
  '--replace keeps an activity whose own file could not be read this time',
  /0 removed/.test(damaged) && /= 2025\/loop-2\.gpx .*kept/.test(damaged) && gpxRows().length === 5,
  damaged,
);
writeFileSync(loopFile, whole);
const empty = join(temp, 'empty');
mkdirSync(empty);
writeFileSync(join(empty, 'broken.gpx'), 'nothing');
const nothing = jamResult('sync', 'gpx', empty, '--replace');
check(
  '--replace with nothing readable removes nothing',
  nothing.code !== 0 && gpxRows().length === 5,
  nothing.text,
);
const pulls = query<{ outcome: string; added: number; removed: number; source_file: string }>(
  `SELECT outcome, added, removed, source_file FROM pulls WHERE source = 'gpx' ORDER BY id`,
);
check(
  'every import is recorded as a pull',
  pulls.length >= 5 &&
    pulls[0]?.added === 6 &&
    pulls.some((pull) => pull.removed === 2) &&
    pulls.every((pull) => pull.outcome === 'ok'),
  JSON.stringify(pulls),
);

// Wipe.
const wouldWipe = jam('gpx', 'wipe');
check(
  'gpx wipe without --yes only says what would go',
  /Would delete 5 GPX activities and 5 tracks/.test(wouldWipe) && gpxRows().length === 5,
  wouldWipe,
);
const wiped = jam('gpx', 'wipe', '--yes');
check(
  'gpx wipe --yes deletes every GPX activity and track, after a copy',
  /Deleted 5 GPX activities and 5 tracks/.test(wiped) &&
    gpxRows().length === 0 &&
    query<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tracks t LEFT JOIN activities a ON a.id = t.activity_id WHERE a.id IS NULL`,
    )[0]?.n === 0 &&
    backups('before-wipe-gpx.sqlite') === 1,
  wiped,
);
check('  ...and no Strava or sheet row, track or override with them', others() === before);
renameSync(join(temp, 'a-to-b.gpx'), join(folder, '2025/a-to-b.gpx'));
jam('sync', 'gpx');
check(
  'imported again after a wipe, every activity has the public id it had',
  gpxRows().length === 6 && [...publicIds()].every(([name, id]) => ids.get(name) === id),
  JSON.stringify([...publicIds()]),
);

finish();

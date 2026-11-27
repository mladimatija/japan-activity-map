/**
 * Runs the privacy checks on the made-up runs around 東京駅 (route-fixtures.ts) in a throwaway data
 * folder: a home zone at their start and an office zone on the way from A to B. It writes a small
 * output folder the way the build will, then audits it.
 *
 *   node packages/cli/dev/check-privacy.ts      (or: pnpm check:privacy)
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Position } from '@jam/core';

import { forbiddenFor, publishSelection } from '../src/privacy/selection.ts';
import { loadConfig } from '../src/config.ts';
import { distanceM } from '../src/match/geometry.ts';
import { audit } from '../src/privacy/audit.ts';
import { fragmentFeatures } from '../src/privacy/clip.ts';
import type { Selection } from '../src/privacy/publish.ts';
import { Database } from '../src/store/sqlite.ts';
import type { Store } from '../src/store/store.ts';
import { sandbox } from './harness.ts';

const { temp, data, configDir, jam, fixtures, check, finish } = sandbox('privacy');
const sheet = join(temp, 'sheet');
const HOME: Position = [139.7671, 35.6812];
const OFFICE: Position = [139.7681, 35.6642];
writeFileSync(
  join(configDir, 'privacy-zones.jsonc'),
  JSON.stringify({
    zones: [
      { label: 'home', lat: HOME[1], lon: HOME[0], radiusM: 300 },
      {
        label: 'office',
        lat: OFFICE[1],
        lon: OFFICE[0],
        radiusM: 200,
        address: '1-2-3 Example, Chiyoda',
      },
    ],
  }),
);
fixtures('route-fixtures.ts', sheet);
// A short walk that never leaves the home zone, and a run marked hidden in the sheet.
const around = Array.from({ length: 40 }, (_, i) => [
  HOME[0] + Math.cos(i / 6) * 0.001,
  HOME[1] + Math.sin(i / 6) * 0.0008,
]);
writeFileSync(
  join(sheet, 'block.gpx'),
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${around.map(([lon, lat], i) => `<trkpt lat="${lat}" lon="${lon}"><time>2025-12-01T00:${String(i).padStart(2, '0')}:00Z</time></trkpt>`).join('')}</trkseg></trk></gpx>`,
);
appendFileSync(
  join(sheet, 'sheet.csv'),
  'block1,2025-12-01,,,Walk,,Round the block,,done,,,,,,block.gpx,,,,\nsecret1,2025-12-02,,,Run,,Secret run,,done,,,,,,east1.gpx,,,yes,\n',
);
jam('sync', 'sheet', join(sheet, 'sheet.csv'));
jam('match');

// Three of the runs become Strava activities, to try the link option.
const db = new Database(join(data, 'jam.sqlite'));
const stravaIds = [17000000001, 17000000002, 17000000003];
['East loop 1', 'A to B 1', 'West loop'].forEach((name, i) =>
  db.run('UPDATE activities SET strava_id = ? WHERE name = ?', [stravaIds[i] ?? 0, name]),
);
const salt = db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'id_salt'`)?.value ?? '';
const store = { db, salt, close: () => db.close() } as unknown as Store;

/** What the build will write, in miniature: public records and their clipped tracks. */
const writeOutput = (selection: Selection, dir: string): void => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const records = selection.activities.map((activity) => ({
    id: activity.publicId,
    date: activity.date,
    time: activity.startLocal,
    type: activity.type,
    name: activity.name,
    distanceM: activity.distanceM,
    prefectures: Object.keys(activity.prefectures),
    link: activity.link,
  }));
  writeFileSync(join(dir, 'activities.json'), JSON.stringify(records));
  const tracks = fragmentFeatures(selection.activities, (activity) => ({ id: activity.publicId }));
  writeFileSync(join(dir, 'tracks.geojson'), JSON.stringify(tracks));
};

const configWith = (publish: Record<string, unknown>) => {
  const config = loadConfig(configDir).config;
  return { ...config, site: { ...config.site, publish: { ...config.site.publish, ...publish } } };
};
const out = join(temp, 'dist');

let config = configWith({});
let { selection, zones } = publishSelection(store, config, false);
const byName = (name: string) => selection.activities.find((activity) => activity.name === name);

// 1. A track starting at home: a gap there, and cut points not on a circle round the true spot.
// The clipping centre moves up to half the radius, and the radius grows by that shift plus up to
// 50 m of jitter, so a cut can land up to r + 2 × 0.5 r + 50 m from home: 650 m for this 300 m zone.
const FARTHEST_CUT = 700;
const eastRuns = selection.activities.filter((activity) => activity.name.startsWith('East loop'));
const ends = eastRuns
  .flatMap((activity) =>
    activity.fragments.flatMap((fragment) => [fragment.points[0], fragment.points.at(-1)]),
  )
  .filter((point): point is Position => Boolean(point));
const fromHome = ends
  .map((point) => distanceM(point, HOME))
  .filter((metres) => metres < FARTHEST_CUT);
const closest = Math.min(
  ...selection.activities.flatMap((activity) =>
    activity.fragments.flatMap((fragment) =>
      fragment.points.map((point) => distanceM(point, HOME)),
    ),
  ),
);
check(
  'a track starting at home shows a gap there',
  eastRuns.length === 8 && closest >= 300,
  `closest published point ${Math.round(closest)} m from home`,
);
const spread = Math.max(...fromHome) - Math.min(...fromHome);
check(
  '  ...and its cut points are not on a circle around home',
  fromHome.length >= 16 && spread >= 15,
  `${fromHome.length} cut points, ${Math.round(Math.min(...fromHome))}–${Math.round(Math.max(...fromHome))} m from home`,
);
const again = publishSelection(store, config, false).selection;
const sameCuts =
  JSON.stringify(
    again.activities.map((activity) => activity.fragments.map((fragment) => fragment.points[0])),
  ) ===
  JSON.stringify(
    selection.activities.map((activity) =>
      activity.fragments.map((fragment) => fragment.points[0]),
    ),
  );
check('  ...the same cut points on every build', sameCuts);

// 2. A run through the office zone is split in two.
const ab = byName('A to B 1');
check(
  'a run passing through a zone is split in two',
  ab?.fragments.length === 2,
  `${ab?.fragments.length} pieces`,
);
check(
  '  ...with nothing published inside the zone',
  selection.activities.every((activity) =>
    activity.fragments.every((fragment) =>
      fragment.points.every((point) => distanceM(point, OFFICE) >= 200),
    ),
  ),
);

// 3. Entirely inside a zone: no geometry, statistics kept. Hidden in the sheet: left out.
const block = byName('Round the block');
check(
  'an activity entirely inside a zone publishes no track but keeps its statistics',
  block?.fragments.length === 0 && block.trackHidden && (block.distanceM ?? 0) > 0,
);
check(
  'a row hidden in the sheet is left out',
  !byName('Secret run') &&
    selection.excluded.some((activity) => activity.reason === 'hidden in the sheet'),
);
check(
  'without time of day, no start time is published',
  selection.activities.every((activity) => activity.startLocal === null),
);
check(
  'with names off, no name is published (the site says the type in its own language)',
  publishSelection(store, configWith({ activityNames: false }), false).selection.activities.every(
    (activity) => activity.name === '',
  ),
);
check(
  'with pace along tracks off, no times inside tracks go further',
  publishSelection(store, configWith({ paceAlongTracks: false }), false).selection.activities.every(
    (activity) => activity.fragments.every((fragment) => fragment.times === null),
  ),
);

// 4. Links off, then on.
writeOutput(selection, out);
let text = readFileSync(join(out, 'activities.json'), 'utf8');
let report = audit(out, forbiddenFor(store, config, selection, zones));
check(
  'links off: no Strava link or id anywhere, and the audit passes',
  !text.includes('strava.com') && stravaIds.every((id) => !text.includes(String(id))) && report.ok,
  JSON.stringify(report.checks.filter((c) => c.failures.length)),
);
config = configWith({ stravaLinks: true });
({ selection, zones } = publishSelection(store, config, false));
writeOutput(selection, out);
text = readFileSync(join(out, 'activities.json'), 'utf8');
report = audit(out, forbiddenFor(store, config, selection, zones));
const links = (text.match(/strava\.com\/activities\/\d+/g) ?? []).length;
check(
  'links on: every Strava activity gets its link, and the audit still passes',
  links === 3 && report.ok,
  `${links} links; ${JSON.stringify(report.checks.filter((c) => c.failures.length))}`,
);
config = configWith({});
({ selection, zones } = publishSelection(store, config, false));
writeOutput(selection, out);
check(
  'links off again: every link is gone',
  !readFileSync(join(out, 'activities.json'), 'utf8').includes('strava.com'),
);

// 5. The audit catches what is planted by hand.
const plant = (name: string, content: string, expect: string) => {
  writeFileSync(join(out, 'planted.json'), content);
  const result = audit(out, forbiddenFor(store, config, selection, zones));
  const caught = result.checks.find((c) => c.name === expect);
  check(
    `the audit fails on ${name}`,
    !result.ok && (caught?.failures.length ?? 0) > 0,
    JSON.stringify(result.checks.map((c) => [c.name, c.failures.length])),
  );
  rmSync(join(out, 'planted.json'));
};
plant(
  'a real zone coordinate planted in the output',
  JSON.stringify({ note: 'start', at: [HOME[0], HOME[1]] }),
  'Privacy zone coordinates',
);
plant(
  'a point inside a zone',
  JSON.stringify({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [HOME[0] + 0.001, HOME[1]] },
  }),
  'Points inside privacy zones',
);
// A bounding box is not a place: a loop that leaves a zone to the north and returns from the east
// has its box's corner inside the zone, with no point there.
{
  writeFileSync(
    join(out, 'planted.json'),
    JSON.stringify({ bbox: [HOME[0] + 0.001, HOME[1] + 0.0005, HOME[0] + 0.05, HOME[1] + 0.05] }),
  );
  const result = audit(out, forbiddenFor(store, config, selection, zones));
  check(
    'a bounding box with a corner inside a zone is not taken for a point',
    result.ok,
    JSON.stringify(result.checks.map((c) => [c.name, c.failures.length])),
  );
  rmSync(join(out, 'planted.json'));
}
plant(
  'a hidden Strava id',
  JSON.stringify({ ref: stravaIds[0] }),
  'Strava ids not chosen for publishing',
);
plant(
  "an excluded activity's public id",
  JSON.stringify({ id: selection.excluded[0]?.publicId }),
  'Excluded activities',
);
plant('the secret salt', JSON.stringify({ x: salt }), 'The secret salt');
plant('a zone address', JSON.stringify({ x: '1-2-3 Example, Chiyoda' }), 'Privacy zone addresses');
const clean = audit(out, forbiddenFor(store, config, selection, zones));
check('  ...and passes again once it is removed', clean.ok);
const cli = (() => {
  try {
    return { code: 0, text: jam('audit', out) };
  } catch (error) {
    return {
      code: (error as { status: number }).status,
      text: String((error as { stdout: string }).stdout),
    };
  }
})();
check(
  '`jam audit <folder>` reports every check and passes',
  cli.code === 0 && /pass {2}Points inside privacy zones/.test(cli.text),
  cli.text,
);

store.close();
finish();

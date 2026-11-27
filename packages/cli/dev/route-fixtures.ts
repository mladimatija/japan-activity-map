/**
 * Writes a sheet and GPX tracks for trying `jam routes` without real activities, around 東京駅:
 * a 5 km loop run six times one way and twice the other, a different loop from the same start,
 * a run from A to B three times and once back, a shorter run along half of it, and a run with
 * no track.
 *
 *   node packages/cli/dev/route-fixtures.ts <folder>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: route-fixtures.ts <folder>');
mkdirSync(folder, { recursive: true });

type Point = [number, number];
const M_LON = 1 / 90_600;
const M_LAT = 1 / 110_950;
let seed = 7;
/** Repeatable noise, so every run of the check sees the same tracks. */
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};
const jitter = ([lon, lat]: Point, metres: number): Point => [
  lon + noise() * 2 * metres * M_LON,
  lat + noise() * 2 * metres * M_LAT,
];

const START: Point = [139.7671, 35.6812];

/** A circle of `radius` metres through START, its centre east (+1) or west (-1) of START. */
const loop = (side: 1 | -1, clockwise: boolean, radius = 800, step = 15): Point[] => {
  const centre: Point = [START[0] + side * radius * M_LON, START[1]];
  const start = side === 1 ? Math.PI : 0;
  const n = Math.round((2 * Math.PI * radius) / step);
  return Array.from({ length: n + 1 }, (_, i) => {
    const angle = start + (clockwise ? -1 : 1) * ((2 * Math.PI * i) / n);
    return [
      centre[0] + Math.cos(angle) * radius * M_LON,
      centre[1] + Math.sin(angle) * radius * M_LAT,
    ] as Point;
  });
};

/** Straight legs through the waypoints, a point every `step` metres. */
const path = (waypoints: Point[], step = 15): Point[] => {
  const out: Point[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const [a, b] = [waypoints[i - 1] as Point, waypoints[i] as Point];
    const n = Math.max(
      1,
      Math.round(Math.hypot((b[0] - a[0]) / M_LON, (b[1] - a[1]) / M_LAT) / step),
    );
    for (let k = i === 1 ? 0 : 1; k <= n; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
};

const A: Point = [139.7501, 35.6652];
const B: Point = [139.7901, 35.6752];
const BEND: Point = [139.7681, 35.6642];
const MID: Point = [139.7681, 35.6647];

const gpx = (name: string, start: string, points: Point[]): string => {
  const t0 = Date.parse(start);
  const rows = points.map(
    ([lon, lat], i) =>
      `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>20</ele><time>${new Date(t0 + i * 5000).toISOString().replace('.000', '')}</time></trkpt>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="route-fixtures" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${name}</name>\n    <trkseg>\n${rows.join('\n')}\n    </trkseg>\n  </trk>\n</gpx>\n`;
};

const rows: string[] = [];
const add = (id: string, day: string, name: string, points: Point[], noiseM = 8) => {
  const file = `${id}.gpx`;
  writeFileSync(
    join(folder, file),
    gpx(
      name,
      `${day}T21:00:00Z`,
      points.map((point) => jitter(point, noiseM)),
    ),
  );
  rows.push(`${id},${day},,,Run,,${name},,done,,,,,,${file},,,,`);
};

// The east loop: six times clockwise (one starting 40 m off), twice anticlockwise.
for (let i = 0; i < 6; i++)
  add(
    `east${i + 1}`,
    `2025-0${i + 1}-10`,
    `East loop ${i + 1}`,
    i === 3 ? [[START[0] + 40 * M_LON, START[1]], ...loop(1, true)] : loop(1, true),
  );
add('east-back1', '2025-07-10', 'East loop the other way', loop(1, false));
add('east-back2', '2025-08-10', 'East loop the other way again', loop(1, false));
// The west loop: same start, same length, different streets.
add('west1', '2025-02-20', 'West loop', loop(-1, true));
add('west2', '2025-03-20', 'West loop again', loop(-1, true));
// A to B three times, B to A once, and A to the half-way point once (a variant).
for (let i = 0; i < 3; i++)
  add(`ab${i + 1}`, `2025-0${i + 4}-15`, `A to B ${i + 1}`, path([A, BEND, B]));
add('ba1', '2025-09-15', 'B to A', path([B, BEND, A]));
add('amid1', '2025-10-15', 'A to half way', path([A, MID]));
// Out to a block north of START, laps of it, and back: one, two or three laps is the same route.
// The extended run goes 1.2 km further out before its lap, onto streets the others never use.
const NORTH: Point = [START[0], START[1] + 1500 * M_LAT];
const FURTHER: Point = [START[0], START[1] + 2700 * M_LAT];
const block = (corner: Point): Point[] => [
  corner,
  [corner[0] + 250 * M_LON, corner[1]],
  [corner[0] + 250 * M_LON, corner[1] + 200 * M_LAT],
  [corner[0], corner[1] + 200 * M_LAT],
  corner,
];
const laps = (corner: Point, n: number) =>
  Array.from({ length: n }, () => block(corner).slice(1)).flat();
add('lap1', '2025-03-05', 'Block laps once', path([START, NORTH, ...laps(NORTH, 1), START]));
add('lap3', '2025-04-05', 'Block laps three times', path([START, NORTH, ...laps(NORTH, 3), START]));
add('lap2', '2025-05-05', 'Block laps twice', path([START, NORTH, ...laps(NORTH, 2), START]));
add(
  'lapfar',
  '2025-06-05',
  'Block laps further out',
  path([START, FURTHER, ...laps(FURTHER, 1), START]),
);
rows.push('tread1,2025-11-01,,,Run,,Treadmill,,done,,,10,,,,,,,');

writeFileSync(
  join(folder, 'sheet.csv'),
  `row_id,date,end_date,time_zone,activity_type,event_tags,name,place,status,lat,lon,distance_km,elevation_gain_m,duration,gpx_path,strava_id,show_strava_link,hide,notes\n${rows.join('\n')}\n`,
);
console.log(`Wrote ${rows.length} rows to ${folder}`);

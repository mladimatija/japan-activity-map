/**
 * Writes a sheet and GPX tracks for trying `jam match` without real activities:
 * a hike to 雲取山, a DNS on 甲斐駒ヶ岳 whose track reaches the summit anyway, a ride from Tokyo
 * to Yokohama across the Tama river, a stretch of the 東海道, a run in Zagreb and a manual row.
 *
 *   node packages/cli/dev/match-fixtures.ts <folder>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const folder = process.argv[2];
if (!folder) throw new Error('Usage: match-fixtures.ts <folder>');
mkdirSync(folder, { recursive: true });

type Point = [number, number, number?];

/** Straight legs between waypoints, a point about every 50 m, elevation interpolated. */
const path = (waypoints: Point[], stepM = 50): Point[] => {
  const out: Point[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const [a, b] = [waypoints[i - 1] as Point, waypoints[i] as Point];
    const metres = Math.hypot((b[0] - a[0]) * 91_000, (b[1] - a[1]) * 111_000);
    const n = Math.max(1, Math.round(metres / stepM));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * t,
      ]);
    }
  }
  return out;
};

const gpx = (name: string, start: string, points: Point[]): string => {
  const t0 = Date.parse(start);
  const rows = points.map(
    ([lon, lat, ele], i) =>
      `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${(ele ?? 0).toFixed(1)}</ele><time>${new Date(t0 + i * 30_000).toISOString().replace('.000', '')}</time></trkpt>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="match-fixtures" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${name}</name>\n    <trkseg>\n${rows.join('\n')}\n    </trkseg>\n  </trk>\n</gpx>\n`;
};

const tracks: Record<string, [string, string, Point[]]> = {
  // 鴨沢 (Yamanashi) to the summit of 雲取山 on the Tokyo-Saitama border, and back down a little.
  'kumotori.gpx': [
    '雲取山',
    '2025-05-03T22:30:00Z',
    path([
      [138.9895, 35.7865, 540],
      [138.9745, 35.8125, 1300],
      [138.96, 35.829, 1750],
      [138.944, 35.8553, 2017],
      [138.948, 35.85, 1900],
    ]),
  ],
  // Reaches the summit of 甲斐駒ヶ岳 although the sheet says DNS: the sheet must win.
  'kaikoma.gpx': [
    '甲斐駒ヶ岳',
    '2025-09-13T22:00:00Z',
    path([
      [138.286, 35.785, 800],
      [138.26, 35.77, 1900],
      [138.2367, 35.758, 2967],
    ]),
  ],
  // Tokyo station to Yokohama station, crossing the Tama river near 丸子橋.
  'ride.gpx': [
    'Tokyo to Yokohama',
    '2025-11-08T00:00:00Z',
    path([
      [139.7671, 35.6812, 5],
      [139.73, 35.62, 10],
      [139.67, 35.585, 15],
      [139.66, 35.53, 20],
      [139.622, 35.466, 5],
    ]),
  ],
  // A run in Zagreb: outside Japan.
  'zagreb.gpx': [
    'Zagreb run',
    '2026-06-01T05:00:00Z',
    path([
      [15.97, 45.813, 120],
      [15.99, 45.82, 130],
      [16.005, 45.81, 125],
    ]),
  ],
};
// The first ~15 km of the 東海道 from 日本橋 (the checks' stand-in line on a fresh clone), shifted by about 20 m as a GPS track would be.
const tokaido = (
  JSON.parse(
    readFileSync(
      join(
        process.env.JAM_LISTS_DIR ?? join(import.meta.dirname, '../../../lists'),
        'routes/tokaido.geojson',
      ),
      'utf8',
    ),
  ) as {
    features: {
      geometry:
        | { type: 'LineString'; coordinates: number[][] }
        | { type: 'MultiLineString'; coordinates: number[][][] };
    }[];
  }
).features
  // Whole, or split into stages: the line from 日本橋 either way.
  .flatMap(({ geometry }) =>
    geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates.flat(),
  )
  .slice(0, 120);
tracks['tokaido.gpx'] = [
  '東海道 日本橋から',
  '2025-12-06T23:00:00Z',
  path(
    tokaido.map(([lon, lat]) => [(lon ?? 0) + 0.0002, (lat ?? 0) + 0.0001, 10] as Point),
    40,
  ),
];

for (const [file, [name, start, points]] of Object.entries(tracks))
  writeFileSync(join(folder, file), gpx(name, start, points));
writeFileSync(
  join(folder, 'sheet.csv'),
  `row_id,date,end_date,time_zone,activity_type,event_tags,name,place,status,lat,lon,distance_km,elevation_gain_m,duration,gpx_path,strava_id,show_strava_link,hide,notes
k001,2025-05-04,,,Hike,,雲取山 from 鴨沢,,done,,,,1500,,kumotori.gpx,,,,
k002,2025-09-14,,,Hike,,甲斐駒ヶ岳 黒戸尾根,甲斐駒ヶ岳,DNS,,,,2200,,kaikoma.gpx,,,,Turned back in the rain
k003,2025-11-08,,,Ride,,Tokyo to Yokohama,,done,,,,,,ride.gpx,,,,
k004,2025-12-07,,,Walk,,東海道 日本橋から,,done,,,,,,tokaido.gpx,,,,
k005,2026-06-01,,Europe/Zagreb,Run,,Zagreb run,,done,,,,,,zagreb.gpx,,,,
k006,2025-11-02,,,Ride,,しまなみ海道,shimanami-kaido,done,,,75,,,,,,,
k007,2026-08-01,,,Hike,,槍ヶ岳 some day,hyakumeizan-054,want,,,,,,,,,,
k008,2026-02-01,,,Run,,Gym treadmill,,done,,,10,,,,,,,
`,
);
console.log(`Wrote ${Object.keys(tracks).length} tracks and sheet.csv to ${folder}`);

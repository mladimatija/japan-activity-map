import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gpxFileName, routeGpx } from '../src/gpx.ts';

test('a route as GPX: a track per item, a segment per piece, names escaped', () => {
  const gpx = routeGpx(
    [
      {
        name: '小辺路 <A & B>',
        lines: [
          [
            [135.5874, 34.21283],
            [135.58734, 34.21263],
          ],
          [[135.6, 34.3]],
          [
            [135.7, 34.4],
            [135.71, 34.41],
          ],
        ],
      },
      { name: 'empty', lines: [] },
    ],
    { name: '熊野古道', credit: '© OpenStreetMap contributors (ODbL)' },
  );
  assert.match(gpx, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1"/);
  assert.equal(gpx.match(/<trk>/g)?.length, 1);
  // The one-point piece is no line and is left out.
  assert.equal(gpx.match(/<trkseg>/g)?.length, 2);
  assert.match(gpx, /<name>小辺路 &lt;A &amp; B&gt;<\/name>/);
  assert.match(gpx, /<trkpt lat="34.212830" lon="135.587400"\/>/);
  assert.match(gpx, /<desc>© OpenStreetMap contributors \(ODbL\)<\/desc>/);
});

test('a GPX file name keeps any script and drops what a disk refuses', () => {
  assert.equal(gpxFileName('熊野古道 小辺路'), '熊野古道 小辺路.gpx');
  assert.equal(gpxFileName('Tōkaidō: Nihonbashi/Shinagawa?'), 'Tōkaidō Nihonbashi Shinagawa.gpx');
  assert.equal(gpxFileName('  '), 'route.gpx');
});

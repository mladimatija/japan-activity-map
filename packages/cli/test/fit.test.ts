import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fitFile, type FitPoint } from '../dev/fit-writer.ts';
import { looksLikeFit, parseFit } from '../src/fit.ts';
import { fitActivity } from '../src/gpx-import/activity.ts';

// A short line east from Tokyo Station, a point every 30 seconds.
const points: FitPoint[] = Array.from({ length: 10 }, (_, i) => ({
  lon: 139.7671 + i * 0.0005,
  lat: 35.6812,
  ele: 5 + i * 2,
  time: new Date(Date.parse('2025-04-12T00:00:00Z') + i * 30_000).toISOString(),
}));

test('a FIT file gives back its points, heights and times', () => {
  const bytes = fitFile(points, { sport: 'running', subSport: 'trail' });
  assert.ok(looksLikeFit(bytes));
  const track = parseFit(bytes);
  assert.equal(track.segments.length, 1);
  assert.equal(track.segments[0]?.length, 10);
  const first = track.segments[0]?.[0];
  assert.ok(Math.abs((first?.lon ?? 0) - 139.7671) < 1e-6);
  assert.ok(Math.abs((first?.lat ?? 0) - 35.6812) < 1e-6);
  assert.equal(first?.ele, 5);
  assert.equal(first?.time, '2025-04-12T00:00:00.000Z');
  assert.equal(track.info.type, 'trail running');
});

test('a pause on the watch starts a new segment', () => {
  const track = parseFit(fitFile(points, { pauseAfter: 4 }));
  assert.deepEqual(
    track.segments.map((segment) => segment.length),
    [5, 5],
  );
});

test('a FIT file is one activity, typed by its sport and keyed by its start', () => {
  const activity = fitActivity(
    fitFile(points, { sport: 'running', subSport: 'trail' }),
    { label: 'run.fit', name: 'run' },
    { defaultType: 'hike', timeZone: 'Asia/Tokyo' },
  );
  assert.equal(activity.key, 'time:2025-04-12T00:00:00Z');
  assert.equal(activity.activity.activity_type, 'trail_run');
  assert.equal(activity.activity.start_local, '2025-04-12T09:00:00');
  assert.equal(activity.activity.elapsed_time_s, 270);
  assert.equal(activity.track.point_count, 10);
  assert.equal(activity.activity.elevation_gain_m, 18);
});

test('something that is not a FIT file is refused', () => {
  assert.equal(looksLikeFit(new TextEncoder().encode('<gpx></gpx>')), false);
  assert.throws(() => parseFit(new TextEncoder().encode('<gpx version="1.1"></gpx>')), /FIT/);
});

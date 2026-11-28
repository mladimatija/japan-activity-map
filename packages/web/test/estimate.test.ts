import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateSeconds, paceKind, usualPace } from '../src/estimate.ts';

const outing = (type: string, km: number, hours: number) => ({
  type: type as 'hike',
  distanceM: km * 1000,
  movingS: hours * 3600,
});

test('the usual pace is the median of the outings that fit, long enough to count', () => {
  const activities = [
    outing('hike', 10, 4), // 1.44 s/m
    outing('hike', 12, 4), // 1.2
    outing('walk', 6, 1.5), // 0.9
    outing('hike', 1, 0.1), // too short to count
    outing('run', 10, 1), // a run says nothing about a hike
    outing('ride', 60, 3),
  ];
  const pace = usualPace(activities, 'walk');
  assert.equal(pace?.count, 3);
  assert.ok(Math.abs((pace?.secondsPerMetre ?? 0) - 1.2) < 1e-9);
  assert.equal(usualPace(activities, 'ride'), undefined, 'one ride is no usual pace');
  assert.equal(usualPace([], 'walk'), undefined);
});

test('an estimate is rounded as roughly as it is known', () => {
  const pace = { secondsPerMetre: 1.2, count: 3, kind: 'walk' as const };
  // 10 km: 3 h 20 min, to the quarter hour.
  assert.equal(estimateSeconds(10_000, pace), 3 * 3600 + 15 * 60);
  // 66.4 km: 22.1 h, to the hour.
  assert.equal(estimateSeconds(66_400, pace), 22 * 3600);
  assert.equal(estimateSeconds(100, pace), 900, 'never less than a quarter of an hour');
});

test('cycle routes are ridden, everything else walked', () => {
  assert.equal(paceKind('cycle-routes'), 'ride');
  assert.equal(paceKind('pilgrimage'), 'walk');
  assert.equal(paceKind('long-trails'), 'walk');
});

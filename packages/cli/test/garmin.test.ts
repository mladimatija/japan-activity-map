import assert from 'node:assert/strict';
import { test } from 'node:test';

import { siteOptionsSchema } from '@jam/core';

import { garminActivityId, isSummary, summaryColumns } from '../src/garmin/sync.ts';
import { garminActivityType } from '../src/garmin/types.ts';

const settings = siteOptionsSchema.parse({}).activities.garmin;
const summary = {
  activityId: 5001,
  activityName: ' Morning hike ',
  startTimeLocal: '2025-03-01 09:00:00',
  startTimeGMT: '2025-03-01 00:00:00',
  activityType: { typeKey: 'hiking' },
  eventType: { typeKey: 'race' },
  privacy: { typeKey: 'public' },
  distance: 975.4,
  duration: 780.2,
  movingDuration: 770.6,
  elevationGain: 39.4,
  hasPolyline: true,
  startLatitude: 35.6812,
  startLongitude: 139.7671,
};

test('Garmin type keys map onto the five types, and typeMap adds to them', () => {
  assert.equal(garminActivityType('trail_running'), 'trail_run');
  assert.equal(garminActivityType('mountain_biking'), 'ride');
  assert.equal(garminActivityType('treadmill_running'), 'run');
  assert.equal(garminActivityType('yoga'), undefined);
  assert.equal(garminActivityType('backcountry_skiing', { backcountry_skiing: 'hike' }), 'hike');
  assert.equal(garminActivityType(undefined), undefined);
});

test('a summary becomes the store columns', () => {
  const verdict = summaryColumns(summary, settings, 'Asia/Tokyo');
  assert.ok(verdict.keep);
  assert.equal(verdict.id, garminActivityId(5001));
  assert.equal(verdict.columns.source, 'garmin');
  assert.equal(verdict.columns.name, 'Morning hike');
  assert.equal(verdict.columns.start_time, '2025-03-01T00:00:00.000Z');
  assert.equal(verdict.columns.start_local, '2025-03-01T09:00:00');
  assert.equal(verdict.columns.distance_m, 975);
  assert.equal(verdict.columns.moving_time_s, 771);
  assert.equal(verdict.columns.elapsed_time_s, 780);
  assert.equal(verdict.columns.event_tags, '["race"]');
  assert.equal(verdict.columns.visibility, 'everyone');
  assert.equal(verdict.raw.hasPolyline, true);
});

test('other types, Only Me activities and undated ones are not kept', () => {
  const yoga = summaryColumns(
    { ...summary, activityType: { typeKey: 'yoga' } },
    settings,
    'Asia/Tokyo',
  );
  assert.deepEqual(yoga, { keep: false, reason: 'type', type: 'yoga' });
  const only = { ...summary, privacy: { typeKey: 'private' } };
  assert.equal(summaryColumns(only, settings, 'Asia/Tokyo').keep, false);
  const included = summaryColumns(only, { ...settings, includePrivate: true }, 'Asia/Tokyo');
  assert.ok(included.keep && included.columns.visibility === 'only_me');
  const undated = summaryColumns({ ...summary, startTimeGMT: null }, settings, 'Asia/Tokyo');
  assert.ok(!undated.keep && undated.reason === 'undated');
});

test('an id is the same on every pull, and only numbered summaries count', () => {
  assert.equal(garminActivityId(5001), garminActivityId(5001));
  assert.notEqual(garminActivityId(5001), garminActivityId(5002));
  assert.ok(isSummary({ activityId: 1 }));
  assert.ok(!isSummary({ activityId: 'x' }));
  assert.ok(!isSummary(null));
});

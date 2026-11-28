import assert from 'node:assert/strict';
import { test } from 'node:test';

import { siteOptionsSchema } from '@jam/core';

import { isSummary, summaryColumns, yamapActivityId } from '../src/yamap/sync.ts';
import { cleanToken } from '../src/yamap/token.ts';

test('a pasted YAMAP token is tidied, however it was copied', () => {
  assert.equal(cleanToken('  abc123DEF  \n'), 'abc123DEF');
  assert.equal(cleanToken('yamap_token=abc123DEF'), 'abc123DEF');
  assert.equal(cleanToken('"abc123DEF"'), 'abc123DEF');
  assert.equal(cleanToken('Cookie: _ga=1; yamap_token=abc123DEF; other=2'), 'abc123DEF');
  assert.equal(cleanToken('other=2; yamap_token=abc123DEF'), 'abc123DEF');
  assert.equal(cleanToken(''), '');
});

test('a YAMAP activity as the store keeps it', () => {
  const summary = {
    id: 49680490,
    title: ' 船山 ',
    start_at: 1783903374,
    finish_at: 1783914976,
    time_zone: 9,
    distance: 7622.03,
    cumulative_up: 465,
    has_points: true,
    public_type: 'public',
  };
  assert.ok(isSummary(summary));
  const kept = summaryColumns(summary, 'hike', 'Asia/Tokyo');
  assert.ok(kept);
  assert.equal(kept.id, yamapActivityId(49680490));
  assert.equal(kept.columns.source, 'yamap');
  assert.equal(kept.columns.name, '船山');
  assert.equal(kept.columns.start_time, new Date(1783903374000).toISOString());
  // 9 hours east of GMT, as a wall-clock time.
  assert.equal(
    kept.columns.start_local,
    new Date(1783903374000 + 9 * 3_600_000).toISOString().slice(0, 19),
  );
  assert.equal(kept.day, String(kept.columns.start_local).slice(0, 10));
  assert.equal(kept.columns.distance_m, 7622);
  assert.equal(kept.columns.elevation_gain_m, 465);
  assert.equal(kept.columns.elapsed_time_s, 1783914976 - 1783903374);
  assert.equal(kept.columns.visibility, 'everyone');
  assert.equal(kept.raw.url, 'https://yamap.com/activities/49680490');
});

test('a YAMAP activity that is not plainly public is kept as private; one without a start is not kept', () => {
  const base = { id: 1, start_at: 1783903374 };
  assert.equal(
    summaryColumns({ ...base, public_type: 'limited' }, 'hike', 'Asia/Tokyo')?.columns.visibility,
    'only_me',
  );
  assert.equal(summaryColumns(base, 'hike', 'Asia/Tokyo')?.columns.visibility, null);
  assert.equal(
    summaryColumns({ ...base, has_points: false }, 'hike', 'Asia/Tokyo')?.raw.hasPoints,
    false,
  );
  assert.equal(summaryColumns({ id: 2 }, 'hike', 'Asia/Tokyo'), undefined);
  assert.equal(isSummary({ title: 'no id' }), false);
});

test('the YAMAP settings have their defaults, and a user id must be a number', () => {
  const site = siteOptionsSchema.parse({});
  assert.equal(site.activities.yamap.defaultType, 'hike');
  assert.equal(site.activities.yamap.tracksPerSync, 100);
  assert.equal(site.activities.yamap.api.pauseMs, 2000);
  assert.equal(
    siteOptionsSchema.safeParse({ activities: { yamap: { userId: 'me' } } }).success,
    false,
  );
  assert.equal(
    siteOptionsSchema.parse({ activities: { source: 'yamap' } }).activities.source,
    'yamap',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mapsUrl } from '../src/maps.ts';

// 東京駅.
const at = [139.7671, 35.6812];

test('a place opens in the maps app the device has', () => {
  assert.equal(
    mapsUrl(at, '東京駅', 'apple'),
    `https://maps.apple.com/?ll=35.681200,139.767100&q=${encodeURIComponent('東京駅')}`,
  );
  assert.equal(
    mapsUrl(at, '東京駅', 'android'),
    `geo:35.681200,139.767100?q=35.681200,139.767100(${encodeURIComponent('東京駅')})`,
  );
  assert.equal(
    mapsUrl(at, '東京駅', 'other'),
    'https://www.google.com/maps/search/?api=1&query=35.681200,139.767100',
  );
});

test('a label cannot break out of the link, and a position that is none gives no link', () => {
  const url = mapsUrl(at, 'A&B)?x=1 #y', 'android') ?? '';
  assert.ok(url.endsWith('(A%26B%29%3Fx%3D1%20%23y)'), url);
  assert.equal(mapsUrl(undefined, 'x', 'other'), undefined);
  assert.equal(mapsUrl([139.7], 'x', 'other'), undefined);
  assert.equal(mapsUrl([139.7, 95], 'x', 'other'), undefined);
  assert.equal(mapsUrl([Number.NaN, 35], 'x', 'other'), undefined);
});

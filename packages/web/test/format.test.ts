import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { weekdayIndex } from '../src/filters.ts';
import {
  clock,
  distanceText,
  duration,
  heightText,
  niceStep,
  numberText,
  paceText,
  percent,
  wholeDistance,
} from '../src/format.ts';
import { setFormatUnits } from '../src/units.ts';
import { decode, encode } from '../src/url.ts';

// The site starts in the units the browser's language suggests; a test says which it means.
beforeEach(() => setFormatUnits('metric'));

test('format: distances, heights and paces in kilometres and metres', () => {
  assert.equal(distanceText(1000), '1.0 km');
  assert.equal(distanceText(12_345), '12.3 km');
  assert.equal(heightText(1000), '1,000 m');
  assert.equal(wholeDistance(42), '42 km');
  assert.equal(paceText(300), '5:00/km');
});

test('format: the same figures in miles and feet', () => {
  setFormatUnits('imperial');
  assert.equal(distanceText(1609.344), '1.0 mi');
  assert.equal(heightText(1000), '3,281 ft');
  assert.equal(wholeDistance(42), '26 mi');
});

test('format: time, numbers and shares', () => {
  assert.equal(duration(3725), '1 h 02 min');
  assert.equal(clock(3725), '1:02:05');
  assert.equal(numberText(1234.5, 1), '1,234.5');
  assert.equal(percent(1, 3), '33%');
  assert.equal(niceStep(100, 5), 20);
});

test('filters: the day of the week of a date, whatever the time zone of the machine', () => {
  assert.equal(weekdayIndex('2026-11-28'), 6);
  assert.equal(weekdayIndex('2026-11-29'), 0);
});

test('address: a view survives being written to the address and read back', () => {
  const view = decode('view=activities&type=hike,run&km=30-&layers=prefectures,tracks');
  const written = encode(view);
  assert.equal(encode(decode(written)), written);
  assert.match(written, /type=hike,run/);
  assert.match(written, /km=30-/);
});

test('address: nothing set writes nothing', () => {
  assert.equal(encode(decode('')), '');
});

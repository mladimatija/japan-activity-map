import assert from 'node:assert/strict';
import { test } from 'node:test';

import { densify, distanceM, lengthM } from '../src/geo.ts';

const TOKYO_STATION = [139.7671, 35.6812];
const TOKYO_TOWER = [139.7454, 35.6586];

test('distance: Tokyo Station to Tokyo Tower is about 3.2 km', () => {
  const metres = distanceM(TOKYO_STATION, TOKYO_TOWER);
  assert.ok(metres > 3100 && metres < 3300, String(metres));
});

test('distance: nothing between a point and itself, and the same both ways', () => {
  assert.equal(distanceM(TOKYO_STATION, TOKYO_STATION), 0);
  assert.equal(distanceM(TOKYO_STATION, TOKYO_TOWER), distanceM(TOKYO_TOWER, TOKYO_STATION));
});

test('distance: one degree of latitude is about 111 km anywhere', () => {
  for (const lon of [0, 139, -170])
    assert.ok(Math.abs(distanceM([lon, 35], [lon, 36]) - 111_195) < 50);
});

test('length: the legs added up; nothing for a single point', () => {
  const line = [TOKYO_STATION, TOKYO_TOWER, TOKYO_STATION];
  assert.equal(lengthM(line), 2 * distanceM(TOKYO_STATION, TOKYO_TOWER));
  assert.equal(lengthM([TOKYO_STATION]), 0);
  assert.equal(lengthM([]), 0);
});

test('densify: keeps every vertex, and no two points are further apart than the step', () => {
  const line = [TOKYO_STATION, TOKYO_TOWER, [139.7, 35.7]];
  const dense = densify(line, 200);
  for (const vertex of line)
    assert.ok(dense.some((point) => point[0] === vertex[0] && point[1] === vertex[1]));
  for (let i = 1; i < dense.length; i++)
    assert.ok(distanceM(dense[i - 1] as number[], dense[i] as number[]) <= 200.5);
  assert.ok(Math.abs(lengthM(dense) - lengthM(line)) < 1);
});

test('densify: a line already fine enough comes back as it was', () => {
  const short = [
    [139.7, 35.7],
    [139.7001, 35.7],
  ];
  assert.deepEqual(densify(short, 200), short);
});

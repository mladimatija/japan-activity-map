import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Position } from '@jam/core';

import { keepHeights, publishLine, simplifyIndices } from '../src/build/geometry.ts';

// A dead straight line east of 東京駅, 100 points about 9 m apart, over a hill 300 m high.
const points: Position[] = Array.from({ length: 100 }, (_, i) => [139.7671 + i * 0.0001, 35.6812]);
const hill = points.map((_, i) => 100 + 300 * Math.sin((i / 99) * Math.PI));

test('simplifying a straight line keeps only its ends, and with them loses the hill', () => {
  assert.deepEqual(simplifyIndices(points, 10), [0, 99]);
});

test('keeping heights brings the summit back, within the tolerance everywhere', () => {
  const kept = keepHeights(points, hill, [0, 99], 5);
  assert.ok(kept.includes(49) || kept.includes(50), 'the top of the hill is kept');
  assert.ok(kept.length < 30, `far fewer points than recorded (${kept.length})`);
  // Every dropped point is within 5 m of the slope between its kept neighbours.
  for (let k = 1; k < kept.length; k++) {
    const [a, b] = [kept[k - 1] as number, kept[k] as number];
    for (let i = a + 1; i < b; i++) {
      const slope =
        (hill[a] as number) + (((hill[b] as number) - (hill[a] as number)) * (i - a)) / (b - a);
      assert.ok(Math.abs((hill[i] as number) - slope) <= 5.0001);
    }
  }
});

test('a flat track gains no points, and a track without heights is left as it was', () => {
  assert.deepEqual(
    keepHeights(
      points,
      points.map(() => 40),
      [0, 99],
      5,
    ),
    [0, 99],
  );
  assert.equal(publishLine(points, 10, 5).line.length, 2);
});

test('a published line with heights shows the hill at its real height', () => {
  const { line } = publishLine(points, 10, 5, { elevations: hill });
  const highest = Math.max(...line.map((point) => point[2] ?? 0));
  assert.ok(highest >= 395, `highest published height ${highest}`);
  assert.equal(line[0]?.[2], 100);
});

test('times stay in step with the points that are kept for their height', () => {
  const times = points.map((_, i) => new Date(Date.UTC(2026, 4, 16, 0, 0, i * 10)).toISOString());
  const { line, seconds } = publishLine(points, 10, 5, { elevations: hill, times });
  assert.equal(seconds?.length, line.length);
  assert.equal(seconds?.at(-1), 990);
});

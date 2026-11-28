import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contours } from '../src/contours.ts';

const coordinates = (d: string) =>
  [...d.matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(([, x, y]) => [Number(x), Number(y)]);

test('a cover draws the same lines for the same list, and other lines for another', () => {
  const first = contours('hyakumeizan', 400, 220);
  assert.deepEqual(contours('hyakumeizan', 400, 220), first);
  assert.notDeepEqual(contours('shikoku-88', 400, 220), first);
});

test('the lines stay inside the box and most levels have one', () => {
  for (const seed of ['hyakumeizan', 'tokaido', 'prefecture-highpoints']) {
    const lines = contours(seed, 400, 220, { levels: 10 });
    assert.ok(lines.length >= 5, `${seed}: ${lines.length} levels drawn`);
    for (const { d } of lines)
      for (const [x = NaN, y = NaN] of coordinates(d)) {
        assert.ok(x >= 0 && x <= 400, `${seed}: x ${x}`);
        assert.ok(y >= 0 && y <= 220, `${seed}: y ${y}`);
      }
    assert.deepEqual(
      lines.filter((line) => line.major).map((line) => line.level % 4),
      lines.filter((line) => line.major).map(() => 0),
    );
  }
});

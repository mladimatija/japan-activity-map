import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dyeColour, dyeValue, lightnessOf, parseColour } from '../src/map/dye.ts';

const close = (a: number, b: number, within = 0.01) =>
  assert.ok(Math.abs(a - b) <= within, `${a} is not within ${within} of ${b}`);

test('colours are read as the base map styles write them', () => {
  assert.deepEqual(parseColour('#fff'), [1, 1, 1, 1]);
  assert.deepEqual(parseColour('rgb(255, 0, 0)'), [1, 0, 0, 1]);
  assert.deepEqual(
    parseColour('rgb(27 ,27 ,29)')?.map((n) => Math.round(n * 255)),
    [27, 27, 29, 255],
  );
  assert.deepEqual(parseColour('rgba(60,60,60,0.8)')?.[3], 0.8);
  const grey = parseColour('hsl(0,0%,98%)') ?? [];
  for (const channel of grey.slice(0, 3)) close(channel, 0.98, 0.001);
  assert.equal(parseColour('white'), undefined);
  assert.equal(parseColour('linear'), undefined);
});

test('a dyed grey keeps its lightness and turns indigo', () => {
  for (const grey of ['rgb(12,12,12)', 'rgb(194, 200, 202)', 'hsl(0,0%,98%)']) {
    const before = parseColour(grey);
    const after = parseColour(dyeColour(grey, 270, 0.04));
    assert.ok(before && after);
    close(lightnessOf(after), lightnessOf(before), 0.02);
    // Indigo: blue leads, as in the page's own (#17224f).
    assert.ok(after[2] > after[0] && after[2] > after[1], dyeColour(grey, 270, 0.04));
  }
  assert.match(dyeColour('rgba(60,60,60,0.8)', 270, 0.04), /^#[\da-f]{6}cc$/);
});

test('only colours inside an expression are dyed', () => {
  const value = ['interpolate', ['linear'], ['zoom'], 5, 'rgb(242,243,240)', 10, 'white'];
  const dyed = dyeValue(value, 270, 0.04) as unknown[];
  assert.deepEqual(dyed.slice(0, 4), ['interpolate', ['linear'], ['zoom'], 5]);
  assert.match(String(dyed[4]), /^#[\da-f]{6}$/);
  assert.equal(dyed[6], 'white');
});

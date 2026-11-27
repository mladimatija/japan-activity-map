import type { Position } from '@jam/core';

import { roundPosition } from '../lists/geo.ts';
import { LocalProjection, pointSegmentM } from '../match/geometry.ts';

/**
 * Douglas–Peucker: the indices of the points to keep so that no dropped point is further than
 * `toleranceM` from the simplified line. Iterative, so long tracks do not overflow the stack.
 */
export const simplifyIndices = (points: readonly Position[], toleranceM: number): number[] => {
  if (points.length <= 2 || toleranceM <= 0) return points.map((_, i) => i);
  const projection = LocalProjection.around(points);
  const xy = points.map((point) => projection.project(point));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = pointSegmentM(
        xy[i] as [number, number],
        xy[from] as [number, number],
        xy[to] as [number, number],
      );
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > toleranceM && at > 0) {
      keep[at] = 1;
      stack.push([from, at], [at, to]);
    }
  }
  const out: number[] = [];
  keep.forEach((flag, i) => {
    if (flag) out.push(i);
  });
  return out;
};

/**
 * Simplified, rounded [lon, lat] (and elevation, to the metre, when given), without repeats; with
 * ISO times given, also the whole seconds at each kept point, counted from the first.
 */
export const publishLine = (
  points: readonly Position[],
  toleranceM: number,
  decimals: number,
  extras: { elevations?: readonly number[] | null; times?: readonly string[] | null } = {},
): { line: number[][]; seconds: number[] | null } => {
  const { elevations, times } = extras;
  const line: number[][] = [];
  const kept: number[] = [];
  for (const i of simplifyIndices(points, toleranceM)) {
    const point = points[i] as Position;
    const next: number[] = roundPosition(point, decimals);
    const last = line.at(-1);
    if (last && last[0] === next[0] && last[1] === next[1]) continue;
    const elevation = elevations?.[i];
    line.push(elevation === undefined ? next : [...next, Math.round(elevation)]);
    kept.push(i);
  }
  const at =
    times && times.length === points.length ? kept.map((i) => Date.parse(times[i] ?? '')) : [];
  const start = at[0] ?? Number.NaN;
  const seconds =
    at.length > 0 && at.every((ms) => ms >= start)
      ? at.map((ms) => Math.round((ms - start) / 1000))
      : null;
  return { line, seconds };
};

export const bboxOfLines = (
  lines: readonly number[][][],
): [number, number, number, number] | undefined => {
  let box: [number, number, number, number] | undefined;
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon === undefined || lat === undefined) continue;
      box = box
        ? [
            Math.min(box[0], lon),
            Math.min(box[1], lat),
            Math.max(box[2], lon),
            Math.max(box[3], lat),
          ]
        : [lon, lat, lon, lat];
    }
  }
  return box;
};

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
 * A track's height profile may be off by this much after simplifying, and no more. About the
 * wobble of GPS heights, and the step a rise has to pass to count as climb.
 */
export const HEIGHT_TOLERANCE_M = 5;

/**
 * Adds back the points a simplified line needs to keep its heights. Douglas–Peucker looks at the
 * line from above: on a straight ridge or a straight valley road it drops every point between the
 * ends, the summit among them, and the profile drawn from what is left cuts the mountain off.
 * Between each two kept points, the dropped point whose height is furthest from the straight
 * slope between them is kept when it is further than the tolerance, and so on in both halves.
 * `kept` and the result are sorted indices into `points`.
 */
export const keepHeights = (
  points: readonly Position[],
  elevations: readonly number[],
  kept: readonly number[],
  toleranceM = HEIGHT_TOLERANCE_M,
): number[] => {
  if (kept.length < 2 || elevations.length !== points.length) return [...kept];
  const projection = LocalProjection.around(points);
  // Distance along the recorded line: the slope between two kept points is judged over it.
  const along = new Float64Array(points.length);
  let before = projection.project(points[0] as Position);
  for (let i = 1; i < points.length; i++) {
    const here = projection.project(points[i] as Position);
    along[i] = (along[i - 1] ?? 0) + Math.hypot(here[0] - before[0], here[1] - before[1]);
    before = here;
  }
  const keep = new Set(kept);
  const stack: [number, number][] = [];
  for (let k = 1; k < kept.length; k++) stack.push([kept[k - 1] as number, kept[k] as number]);
  while (stack.length > 0) {
    const [from, to] = stack.pop() as [number, number];
    if (to - from < 2) continue;
    const [d0, d1] = [along[from] ?? 0, along[to] ?? 0];
    const [z0, z1] = [elevations[from] ?? 0, elevations[to] ?? 0];
    let worst = toleranceM;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const share = d1 > d0 ? ((along[i] ?? 0) - d0) / (d1 - d0) : 0;
      const off = Math.abs((elevations[i] ?? 0) - (z0 + (z1 - z0) * share));
      if (off > worst) {
        worst = off;
        at = i;
      }
    }
    if (at > 0) {
      keep.add(at);
      stack.push([from, at], [at, to]);
    }
  }
  return [...keep].sort((a, b) => a - b);
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
  const flat = simplifyIndices(points, toleranceM);
  // With heights, the points that carry the profile are kept as well as those that carry the line.
  const indices =
    elevations && elevations.length === points.length && toleranceM > 0
      ? keepHeights(points, elevations, flat)
      : flat;
  for (const i of indices) {
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

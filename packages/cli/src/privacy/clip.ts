import type { Position } from '@jam/core';

import { roundPosition } from '../lists/geo.ts';
import { LocalProjection } from '../match/geometry.ts';

interface Circle {
  centre: Position;
  radiusM: number;
}

export interface Fragment {
  points: Position[];
  elevations: number[] | null;
  /** ISO times, when the track has them. */
  times: string[] | null;
  lengthM: number;
}

interface ClipResult {
  fragments: Fragment[];
  /** Something was inside a zone. */
  clipped: boolean;
  /** Every point was inside a zone: nothing is published, the statistics stay. */
  hidden: boolean;
  /** Fragments dropped for being shorter than the minimum. */
  dropped: number;
}

type XY = [number, number];

/** Parameters t in [0, 1] where the segment a-b is inside the circle (centre c, radius r). */
const inside = (a: XY, b: XY, c: XY, r: number): [number, number] | undefined => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - c[0];
  const fy = a[1] - c[1];
  const qa = dx * dx + dy * dy;
  const qb = 2 * (fx * dx + fy * dy);
  const qc = fx * fx + fy * fy - r * r;
  if (qa === 0) return qc <= 0 ? [0, 1] : undefined;
  const disc = qb * qb - 4 * qa * qc;
  if (disc <= 0) return undefined;
  const root = Math.sqrt(disc);
  const t1 = Math.max(0, (-qb - root) / (2 * qa));
  const t2 = Math.min(1, (-qb + root) / (2 * qa));
  return t1 < t2 ? [t1, t2] : undefined;
};

/** The parts of [0, 1] outside every interval. */
const outside = (intervals: [number, number][]): [number, number][] => {
  const sorted = intervals.toSorted((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let at = 0;
  for (const [from, to] of sorted) {
    if (from > at) out.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1) out.push([at, 1]);
  return out;
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Removes every part of the line inside any circle, cutting exactly where the line crosses the
 * circle's edge (not at the nearest recorded point), splits it where it passes through, and drops
 * leftover pieces shorter than `minFragmentM`. Elevations and times are interpolated at the cuts.
 */
export const clipLine = (
  points: Position[],
  circles: Circle[],
  minFragmentM: number,
  extras: { elevations?: number[] | null; times?: string[] | null } = {},
): ClipResult => {
  const elevations =
    extras.elevations && extras.elevations.length === points.length ? extras.elevations : null;
  const times =
    extras.times && extras.times.length === points.length
      ? extras.times.map((time) => Date.parse(time))
      : null;
  if (points.length < 2 || circles.length === 0) {
    const lengthM = 0;
    return {
      fragments:
        points.length >= 2 ? [{ points, elevations, times: extras.times ?? null, lengthM }] : [],
      clipped: false,
      hidden: false,
      dropped: 0,
    };
  }
  const projection = LocalProjection.around(points);
  const xy = points.map((point) => projection.project(point));
  const centres = circles.map((circle) => ({
    c: projection.project(circle.centre),
    r: circle.radiusM,
  }));

  const fragments: Fragment[] = [];
  let current:
    | { points: Position[]; elevations: number[]; times: number[]; lengthM: number }
    | undefined;
  let clipped = false;
  let any = false;
  const point = (i: number, t: number): { p: Position; e: number; s: number } => {
    const a = points[i] as Position;
    const b = points[i + 1] ?? a;
    return {
      p: t === 0 ? a : t === 1 ? b : [lerp(a[0], b[0], t), lerp(a[1], b[1], t)],
      e: elevations ? lerp(elevations[i] ?? 0, elevations[i + 1] ?? elevations[i] ?? 0, t) : 0,
      s: times ? lerp(times[i] ?? 0, times[i + 1] ?? times[i] ?? 0, t) : 0,
    };
  };
  const push = (at: { p: Position; e: number; s: number }) => {
    if (!current) current = { points: [], elevations: [], times: [], lengthM: 0 };
    const last = current.points.at(-1);
    if (last && last[0] === at.p[0] && last[1] === at.p[1]) return;
    if (last)
      current.lengthM += Math.hypot(
        ...(([0, 1] as const).map(
          (k) => projection.project(at.p)[k] - projection.project(last)[k],
        ) as [number, number]),
      );
    current.points.push(at.p);
    current.elevations.push(at.e);
    current.times.push(at.s);
  };
  const close = () => {
    if (current && current.points.length >= 2) {
      fragments.push({
        points: current.points,
        elevations: elevations
          ? current.elevations.map((value) => Math.round(value * 10) / 10)
          : null,
        times: times
          ? current.times.map((value) => new Date(Math.round(value)).toISOString())
          : null,
        lengthM: current.lengthM,
      });
    }
    current = undefined;
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = xy[i] as XY;
    const b = xy[i + 1] as XY;
    const cuts = centres
      .map(({ c, r }) => inside(a, b, c, r))
      .filter((interval): interval is [number, number] => Boolean(interval));
    if (cuts.length > 0) clipped = true;
    const keep = outside(cuts);
    for (const [from, to] of keep) {
      if (from > 0) close(); // the segment starts inside a zone: a new piece begins at its edge
      push(point(i, from));
      push(point(i, to));
      any = true;
      if (to < 1) close(); // it goes into a zone before the end of the segment
    }
    if (keep.length === 0) close();
  }
  close();
  const kept = fragments.filter((fragment) => fragment.lengthM >= minFragmentM || !clipped);
  return {
    fragments: kept,
    clipped,
    hidden: !any || kept.length === 0,
    dropped: fragments.length - kept.length,
  };
};

/** Cut tracks as GeoJSON lines, one per fragment, to look at in any viewer (5 decimals, about 1 m). */
export const fragmentFeatures = <
  T extends { fragments: readonly { points: readonly Position[] }[] },
>(
  activities: readonly T[],
  properties: (activity: T) => Record<string, unknown>,
) => ({
  type: 'FeatureCollection' as const,
  features: activities.flatMap((activity) =>
    activity.fragments.map((fragment) => ({
      type: 'Feature' as const,
      properties: properties(activity),
      geometry: {
        type: 'LineString' as const,
        coordinates: fragment.points.map((point) => roundPosition(point, 5)),
      },
    })),
  ),
});

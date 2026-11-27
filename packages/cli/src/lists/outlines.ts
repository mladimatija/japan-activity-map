import type { Position } from '@jam/core';

import { simplifyIndices } from '../build/geometry.ts';
import { roundPosition } from './geo.ts';
import { LocalProjection } from '../match/geometry.ts';

/** Municipality polygons, as GeoJSON MultiPolygon coordinates. */
export type Polygons = readonly (readonly (readonly Position[])[])[];

/** A prefecture's outline: its area, and the stretches of it it shares with a neighbour. */
export interface Outline {
  code: string;
  area: Position[][][];
  /** Land borders only: along the coast the base map's own coastline is drawn instead. */
  borders: Position[][];
}

/**
 * A prefecture's outline from its municipalities, at full detail: the edges two municipalities
 * share cancel out, and what is left is chained back into rings. N03 is topologically clean (a
 * shared edge has the same points on both sides), so no geometry library is needed.
 */
export const dissolve = (polygons: Polygons): Position[][] => {
  const key = (point: Position) => `${(point[0] ?? 0).toFixed(7)},${(point[1] ?? 0).toFixed(7)}`;
  const count = new Map<string, number>();
  const edges: [string, string, string][] = [];
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = key(ring[i - 1] as Position);
        const b = key(ring[i] as Position);
        if (a === b) continue;
        const edge = a < b ? `${a}|${b}` : `${b}|${a}`;
        count.set(edge, (count.get(edge) ?? 0) + 1);
        edges.push([a, b, edge]);
      }
  // An edge used twice is inside the prefecture; one used once is on its edge.
  const next = new Map<string, string[]>();
  for (const [a, b, edge] of edges)
    if ((count.get(edge) ?? 0) % 2 === 1) next.set(a, [...(next.get(a) ?? []), b]);
  const rings: Position[][] = [];
  for (const [start, ends] of next)
    while (ends.length > 0) {
      const ring = [start];
      let at = ends.pop() as string;
      while (at !== start) {
        ring.push(at);
        const onward = next.get(at)?.pop();
        if (onward === undefined) break;
        at = onward;
      }
      ring.push(start);
      if (ring.length >= 4)
        rings.push(ring.map((point) => point.split(',').map(Number) as [number, number]));
    }
  return rings;
};

/** Signed area in square metres: one sign for outer rings, the other for holes. */
const signedArea = (ring: readonly Position[], projection: LocalProjection): number => {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = projection.project(ring[i - 1] as Position);
    const [x2, y2] = projection.project(ring[i] as Position);
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
};

/** Whether a point is inside a ring (even-odd). */
const inside = (point: Position, ring: readonly Position[]): boolean => {
  const [x, y] = point as [number, number];
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

/** A point as one number, to 0.1 m, for telling which points two prefectures share. */
const pointKey = (lon: number, lat: number) =>
  (Math.round(lon * 1e6) - 122_000_000) * 1e8 + Math.round(lat * 1e6);

/** A ring kept compactly while every prefecture is read, with its area worked out at full detail. */
interface StoredRing {
  points: Float64Array;
  area: number;
}

/**
 * Borders to 5 m (a few pixels at the closest zoom), the coast to 25 m: it only shapes the tint,
 * which fades out closer in, where the base map's coastline and this one differ anyway.
 */
export const OUTLINE_OPTIONS: OutlineOptions = {
  borderToleranceM: 5,
  coastToleranceM: 25,
  decimals: 5,
  minAreaM2: 5000,
};

export interface OutlineOptions {
  /** How far a land border may move when simplified, in metres. */
  borderToleranceM: number;
  /** How far the coast may move: it only shapes the tint, which fades before the coast differs. */
  coastToleranceM: number;
  decimals: number;
  /** Rocks and specks smaller than this are left out. */
  minAreaM2: number;
}

/**
 * Every prefecture's outline. Each one's municipalities are read in turn (`load`) and dissolved;
 * a point that two prefectures' outlines share is on a land border, and the rest is coast. Each
 * ring is then simplified a stretch at a time, borders more finely than the coast, keeping the
 * points where a border meets the coast, so neighbours' borders still meet.
 */
export const buildOutlines = async (
  codes: readonly string[],
  load: (code: string) => Promise<Polygons>,
  options: OutlineOptions,
  progress: (code: string) => void = () => undefined,
): Promise<Outline[]> => {
  // Which prefecture each outline point belongs to; -1 for a point on two prefectures' outlines.
  const owner = new Map<number, number>();
  const stored: StoredRing[][] = [];
  for (const [index, code] of codes.entries()) {
    const rings = dissolve(await load(code));
    const all = rings.flat();
    const projection = LocalProjection.around(all.length > 0 ? all : [[135, 35]]);
    const kept: StoredRing[] = [];
    for (const ring of rings) {
      const area = signedArea(ring, projection);
      if (Math.abs(area) < options.minAreaM2) continue;
      const points = new Float64Array(ring.length * 2);
      ring.forEach(([lon = 0, lat = 0], i) => {
        points[i * 2] = lon;
        points[i * 2 + 1] = lat;
        const key = pointKey(lon, lat);
        const known = owner.get(key);
        if (known === undefined) owner.set(key, index);
        else if (known !== index) owner.set(key, -1);
      });
      kept.push({ points, area });
    }
    stored.push(kept);
    progress(code);
  }

  const round = (point: Position) => roundPosition(point, options.decimals);
  return codes.map((code, index) => {
    const borders: Position[][] = [];
    const simplified: { ring: Position[]; area: number }[] = [];
    for (const { points, area } of stored[index] ?? []) {
      const ring: Position[] = [];
      for (let i = 0; i < points.length; i += 2) ring.push([points[i] ?? 0, points[i + 1] ?? 0]);
      const shared = ring.map(([lon = 0, lat = 0]) => owner.get(pointKey(lon, lat)) === -1);
      // Edge i joins point i and i + 1; it is a land border when both ends are shared.
      const border = ring.slice(0, -1).map((_, i) => Boolean(shared[i] && shared[i + 1]));
      const simplify = (stretch: Position[], onBorder: boolean) =>
        simplifyIndices(stretch, onBorder ? options.borderToleranceM : options.coastToleranceM).map(
          (i) => round(stretch[i] as Position),
        );
      let out: Position[];
      if (border.every((on) => on === border[0])) {
        out = simplify(ring, border[0] ?? false);
        if (border[0]) borders.push(out);
      } else {
        // Start where a border begins after the coast, then take the ring a stretch at a time.
        const edges = border.length;
        const start = border.findIndex((on, i) => on && !border[(i - 1 + edges) % edges]);
        out = [];
        let from = start;
        for (let done = 0; done < edges;) {
          const kind = border[from] ?? false;
          const stretch: Position[] = [ring[from] as Position];
          let at = from;
          while (done < edges && (border[at] ?? false) === kind) {
            at = (at + 1) % edges;
            stretch.push(ring[at] as Position);
            done++;
          }
          const simple = simplify(stretch, kind);
          if (kind) borders.push(simple);
          out.push(...(out.length > 0 ? simple.slice(1) : simple));
          from = at;
        }
      }
      if (out.length >= 4) simplified.push({ ring: out, area });
    }
    // The larger sign is the outer rings': municipalities are drawn one way round, holes the other.
    const outerSign = Math.sign(
      simplified.reduce((sum, { area }) => sum + area, 0) || (simplified[0]?.area ?? 1),
    );
    const outers = simplified.filter(({ area }) => Math.sign(area) === outerSign);
    const area: Position[][][] = outers.map(({ ring }) => [ring]);
    for (const { ring, area: signed } of simplified) {
      if (Math.sign(signed) === outerSign) continue;
      const host = outers.findIndex((outer) => inside(ring[0] as Position, outer.ring));
      if (host >= 0) area[host]?.push(ring);
    }
    return { code, area, borders: borders.filter((line) => line.length >= 2) };
  });
};

/** The outline as the file `jam lists fetch outlines` writes and the build reads. */
export const outlineCollection = ({ code, area, borders }: Outline) => ({
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { code, part: 'area' as const },
      geometry: { type: 'MultiPolygon' as const, coordinates: area },
    },
    {
      type: 'Feature' as const,
      properties: { code, part: 'border' as const },
      geometry: { type: 'MultiLineString' as const, coordinates: borders },
    },
  ],
});

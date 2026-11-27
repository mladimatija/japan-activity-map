import {
  distanceM,
  EARTH_RADIUS_M,
  type MultiPolygonGeometry,
  type PolygonGeometry,
  type Position,
} from '@jam/core';

export { distanceM };

const toRad = (deg: number) => (deg * Math.PI) / 180;

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const polygonsOf = (geometry: PolygonGeometry | MultiPolygonGeometry): Position[][][] =>
  geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

export const bboxOf = (geometry: PolygonGeometry | MultiPolygonGeometry): BBox => {
  const box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const polygon of polygonsOf(geometry)) {
    for (const [lon, lat] of polygon[0] ?? []) {
      box.minLon = Math.min(box.minLon, lon);
      box.minLat = Math.min(box.minLat, lat);
      box.maxLon = Math.max(box.maxLon, lon);
      box.maxLat = Math.max(box.maxLat, lat);
    }
  }
  return box;
};

/** Grows a bounding box by roughly `metres` in every direction. */
export const expandBBox = (box: BBox, metres: number): BBox => {
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.cos(toRad((box.minLat + box.maxLat) / 2)));
  return {
    minLon: box.minLon - dLon,
    minLat: box.minLat - dLat,
    maxLon: box.maxLon + dLon,
    maxLat: box.maxLat + dLat,
  };
};

export const inBBox = (point: Position, box: BBox): boolean =>
  point[0] >= box.minLon &&
  point[0] <= box.maxLon &&
  point[1] >= box.minLat &&
  point[1] <= box.maxLat;

const inRing = (point: Position, ring: Position[]): boolean => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
};

/** Point-in-polygon with holes, by ray casting. */
export const containsPoint = (
  geometry: PolygonGeometry | MultiPolygonGeometry,
  point: Position,
): boolean => {
  for (const polygon of polygonsOf(geometry)) {
    const [outer, ...holes] = polygon;
    if (outer && inRing(point, outer) && !holes.some((hole) => inRing(point, hole))) return true;
  }
  return false;
};

/** Shortest distance in metres from a point to the polygon's outline (local flat approximation). */
export const distanceToOutlineM = (
  geometry: PolygonGeometry | MultiPolygonGeometry,
  point: Position,
): number => {
  const lat0 = toRad(point[1]);
  const kx = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(lat0);
  const ky = (Math.PI / 180) * EARTH_RADIUS_M;
  const project = (p: Position): [number, number] => [
    (p[0] - point[0]) * kx,
    (p[1] - point[1]) * ky,
  ];
  let best = Infinity;
  for (const polygon of polygonsOf(geometry)) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const previous = ring[i - 1];
        const current = ring[i];
        if (!previous || !current) continue;
        const [ax, ay] = project(previous);
        const [bx, by] = project(current);
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t =
          lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
};

export const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const roundPosition = ([lon, lat]: Position, decimals: number): Position => [
  roundTo(lon, decimals),
  roundTo(lat, decimals),
];

/** Rounds every coordinate and drops points that became duplicates of their neighbour. */
export const roundPolygonal = <G extends PolygonGeometry | MultiPolygonGeometry>(
  geometry: G,
  decimals: number,
): G => {
  const roundRing = (ring: Position[]) =>
    ring
      .map((p) => roundPosition(p, decimals))
      .filter((p, i, all) => {
        const before = all[i - 1];
        return i === 0 || !before || before[0] !== p[0] || before[1] !== p[1];
      });
  const polygons = polygonsOf(geometry).map((polygon) => polygon.map(roundRing));
  return (
    geometry.type === 'Polygon'
      ? { type: 'Polygon', coordinates: polygons[0] ?? [] }
      : { type: 'MultiPolygon', coordinates: polygons }
  ) as G;
};

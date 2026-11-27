import { densify, EARTH_RADIUS_M, type Position } from '@jam/core';

import type { BBox } from '../lists/geo.ts';

export { densify, distanceM, lengthM } from '@jam/core';

const RAD = Math.PI / 180;

/** Flat x/y metres around a reference latitude: accurate to well under 1% over a few hundred km. */
export class LocalProjection {
  readonly #kx: number;
  readonly #ky = RAD * EARTH_RADIUS_M;
  readonly #lon0: number;
  readonly #lat0: number;

  constructor(lon0: number, lat0: number) {
    this.#lon0 = lon0;
    this.#lat0 = lat0;
    this.#kx = RAD * EARTH_RADIUS_M * Math.cos(lat0 * RAD);
  }

  static around(points: readonly Position[]): LocalProjection {
    const box = bboxOfPoints(points);
    return new LocalProjection((box.minLon + box.maxLon) / 2, (box.minLat + box.maxLat) / 2);
  }

  project(point: Position): [number, number] {
    return [(point[0] - this.#lon0) * this.#kx, (point[1] - this.#lat0) * this.#ky];
  }
}

export const bboxOfPoints = (points: readonly Position[]): BBox => {
  const box = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const [lon, lat] of points) {
    if (lon < box.minLon) box.minLon = lon;
    if (lon > box.maxLon) box.maxLon = lon;
    if (lat < box.minLat) box.minLat = lat;
    if (lat > box.maxLat) box.maxLat = lat;
  }
  return box;
};

export const bboxesOverlap = (a: BBox, b: BBox) =>
  a.minLon <= b.maxLon && b.minLon <= a.maxLon && a.minLat <= b.maxLat && b.minLat <= a.maxLat;

/** Distance from p to the segment a-b, all in projected metres. */
export const pointSegmentM = (
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
};

/** Nearest approach of a polyline to a point, in metres. A single point counts as a polyline. */
export const nearestApproachM = (line: readonly Position[], point: Position): number => {
  const projection = new LocalProjection(point[0], point[1]);
  const p: [number, number] = [0, 0];
  let best = Infinity;
  let previous: [number, number] | undefined;
  for (const position of line) {
    const current = projection.project(position);
    best = Math.min(
      best,
      previous ? pointSegmentM(p, previous, current) : Math.hypot(current[0], current[1]),
    );
    previous = current;
  }
  return best;
};

/** Web-map tile cell at `zoom` containing the point, as one number. */
export const cellOf = (point: Position, zoom: number): number => {
  const n = 2 ** zoom;
  const x = Math.floor(((point[0] + 180) / 360) * n);
  const lat = point[1] * RAD;
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return x * n + y;
};

/** Approximate width of a tile cell in metres at the given latitude. */
export const cellSizeM = (zoom: number, lat: number) =>
  (2 * Math.PI * EARTH_RADIUS_M * Math.cos(lat * RAD)) / 2 ** zoom;

/** The cells a line passes through. */
export const cellsOf = (line: readonly Position[], zoom: number): Set<number> => {
  const first = line[0];
  if (!first) return new Set();
  const cells = new Set<number>();
  for (const point of densify(line, cellSizeM(zoom, first[1]) / 3)) cells.add(cellOf(point, zoom));
  return cells;
};

/** Whether the point's cell or one of its eight neighbours is in `cells`. */
export const nearCells = (cells: ReadonlySet<number>, point: Position, zoom: number): boolean => {
  const n = 2 ** zoom;
  const cell = cellOf(point, zoom);
  const x = Math.floor(cell / n);
  const y = cell - x * n;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) if (cells.has((x + dx) * n + (y + dy))) return true;
  return false;
};

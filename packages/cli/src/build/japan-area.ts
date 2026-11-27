import { simplifyIndices } from './geometry.ts';

/**
 * The part of the world the site shows: Japan's land plus a band of sea around it. Everything else
 * is covered on the map with the base map's sea colour, so neighbouring countries are simply not
 * there. The view is locked to this area plus a margin of (covered) open sea, so Japan never has to
 * sit against the edge of the window.
 *
 * Worked out on a grid of about 1 km, without a geometry library: the coastline is drawn into
 * cells, the land is widened by `bandKm` measured from coast cells, enclosed sea is filled in, the
 * edge is traced into rings, and the rings' grid steps are smoothed away (moving the edge by at
 * most `smoothKm`). Measured against the detailed coastline, the edge ends up `bandKm` from the
 * coast to within about a kilometre and a half.
 */

interface JapanArea {
  /** A world polygon whose holes are the shown area: draw it in the sea colour on top. */
  mask: [number, number][][];
  /** West, south, east, north the view is locked to: the shown area plus the margin. */
  bounds: [number, number, number, number];
}

interface JapanAreaOptions {
  /** Sea kept around the land, measured from the coast. */
  bandKm?: number;
  /** Open sea the view may show beyond the band, so the land is not at the window's edge. */
  marginKm?: number;
  /** Grid cell size in degrees; 0.01 is about 1.1 km north to south. */
  cellDeg?: number;
  /** How far smoothing may move the edge. */
  smoothKm?: number;
}

type Ring = [number, number][];
const KM_PER_DEGREE = 111.32;

export const japanArea = (
  polygons: Ring[][],
  { bandKm = 20, marginKm = 150, cellDeg = 0.01, smoothKm = 0.5 }: JapanAreaOptions = {},
): JapanArea => {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons)
    for (const [lon, lat] of polygon[0] ?? []) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  if (!Number.isFinite(west)) throw new Error('No land to show.');

  // The grid, on whole multiples of the cell size so the output is stable, with room for the band.
  const kmPerDegreeLon = (lat: number) => KM_PER_DEGREE * Math.cos((lat * Math.PI) / 180);
  const padLat = bandKm / KM_PER_DEGREE + 3 * cellDeg;
  const padLon = bandKm / kmPerDegreeLon(Math.max(Math.abs(north), Math.abs(south))) + 3 * cellDeg;
  const x0 = Math.floor((west - padLon) / cellDeg);
  const y0 = Math.floor((south - padLat) / cellDeg);
  const width = Math.ceil((east + padLon) / cellDeg) - x0;
  const height = Math.ceil((north + padLat) / cellDeg) - y0;
  const cells = width * height;
  const at = (x: number, y: number) => y * width + x;
  const toX = (lon: number) => lon / cellDeg - x0;
  const toY = (lat: number) => lat / cellDeg - y0;

  // Land: each polygon filled row by row (cells whose centre is inside), plus every cell its
  // outline passes through, so islands and headlands thinner than a cell still count.
  const land = new Uint8Array(cells);
  for (const polygon of polygons) {
    let top = -Infinity;
    let bottom = Infinity;
    for (const [, lat] of polygon[0] ?? []) {
      top = Math.max(top, lat);
      bottom = Math.min(bottom, lat);
    }
    const yFrom = Math.max(0, Math.floor(toY(bottom)));
    const yTo = Math.min(height - 1, Math.ceil(toY(top)));
    for (let y = yFrom; y <= yTo; y++) {
      const lat = (y0 + y + 0.5) * cellDeg;
      const crossings: number[] = [];
      for (const ring of polygon)
        for (let i = 0; i < ring.length - 1; i++) {
          const [ax, ay] = ring[i] as [number, number];
          const [bx, by] = ring[i + 1] as [number, number];
          if (ay <= lat === by <= lat) continue;
          crossings.push(toX(ax + ((lat - ay) / (by - ay)) * (bx - ax)));
        }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const from = Math.max(0, Math.ceil((crossings[i] ?? 0) - 0.5));
        const to = Math.min(width - 1, Math.floor((crossings[i + 1] ?? 0) - 0.5));
        land.fill(1, at(from, y), at(to, y) + 1);
      }
    }
    for (const ring of polygon)
      for (let i = 0; i < ring.length - 1; i++) {
        const [ax, ay] = ring[i] as [number, number];
        const [bx, by] = ring[i + 1] as [number, number];
        const steps = Math.max(1, Math.ceil((Math.hypot(bx - ax, by - ay) / cellDeg) * 2));
        for (let s = 0; s <= steps; s++) {
          const x = Math.floor(toX(ax + ((bx - ax) * s) / steps));
          const y = Math.floor(toY(ay + ((by - ay) * s) / steps));
          if (x >= 0 && x < width && y >= 0 && y < height) land[at(x, y)] = 1;
        }
      }
  }

  // The band: every cell within `bandKm` of a coast cell (a land cell next to sea). Inland cells
  // need no widening, since any sea within reach of them is nearer to the coast.
  const area = land.slice();
  const kmPerCellY = KM_PER_DEGREE * cellDeg;
  const reachY = Math.ceil(bandKm / kmPerCellY);
  const isLand = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && land[at(x, y)] === 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!land[at(x, y)]) continue;
      if (isLand(x - 1, y) && isLand(x + 1, y) && isLand(x, y - 1) && isLand(x, y + 1)) continue;
      for (let dy = -reachY; dy <= reachY; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        const left = bandKm ** 2 - (dy * kmPerCellY) ** 2;
        if (left < 0) continue;
        // Kilometres per cell east to west at the row being reached.
        const kmPerCellX = kmPerDegreeLon((y0 + yy + 0.5) * cellDeg) * cellDeg;
        const reachX = Math.floor(Math.sqrt(left) / kmPerCellX);
        area.fill(1, at(Math.max(0, x - reachX), yy), at(Math.min(width - 1, x + reachX), yy) + 1);
      }
    }

  // Sea that the area encloses belongs to it: flood the outside in from the grid's edge.
  const outside = new Uint8Array(cells);
  const stack = new Int32Array(cells);
  let size = 0;
  const visit = (i: number) => {
    if (!area[i] && !outside[i]) {
      outside[i] = 1;
      stack[size++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(at(x, 0));
    visit(at(x, height - 1));
  }
  for (let y = 0; y < height; y++) {
    visit(at(0, y));
    visit(at(width - 1, y));
  }
  while (size > 0) {
    const i = stack[--size] as number;
    const x = i % width;
    if (x > 0) visit(i - 1);
    if (x < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i < cells - width) visit(i + width);
  }
  for (let i = 0; i < cells; i++) if (!outside[i]) area[i] = 1;

  // Two cells touching only at a corner would make rings that touch: join them.
  const inArea = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && area[at(x, y)] === 1;
  for (let changed = true; changed;) {
    changed = false;
    for (let y = 0; y + 1 < height; y++)
      for (let x = 0; x + 1 < width; x++) {
        const a = area[at(x, y)];
        const b = area[at(x + 1, y)];
        const c = area[at(x, y + 1)];
        const d = area[at(x + 1, y + 1)];
        if (a && d && !b && !c) {
          area[at(x + 1, y)] = 1;
          area[at(x, y + 1)] = 1;
          changed = true;
        } else if (b && c && !a && !d) {
          area[at(x, y)] = 1;
          area[at(x + 1, y + 1)] = 1;
          changed = true;
        }
      }
  }

  // Trace the edges between the area and the rest into rings, the area on the left of each edge.
  const next = new Map<number, number>();
  const corner = (x: number, y: number) => y * (width + 1) + x;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!area[at(x, y)]) continue;
      if (!inArea(x, y - 1)) next.set(corner(x, y), corner(x + 1, y));
      if (!inArea(x + 1, y)) next.set(corner(x + 1, y), corner(x + 1, y + 1));
      if (!inArea(x, y + 1)) next.set(corner(x + 1, y + 1), corner(x, y + 1));
      if (!inArea(x - 1, y)) next.set(corner(x, y + 1), corner(x, y));
    }
  const toLonLat = (c: number): [number, number] => {
    const x = c % (width + 1);
    const y = (c - x) / (width + 1);
    return [round((x0 + x) * cellDeg), round((y0 + y) * cellDeg)];
  };
  const holes: Ring[] = [];
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    if (!next.has(start)) continue;
    const corners: number[] = [];
    let c = start;
    while (next.has(c)) {
      corners.push(c);
      const to = next.get(c) as number;
      next.delete(c);
      c = to;
    }
    const ring = smoothRing(corners.map(toLonLat), smoothKm);
    if (ring.length >= 4) holes.push(ring);
  }

  // The view's limits: the shown area plus the margin of open sea.
  let areaWest = Infinity;
  let areaSouth = Infinity;
  let areaEast = -Infinity;
  let areaNorth = -Infinity;
  for (const ring of holes)
    for (const [lon, lat] of ring) {
      areaWest = Math.min(areaWest, lon);
      areaEast = Math.max(areaEast, lon);
      areaSouth = Math.min(areaSouth, lat);
      areaNorth = Math.max(areaNorth, lat);
    }
  const marginLat = marginKm / KM_PER_DEGREE;
  const marginLon =
    marginKm / kmPerDegreeLon(Math.max(Math.abs(areaNorth), Math.abs(areaSouth)) + marginLat);
  const world: Ring = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  return {
    mask: [world, ...holes],
    bounds: [
      round(areaWest - marginLon),
      round(Math.max(-85, areaSouth - marginLat)),
      round(areaEast + marginLon),
      round(Math.min(85, areaNorth + marginLat)),
    ],
  };
};

/**
 * Smooths a traced ring (its points, not closed): drops points along straight runs, then the grid
 * steps, keeping every point within `toleranceKm` of the original edge. Returns a closed ring.
 */
const smoothRing = (points: Ring, toleranceKm: number): Ring => {
  const turns = points.filter((point, i) => {
    const before = points[(i - 1 + points.length) % points.length] as [number, number];
    const after = points[(i + 1) % points.length] as [number, number];
    return !(
      (before[0] === point[0] && point[0] === after[0]) ||
      (before[1] === point[1] && point[1] === after[1])
    );
  });
  if (turns.length < 8 || toleranceKm <= 0) return [...turns, turns[0] as [number, number]];
  // A ring has no ends to keep, so it is simplified as two halves: from its first point to the
  // point farthest from it, and back.
  const first = turns[0] as [number, number];
  let far = 0;
  let farthest = -1;
  turns.forEach(([lon, lat], i) => {
    const distance = (lon - first[0]) ** 2 + (lat - first[1]) ** 2;
    if (distance > farthest) {
      farthest = distance;
      far = i;
    }
  });
  const there = turns.slice(0, far + 1);
  const back = [...turns.slice(far), first];
  const keep = (half: Ring) =>
    simplifyIndices(half, toleranceKm * 1000).map((i) => half[i] as [number, number]);
  const ring = [...keep(there), ...keep(back).slice(1)];
  return ring.length >= 4 ? ring : [...turns, first];
};

const round = (value: number) => Math.round(value * 1e4) / 1e4;

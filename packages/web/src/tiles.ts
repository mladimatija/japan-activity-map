import type { FeatureCollection, Position } from 'geojson';

import type { ActivityRecord } from './data.ts';
import { tracksByYear } from './lazy.ts';

/**
 * Explorer tiles: the map cut into the squares of web-map zoom 14 (about 2 km across in Japan),
 * each ticked when a published track passes through it. The same squares as VeloViewer and
 * Statshunters use, so the scores compare.
 */
export const TILE_ZOOM = 14;
const N = 2 ** TILE_ZOOM;

const tileX = (lon: number) => Math.floor(((lon + 180) / 360) * N);
const tileY = (lat: number) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * N);
};
const keyOf = (x: number, y: number) => x * N + y;
const xyOf = (key: number): [number, number] => [Math.floor(key / N), key % N];
const lonOf = (x: number) => (x / N) * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;

const perTrack = new WeakMap<object, number[]>();

/** The tiles a track passes through: its points, and the straight runs between them. */
const tilesOfLines = (lines: Position[][]): number[] => {
  const tiles = new Set<number>();
  for (const line of lines) {
    let before: Position | undefined;
    for (const point of line) {
      const [lon = 0, lat = 0] = point;
      tiles.add(keyOf(tileX(lon), tileY(lat)));
      if (before) {
        // A long straight stretch has few points: step along it so no tile in between is missed.
        const [lon0 = 0, lat0 = 0] = before;
        const steps =
          Math.max(Math.abs(tileX(lon) - tileX(lon0)), Math.abs(tileY(lat) - tileY(lat0))) * 4;
        for (let i = 1; i < steps; i++)
          tiles.add(
            keyOf(
              tileX(lon0 + ((lon - lon0) * i) / steps),
              tileY(lat0 + ((lat - lat0) * i) / steps),
            ),
          );
      }
      before = point;
    }
  }
  return [...tiles];
};

export interface Coverage {
  /** Tile key → the first day it was ticked. */
  tiles: Map<number, string>;
  /** The largest square with every tile ticked: its top-left tile and its side. */
  square: { x: number; y: number; size: number } | null;
  /** Tiles in the largest group joined edge to edge. */
  cluster: number;
  /** Tiles first ticked per year. */
  byYear: Map<string, number>;
}

/** What the given activities' published tracks cover (those whose year of tracks has loaded). */
export const coverageOf = (activities: readonly ActivityRecord[]): Coverage => {
  const tiles = new Map<number, string>();
  for (const activity of activities.toSorted((a, b) => a.date.localeCompare(b.date))) {
    if (activity.trackYear === undefined) continue;
    const feature = tracksByYear
      .get(activity.trackYear)
      ?.features.find((candidate) => candidate.properties.id === activity.id);
    if (!feature) continue;
    let own = perTrack.get(feature);
    if (!own) {
      own = tilesOfLines(feature.geometry.coordinates as Position[][]);
      perTrack.set(feature, own);
    }
    for (const tile of own) if (!tiles.has(tile)) tiles.set(tile, activity.date);
  }

  // The largest filled square: each tile's best square ending there, from its three neighbours.
  const best = new Map<number, number>();
  let square: Coverage['square'] = null;
  for (const key of [...tiles.keys()].sort((a, b) => a - b)) {
    const [x, y] = xyOf(key);
    const size =
      1 +
      Math.min(
        best.get(keyOf(x - 1, y)) ?? 0,
        best.get(keyOf(x, y - 1)) ?? 0,
        best.get(keyOf(x - 1, y - 1)) ?? 0,
      );
    best.set(key, size);
    if (!square || size > square.size) square = { x: x - size + 1, y: y - size + 1, size };
  }

  // The largest group of tiles joined edge to edge.
  const seen = new Set<number>();
  let cluster = 0;
  for (const start of tiles.keys()) {
    if (seen.has(start)) continue;
    let size = 0;
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      const [x, y] = xyOf(queue.pop() as number);
      size++;
      for (const next of [keyOf(x + 1, y), keyOf(x - 1, y), keyOf(x, y + 1), keyOf(x, y - 1)])
        if (tiles.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    cluster = Math.max(cluster, size);
  }

  const byYear = new Map<string, number>();
  for (const day of tiles.values())
    byYear.set(day.slice(0, 4), (byYear.get(day.slice(0, 4)) ?? 0) + 1);
  return { tiles, square, cluster, byYear };
};

const ring = (x: number, y: number, size = 1): Position[] => [
  [lonOf(x), latOf(y)],
  [lonOf(x + size), latOf(y)],
  [lonOf(x + size), latOf(y + size)],
  [lonOf(x), latOf(y + size)],
  [lonOf(x), latOf(y)],
];

/** The ticked tiles and the largest square, for the map. */
export const coverageShapes = (coverage: Coverage): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    ...[...coverage.tiles.keys()].map((key) => ({
      type: 'Feature' as const,
      properties: { part: 'tile' },
      geometry: { type: 'Polygon' as const, coordinates: [ring(...xyOf(key))] },
    })),
    ...(coverage.square
      ? [
          {
            type: 'Feature' as const,
            properties: { part: 'square' },
            geometry: {
              type: 'Polygon' as const,
              coordinates: [ring(coverage.square.x, coverage.square.y, coverage.square.size)],
            },
          },
        ]
      : []),
  ],
});

/** The middle of the largest square, for showing it on the map. */
export const squareBounds = (
  square: NonNullable<Coverage['square']>,
): [number, number, number, number] => [
  lonOf(square.x),
  latOf(square.y + square.size),
  lonOf(square.x + square.size),
  latOf(square.y),
];

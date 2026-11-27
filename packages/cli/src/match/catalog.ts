import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Position, Thresholds } from '@jam/core';

import type { BBox } from '../lists/geo.ts';
import { readListIndex } from '../lists/index-file.ts';
import { LISTS_DIR } from '../lists/sources.ts';
import { bboxOfPoints, densify, distanceM } from './geometry.ts';
import { readJson } from '../files.ts';

export interface CatalogList {
  id: string;
  kind: 'point' | 'route';
  title: { ja: string; en: string };
  radiusM: number;
}

export interface CatalogPlace {
  id: string;
  name: { ja: string; en: string };
  point: Position;
  lists: string[];
  /** The widest radius of the lists it is in, so one pass finds matches for all of them. */
  radiusM: number;
}

export interface PointItem {
  id: string;
  listId: string;
  order: number;
  name: { ja: string; en: string };
  placeId: string | null;
}

/** One stretch of a route item, densified, with the distance along the item at each point. */
interface RoutePart {
  points: Position[];
  along: number[];
  /** Runs of points with their bounding box, so a track only checks the runs near it. */
  chunks: { from: number; to: number; box: BBox }[];
}

const CHUNK = 64;

export interface RouteItem {
  id: string;
  listId: string;
  order: number;
  name: { ja: string; en: string };
  lengthM: number;
  box: BBox;
  parts: RoutePart[];
}

export interface Catalog {
  lists: CatalogList[];
  places: Map<string, CatalogPlace>;
  pointItems: PointItem[];
  routeItems: RouteItem[];
  areasFile: string;
  maxRadiusM: number;
}

/** Spacing of the points checked along reference routes. */
const ROUTE_STEP_M = 25;

interface ItemFeature {
  properties: {
    id: string;
    order: number;
    placeId?: string | null;
    name: { ja: string; en: string };
  };
  geometry: { type: string; coordinates: unknown } | null;
}

/** A hash of every list file the matcher reads, so cached results go stale when a list changes. */
export const catalogHash = (listsDir = LISTS_DIR): string => {
  const hash = createHash('sha256');
  const index = readFileSync(join(listsDir, 'index.json'));
  hash.update(index);
  for (const file of ['places.geojson', 'prefectures-detail.geojson'])
    hash.update(readFileSync(join(listsDir, file)));
  for (const list of readListIndex(listsDir).lists) {
    if (list.file && list.kind !== 'area') hash.update(readFileSync(join(listsDir, list.file)));
  }
  return hash.digest('hex').slice(0, 16);
};

const linesOf = (geometry: ItemFeature['geometry']): Position[][] => {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates as Position[]];
  if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][];
  return [];
};

export const loadCatalog = (thresholds: Thresholds, listsDir = LISTS_DIR): Catalog => {
  const index = readListIndex(listsDir);
  const radiusOf = (listId: string) =>
    thresholds.matching.perList[listId]?.pointRadiusM ?? thresholds.matching.pointRadiusM;
  const lists: CatalogList[] = [];
  const pointItems: PointItem[] = [];
  const routeItems: RouteItem[] = [];
  for (const list of index.lists) {
    if (!list.file || (list.kind !== 'point' && list.kind !== 'route')) continue;
    lists.push({ id: list.id, kind: list.kind, title: list.title, radiusM: radiusOf(list.id) });
    for (const feature of readJson<{ features: ItemFeature[] }>(join(listsDir, list.file))
      .features) {
      const { id, order, name } = feature.properties;
      if (list.kind === 'point') {
        pointItems.push({
          id,
          listId: list.id,
          order,
          name,
          placeId: feature.properties.placeId ?? null,
        });
        continue;
      }
      const parts: RoutePart[] = [];
      let offset = 0;
      for (const line of linesOf(feature.geometry)) {
        const points = densify(line, ROUTE_STEP_M);
        const along = [offset];
        for (let i = 1; i < points.length; i++)
          along.push(
            (along[i - 1] ?? 0) + distanceM(points[i - 1] as Position, points[i] as Position),
          );
        offset = along.at(-1) ?? offset;
        const chunks = [];
        for (let from = 0; from < points.length; from += CHUNK) {
          const to = Math.min(points.length, from + CHUNK);
          chunks.push({ from, to, box: bboxOfPoints(points.slice(from, to)) });
        }
        if (points.length > 1) parts.push({ points, along, chunks });
      }
      if (parts.length === 0) continue;
      routeItems.push({
        id,
        listId: list.id,
        order,
        name,
        lengthM: offset,
        box: bboxOfPoints(parts.flatMap((part) => part.points)),
        parts,
      });
    }
  }
  const membership = new Map<string, string[]>();
  for (const item of pointItems) {
    if (!item.placeId) continue;
    const lists = membership.get(item.placeId) ?? [];
    lists.push(item.listId);
    membership.set(item.placeId, lists);
  }
  const places = new Map<string, CatalogPlace>();
  const features = readJson<{
    features: {
      properties: { id: string; name: { ja: string; en: string } };
      geometry: { coordinates: Position } | null;
    }[];
  }>(join(listsDir, 'places.geojson')).features;
  for (const feature of features) {
    const lists = membership.get(feature.properties.id);
    if (!feature.geometry || !lists) continue;
    places.set(feature.properties.id, {
      id: feature.properties.id,
      name: feature.properties.name,
      point: feature.geometry.coordinates,
      lists,
      radiusM: Math.max(...lists.map(radiusOf)),
    });
  }
  return {
    lists,
    places,
    pointItems,
    routeItems,
    areasFile: join(listsDir, 'prefectures-detail.geojson'),
    maxRadiusM: Math.max(
      thresholds.matching.pointRadiusM,
      ...[...places.values()].map((place) => place.radiusM),
    ),
  };
};

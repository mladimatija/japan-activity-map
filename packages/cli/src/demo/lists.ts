/**
 * What the demo history reads from the committed lists: places with their coordinates and
 * heights, and reference routes as continuous lines to travel along. A list whose file is not on
 * this machine (the 五街道 on a fresh clone) is simply absent; the history does not use those.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { distM, lengthM, type LonLat } from './track.ts';

export interface DemoPlace {
  id: string;
  name: { ja: string; en: string };
  at: LonLat;
  elevationM?: number;
}

export interface DemoRouteItem {
  id: string;
  name: { ja: string; en: string };
  /** The item's line as continuous pieces, in the file's order. */
  chains: LonLat[][];
}

export interface DemoLists {
  place(id: string): DemoPlace | undefined;
  routeItem(listId: string, itemId: string): DemoRouteItem | undefined;
}

interface Feature {
  properties: { id: string; name: { ja: string; en: string }; elevationM?: number };
  geometry:
    | { type: 'Point'; coordinates: number[] }
    | { type: 'LineString'; coordinates: number[][] }
    | { type: 'MultiLineString'; coordinates: number[][][] };
}

/** Joins the parts of a line that touch end to end (within `gapM`) into continuous pieces. */
export const chainParts = (parts: readonly LonLat[][], gapM = 150): LonLat[][] => {
  const out: LonLat[][] = [];
  let current: LonLat[] | undefined;
  for (const part of parts) {
    if (part.length < 2) continue;
    if (!current) {
      current = [...part];
      continue;
    }
    const [head, tail] = [current[0] as LonLat, current.at(-1) as LonLat];
    const [first, last] = [part[0] as LonLat, part.at(-1) as LonLat];
    if (distM(tail, first) < gapM) current.push(...part);
    else if (distM(tail, last) < gapM) current.push(...part.toReversed());
    else if (out.length === 0 && distM(head, first) < gapM)
      current = [...current.toReversed(), ...part];
    else if (distM(head, last) < gapM) current = [...part, ...current];
    else {
      out.push(current);
      current = [...part];
    }
  }
  if (current) out.push(current);
  return out;
};

/** The longest continuous piece of a route item. */
export const longestChain = (item: DemoRouteItem): LonLat[] =>
  item.chains.reduce(
    (best, chain) => (lengthM(chain) > lengthM(best) ? chain : best),
    [] as LonLat[],
  );

export const loadDemoLists = (listsDir: string): DemoLists => {
  const places = new Map<string, DemoPlace>();
  const file = join(listsDir, 'places.geojson');
  if (existsSync(file)) {
    for (const feature of (JSON.parse(readFileSync(file, 'utf8')) as { features: Feature[] })
      .features) {
      if (feature.geometry.type !== 'Point') continue;
      const [lon, lat] = feature.geometry.coordinates;
      if (lon === undefined || lat === undefined) continue;
      places.set(feature.properties.id, {
        id: feature.properties.id,
        name: feature.properties.name,
        at: [lon, lat],
        ...(feature.properties.elevationM === undefined
          ? {}
          : { elevationM: feature.properties.elevationM }),
      });
    }
  }
  const routes = new Map<string, Map<string, DemoRouteItem> | null>();
  const routeList = (listId: string) => {
    const known = routes.get(listId);
    if (known !== undefined) return known;
    const path = join(listsDir, 'routes', `${listId}.geojson`);
    let items: Map<string, DemoRouteItem> | null = null;
    if (existsSync(path)) {
      items = new Map();
      for (const feature of (JSON.parse(readFileSync(path, 'utf8')) as { features: Feature[] })
        .features) {
        const { geometry } = feature;
        if (geometry.type === 'Point') continue;
        const parts = (
          geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
        ).map((part) => part.map(([lon, lat]) => [lon ?? 0, lat ?? 0] as LonLat));
        items.set(feature.properties.id, {
          id: feature.properties.id,
          name: feature.properties.name,
          chains: chainParts(parts),
        });
      }
    }
    routes.set(listId, items);
    return items;
  };
  return {
    place: (id) => places.get(id),
    routeItem: (listId, itemId) => routeList(listId)?.get(itemId),
  };
};

import { readFileSync } from 'node:fs';

import type { MultiPolygonGeometry, PolygonGeometry, Position } from '@jam/core';

import {
  type BBox,
  bboxOf,
  containsPoint,
  distanceToOutlineM,
  expandBBox,
  inBBox,
} from '../lists/geo.ts';

interface Area {
  code: string;
  geometry: PolygonGeometry | MultiPolygonGeometry;
  box: BBox;
}

/** Point lookups against the prefecture outlines in lists/prefectures-detail.geojson. */
export class AreaIndex {
  readonly #areas: Area[];
  readonly #japan: BBox;
  readonly #memo = new Map<string, string | null>();
  readonly #byCode = new Map<string, Area>();

  constructor(file: string) {
    const collection = JSON.parse(readFileSync(file, 'utf8')) as {
      features: {
        properties: { code: string };
        geometry: PolygonGeometry | MultiPolygonGeometry;
      }[];
    };
    this.#areas = collection.features.map((feature) => ({
      code: feature.properties.code,
      geometry: feature.geometry,
      box: bboxOf(feature.geometry),
    }));
    for (const area of this.#areas) this.#byCode.set(area.code, area);
    this.#japan = this.#areas.reduce(
      (box, area) => ({
        minLon: Math.min(box.minLon, area.box.minLon),
        minLat: Math.min(box.minLat, area.box.minLat),
        maxLon: Math.max(box.maxLon, area.box.maxLon),
        maxLat: Math.max(box.maxLat, area.box.maxLat),
      }),
      { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity },
    );
  }

  /**
   * The prefecture containing the point or, when it is just off an outline (coastal paths,
   * simplified coastlines), the nearest one within `marginM`. Results are memoised on a ~10 m grid.
   */
  locate(point: Position, marginM: number, hint?: string): string | undefined {
    const key = `${point[0].toFixed(4)},${point[1].toFixed(4)},${marginM}`;
    const known = this.#memo.get(key);
    if (known !== undefined) return known ?? undefined;
    let found: string | undefined;
    // Tracks stay in one prefecture for long stretches, so try the previous point's first.
    const hinted = hint ? this.#byCode.get(hint) : undefined;
    if (hinted && inBBox(point, hinted.box) && containsPoint(hinted.geometry, point))
      found = hinted.code;
    else if (inBBox(point, expandBBox(this.#japan, marginM))) {
      found = this.#areas.find(
        (area) => inBBox(point, area.box) && containsPoint(area.geometry, point),
      )?.code;
      if (!found && marginM > 0) {
        let best = marginM;
        for (const area of this.#areas) {
          if (!inBBox(point, expandBBox(area.box, marginM))) continue;
          const distance = distanceToOutlineM(area.geometry, point);
          if (distance <= best) {
            best = distance;
            found = area.code;
          }
        }
      }
    }
    if (this.#memo.size > 500_000) this.#memo.clear();
    this.#memo.set(key, found ?? null);
    return found;
  }
}

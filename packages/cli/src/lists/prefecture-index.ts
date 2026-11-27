import type { MultiPolygonGeometry, PolygonGeometry, Position } from '@jam/core';
import { prefectureByJa } from '@jam/core';

import { type BBox, bboxOf, containsPoint, distanceToOutlineM, expandBBox, inBBox } from './geo.ts';
import type { PrefectureShapes } from './sources.ts';

interface IndexedPrefecture {
  code: string;
  geometry: PolygonGeometry | MultiPolygonGeometry;
  box: BBox;
}

/** Point lookups against the detailed prefecture outlines. */
export class PrefectureIndex {
  readonly #items: IndexedPrefecture[];

  constructor(shapes: PrefectureShapes) {
    this.#items = shapes.features.map((feature) => {
      const prefecture = prefectureByJa(feature.properties.N03_001);
      if (!prefecture)
        throw new Error(`Unknown prefecture in N03 data: ${feature.properties.N03_001}`);
      return { code: prefecture.code, geometry: feature.geometry, box: bboxOf(feature.geometry) };
    });
    const codes = new Set(this.#items.map((item) => item.code));
    if (codes.size !== 47)
      throw new Error(`Expected 47 prefectures in N03 data, found ${codes.size}`);
  }

  /** The prefecture containing the point, if any. */
  containing(point: Position): string | undefined {
    return this.#items.find(
      (item) => inBBox(point, item.box) && containsPoint(item.geometry, point),
    )?.code;
  }

  /** Distance in metres from the point to a prefecture: 0 inside, else to its outline. */
  distanceTo(code: string, point: Position): number {
    const item = this.#items.find((candidate) => candidate.code === code);
    if (!item) throw new Error(`Unknown prefecture code ${code}`);
    if (inBBox(point, item.box) && containsPoint(item.geometry, point)) return 0;
    return distanceToOutlineM(item.geometry, point);
  }

  /** The containing prefecture plus any whose outline is within `metres` (border summits). */
  around(point: Position, metres: number): string[] {
    const codes = new Set<string>();
    for (const item of this.#items) {
      if (!inBBox(point, expandBBox(item.box, metres))) continue;
      if (
        containsPoint(item.geometry, point) ||
        distanceToOutlineM(item.geometry, point) <= metres
      ) {
        codes.add(item.code);
      }
    }
    return [...codes].sort();
  }
}

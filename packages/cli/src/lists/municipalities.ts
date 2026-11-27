import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { MultiPolygonGeometry, Position } from '@jam/core';
import { prefectureByJa } from '@jam/core';

import { type BBox, bboxOf, containsPoint, inBBox, roundPosition } from './geo.ts';
import { SOURCES_DIR } from './sources.ts';

/**
 * Every municipality (市区町村, with Tokyo's 23 wards; a designated city counts once, not ward by
 * ward) with its outline, written by `jam lists fetch municipalities`. The build ticks the ones a
 * published track passes through.
 */
export const MUNICIPALITIES_FILE = join(
  SOURCES_DIR,
  'n03-municipalities',
  'municipalities.geojson',
);

export interface Municipality {
  code: string;
  ja: string;
  en: string;
  /** Prefecture code. */
  prefecture: string;
  geometry: MultiPolygonGeometry;
}

/** English for the municipalities the names table leaves out. */
const UNLISTED: Record<string, string> = { 留夜別村: 'Ruyobetsu', 蘂取村: 'Shibetoro' };

interface N03Feature {
  properties: {
    N03_001: string;
    N03_003: string | null;
    N03_004: string | null;
    N03_007: string | null;
  };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

/**
 * The municipalities in an N03 file (one feature per island or piece, designated cities whole)
 * with English names from a table of "code,prefecture,English,…" rows. A piece without a code
 * (land not assigned to a municipality) is left out.
 */
export const municipalitiesFrom = (
  n03: { features: N03Feature[] },
  namesCsv: string,
  decimals = 5,
): Municipality[] => {
  const english = new Map<string, string>();
  for (const line of namesCsv.split('\n').slice(1)) {
    // id,prefecture_id,city_en,city_ja,special_district_ja — the English name may be quoted.
    const match = /^(\d{5}),\d{2},(?:"([^"]*)"|([^,]*)),/.exec(line);
    if (match?.[1]) english.set(match[1], match[2] ?? match[3] ?? '');
  }
  const byCode = new Map<string, Municipality>();
  for (const { properties, geometry } of n03.features) {
    const code = properties.N03_007;
    const ja = properties.N03_004 ?? properties.N03_003;
    const prefecture = prefectureByJa(properties.N03_001)?.code;
    if (!code || !ja || !prefecture) continue;
    const polygons = (
      geometry.type === 'Polygon'
        ? [geometry.coordinates as Position[][]]
        : (geometry.coordinates as Position[][][])
    ).map((polygon) => polygon.map((ring) => ring.map((point) => roundPosition(point, decimals))));
    const known = byCode.get(code);
    if (known) known.geometry.coordinates.push(...polygons);
    else
      byCode.set(code, {
        code,
        ja,
        en: english.get(code) || UNLISTED[ja] || '',
        prefecture,
        geometry: { type: 'MultiPolygon', coordinates: polygons },
      });
  }
  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
};

export const municipalityCollection = (municipalities: readonly Municipality[]) => ({
  type: 'FeatureCollection' as const,
  features: municipalities.map(({ geometry, ...properties }) => ({
    type: 'Feature' as const,
    properties,
    geometry,
  })),
});

export const loadMunicipalities = (path = MUNICIPALITIES_FILE): Municipality[] =>
  (
    JSON.parse(readFileSync(path, 'utf8')) as {
      features: { properties: Omit<Municipality, 'geometry'>; geometry: MultiPolygonGeometry }[];
    }
  ).features.map((feature) => ({ ...feature.properties, geometry: feature.geometry }));

/** Finds the municipality a point is in; made once, then asked for every point of every track. */
export class MunicipalityIndex {
  readonly #entries: { municipality: Municipality; box: BBox }[];
  /** Tenth-of-a-degree cells to the municipalities whose box touches them. */
  readonly #cells = new Map<string, number[]>();
  #last = -1;

  constructor(municipalities: readonly Municipality[]) {
    this.#entries = municipalities.map((municipality) => ({
      municipality,
      box: bboxOf(municipality.geometry),
    }));
    this.#entries.forEach(({ box }, index) => {
      for (let x = Math.floor(box.minLon * 10); x <= Math.floor(box.maxLon * 10); x++)
        for (let y = Math.floor(box.minLat * 10); y <= Math.floor(box.maxLat * 10); y++) {
          const key = `${x},${y}`;
          const list = this.#cells.get(key);
          if (list) list.push(index);
          else this.#cells.set(key, [index]);
        }
    });
  }

  locate(point: Position): Municipality | undefined {
    const hit = (index: number) => {
      const entry = this.#entries[index];
      return entry && inBBox(point, entry.box) && containsPoint(entry.municipality.geometry, point);
    };
    // A track mostly stays where its last point was.
    if (this.#last >= 0 && hit(this.#last)) return this.#entries[this.#last]?.municipality;
    const key = `${Math.floor(point[0] * 10)},${Math.floor(point[1] * 10)}`;
    for (const index of this.#cells.get(key) ?? [])
      if (hit(index)) {
        this.#last = index;
        return this.#entries[index]?.municipality;
      }
    return undefined;
  }

  /** The middle of a municipality's largest piece's box: where its pin goes. */
  static centre(municipality: Municipality): [number, number] {
    let best: Position[] = [];
    for (const polygon of municipality.geometry.coordinates)
      if ((polygon[0]?.length ?? 0) > best.length) best = polygon[0] ?? [];
    const lons = best.map((point) => point[0]);
    const lats = best.map((point) => point[1]);
    return [
      (Math.min(...lons) + Math.max(...lons)) / 2,
      (Math.min(...lats) + Math.max(...lats)) / 2,
    ];
  }
}

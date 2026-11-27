import type { Position, Thresholds } from '@jam/core';

import { type BBox, expandBBox, inBBox } from '../lists/geo.ts';
import type { AreaIndex } from './areas.ts';
import type { Catalog, RouteItem } from './catalog.ts';
import {
  bboxesOverlap,
  bboxOfPoints,
  cellsOf,
  distanceM,
  nearCells,
  nearestApproachM,
} from './geometry.ts';

/** Bump when the matching rules change, so every cached result is recomputed. */
export const MATCHER_VERSION = 1;

export type Location = 'japan' | 'outside' | 'none';

export interface PlaceMatch {
  id: string;
  /** Nearest approach of the track, in metres. */
  distanceM: number;
  /** Within the place's radius. Near misses are kept only when uncertain, for review. */
  matched: boolean;
  /** Only a summary track was available and the distance is close to the radius. */
  uncertain: boolean;
}

export interface RouteMatch {
  id: string;
  listId: string;
  /** Covered stretches as [from, to] metres along the route item. */
  intervals: [number, number][];
  coveredM: number;
}

export interface MatchResult {
  location: Location;
  /** Distance and climb inside each prefecture, keyed by prefecture code. */
  prefectures: Record<string, { distanceM: number; gainM: number }>;
  gainMethod: 'elevations' | 'distance' | null;
  places: PlaceMatch[];
  routes: RouteMatch[];
}

interface MatchInput {
  coordinates: Position[] | null;
  detail: 'summary' | 'full' | null;
  elevations: number[] | null;
  distanceM: number | null;
  elevationGainM: number | null;
  /** A pin without a track (a sheet row with lat and lon). */
  point: Position | null;
  /** The activity links to list places by hand, which are all in Japan. */
  hasPlaceLinks: boolean;
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Smoothed climb between consecutive points, so GPS noise does not add up to hundreds of metres. */
const climbs = (elevations: number[]): number[] => {
  const window = 2;
  const smooth = elevations.map((_, i) => {
    const slice = elevations.slice(Math.max(0, i - window), i + window + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
  return smooth.map((value, i) => (i === 0 ? 0 : Math.max(0, value - (smooth[i - 1] ?? value))));
};

const areaSplit = (
  input: MatchInput,
  line: Position[],
  areas: AreaIndex,
  marginM: number,
): Pick<MatchResult, 'location' | 'prefectures' | 'gainMethod'> => {
  const codes: (string | undefined)[] = [];
  let hint: string | undefined;
  for (const point of line) {
    const code = areas.locate(point, marginM, hint);
    codes.push(code);
    hint = code ?? hint;
  }
  const location: Location = codes.some(Boolean) ? 'japan' : 'outside';
  const lengths: Record<string, number> = {};
  const gains: Record<string, number> = {};
  const elevations =
    input.elevations && input.elevations.length === line.length ? input.elevations : null;
  const climb = elevations ? climbs(elevations) : null;
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const length = distanceM(line[i - 1] as Position, line[i] as Position);
    total += length;
    // A segment belongs to the prefecture of its end point, or of its start when the end is at sea.
    const code = codes[i] ?? codes[i - 1];
    if (!code) continue;
    lengths[code] = (lengths[code] ?? 0) + length;
    if (climb) gains[code] = (gains[code] ?? 0) + (climb[i] ?? 0);
  }
  // Recorded figures are better than a summary line's length; scale to them.
  const distanceScale = input.distanceM && total > 0 ? input.distanceM / total : 1;
  const measuredGain = Object.values(gains).reduce((sum, value) => sum + value, 0);
  const assigned = Object.values(lengths).reduce((sum, value) => sum + value, 0);
  const prefectures: MatchResult['prefectures'] = {};
  for (const [code, length] of Object.entries(lengths)) {
    let gain = 0;
    if (climb && measuredGain > 0)
      gain = ((gains[code] ?? 0) / measuredGain) * (input.elevationGainM ?? measuredGain);
    else if (input.elevationGainM && total > 0) gain = (length / total) * input.elevationGainM;
    prefectures[code] = { distanceM: round(length * distanceScale), gainM: round(gain) };
  }
  const gainMethod =
    climb && measuredGain > 0
      ? 'elevations'
      : input.elevationGainM && assigned > 0
        ? 'distance'
        : null;
  return { location, prefectures, gainMethod };
};

const matchPlaces = (
  line: Position[],
  detail: MatchInput['detail'],
  catalog: Catalog,
  thresholds: Thresholds,
): PlaceMatch[] => {
  const margin = thresholds.matching.uncertainMarginM;
  const box = expandBBox(bboxOfPoints(line), catalog.maxRadiusM + margin);
  const matches: PlaceMatch[] = [];
  for (const place of catalog.places.values()) {
    if (!inBBox(place.point, box)) continue;
    const distance = nearestApproachM(line, place.point);
    const matched = distance <= place.radiusM;
    const uncertain = detail !== 'full' && Math.abs(distance - place.radiusM) <= margin;
    if (matched || uncertain)
      matches.push({ id: place.id, distanceM: round(distance), matched, uncertain });
  }
  return matches.sort((a, b) => a.id.localeCompare(b.id));
};

const coverage = (
  item: RouteItem,
  cells: Set<number>,
  box: BBox,
  zoom: number,
  bridgeM: number,
  minStretchM: number,
): [number, number][] => {
  const intervals: [number, number][] = [];
  for (const part of item.parts) {
    let start: number | undefined;
    let last = 0;
    const close = () => {
      if (start !== undefined && last - start >= minStretchM)
        intervals.push([round(start), round(last)]);
      start = undefined;
    };
    for (const chunk of part.chunks) {
      // Nothing in a run away from the track can be covered.
      if (!bboxesOverlap(chunk.box, box)) {
        close();
        continue;
      }
      for (let i = chunk.from; i < chunk.to; i++) {
        const along = part.along[i] ?? 0;
        if (!nearCells(cells, part.points[i] as Position, zoom)) continue;
        if (start !== undefined && along - last > bridgeM) close();
        start ??= along;
        last = along;
      }
    }
    close();
  }
  return intervals;
};

const matchRoutes = (line: Position[], catalog: Catalog, thresholds: Thresholds): RouteMatch[] => {
  const zoom = thresholds.routeGrouping.gridZoom;
  const { bridgeGapM, minStretchM } = thresholds.matching.routes;
  const box = expandBBox(bboxOfPoints(line), 200);
  let cells: Set<number> | undefined;
  const matches: RouteMatch[] = [];
  for (const item of catalog.routeItems) {
    if (!bboxesOverlap(box, item.box)) continue;
    cells ??= cellsOf(line, zoom);
    const intervals = coverage(item, cells, box, zoom, bridgeGapM, minStretchM);
    if (intervals.length === 0) continue;
    matches.push({
      id: item.id,
      listId: item.listId,
      intervals,
      coveredM: round(intervals.reduce((sum, [a, b]) => sum + b - a, 0)),
    });
  }
  return matches;
};

/** Everything the lists can say about one activity. Pure: the same input gives the same result. */
export const matchActivity = (
  input: MatchInput,
  catalog: Catalog,
  areas: AreaIndex,
  thresholds: Thresholds,
): MatchResult => {
  const line = input.coordinates && input.coordinates.length > 0 ? input.coordinates : null;
  const marginM = thresholds.matching.japanMarginM;
  if (!line) {
    const location: Location = input.point
      ? areas.locate(input.point, marginM)
        ? 'japan'
        : 'outside'
      : input.hasPlaceLinks
        ? 'japan'
        : 'none';
    const code = input.point ? areas.locate(input.point, marginM) : undefined;
    return {
      location,
      // A pin is one place: its whole distance goes to that prefecture.
      prefectures: code
        ? {
            [code]: {
              distanceM: round(input.distanceM ?? 0),
              gainM: round(input.elevationGainM ?? 0),
            },
          }
        : {},
      gainMethod: null,
      places: [],
      routes: [],
    };
  }
  return {
    ...areaSplit(input, line, areas, marginM),
    places: matchPlaces(line, input.detail, catalog, thresholds),
    routes: matchRoutes(line, catalog, thresholds),
  };
};

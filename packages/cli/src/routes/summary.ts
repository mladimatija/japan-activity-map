import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ACTIVITY_TYPE_LABELS,
  type ActivityType,
  type Position,
  prefectureByCode,
  prefectureByJa,
  type RoutesConfig,
  type Thresholds,
} from '@jam/core';

import { LISTS_DIR } from '../lists/sources.ts';
import { AreaIndex } from '../match/areas.ts';
import { distanceM } from '../match/geometry.ts';
import type { Database } from '../store/sqlite.ts';
import { type GroupActivity, lengthFor, refFromConfig, type Route } from './group.ts';
import { coverOf, endsMatch, isLoop, similarity } from './shape.ts';

interface Place {
  name: { ja: string; en: string };
  point: Position;
  elevationM: number;
}

interface NameContext {
  places: Map<string, Place>;
  /** Places each activity reached, from `jam match`. */
  reached: Map<string, string[]>;
  areas: AreaIndex;
}

export const nameContext = (db: Database): NameContext => {
  const places = new Map<string, Place>();
  const collection = JSON.parse(readFileSync(join(LISTS_DIR, 'places.geojson'), 'utf8')) as {
    features: {
      properties: { id: string; name: { ja: string; en?: string }; elevationM?: number };
      geometry: { coordinates: Position } | null;
    }[];
  };
  for (const feature of collection.features) {
    if (feature.geometry)
      places.set(feature.properties.id, {
        name: { ja: feature.properties.name.ja, en: feature.properties.name.en ?? '' },
        point: feature.geometry.coordinates,
        elevationM: feature.properties.elevationM ?? 0,
      });
  }
  const reached = new Map<string, string[]>();
  try {
    for (const row of db.all<{ activity_id: string; target_id: string }>(
      `SELECT activity_id, target_id FROM matches WHERE target_kind = 'place' AND matched = 1`,
    )) {
      reached.set(row.activity_id, [...(reached.get(row.activity_id) ?? []), row.target_id]);
    }
  } catch {
    // Matching has not run on this store yet; names fall back to the start point.
  }
  return { places, reached, areas: new AreaIndex(join(LISTS_DIR, 'prefectures-detail.geojson')) };
};

/**
 * "雲取山 · Hike 20.5 km": the highest list place the representative reached, else the nearest one
 * within 3 km of the start, else the prefecture of the start; then the type and distance.
 */
/** What an automatic name is made of, so the site can say it in either language. */
export interface AutoName {
  /** The place it is named after, in both languages (English may be empty). */
  place: { ja: string; en: string };
  km: number;
  loop: boolean;
}

export const autoNameParts = (
  route: Route,
  activities: Map<string, GroupActivity>,
  context: NameContext,
  thresholds: Thresholds,
): AutoName => {
  const representative = activities.get(route.representativeRef);
  const reached = representative ? (context.reached.get(representative.id) ?? []) : [];
  let anchor = reached
    .map((id) => context.places.get(id))
    .filter((place): place is Place => Boolean(place))
    .sort((a, b) => b.elevationM - a.elevationM)[0]?.name;
  if (!anchor) {
    let best = 3000;
    for (const place of context.places.values()) {
      const distance = distanceM(route.shape.start, place.point);
      if (distance < best) {
        best = distance;
        anchor = place.name;
      }
    }
  }
  if (!anchor) {
    const code = context.areas.locate(route.shape.start, thresholds.matching.japanMarginM);
    const prefecture = code ? prefectureByCode(code) : undefined;
    anchor = prefecture
      ? { ja: prefecture.ja, en: prefecture.en }
      : { ja: '日本国外', en: 'Outside Japan' };
  }
  return {
    place: anchor,
    km: Math.round(route.shape.distanceM / 100) / 10,
    loop: isLoop(route.shape, thresholds.routeGrouping.startToleranceM),
  };
};

/**
 * The parts of a stored automatic name, with the place's English name looked up: the site says the
 * same name as `jam routes`, in either language, and it stays as stable as the stored one (which
 * changes only when the route does). Undefined for a name not in that form.
 */
export const partsOfName = (
  name: string,
  context: NameContext,
): (AutoName & { n?: number }) | undefined => {
  const match = /^(.+?) · .+ (\d+(?:\.\d+)?) km( loop)?(?: \((\d+)\))?$/.exec(name);
  const ja = match?.[1];
  if (!match || !ja) return undefined;
  const en =
    [...context.places.values()].find((place) => place.name.ja === ja)?.name.en ??
    prefectureByJa(ja)?.en ??
    (ja === '日本国外' ? 'Outside Japan' : '');
  const n = Number(match[4] ?? 1);
  return {
    place: { ja, en },
    km: Number(match[2]),
    loop: Boolean(match[3]),
    ...(n > 1 ? { n } : {}),
  };
};

/** "雲取山 · Hike 20.5 km": the name kept in the store and shown by the `jam routes` review. */
export const autoName = (
  route: Route,
  activities: Map<string, GroupActivity>,
  context: NameContext,
  thresholds: Thresholds,
): string => {
  const { place, km, loop } = autoNameParts(route, activities, context, thresholds);
  const label = ACTIVITY_TYPE_LABELS[route.type as ActivityType] ?? route.type;
  return `${place.ja} · ${label} ${km.toFixed(1)} km${loop ? ' loop' : ''}`;
};

/** Manual names from the routes file, keyed by route id; problems are reported, not fatal. */
export const manualNames = (
  routes: Route[],
  config: RoutesConfig,
): { names: Map<string, string>; problems: string[] } => {
  const names = new Map<string, string>();
  const problems: string[] = [];
  for (const [key, name] of Object.entries(config.names)) {
    const ref = refFromConfig(key);
    const route = routes.find((candidate) => candidate.members.has(ref));
    if (!route)
      problems.push(`routes.jsonc names ${key}, which is in no route (no track, or not imported).`);
    else if (names.has(route.id) && names.get(route.id) !== name)
      problems.push(`routes.jsonc gives ${route.id} two names; keeping "${names.get(route.id)}".`);
    else names.set(route.id, name);
  }
  return { names, problems };
};

interface RouteStats {
  count: number;
  /** Shortest and longest member, in metres: laps make them differ. */
  minDistanceM: number | null;
  maxDistanceM: number | null;
  reversed: number;
  first: string | null;
  latest: string | null;
  fastestS: number | null;
  medianS: number | null;
  /** Seconds per km: what compares when laps make the distances differ. */
  bestPaceS: number | null;
  medianPaceS: number | null;
}

export const statsOf = (route: Route, activities: Map<string, GroupActivity>): RouteStats => {
  const present = [...route.members].filter(([ref]) => activities.has(ref));
  const days = present
    .map(([ref]) => activities.get(ref)?.day ?? '')
    .filter(Boolean)
    .sort();
  const times = present
    .map(([ref]) => activities.get(ref)?.timeS)
    .filter((value): value is number => typeof value === 'number' && value > 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  const distances = present
    .map(([ref]) => activities.get(ref)?.shape.distanceM ?? 0)
    .filter((value) => value > 0);
  const paces = present
    .map(([ref]) => {
      const activity = activities.get(ref);
      return activity?.timeS && activity.shape.distanceM > 0
        ? activity.timeS / (activity.shape.distanceM / 1000)
        : undefined;
    })
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  return {
    count: present.length,
    bestPaceS: paces[0] ?? null,
    medianPaceS: paces.length ? (paces[Math.floor((paces.length - 1) / 2)] ?? null) : null,
    minDistanceM: distances.length ? Math.min(...distances) : null,
    maxDistanceM: distances.length ? Math.max(...distances) : null,
    reversed: present.filter(([, member]) => member.reversed).length,
    first: days[0] ?? null,
    latest: days.at(-1) ?? null,
    fastestS: times[0] ?? null,
    medianS:
      times.length === 0
        ? null
        : times.length % 2
          ? (times[middle] ?? null)
          : Math.round(((times[middle - 1] ?? 0) + (times[middle] ?? 0)) / 2),
  };
};

export interface Candidate {
  routes: string[];
  reason: string;
  /** Merge candidates: how alike they are, for sorting. */
  share?: number;
}

/** Pairs just under the threshold (merge?) and routes whose members differ a lot (split?). */
export const candidates = (
  allRoutes: Route[],
  activities: Map<string, GroupActivity>,
  thresholds: Thresholds,
  scope?: Set<string>,
): { merge: Candidate[]; split: Candidate[] } => {
  const g = thresholds.routeGrouping;
  const zoom = g.gridZoom;
  // Only routes that can be published are worth reviewing unless asked: the site shows Japan only.
  const routes = scope
    ? allRoutes.filter((route) => scope.has(route.representativeRef))
    : allRoutes;
  const merge: Candidate[] = [];
  for (let i = 0; i < routes.length; i++) {
    const a = routes[i] as Route;
    for (let j = i + 1; j < routes.length; j++) {
      const b = routes[j] as Route;
      if (a.type !== b.type || a.variantOf === b.id || b.variantOf === a.id) continue;
      if (!endsMatch(a.shape, b.shape, g.startToleranceM * 2, g.endToleranceM * 2)) continue;
      const share = similarity(a.shape, b.shape, zoom);
      const [la, lb] = [
        lengthFor(a.shape, zoom, g.ignoreLaps),
        lengthFor(b.shape, zoom, g.ignoreLaps),
      ];
      const close = Math.abs(la - lb) <= (2 * g.distanceTolerancePct * Math.max(la, lb)) / 100;
      // Close in shape but kept apart: a little under the overlap share, or ends or distance a little out.
      if (close && share >= g.minOverlapShare - 0.1) {
        merge.push({ routes: [a.id, b.id], share, reason: difference(a, b, thresholds) });
      }
    }
  }
  const split: Candidate[] = [];
  for (const route of routes) {
    const present = [...route.members].filter(([ref]) => activities.has(ref));
    if (present.length < 3) continue;
    const lowest = Math.min(...present.map(([, member]) => member.similarity));
    const distances = present
      .map(([ref]) => {
        const shape = activities.get(ref)?.shape;
        return shape ? lengthFor(shape, zoom, g.ignoreLaps) : 0;
      })
      .filter((value) => value > 0);
    const spread = distances.length > 1 ? Math.max(...distances) / Math.min(...distances) : 1;
    if (lowest < g.minOverlapShare - 0.15)
      split.push({
        routes: [route.id],
        reason: `a member shares only ${Math.round(lowest * 100)}% with the representative`,
      });
    else if (spread > 1 + (2 * g.distanceTolerancePct) / 100)
      split.push({
        routes: [route.id],
        reason: `member distances vary by ${Math.round((spread - 1) * 100)}%`,
      });
  }
  merge.sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  return { merge, split };
};

const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`;

/**
 * What actually differs between two routes, measured on their cells: how much of each lies away
 * from the other. "Same streets" means the extra distance retraces streets both routes use.
 */
const difference = (a: Route, b: Route, thresholds: Thresholds): string => {
  const g = thresholds.routeGrouping;
  const zoom = g.gridZoom;
  const [short, long] = a.shape.distanceM <= b.shape.distanceM ? [a, b] : [b, a];
  const longOff = (1 - coverOf(long.shape, short.shape, zoom)) * long.shape.distanceM;
  const shortOff = (1 - coverOf(short.shape, long.shape, zoom)) * short.shape.distanceM;
  const lengths = `${km(short.shape.distanceM)} and ${km(long.shape.distanceM)}`;
  const extra = km(long.shape.distanceM - short.shape.distanceM);
  const what =
    longOff < 250 && shortOff < 250
      ? long.shape.distanceM - short.shape.distanceM < 300
        ? 'the same streets'
        : `the same streets, the longer one ${extra} more on them (repeated stretches)`
      : shortOff < 250
        ? `the longer one goes about ${km(longOff)} beyond the shorter`
        : `about ${km(longOff)} of the longer and ${km(shortOff)} of the shorter are not on the other`;
  // Why grouping kept them apart, when it is the ends.
  const same = distanceM(a.shape.start, b.shape.start) + distanceM(a.shape.end, b.shape.end);
  const swapped = distanceM(a.shape.start, b.shape.end) + distanceM(a.shape.end, b.shape.start);
  const [startGap, endGap] =
    same <= swapped
      ? [distanceM(a.shape.start, b.shape.start), distanceM(a.shape.end, b.shape.end)]
      : [distanceM(a.shape.start, b.shape.end), distanceM(a.shape.end, b.shape.start)];
  const ends = [
    startGap > g.startToleranceM ? `start ${Math.round(startGap)} m apart` : '',
    endGap > g.endToleranceM ? `end ${Math.round(endGap)} m apart` : '',
  ].filter(Boolean);
  const share = similarity(a.shape, b.shape, zoom);
  const [la, lb] = [lengthFor(a.shape, zoom, g.ignoreLaps), lengthFor(b.shape, zoom, g.ignoreLaps)];
  const lengthGap = Math.abs(la - lb) / Math.max(la, lb);
  const why = ends.length
    ? `; kept apart because they ${ends.join(' and ')} (limit ${g.startToleranceM} m)`
    : share < g.minOverlapShare
      ? `; kept apart by shape: ${Math.round(share * 100)}% of cells shared (limit ${Math.round(g.minOverlapShare * 100)}%)`
      : `; kept apart by length${g.ignoreLaps ? ' of distinct street' : ''}: ${Math.round(lengthGap * 100)}% different (limit ${g.distanceTolerancePct}%)`;
  return `${lengths}: ${what}${why}`;
};

export const pace = (seconds: number | null) => {
  if (seconds === null) return '–';
  const m = Math.floor(seconds / 60);
  return `${m}:${String(Math.round(seconds % 60)).padStart(2, '0')}/km`;
};

export const duration = (seconds: number | null) => {
  if (seconds === null) return '–';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
};

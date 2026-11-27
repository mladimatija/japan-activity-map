import type { Position, RoutesConfig, Thresholds } from '@jam/core';

import { distanceM } from '../match/geometry.ts';
import { newId } from '../store/ids.ts';
import type { Database } from '../store/sqlite.ts';
import {
  coverOf,
  endsMatch,
  footprintM,
  isLoop,
  isReversed,
  type Shape,
  shapeFromCells,
  shapeOf,
  similarity,
} from './shape.ts';

type MemberReason = 'auto' | 'merge' | 'split';

export interface Member {
  reversed: boolean;
  similarity: number;
  reason: MemberReason;
  joinedAt: string;
}

export interface Route {
  id: string;
  type: string;
  autoName: string;
  representativeRef: string;
  shape: Shape;
  variantOf: string | null;
  createdAt: string;
  updatedAt: string;
  members: Map<string, Member>;
}

export interface GroupActivity {
  /** strava:<id> or the act_ id. */
  ref: string;
  id: string;
  stravaId: number | null;
  type: string;
  name: string | null;
  day: string;
  timeS: number | null;
  shape: Shape;
}

interface GroupResult {
  joined: number;
  /** Routes folded into another because, with their representatives settled, they match. */
  merged: number;
  created: number;
  variants: number;
  changed: Set<string>;
}

const refOf = (row: { id: string; strava_id: number | null }) =>
  row.strava_id !== null ? `strava:${row.strava_id}` : row.id;

/** The routes file names activities by Strava id or act_ id; members are keyed strava:<id> or act_. */
export const refFromConfig = (value: string) => (/^\d+$/.test(value) ? `strava:${value}` : value);

/** Activities with a track, with the type the sheet gives them when it overrides Strava's. */
export const loadActivities = (db: Database, zoom: number): Map<string, GroupActivity> => {
  const typeOverrides = new Map(
    db
      .all<{ target_id: string; value: string }>(
        `SELECT target_id, value FROM overrides WHERE target_kind = 'activity' AND field = 'activity_type'`,
      )
      .map((row) => [row.target_id, JSON.parse(row.value) as string]),
  );
  const out = new Map<string, GroupActivity>();
  for (const row of db.all<{
    id: string;
    strava_id: number | null;
    activity_type: string;
    name: string | null;
    day: string;
    distance_m: number | null;
    time_s: number | null;
    coordinates: string;
  }>(
    `SELECT a.id, a.strava_id, a.activity_type, a.name, substr(coalesce(a.start_local, a.start_time), 1, 10) AS day, a.distance_m,
            coalesce(a.moving_time_s, a.elapsed_time_s) AS time_s, t.coordinates
       FROM activities a JOIN tracks t ON t.activity_id = a.id ORDER BY a.start_time`,
  )) {
    const ref = refOf(row);
    const shape = shapeOf(JSON.parse(row.coordinates) as Position[], zoom, row.distance_m);
    if (!shape) continue;
    out.set(ref, {
      ref,
      id: row.id,
      stravaId: row.strava_id,
      type: typeOverrides.get(ref) ?? typeOverrides.get(row.id) ?? row.activity_type,
      name: row.name,
      day: row.day,
      timeS: row.time_s,
      shape,
    });
  }
  return out;
};

export const loadRoutes = (db: Database): Route[] => {
  const members = new Map<string, Map<string, Member>>();
  for (const row of db.all<{
    member_ref: string;
    route_id: string;
    reversed: number;
    similarity: number;
    reason: string;
    joined_at: string;
  }>('SELECT member_ref, route_id, reversed, similarity, reason, joined_at FROM route_members')) {
    const map = members.get(row.route_id) ?? new Map<string, Member>();
    map.set(row.member_ref, {
      reversed: row.reversed === 1,
      similarity: row.similarity,
      reason: row.reason as MemberReason,
      joinedAt: row.joined_at,
    });
    members.set(row.route_id, map);
  }
  return db
    .all<{
      id: string;
      activity_type: string;
      auto_name: string;
      representative_ref: string;
      cells: string;
      start_lon: number;
      start_lat: number;
      end_lon: number;
      end_lat: number;
      distance_m: number;
      variant_of: string | null;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM routes ORDER BY created_at, id')
    .map((row) => ({
      id: row.id,
      type: row.activity_type,
      autoName: row.auto_name,
      representativeRef: row.representative_ref,
      shape: shapeFromCells(
        JSON.parse(row.cells) as number[],
        [row.start_lon, row.start_lat],
        [row.end_lon, row.end_lat],
        row.distance_m,
      ),
      variantOf: row.variant_of,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      members: members.get(row.id) ?? new Map(),
    }));
};

export const saveRoutes = (db: Database, routes: Route[]): void => {
  db.transaction(() => {
    db.run('DELETE FROM route_members');
    db.run('DELETE FROM routes');
    for (const route of routes) {
      db.run(
        `INSERT INTO routes (id, activity_type, auto_name, representative_ref, cells, start_lon, start_lat, end_lon, end_lat, distance_m, variant_of, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          route.id,
          route.type,
          route.autoName,
          route.representativeRef,
          JSON.stringify(route.shape.cells),
          route.shape.start[0],
          route.shape.start[1],
          route.shape.end[0],
          route.shape.end[1],
          Math.round(route.shape.distanceM),
          route.createdAt,
          route.updatedAt,
        ],
      );
      for (const [ref, member] of route.members) {
        db.run(
          'INSERT INTO route_members (member_ref, route_id, reversed, similarity, reason, joined_at) VALUES (?, ?, ?, ?, ?, ?)',
          [
            ref,
            route.id,
            member.reversed ? 1 : 0,
            Math.round(member.similarity * 1000) / 1000,
            member.reason,
            member.joinedAt,
          ],
        );
      }
    }
    // Variants point at other routes, so they are linked once every route exists.
    for (const route of routes)
      if (route.variantOf)
        db.run('UPDATE routes SET variant_of = ? WHERE id = ?', [route.variantOf, route.id]);
  });
};

interface Tolerances {
  zoom: number;
  ignoreLaps: boolean;
  startM: number;
  endM: number;
  distanceShare: number;
  overlap: number;
}

const tolerancesOf = (thresholds: Thresholds): Tolerances => ({
  zoom: thresholds.routeGrouping.gridZoom,
  ignoreLaps: thresholds.routeGrouping.ignoreLaps,
  startM: thresholds.routeGrouping.startToleranceM,
  endM: thresholds.routeGrouping.endToleranceM,
  distanceShare: thresholds.routeGrouping.distanceTolerancePct / 100,
  overlap: thresholds.routeGrouping.minOverlapShare,
});

const sharesAnEnd = (a: Shape, b: Shape, toleranceM: number) =>
  [a.start, a.end].some(
    (point) => distanceM(point, b.start) <= toleranceM || distanceM(point, b.end) <= toleranceM,
  );

/** The length the distance check compares: distinct street when laps are ignored, else distance. */
export const lengthFor = (shape: Shape, zoom: number, ignoreLaps: boolean) =>
  ignoreLaps ? footprintM(shape, zoom) : shape.distanceM;

const distanceClose = (a: number, b: number, share: number) =>
  Math.abs(a - b) <= share * Math.max(a, b);

/** Direction and similarity of a track against a route's representative. */
const fit = (
  track: Shape,
  route: Shape,
  t: Tolerances,
): { reversed: boolean; similarity: number } => {
  const ends = endsMatch(track, route, t.startM, t.endM);
  const loop = isLoop(route, t.startM);
  const reversed =
    loop || ends === undefined ? isReversed(track, route, t.zoom, loop) : ends === 'swapped';
  return { reversed, similarity: similarity(track, route, t.zoom) };
};

/** Same type, matching ends either way round, similar length and the same cells. */
const sameShape = (typeA: string, a: Shape, typeB: string, b: Shape, t: Tolerances): boolean => {
  if (typeA !== typeB || !endsMatch(a, b, t.startM, t.endM)) return false;
  if (
    !distanceClose(
      lengthFor(a, t.zoom, t.ignoreLaps),
      lengthFor(b, t.zoom, t.ignoreLaps),
      t.distanceShare,
    )
  )
    return false;
  return similarity(a, b, t.zoom) >= t.overlap;
};

/** Whether a track is the same route: same type, matching ends and length, and the same shape. */
const sameRoute = (
  track: GroupActivity,
  route: Route,
  t: Tolerances,
): { reversed: boolean; similarity: number } | undefined => {
  if (!sameShape(track.type, track.shape, route.type, route.shape, t)) return undefined;
  return fit(track.shape, route.shape, t);
};

/** The member most like all the others; recent members are the candidates, to bound the work. */
const medoid = (
  refs: string[],
  activities: Map<string, GroupActivity>,
  zoom: number,
): string | undefined => {
  const present = refs
    .map((ref) => activities.get(ref))
    .filter((activity): activity is GroupActivity => Boolean(activity));
  if (present.length <= 2) return present[0]?.ref;
  const sample = present.slice(-200);
  let best: { ref: string; score: number } | undefined;
  for (const candidate of sample.slice(-40)) {
    let score = 0;
    for (const other of sample)
      if (other !== candidate) score += similarity(candidate.shape, other.shape, zoom);
    if (!best || score > best.score) best = { ref: candidate.ref, score };
  }
  return best?.ref;
};

const newRoute = (
  activity: GroupActivity,
  now: string,
  reason: MemberReason,
  variantOf: string | null = null,
): Route => ({
  id: newId('route'),
  type: activity.type,
  autoName: '',
  representativeRef: activity.ref,
  shape: activity.shape,
  variantOf,
  createdAt: now,
  updatedAt: now,
  members: new Map([[activity.ref, { reversed: false, similarity: 1, reason, joinedAt: now }]]),
});

/**
 * Brings `routes` up to date: applies the routes file's splits and merges, puts every activity not
 * yet in a route into the first route it matches or a new one, and refreshes the representative of
 * every route whose members changed. Existing members are never moved, so route ids stay put.
 */
export const group = (
  routes: Route[],
  activities: Map<string, GroupActivity>,
  thresholds: Thresholds,
  config: RoutesConfig,
  now: string,
): GroupResult => {
  const t = tolerancesOf(thresholds);
  const result: GroupResult = { joined: 0, merged: 0, created: 0, variants: 0, changed: new Set() };
  const routeOf = new Map<string, Route>();
  for (const route of routes) for (const ref of route.members.keys()) routeOf.set(ref, route);
  const touch = (route: Route) => {
    result.changed.add(route.id);
    route.updatedAt = now;
  };

  // Splits: each group of activities is a route of its own and never joins another automatically.
  const splitRefs = new Set<string>();
  for (const group of config.split) {
    const refs = group.map(refFromConfig);
    for (const ref of refs) splitRefs.add(ref);
    const existing = routeOf.get(refs[0] ?? '');
    const alreadySplit =
      existing &&
      existing.members.size === refs.filter((ref) => routeOf.get(ref) === existing).length &&
      refs.every((ref) => routeOf.get(ref) === existing);
    if (alreadySplit) continue;
    const first = refs.map((ref) => activities.get(ref)).find(Boolean);
    if (!first) continue;
    for (const ref of refs) {
      const from = routeOf.get(ref);
      if (from) {
        from.members.delete(ref);
        touch(from);
      }
    }
    const route = newRoute(first, now, 'split');
    for (const ref of refs) {
      route.members.set(ref, { reversed: false, similarity: 1, reason: 'split', joinedAt: now });
      routeOf.set(ref, route);
    }
    routes.push(route);
    touch(route);
    result.created++;
  }

  const closed = new Set(
    routes
      .filter((route) => [...route.members.values()].some((member) => member.reason === 'split'))
      .map((route) => route.id),
  );

  // New activities, oldest first, so the first run of a route becomes its first representative.
  for (const activity of activities.values()) {
    if (routeOf.has(activity.ref) || splitRefs.has(activity.ref)) continue;
    let target: Route | undefined;
    let fitted: { reversed: boolean; similarity: number } | undefined;
    for (const route of routes) {
      // A route made by a split holds exactly the activities the routes file names.
      if (closed.has(route.id)) continue;
      fitted = sameRoute(activity, route, t);
      if (fitted) {
        target = route;
        break;
      }
    }
    if (target && fitted) {
      target.members.set(activity.ref, { ...fitted, reason: 'auto', joinedAt: now });
      routeOf.set(activity.ref, target);
      touch(target);
      result.joined++;
      continue;
    }
    // Mostly on a longer route but too short for it: a variant, kept separate and linked.
    const parent = routes.find(
      (route) =>
        route.type === activity.type &&
        !route.variantOf &&
        lengthFor(activity.shape, t.zoom, t.ignoreLaps) <
          lengthFor(route.shape, t.zoom, t.ignoreLaps) * (1 - t.distanceShare) &&
        // It starts or ends where the longer route does: a shorter version, not just a piece of it.
        sharesAnEnd(activity.shape, route.shape, t.startM) &&
        coverOf(activity.shape, route.shape, t.zoom) >= t.overlap,
    );
    const route = newRoute(activity, now, 'auto', parent?.id ?? null);
    routes.push(route);
    routeOf.set(activity.ref, route);
    touch(route);
    result.created++;
    if (parent) result.variants++;
  }

  // Merges: the routes holding these activities become the oldest of them.
  for (const group of config.merge) {
    const holders = [
      ...new Set(
        group
          .map(refFromConfig)
          .map((ref) => routeOf.get(ref))
          .filter((route): route is Route => Boolean(route)),
      ),
    ];
    if (holders.length < 2) continue;
    holders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const [keep, ...others] = holders as [Route, ...Route[]];
    for (const other of others) {
      for (const [ref, member] of other.members) {
        keep.members.set(ref, { ...member, reason: 'merge' });
        routeOf.set(ref, keep);
      }
      routes.splice(routes.indexOf(other), 1);
      for (const route of routes)
        if (route.variantOf === other.id) route.variantOf = keep.id === route.id ? null : keep.id;
    }
    touch(keep);
  }

  // Empty routes (every member split away) go; routes whose activities were wiped keep their shape.
  for (let i = routes.length - 1; i >= 0; i--)
    if (routes[i]?.members.size === 0) routes.splice(i, 1);
  for (const route of routes)
    if (route.variantOf && !routes.some((other) => other.id === route.variantOf))
      route.variantOf = null;

  // A representative that left the store (a deleted sheet row) is replaced when other members remain.
  for (const route of routes) {
    if (
      !activities.has(route.representativeRef) &&
      [...route.members.keys()].some((ref) => activities.has(ref))
    )
      touch(route);
  }

  const refresh = (route: Route) => {
    const representative = medoid([...route.members.keys()], activities, t.zoom);
    const activity = representative ? activities.get(representative) : undefined;
    if (activity) {
      route.representativeRef = activity.ref;
      route.shape = activity.shape;
    }
    for (const [ref, member] of route.members) {
      const track = activities.get(ref);
      if (!track) continue;
      const fitted =
        ref === route.representativeRef
          ? { reversed: false, similarity: 1 }
          : fit(track.shape, route.shape, t);
      route.members.set(ref, { ...member, ...fitted });
    }
  };
  for (const route of routes) if (result.changed.has(route.id)) refresh(route);

  // Activities are compared with a route's first member as they arrive, and the representative is
  // chosen afterwards, so two routes can end up matching each other. Such pairs become one route,
  // the older keeping its id. Only pairs where a route changed in this run are compared.
  for (let pass = 0, again = true; again && pass < 5; pass++) {
    again = false;
    for (let i = 0; i < routes.length; i++) {
      const a = routes[i] as Route;
      if (closed.has(a.id)) continue;
      for (let j = i + 1; j < routes.length; j++) {
        const b = routes[j] as Route;
        if (closed.has(b.id) || (!result.changed.has(a.id) && !result.changed.has(b.id))) continue;
        if (
          a.variantOf === b.id ||
          b.variantOf === a.id ||
          !sameShape(a.type, a.shape, b.type, b.shape, t)
        )
          continue;
        for (const [ref, member] of b.members) a.members.set(ref, member);
        for (const route of routes)
          if (route.variantOf === b.id) route.variantOf = route.id === a.id ? null : a.id;
        routes.splice(j, 1);
        j--;
        touch(a);
        refresh(a);
        result.merged++;
        again = true;
      }
    }
  }
  return result;
};

/** Old route ids, kept for regrouped routes whose members are mostly the same. */
export const keepIds = (fresh: Route[], old: Route[]): void => {
  const pairs: { score: number; fresh: Route; old: Route }[] = [];
  for (const a of fresh) {
    for (const b of old) {
      if (a.type !== b.type) continue;
      const shared = [...a.members.keys()].filter((ref) => b.members.has(ref)).length;
      if (shared === 0) continue;
      const score = shared / new Set([...a.members.keys(), ...b.members.keys()]).size;
      if (score >= 0.5) pairs.push({ score, fresh: a, old: b });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const used = new Set<string>();
  const renamed = new Map<string, string>();
  for (const pair of pairs) {
    if (used.has(pair.old.id) || renamed.has(pair.fresh.id)) continue;
    used.add(pair.old.id);
    renamed.set(pair.fresh.id, pair.old.id);
  }
  for (const route of fresh) {
    const id = renamed.get(route.id);
    const previous = id ? old.find((candidate) => candidate.id === id) : undefined;
    if (id && previous) {
      route.id = id;
      route.createdAt = previous.createdAt;
    }
  }
  for (const route of fresh)
    if (route.variantOf) route.variantOf = renamed.get(route.variantOf) ?? route.variantOf;
};

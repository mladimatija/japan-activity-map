import type { Thresholds } from '@jam/core';

import type { Database } from '../store/sqlite.ts';
import type { Catalog } from './catalog.ts';

export type ItemStatus = 'done' | 'partial' | 'dns' | 'want' | 'none';

export interface ItemProgress {
  listId: string;
  itemId: string;
  placeId: string | null;
  order: number;
  name: { ja: string; en: string };
  status: ItemStatus;
  /** Activities that count as a visit: matched automatically or marked done or repeat by hand. */
  visits: number;
  first: string | null;
  latest: string | null;
  /** Route items: length covered by all activities together, and the item's length. */
  coveredM?: number;
  lengthM?: number;
  /** Where the status came from, for review. */
  manual: boolean;
}

export interface ListProgress {
  id: string;
  kind: 'point' | 'route';
  title: { ja: string; en: string };
  items: ItemProgress[];
  counts: Record<ItemStatus, number>;
  /** Route lists: covered and total length over all items. */
  coveredM?: number;
  lengthM?: number;
}

interface Link {
  kind: 'place' | 'item' | 'route';
  id: string;
  status: 'done' | 'dns' | 'repeat' | 'want';
}

interface Visit {
  activityId: string;
  date: string;
  status: 'done' | 'dns' | 'repeat';
  manual: boolean;
}

const parse = <T>(text: string | null | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/** Merges [from, to] intervals and returns their total length. */
const unionLength = (intervals: [number, number][]): number => {
  const sorted = intervals.toSorted((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | undefined;
  for (const [from, to] of sorted) {
    if (current && from <= current[1]) current[1] = Math.max(current[1], to);
    else {
      if (current) total += current[1] - current[0];
      current = [from, to];
    }
  }
  if (current) total += current[1] - current[0];
  return total;
};

/**
 * Combines automatic matches with the sheet: a status written by hand always wins for that activity,
 * DNS and want only come from the sheet, and "ignore" overrides drop false matches.
 */
export const resolveProgress = (
  db: Database,
  catalog: Catalog,
  thresholds: Thresholds,
  /** Only these activities count, by act_ id: the published ones, for the public build. */
  allowed?: Set<string>,
): ListProgress[] => {
  const counts = (activityId: string) => !allowed || allowed.has(activityId);
  const activities = db.all<{ id: string; strava_id: number | null; day: string | null }>(
    `SELECT id, strava_id, substr(coalesce(start_local, start_time), 1, 10) AS day FROM activities`,
  );
  const byTarget = new Map<string, { id: string; day: string }>();
  for (const activity of activities) {
    const entry = { id: activity.id, day: activity.day ?? '' };
    byTarget.set(activity.id, entry);
    if (activity.strava_id !== null) byTarget.set(`strava:${activity.strava_id}`, entry);
  }
  const links = new Map<string, Link[]>();
  const ignored = new Map<string, Set<string>>();
  for (const row of db.all<{ target_id: string; field: string; value: string }>(
    `SELECT target_id, field, value FROM overrides WHERE target_kind = 'activity' AND field IN ('links', 'ignore_matches')`,
  )) {
    const activity = byTarget.get(row.target_id);
    if (!activity || !counts(activity.id)) continue;
    if (row.field === 'links')
      links.set(activity.id, [...(links.get(activity.id) ?? []), ...parse<Link[]>(row.value, [])]);
    else
      ignored.set(
        activity.id,
        new Set([...(ignored.get(activity.id) ?? []), ...parse<string[]>(row.value, [])]),
      );
  }

  // Manual statuses, keyed by the place, item or route id they name.
  const manual = new Map<string, Visit[]>();
  const wanted = new Set<string>();
  for (const [activityId, list] of links) {
    const day = byTarget.get(activityId)?.day ?? '';
    for (const link of list) {
      if (link.status === 'want') continue;
      manual.set(link.id, [
        ...(manual.get(link.id) ?? []),
        { activityId, date: day, status: link.status, manual: true },
      ]);
    }
  }
  for (const row of db.all<{ data: string }>(`SELECT data FROM sheet_rows`)) {
    const data = parse<{ status?: string; links?: Link[] }>(row.data, {});
    if (data.status === 'want') for (const link of data.links ?? []) wanted.add(link.id);
  }

  const placeMatches = new Map<string, { activityId: string; distanceM: number }[]>();
  const routeMatches = new Map<string, { activityId: string; intervals: [number, number][] }[]>();
  for (const row of db.all<{
    activity_id: string;
    target_kind: string;
    target_id: string;
    distance_m: number | null;
    intervals: string | null;
  }>(
    `SELECT activity_id, target_kind, target_id, distance_m, intervals FROM matches WHERE matched = 1`,
  )) {
    if (!counts(row.activity_id) || ignored.get(row.activity_id)?.has(row.target_id)) continue;
    if (row.target_kind === 'place') {
      placeMatches.set(row.target_id, [
        ...(placeMatches.get(row.target_id) ?? []),
        { activityId: row.activity_id, distanceM: row.distance_m ?? 0 },
      ]);
    } else {
      routeMatches.set(row.target_id, [
        ...(routeMatches.get(row.target_id) ?? []),
        { activityId: row.activity_id, intervals: parse<[number, number][]>(row.intervals, []) },
      ]);
    }
  }

  const summarise = (visits: Visit[]) => {
    const counted = visits.filter((visit) => visit.status !== 'dns');
    const days = counted
      .map((visit) => visit.date)
      .filter(Boolean)
      .sort();
    return { counted, first: days[0] ?? null, latest: days.at(-1) ?? null };
  };
  /** One visit per activity; the hand-written status replaces the automatic one. */
  const merge = (automatic: Visit[], hand: Visit[]) => {
    const out = new Map<string, Visit>();
    for (const visit of automatic) out.set(visit.activityId, visit);
    for (const visit of hand) out.set(visit.activityId, visit);
    return [...out.values()];
  };

  const progress: ListProgress[] = [];
  for (const list of catalog.lists) {
    const items: ItemProgress[] = [];
    if (list.kind === 'point') {
      for (const item of catalog.pointItems.filter((candidate) => candidate.listId === list.id)) {
        const target = item.placeId ?? item.id;
        const automatic: Visit[] = item.placeId
          ? (placeMatches.get(item.placeId) ?? [])
              .filter((match) => match.distanceM <= list.radiusM)
              .map((match) => ({
                activityId: match.activityId,
                date: byTarget.get(match.activityId)?.day ?? '',
                status: 'done' as const,
                manual: false,
              }))
          : [];
        const hand = [
          ...(manual.get(target) ?? []),
          ...(item.placeId ? (manual.get(item.id) ?? []) : []),
        ];
        const visits = merge(automatic, hand);
        const { counted, first, latest } = summarise(visits);
        const status: ItemStatus =
          counted.length > 0
            ? 'done'
            : visits.some((visit) => visit.status === 'dns')
              ? 'dns'
              : wanted.has(target) || wanted.has(item.id)
                ? 'want'
                : 'none';
        items.push({
          listId: list.id,
          itemId: item.id,
          placeId: item.placeId,
          order: item.order,
          name: item.name,
          status,
          visits: counted.length,
          first,
          latest,
          manual: hand.length > 0,
        });
      }
    } else {
      for (const item of catalog.routeItems.filter((candidate) => candidate.listId === list.id)) {
        const covering = routeMatches.get(item.id) ?? [];
        const coveredM = Math.min(
          item.lengthM,
          unionLength(covering.flatMap((match) => match.intervals)),
        );
        const automatic = covering.map((match) => ({
          activityId: match.activityId,
          date: byTarget.get(match.activityId)?.day ?? '',
          status: 'done' as const,
          manual: false,
        }));
        const hand = manual.get(item.id) ?? [];
        const visits = merge(automatic, hand);
        const { counted, first, latest } = summarise(visits);
        const handDone = hand.some((visit) => visit.status !== 'dns');
        const share = item.lengthM > 0 ? coveredM / item.lengthM : 0;
        const status: ItemStatus =
          handDone || share >= thresholds.matching.routes.completeShare
            ? 'done'
            : coveredM > 0
              ? 'partial'
              : hand.some((visit) => visit.status === 'dns')
                ? 'dns'
                : wanted.has(item.id)
                  ? 'want'
                  : 'none';
        items.push({
          listId: list.id,
          itemId: item.id,
          placeId: null,
          order: item.order,
          name: item.name,
          status,
          visits: counted.length,
          first,
          latest,
          coveredM: Math.round(coveredM),
          lengthM: Math.round(item.lengthM),
          manual: hand.length > 0,
        });
      }
    }
    items.sort((a, b) => a.order - b.order);
    const counts: Record<ItemStatus, number> = { done: 0, partial: 0, dns: 0, want: 0, none: 0 };
    for (const item of items) counts[item.status]++;
    progress.push({
      id: list.id,
      kind: list.kind,
      title: list.title,
      items,
      counts,
      ...(list.kind === 'route'
        ? {
            coveredM: items.reduce((sum, item) => sum + (item.coveredM ?? 0), 0),
            lengthM: items.reduce((sum, item) => sum + (item.lengthM ?? 0), 0),
          }
        : {}),
    });
  }
  return progress;
};

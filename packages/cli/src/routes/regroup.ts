/** Grouping every activity into routes, naming them and saving the result. */
import type { RoutesConfig, Thresholds } from '@jam/core';

import type { Logger } from '../logger.ts';
import type { Store } from '../store/store.ts';
import {
  group,
  type GroupActivity,
  keepIds,
  loadActivities,
  loadRoutes,
  type Route,
  saveRoutes,
} from './group.ts';
import {
  autoName,
  type AutoName,
  autoNameParts,
  manualNames,
  nameContext,
  partsOfName,
} from './summary.ts';

export interface Grouped {
  routes: Route[];
  activities: Map<string, GroupActivity>;
  names: Map<string, string>;
  /** What each automatic name is made of (routes without a manual name), for the site. */
  labels: Map<string, AutoName & { n?: number }>;
  joined: number;
  merged: number;
  created: number;
  variants: number;
  withoutTrack: number;
}

/** Groups, names and saves. `fresh` regroups from scratch, keeping ids where membership matches. */
export const regroup = (
  store: Store,
  thresholds: Thresholds,
  config: RoutesConfig,
  fresh: boolean,
  dryRun: boolean,
  log: Logger,
): Grouped => {
  const { db } = store;
  const now = new Date().toISOString();
  const activities = loadActivities(db, thresholds.routeGrouping.gridZoom);
  const old = loadRoutes(db);
  const routes = fresh ? [] : old.map((route) => ({ ...route, members: new Map(route.members) }));
  const result = group(routes, activities, thresholds, config, now);
  if (fresh) keepIds(routes, old);
  const context = nameContext(db);
  for (const route of routes) {
    if (fresh || result.changed.has(route.id) || !route.autoName)
      route.autoName = autoName(route, activities, context, thresholds);
  }
  // Same-looking automatic names (two loops from one start) get a number, oldest first.
  const seen = new Map<string, number>();
  for (const route of routes.toSorted(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )) {
    const base = route.autoName.replace(/ \(\d+\)$/, '');
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    route.autoName = count === 1 ? base : `${base} (${count})`;
  }
  const { names, problems } = manualNames(routes, config);
  for (const problem of problems) log.warn(problem);
  const labels = new Map<string, AutoName & { n?: number }>();
  for (const route of routes) {
    if (names.has(route.id)) continue;
    const parts =
      partsOfName(route.autoName, context) ?? autoNameParts(route, activities, context, thresholds);
    labels.set(route.id, parts);
  }
  if (!dryRun) saveRoutes(db, routes);
  const withoutTrack = Number(
    db.get<{ n: number }>(
      'SELECT COUNT(*) AS n FROM activities a LEFT JOIN tracks t ON t.activity_id = a.id WHERE t.activity_id IS NULL',
    )?.n ?? 0,
  );
  return { routes, activities, names, labels, ...result, withoutTrack };
};

export const nameOf = (grouped: Grouped, route: Route) =>
  grouped.names.get(route.id) ?? route.autoName;

import { createHash } from 'node:crypto';

import type { Position, Thresholds } from '@jam/core';

import type { Logger } from '../logger.ts';
import type { Store } from '../store/store.ts';
import { AreaIndex } from './areas.ts';
import { type Catalog, catalogHash, loadCatalog } from './catalog.ts';
import { MATCHER_VERSION, type MatchResult, matchActivity } from './match.ts';

interface RunOptions {
  /** Recompute every activity, ignoring the cache. */
  force: boolean;
  dryRun: boolean;
}

export interface RunReport {
  runId?: number;
  startedAt: string;
  activities: number;
  computed: number;
  reused: number;
  newMatches: number;
  durationMs: number;
}

interface ActivityRow {
  id: string;
  source: string;
  strava_id: number | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  start_lat: number | null;
  start_lon: number | null;
  detail: string | null;
  coordinates: string | null;
  elevations: string | null;
  cached: string | null;
  [key: string]: string | number | null;
}

const sha = (...parts: unknown[]) =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

/** Matches every activity whose track, figures or the lists and thresholds changed since last time. */
export const runMatching = (
  store: Store,
  thresholds: Thresholds,
  options: RunOptions,
  log: Logger,
): RunReport => {
  const { db } = store;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const inputs = sha(
    MATCHER_VERSION,
    catalogHash(),
    thresholds.matching,
    thresholds.routeGrouping.gridZoom,
  );
  const rows = db.all<ActivityRow>(
    `SELECT a.id, a.source, a.strava_id, a.distance_m, a.elevation_gain_m, a.start_lat, a.start_lon,
            t.detail, t.coordinates, t.elevations, c.inputs_hash AS cached
       FROM activities a LEFT JOIN tracks t ON t.activity_id = a.id LEFT JOIN build_cache c ON c.activity_id = a.id
      ORDER BY a.start_time`,
  );
  // Rows that name list places by hand; such an activity is in Japan even without a track.
  const linked = new Set(
    db
      .all<{ target_id: string }>(
        `SELECT target_id FROM overrides WHERE target_kind = 'activity' AND field = 'links'`,
      )
      .map((row) => row.target_id),
  );

  let catalog: Catalog | undefined;
  let areas: AreaIndex | undefined;
  const results: { row: ActivityRow; key: string; result: MatchResult }[] = [];
  let reused = 0;
  for (const [index, row] of rows.entries()) {
    if (index % 20 === 0) log.progress(index, rows.length, 'activities');
    const hasPlaceLinks =
      linked.has(row.id) || (row.strava_id !== null && linked.has(`strava:${row.strava_id}`));
    const key = sha(
      inputs,
      row.source,
      row.detail,
      row.coordinates,
      row.elevations,
      row.distance_m,
      row.elevation_gain_m,
      row.start_lat,
      row.start_lon,
      hasPlaceLinks,
    );
    if (!options.force && row.cached === key) {
      reused++;
      continue;
    }
    catalog ??= loadCatalog(thresholds);
    areas ??= new AreaIndex(catalog.areasFile);
    const result = matchActivity(
      {
        coordinates: row.coordinates ? (JSON.parse(row.coordinates) as Position[]) : null,
        detail: row.detail === 'full' ? 'full' : row.detail === 'summary' ? 'summary' : null,
        elevations: row.elevations ? (JSON.parse(row.elevations) as number[]) : null,
        distanceM: row.distance_m,
        elevationGainM: row.elevation_gain_m,
        point:
          row.start_lat !== null && row.start_lon !== null ? [row.start_lon, row.start_lat] : null,
        // The sheet records outings in Japan; only its coordinates can say otherwise.
        hasPlaceLinks: hasPlaceLinks || row.source === 'sheet',
      },
      catalog,
      areas,
      thresholds,
    );
    results.push({ row, key, result });
  }

  const report: RunReport = {
    startedAt,
    activities: rows.length,
    computed: results.length,
    reused,
    newMatches: 0,
    durationMs: 0,
  };
  if (options.dryRun) {
    report.durationMs = Math.round(performance.now() - started);
    return report;
  }

  report.runId = db.run(
    `INSERT INTO match_runs (started_at, inputs_hash, activities) VALUES (?, ?, ?)`,
    [startedAt, inputs, rows.length],
  ).lastId;
  const now = startedAt;
  // Batches keep each transaction short; an interrupted run keeps what it finished.
  for (let i = 0; i < results.length; i += 200) {
    db.transaction(() => {
      for (const { row, key, result } of results.slice(i, i + 200)) {
        const seen = new Map(
          db
            .all<{ target_kind: string; target_id: string; first_seen_at: string }>(
              'SELECT target_kind, target_id, first_seen_at FROM matches WHERE activity_id = ?',
              [row.id],
            )
            .map((match) => [`${match.target_kind}:${match.target_id}`, match.first_seen_at]),
        );
        db.run('DELETE FROM matches WHERE activity_id = ?', [row.id]);
        for (const place of result.places) {
          const first = seen.get(`place:${place.id}`);
          if (!first && place.matched) report.newMatches++;
          db.run(
            `INSERT INTO matches (activity_id, target_kind, target_id, distance_m, covered_m, intervals, matched, uncertain, first_seen_at) VALUES (?, 'place', ?, ?, NULL, NULL, ?, ?, ?)`,
            [
              row.id,
              place.id,
              place.distanceM,
              place.matched ? 1 : 0,
              place.uncertain ? 1 : 0,
              first ?? now,
            ],
          );
        }
        for (const route of result.routes) {
          const first = seen.get(`route:${route.id}`);
          if (!first) report.newMatches++;
          db.run(
            `INSERT INTO matches (activity_id, target_kind, target_id, distance_m, covered_m, intervals, matched, uncertain, first_seen_at) VALUES (?, 'route', ?, NULL, ?, ?, 1, 0, ?)`,
            [row.id, route.id, route.coveredM, JSON.stringify(route.intervals), first ?? now],
          );
        }
        db.run(
          `INSERT INTO activity_areas (activity_id, location, prefectures, gain_method, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (activity_id) DO UPDATE SET location = excluded.location, prefectures = excluded.prefectures, gain_method = excluded.gain_method, updated_at = excluded.updated_at`,
          [row.id, result.location, JSON.stringify(result.prefectures), result.gainMethod, now],
        );
        db.run(
          `INSERT INTO build_cache (activity_id, inputs_hash, results, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (activity_id) DO UPDATE SET inputs_hash = excluded.inputs_hash, results = excluded.results, updated_at = excluded.updated_at`,
          [row.id, key, JSON.stringify(result), now],
        );
      }
    });
    if (results.length > 400)
      log.info(`  matched ${Math.min(i + 200, results.length)} of ${results.length}`);
  }
  report.durationMs = Math.round(performance.now() - started);
  db.run(
    `UPDATE match_runs SET finished_at = ?, computed = ?, reused = ?, new_matches = ? WHERE id = ?`,
    [new Date().toISOString(), report.computed, report.reused, report.newMatches, report.runId],
  );
  return report;
};

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  ACTIVITY_TYPES,
  type ActivityRecord,
  activitiesFileSchema,
  type ActivityType,
  type Config,
  listsFileSchema,
  maskFileSchema,
  type MetaFile,
  metaFileSchema,
  OUTPUT_SCHEMA_VERSION,
  type Position,
  prefectureOutlineFileSchema,
  prefecturesFileSchema,
  referenceRouteFileSchema,
  routesFileSchema,
  type SiteOptions,
  statsFileSchema,
  tracksFileSchema,
} from '@jam/core';
import type { z } from 'zod';

import { type Grouped, nameOf, regroup } from '../routes/regroup.ts';
import { forbiddenFor } from '../privacy/selection.ts';
import { missingListsWarning, readListIndex } from '../lists/index-file.ts';
import { LISTS_DIR, outlineFile } from '../lists/sources.ts';
import {
  loadMunicipalities,
  MUNICIPALITIES_FILE,
  MunicipalityIndex,
} from '../lists/municipalities.ts';
import { storeMarker } from '../demo/marker.ts';
import type { Logger } from '../logger.ts';
import { type Catalog, loadCatalog, type RouteItem } from '../match/catalog.ts';
import { distanceM } from '../match/geometry.ts';
import { type RunReport, runMatching } from '../match/run.ts';
import { resolveProgress } from '../match/status.ts';
import { DATA_DIR } from '../paths.ts';
import { audit, type AuditReport, REFERENCE_POINTS_FILE } from '../privacy/audit.ts';
import { type PublicActivity, selectPublic } from '../privacy/publish.ts';
import { applyZones, loadZones } from '../privacy/zones.ts';
import { statsOf } from '../routes/summary.ts';
import { publicId } from '../store/ids.ts';
import type { Store } from '../store/store.ts';
import { roundPosition, roundTo } from '../lists/geo.ts';
import { bboxOfLines, publishLine } from './geometry.ts';
import { japanArea } from './japan-area.ts';
import { JamError, errorText } from '../errors.ts';
import { writeFileAtomic } from '../files.ts';

const BUILD_FAILED_DIR = join(DATA_DIR, 'build-failed');

interface BuildOptions {
  /** Where the data files go; the web app lives beside them in dist/. */
  outDir: string;
  force: boolean;
  dryRun: boolean;
}

interface OutputFile {
  path: string;
  bytes: number;
  gzipBytes: number;
  atStart: boolean;
}

interface BuildReport {
  match: RunReport;
  routesGrouped: number;
  published: number;
  withTrack: number;
  clipped: number;
  trackHidden: number;
  excluded: Map<string, number>;
  routes: number;
  files: OutputFile[];
  startGzipBytes: number;
  budgetBytes: number;
  audit: AuditReport;
  /** Where the files are: the output folder, or the kept failed build. */
  writtenTo: string;
  ok: boolean;
}

class BuildError extends JamError {
  readonly step: string;
  constructor(step: string, message: string) {
    super(`The build stopped at "${step}": ${message}`);
    this.name = 'BuildError';
    this.step = step;
  }
}

const json = (value: unknown) => JSON.stringify(value);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** Validates a file against its schema before it is written; a mismatch is a bug, so it stops the build. */
const checked = <S extends z.ZodType>(schema: S, value: z.infer<S>, file: string): string => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new BuildError(
      'validate',
      `${file} does not match its schema at ${issue?.path.join('.') || 'the top'}: ${issue?.message ?? 'invalid'}`,
    );
  }
  return json(value);
};

interface Circle {
  centre: Position;
  radiusM: number;
}

const insideAny = (point: Position, circles: Circle[]) =>
  circles.some((circle) => distanceM(point, circle.centre) < circle.radiusM);

/**
 * Covered stretches of a route item as published: the union of `intervals`, with every part inside
 * a privacy zone taken out, and stretches shorter than `minStretchM` dropped.
 */
const publicCoverage = (
  item: RouteItem,
  intervals: [number, number][],
  zones: Circle[],
  minStretchM: number,
): { covered: [number, number][]; lines: Position[][] } => {
  const merged: [number, number][] = [];
  for (const [from, to] of [...intervals].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  const covered: [number, number][] = [];
  const lines: Position[][] = [];
  for (const part of item.parts) {
    let run: { from: number; to: number; points: Position[] } | undefined;
    const close = () => {
      if (run && run.to - run.from >= minStretchM && run.points.length >= 2) {
        covered.push([Math.round(run.from), Math.round(run.to)]);
        lines.push(run.points);
      }
      run = undefined;
    };
    part.points.forEach((point, i) => {
      const along = part.along[i] ?? 0;
      const isCovered = merged.some(([from, to]) => along >= from && along <= to);
      if (!isCovered || insideAny(point, zones)) {
        close();
        return;
      }
      run ??= { from: along, to: along, points: [] };
      run.to = along;
      run.points.push(point);
    });
    close();
  }
  return { covered, lines };
};

interface Totals {
  activities: number;
  distanceM: number;
  gainM: number;
  movingS: number;
}
const emptyTotals = (): Totals => ({ activities: 0, distanceM: 0, gainM: 0, movingS: 0 });
const roundTotals = (totals: Totals): Totals => ({
  activities: totals.activities,
  distanceM: Math.round(totals.distanceM),
  gainM: Math.round(totals.gainM),
  movingS: Math.round(totals.movingS),
});

/** What every stage of the build reads: the store, the settings and what was worked out first. */
interface Shared {
  db: Store['db'];
  store: Store;
  config: Config;
  thresholds: Config['thresholds'];
  site: Config['site'];
  out: Config['site']['output'];
  options: BuildOptions;
  log: Logger;
  match: ReturnType<typeof runMatching>;
  grouped: Grouped;
  zones: ReturnType<typeof loadZones>;
  applied: ReturnType<typeof applyZones>;
  circles: Circle[];
  selection: ReturnType<typeof selectPublic>;
  catalog: Catalog;
  published: PublicActivity[];
  byActivityId: Map<string, PublicActivity>;
  byRef: Map<string, PublicActivity>;
  progress: ReturnType<typeof resolveProgress>;
  /** The output files by path, filled as the stages go. */
  files: Map<string, string>;
  /** Notes a point of public geometry, which the audit then allows inside a privacy zone. */
  reference: (lon: number, lat: number) => void;
  /** A line as it is published: simplified and rounded. */
  line: (points: readonly Position[]) => number[][];
}

/** Which places and route stretches each published activity reached, after ignores and zones. */
const reachedStage = (c: Shared) => {
  const { db, thresholds, circles, catalog, published, byActivityId, byRef } = c;
  const ignored = new Map<string, Set<string>>();
  for (const row of db.all<{ target_id: string; value: string }>(
    `SELECT target_id, value FROM overrides WHERE target_kind = 'activity' AND field = 'ignore_matches'`,
  )) {
    ignored.set(row.target_id, new Set(JSON.parse(row.value) as string[]));
  }
  const isIgnored = (activity: PublicActivity, target: string) =>
    ignored.get(activity.ref)?.has(target) || ignored.get(activity.activityId)?.has(target);
  const placeInZone = new Set(
    [...catalog.places.values()]
      .filter((place) => insideAny(place.point, circles))
      .map((place) => place.id),
  );
  const placesOf = new Map<string, Set<string>>();
  const routeIntervals = new Map<string, Map<string, [number, number][]>>();
  for (const row of db.all<{
    activity_id: string;
    target_kind: string;
    target_id: string;
    intervals: string | null;
  }>('SELECT activity_id, target_kind, target_id, intervals FROM matches WHERE matched = 1')) {
    const activity = byActivityId.get(row.activity_id);
    if (!activity || isIgnored(activity, row.target_id)) continue;
    if (row.target_kind === 'place') {
      if (!placeInZone.has(row.target_id))
        placesOf.set(
          activity.activityId,
          (placesOf.get(activity.activityId) ?? new Set()).add(row.target_id),
        );
    } else {
      const items = routeIntervals.get(row.target_id) ?? new Map<string, [number, number][]>();
      items.set(activity.activityId, JSON.parse(row.intervals ?? '[]') as [number, number][]);
      routeIntervals.set(row.target_id, items);
    }
  }
  for (const row of db.all<{ target_id: string; value: string }>(
    `SELECT target_id, value FROM overrides WHERE target_kind = 'activity' AND field = 'links'`,
  )) {
    const activity =
      byRef.get(row.target_id) ??
      published.find((candidate) => candidate.activityId === row.target_id);
    if (!activity) continue;
    for (const link of JSON.parse(row.value) as { kind: string; id: string; status: string }[]) {
      if (
        (link.status === 'done' || link.status === 'repeat') &&
        link.kind === 'place' &&
        !placeInZone.has(link.id)
      ) {
        placesOf.set(
          activity.activityId,
          (placesOf.get(activity.activityId) ?? new Set()).add(link.id),
        );
      }
    }
  }
  const minStretch = thresholds.matching.routes.minStretchM;
  const routeItemsOf = new Map<string, Set<string>>();
  const coverage = new Map<string, ReturnType<typeof publicCoverage>>();
  for (const item of catalog.routeItems) {
    const perActivity = routeIntervals.get(item.id);
    if (!perActivity) continue;
    coverage.set(
      item.id,
      publicCoverage(item, [...perActivity.values()].flat(), circles, minStretch),
    );
    for (const [activityId, intervals] of perActivity) {
      if (publicCoverage(item, intervals, circles, minStretch).covered.length > 0) {
        routeItemsOf.set(activityId, (routeItemsOf.get(activityId) ?? new Set()).add(item.id));
      }
    }
  }
  return { placeInZone, placesOf, routeItemsOf, coverage };
};

/** The municipalities each published track passes through, for the municipality list. */
const municipalityStage = (c: Shared) => {
  const { published } = c;
  const municipalities = existsSync(MUNICIPALITIES_FILE) ? loadMunicipalities() : [];
  const areasOf = new Map<string, string[]>();
  const areaVisits = new Map<string, { count: number; first: string; latest: string }>();
  if (municipalities.length > 0) {
    const index = new MunicipalityIndex(municipalities);
    for (const activity of published) {
      const codes = new Set<string>();
      for (const fragment of activity.fragments)
        for (const point of fragment.points) {
          const found = index.locate(point);
          if (found) codes.add(found.code);
        }
      if (codes.size === 0) continue;
      areasOf.set(
        activity.activityId,
        [...codes].sort().map((code) => `muni-${code}`),
      );
      for (const code of codes) {
        const visit = areaVisits.get(code);
        areaVisits.set(code, {
          count: (visit?.count ?? 0) + 1,
          first: visit && visit.first < activity.date ? visit.first : activity.date,
          latest: visit && visit.latest > activity.date ? visit.latest : activity.date,
        });
      }
    }
  }
  return { municipalities, areasOf, areaVisits };
};

/** Grouped routes with at least two published activities, counted from those only. */
const routeStage = (c: Shared) => {
  const { store, grouped, byRef, line } = c;
  const publishedGroup = new Map([...grouped.activities].filter(([ref]) => byRef.has(ref)));
  const routeIdOf = new Map<string, string>();
  const routeRecords: z.infer<typeof routesFileSchema>['routes'] = [];
  const publicRouteId = (id: string) => publicId(store.salt, `route:${id}`);
  for (const route of grouped.routes) {
    const members = [...route.members].filter(([ref]) => byRef.has(ref));
    if (members.length < 2) continue;
    const stats = statsOf(route, publishedGroup);
    if (!stats.first || !stats.latest) continue;
    const id = publicRouteId(route.id);
    for (const [ref] of members) routeIdOf.set(ref, id);
    const [bestRef] = [...members].sort(
      (a, b) =>
        (b[0] === route.representativeRef ? 1 : 0) - (a[0] === route.representativeRef ? 1 : 0) ||
        b[1].similarity - a[1].similarity,
    );
    const representative = bestRef ? byRef.get(bestRef[0]) : undefined;
    const auto = grouped.labels.get(route.id);
    routeRecords.push({
      id,
      name: nameOf(grouped, route),
      ...(auto ? { auto } : {}),
      type: route.type as ActivityType,
      count: stats.count,
      reversed: stats.reversed,
      first: stats.first,
      latest: stats.latest,
      minDistanceM: Math.round(stats.minDistanceM ?? 0),
      maxDistanceM: Math.round(stats.maxDistanceM ?? 0),
      fastestS: stats.fastestS ? Math.round(stats.fastestS) : null,
      medianS: stats.medianS ? Math.round(stats.medianS) : null,
      bestPaceS: stats.bestPaceS ? roundTo(stats.bestPaceS, 1) : null,
      medianPaceS: stats.medianPaceS ? roundTo(stats.medianPaceS, 1) : null,
      ...(route.variantOf ? { variantOf: publicRouteId(route.variantOf) } : {}),
      activities: members
        .map(([ref]) => byRef.get(ref)?.publicId ?? '')
        .filter(Boolean)
        .sort(),
      line: (representative?.fragments ?? [])
        .map((fragment) =>
          line(fragment.points).map(([lon, lat]) => [lon, lat] as [number, number]),
        )
        .filter((points) => points.length >= 2),
    });
  }
  const routeIds = new Set(routeRecords.map((route) => route.id));
  for (const route of routeRecords)
    if (route.variantOf && !routeIds.has(route.variantOf)) delete route.variantOf;
  routeRecords.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return { routeIdOf, routeRecords };
};

/** Tracks, one file per year, and the activity records that point at them. */
const trackStage = (
  c: Shared,
  reached: ReturnType<typeof reachedStage>,
  municipality: ReturnType<typeof municipalityStage>,
  route: ReturnType<typeof routeStage>,
) => {
  const { out, published, files } = c;
  const { placesOf, routeItemsOf } = reached;
  const { areasOf } = municipality;
  const { routeIdOf, routeRecords } = route;
  const tracksByYear = new Map<number, z.infer<typeof tracksFileSchema>['features']>();
  const records: ActivityRecord[] = [];
  for (const activity of [...published].sort(
    (a, b) => a.date.localeCompare(b.date) || a.publicId.localeCompare(b.publicId),
  )) {
    const stretches = activity.fragments
      .map((fragment) => publishLine(fragment.points, out.simplifyM, out.decimals, fragment))
      .filter((stretch) => stretch.line.length >= 2);
    const lines = stretches.map((stretch) => stretch.line);
    // Seconds only when every stretch has them, so they line up with the coordinates.
    const seconds = stretches.every((stretch) => stretch.seconds)
      ? stretches.map((stretch) => stretch.seconds as number[])
      : undefined;
    const year = Number(activity.date.slice(0, 4));
    if (lines.length > 0) {
      const features = tracksByYear.get(year) ?? [];
      features.push({
        type: 'Feature',
        properties: {
          id: activity.publicId,
          type: activity.type as ActivityType,
          heatmap: activity.inHeatmap,
          ...(seconds ? { t: seconds } : {}),
        },
        geometry: { type: 'MultiLineString', coordinates: lines as [number, number][][] },
      });
      tracksByYear.set(year, features);
    }
    const box = bboxOfLines(lines);
    const first = lines[0]?.[0];
    const last = lines.at(-1)?.at(-1);
    const route = routeIdOf.get(activity.ref);
    records.push({
      id: activity.publicId,
      date: activity.date,
      ...(activity.startLocal ? { time: activity.startLocal.slice(11, 16) } : {}),
      type: activity.type as ActivityType,
      tags: activity.tags,
      source: activity.source === 'sheet' ? 'sheet' : 'strava',
      name: activity.name,
      distanceM: activity.distanceM === null ? null : Math.round(activity.distanceM),
      gainM: activity.gainM === null ? null : Math.round(activity.gainM),
      movingS: activity.movingS === null ? null : Math.round(activity.movingS),
      elapsedS: activity.elapsedS === null ? null : Math.round(activity.elapsedS),
      prefectures: Object.fromEntries(
        Object.entries(activity.prefectures)
          .map(([code, value]) => [code, Math.round(value.distanceM)])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
      prefectureGain: Object.fromEntries(
        Object.entries(activity.prefectures)
          .map(([code, value]) => [code, Math.round(value.gainM)] as const)
          .filter(([, gain]) => gain > 0)
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
      places: [...(placesOf.get(activity.activityId) ?? [])].sort(),
      routeItems: [...(routeItemsOf.get(activity.activityId) ?? [])].sort(),
      ...(areasOf.has(activity.activityId) ? { areas: areasOf.get(activity.activityId) } : {}),
      ...(route ? { route } : {}),
      ...(activity.link ? { link: activity.link } : {}),
      ...(lines.length > 0 ? { trackYear: year } : {}),
      ...(box ? { bbox: box } : {}),
      ...(first ? { start: [first[0] ?? 0, first[1] ?? 0] as [number, number] } : {}),
      ...(last ? { end: [last[0] ?? 0, last[1] ?? 0] as [number, number] } : {}),
    });
  }
  files.set(
    'activities.json',
    checked(
      activitiesFileSchema,
      { schemaVersion: OUTPUT_SCHEMA_VERSION, activities: records },
      'activities.json',
    ),
  );
  for (const [year, features] of [...tracksByYear].sort((a, b) => a[0] - b[0])) {
    files.set(
      `tracks/${year}.geojson`,
      checked(
        tracksFileSchema,
        { type: 'FeatureCollection', schemaVersion: OUTPUT_SCHEMA_VERSION, year, features },
        `tracks/${year}.geojson`,
      ),
    );
  }
  files.set(
    'routes.json',
    checked(
      routesFileSchema,
      { schemaVersion: OUTPUT_SCHEMA_VERSION, routes: routeRecords },
      'routes.json',
    ),
  );
  return { tracksByYear, records };
};

/** Lists, with statuses from published activities and the sheet only. */
const listStage = (
  c: Shared,
  reached: ReturnType<typeof reachedStage>,
  municipality: ReturnType<typeof municipalityStage>,
) => {
  const { out, log, catalog, progress, files, reference } = c;
  const { placeInZone, coverage } = reached;
  const { municipalities, areaVisits } = municipality;
  const index = readListIndex();
  const leftOut = missingListsWarning(index.missing);
  if (leftOut) log.warn(leftOut);
  const meta = new Map(index.lists.map((list) => [list.id, list]));
  const itemPrefectures = new Map<string, string[]>();
  for (const list of index.lists) {
    if (!list.file || list.kind === 'area') continue;
    const features = (
      JSON.parse(readFileSync(join(LISTS_DIR, list.file), 'utf8')) as {
        features: { properties: { id: string; prefectures?: string[] } }[];
      }
    ).features;
    for (const feature of features)
      itemPrefectures.set(
        feature.properties.id,
        [...(feature.properties.prefectures ?? [])].sort(),
      );
  }
  const elevation = new Map(
    (
      JSON.parse(readFileSync(join(LISTS_DIR, 'places.geojson'), 'utf8')) as {
        features: { properties: { id: string; elevationM?: number } }[];
      }
    ).features.map((feature) => [feature.properties.id, feature.properties.elevationM]),
  );
  const lists = progress.map((list) => {
    const items = list.items.map((item) => {
      const place = item.placeId ? catalog.places.get(item.placeId) : undefined;
      const at = place ? (roundPosition(place.point, out.decimals) as [number, number]) : undefined;
      if (at) reference(at[0], at[1]);
      const hidden = item.placeId ? placeInZone.has(item.placeId) : false;
      const public_ = coverage.get(item.itemId);
      const elevationM = item.placeId ? elevation.get(item.placeId) : undefined;
      return {
        id: item.itemId,
        order: item.order,
        name: { ja: item.name.ja, en: item.name.en },
        status: item.status,
        ...(list.kind === 'point' ? { placeId: item.placeId } : {}),
        prefectures: itemPrefectures.get(item.itemId) ?? [],
        ...(at ? { at } : {}),
        ...(elevationM !== undefined ? { elevationM } : {}),
        // A place inside a privacy zone shows its status, not how often or when.
        ...(hidden ? {} : { visits: item.visits, first: item.first, latest: item.latest }),
        ...(list.kind === 'route'
          ? {
              coveredM: Math.round(sum((public_?.covered ?? []).map(([a, b]) => b - a))),
              lengthM: item.lengthM ?? 0,
              covered: public_?.covered ?? [],
            }
          : {}),
      };
    });
    const counts = { done: 0, partial: 0, dns: 0, want: 0, none: 0 };
    for (const item of items) counts[item.status]++;
    const info = meta.get(list.id);
    return {
      id: list.id,
      title: list.title,
      kind: list.kind,
      theme: (info?.theme ?? 'peaks') as z.infer<typeof listsFileSchema>['lists'][number]['theme'],
      status: (info?.status ?? 'ready') as z.infer<
        typeof listsFileSchema
      >['lists'][number]['status'],
      counts,
      items,
      ...(list.kind === 'route'
        ? {
            coveredM: sum(items.map((item) => item.coveredM ?? 0)),
            lengthM: sum(items.map((item) => item.lengthM ?? 0)),
          }
        : {}),
    };
  });
  if (municipalities.length > 0) {
    const items = municipalities.map((municipality, i) => {
      const visit = areaVisits.get(municipality.code);
      const at = roundPosition(MunicipalityIndex.centre(municipality), out.decimals) as [
        number,
        number,
      ];
      reference(at[0], at[1]);
      return {
        id: `muni-${municipality.code}`,
        order: i + 1,
        name: { ja: municipality.ja, en: municipality.en || municipality.ja },
        status: visit ? ('done' as const) : ('none' as const),
        placeId: `muni-${municipality.code}`,
        prefectures: [municipality.prefecture],
        at,
        visits: visit?.count ?? 0,
        first: visit?.first ?? null,
        latest: visit?.latest ?? null,
      };
    });
    const counts = { done: 0, partial: 0, dns: 0, want: 0, none: 0 };
    for (const item of items) counts[item.status]++;
    lists.push({
      id: 'municipalities',
      title: { en: 'Municipalities', ja: '市区町村' },
      kind: 'point',
      theme: 'areas',
      status: 'ready',
      counts,
      items,
    });
  }
  files.set(
    'lists.json',
    checked(listsFileSchema, { schemaVersion: OUTPUT_SCHEMA_VERSION, lists }, 'lists.json'),
  );
  return { meta, lists };
};

/** Reference routes, one file per route list, loaded when the list is switched on. */
const referenceRouteStage = (c: Shared, reached: ReturnType<typeof reachedStage>) => {
  const { catalog, files, reference, line } = c;
  const { coverage } = reached;
  for (const list of catalog.lists.filter((candidate) => candidate.kind === 'route')) {
    const features = catalog.routeItems
      .filter((item) => item.listId === list.id)
      .sort((a, b) => a.order - b.order)
      .map((item) => {
        const geometry = item.parts
          .map((part) => line(part.points).map(([lon, lat]) => [lon, lat] as [number, number]))
          .filter((points) => points.length >= 2);
        for (const points of geometry) for (const [lon, lat] of points) reference(lon, lat);
        const public_ = coverage.get(item.id);
        return {
          type: 'Feature' as const,
          properties: {
            id: item.id,
            order: item.order,
            name: { ja: item.name.ja, en: item.name.en },
            lengthM: Math.round(item.lengthM),
            coveredM: Math.round(sum((public_?.covered ?? []).map(([a, b]) => b - a))),
            covered: public_?.covered ?? [],
            coveredLines: (public_?.lines ?? [])
              .map((points) => line(points).map(([lon, lat]) => [lon, lat] as [number, number]))
              .filter((points) => points.length >= 2),
          },
          geometry: { type: 'MultiLineString' as const, coordinates: geometry },
        };
      });
    const file = `reference-routes/${list.id}.geojson`;
    files.set(
      file,
      checked(
        referenceRouteFileSchema,
        {
          type: 'FeatureCollection',
          schemaVersion: OUTPUT_SCHEMA_VERSION,
          list: list.id,
          features,
        },
        file,
      ),
    );
  }
};

/** Statistics, from the published records. */
const statsStage = (
  c: Shared,
  track: ReturnType<typeof trackStage>,
  list: ReturnType<typeof listStage>,
) => {
  const { published, byRef, files } = c;
  const { records } = track;
  const { lists } = list;
  const byPrefecture = new Map<
    string,
    Totals & { days: Set<string>; byType: Record<string, number> }
  >();
  const total = emptyTotals();
  const byType = new Map<string, Totals>();
  const byYear = new Map<string, Totals>();
  const byMonth = new Map<string, Totals>();
  const grid = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  const hourByWeekday = grid();
  const hourByWeekdayByType = new Map<string, number[][]>();
  const add = (map: Map<string, Totals>, key: string, record: ActivityRecord) => {
    const totals = map.get(key) ?? emptyTotals();
    totals.activities++;
    totals.distanceM += record.distanceM ?? 0;
    totals.gainM += record.gainM ?? 0;
    totals.movingS += record.movingS ?? 0;
    map.set(key, totals);
  };
  for (const record of records) {
    const activity = byRef.get(
      published.find((candidate) => candidate.publicId === record.id)?.ref ?? '',
    );
    total.activities++;
    total.distanceM += record.distanceM ?? 0;
    total.gainM += record.gainM ?? 0;
    total.movingS += record.movingS ?? 0;
    add(byType, record.type, record);
    add(byYear, record.date.slice(0, 4), record);
    add(byMonth, record.date.slice(0, 7), record);
    if (activity?.hour !== null && activity?.hour !== undefined) {
      const weekday = (new Date(`${record.date}T00:00:00Z`).getUTCDay() + 6) % 7;
      const typed = hourByWeekdayByType.get(record.type) ?? grid();
      hourByWeekdayByType.set(record.type, typed);
      for (const counts of [hourByWeekday, typed]) {
        const row = counts[weekday];
        if (row) row[activity.hour] = (row[activity.hour] ?? 0) + 1;
      }
    }
    const split = activity?.prefectures ?? {};
    const splitTotal = sum(Object.values(split).map((value) => value.distanceM));
    for (const [code, value] of Object.entries(split)) {
      const entry = byPrefecture.get(code) ?? {
        ...emptyTotals(),
        days: new Set<string>(),
        byType: {},
      };
      const share = splitTotal > 0 ? value.distanceM / splitTotal : 0;
      entry.activities++;
      entry.distanceM += value.distanceM;
      entry.gainM += value.gainM;
      entry.movingS += (record.movingS ?? 0) * share;
      entry.days.add(record.date);
      entry.byType[record.type] = (entry.byType[record.type] ?? 0) + value.distanceM;
      byPrefecture.set(code, entry);
    }
  }
  const sortedRecord = <T>(map: Map<string, T>, convert: (value: T) => Totals) =>
    Object.fromEntries(
      [...map]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => [key, roundTotals(convert(value))]),
    );
  const completion = Object.fromEntries(
    lists.map((list) => {
      const days = list.items
        .map((item) => (item.status === 'done' ? (item.first ?? null) : null))
        .filter((day): day is string => Boolean(day))
        .sort();
      const series: { date: string; done: number }[] = [];
      days.forEach((day, i) => {
        if (series.at(-1)?.date === day) (series.at(-1) as { done: number }).done = i + 1;
        else series.push({ date: day, done: i + 1 });
      });
      return [list.id, series];
    }),
  );
  files.set(
    'stats.json',
    checked(
      statsFileSchema,
      {
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        total: roundTotals(total),
        byType: sortedRecord(byType, (value) => value),
        byYear: sortedRecord(byYear, (value) => value),
        byMonth: sortedRecord(byMonth, (value) => value),
        byPrefecture: sortedRecord(byPrefecture, (value) => value),
        hourByWeekday,
        hourByWeekdayByType: Object.fromEntries(
          [...hourByWeekdayByType].sort((a, b) => a[0].localeCompare(b[0])),
        ),
        completion,
      },
      'stats.json',
    ),
  );
  return { byPrefecture, byType };
};

/** The prefectures' outlines, simplified and in full, with what was done in each. */
const prefectureStage = (c: Shared, stats: ReturnType<typeof statsStage>) => {
  const { out, files, reference } = c;
  const { byPrefecture } = stats;
  const outlines = JSON.parse(readFileSync(join(LISTS_DIR, 'prefectures.geojson'), 'utf8')) as {
    features: {
      properties: { code: string; ja: string; en: string; region: string };
      geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
    }[];
  };
  const roundRing = (ring: [number, number][]) =>
    ring.map(([lon, lat]) => {
      const point = roundPosition([lon, lat], out.decimals) as [number, number];
      reference(point[0], point[1]);
      return point;
    });
  const prefectures = outlines.features.map((feature) => {
    const stats = byPrefecture.get(feature.properties.code);
    const geometry =
      feature.geometry.type === 'Polygon'
        ? {
            type: 'Polygon' as const,
            coordinates: (feature.geometry.coordinates as [number, number][][]).map(roundRing),
          }
        : {
            type: 'MultiPolygon' as const,
            coordinates: (feature.geometry.coordinates as [number, number][][][]).map((polygon) =>
              polygon.map(roundRing),
            ),
          };
    return {
      type: 'Feature' as const,
      properties: {
        code: feature.properties.code,
        ja: feature.properties.ja,
        en: feature.properties.en,
        region: feature.properties.region,
        activities: stats?.activities ?? 0,
        days: stats?.days.size ?? 0,
        distanceM: Math.round(stats?.distanceM ?? 0),
        gainM: Math.round(stats?.gainM ?? 0),
        byType: Object.fromEntries(
          ACTIVITY_TYPES.filter((type) => stats?.byType[type]).map((type) => [
            type,
            Math.round(stats?.byType[type] ?? 0),
          ]),
        ),
      },
      geometry,
    };
  });
  files.set(
    'prefectures.geojson',
    checked(
      prefecturesFileSchema,
      { type: 'FeatureCollection', schemaVersion: OUTPUT_SCHEMA_VERSION, features: prefectures },
      'prefectures.geojson',
    ),
  );

  // Each prefecture's detailed outline, for the selected one's highlight when zoomed in. Left out
  // (the simplified outline is used at every zoom) until `jam lists fetch outlines` has run.
  for (const { properties } of outlines.features) {
    const path = outlineFile(properties.code);
    if (!existsSync(path)) continue;
    const source = JSON.parse(readFileSync(path, 'utf8')) as {
      features: [
        { geometry: { coordinates: [number, number][][][] } },
        { geometry: { coordinates: [number, number][][] } },
      ];
    };
    const [area, border] = source.features;
    const file = `prefectures/${properties.code}.geojson`;
    files.set(
      file,
      checked(
        prefectureOutlineFileSchema,
        {
          type: 'FeatureCollection',
          schemaVersion: OUTPUT_SCHEMA_VERSION,
          features: [
            {
              type: 'Feature',
              properties: { code: properties.code, part: 'area' },
              geometry: {
                type: 'MultiPolygon',
                coordinates: area.geometry.coordinates.map((polygon) => polygon.map(roundRing)),
              },
            },
            {
              type: 'Feature',
              properties: { code: properties.code, part: 'border' },
              geometry: {
                type: 'MultiLineString',
                coordinates: border.geometry.coordinates.map(roundRing),
              },
            },
          ],
        },
        file,
      ),
    );
  }
  return { outlines, prefectures };
};

/** The area the site shows, and meta.json. */
const maskAndMetaStage = (
  c: Shared,
  route: ReturnType<typeof routeStage>,
  track: ReturnType<typeof trackStage>,
  list: ReturnType<typeof listStage>,
  prefecture: ReturnType<typeof prefectureStage>,
) => {
  const { store, site, files, reference } = c;
  const { routeRecords } = route;
  const { tracksByYear, records } = track;
  const { lists } = list;
  const { outlines } = prefecture;
  const detailed = JSON.parse(
    readFileSync(join(LISTS_DIR, 'prefectures-detail.geojson'), 'utf8'),
  ) as typeof outlines;
  const area = japanArea(
    detailed.features.flatMap((feature) =>
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as [number, number][][]]
        : (feature.geometry.coordinates as [number, number][][][]),
    ),
  );
  for (const ring of area.mask) for (const [lon, lat] of ring) reference(lon, lat);
  files.set(
    'mask.geojson',
    checked(
      maskFileSchema,
      {
        type: 'FeatureCollection',
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: area.mask },
          },
        ],
      },
      'mask.geojson',
    ),
  );

  const credits = (
    JSON.parse(readFileSync(join(LISTS_DIR, 'credits.json'), 'utf8')) as {
      sources: {
        name: string;
        url: string;
        licence: string;
        attribution: string;
        licenceJa?: string;
        attributionJa?: string;
        usedBy: string[];
      }[];
    }
  ).sources.map(({ name, url, licence, attribution, licenceJa, attributionJa, usedBy }) => ({
    name,
    url,
    licence,
    ...(licenceJa ? { licenceJa } : {}),
    ...(attributionJa ? { attributionJa } : {}),
    attribution,
    usedBy,
  }));
  const years = [...tracksByYear.keys()].sort((a, b) => a - b);
  files.set(
    'meta.json',
    checked(
      metaFileSchema,
      {
        schemaVersion: OUTPUT_SCHEMA_VERSION,
        builtAt: new Date().toISOString(),
        latestActivity: records.at(-1)?.date ?? null,
        counts: {
          activities: records.length,
          withTrack: records.filter((record) => record.trackYear !== undefined).length,
          routes: routeRecords.length,
          lists: lists.length,
        },
        trackYears: years,
        publish: {
          stravaLinks: site.publish.stravaLinks,
          activityNames: site.publish.activityNames,
          timeOfDay: site.publish.timeOfDay,
        },
        site: { title: site.site.title, description: site.site.description },
        views: site.views,
        map: {
          styleUrl: site.map.styleUrl,
          darkStyleUrl: site.map.darkStyleUrl,
          bounds: area.bounds,
          terrain: terrainSource(site.map.terrain),
        },
        credits,
        // Made-up data from `jam demo`: the site shows a badge, and it must not be published.
        ...(storeMarker(store.db) ? { demo: true } : {}),
      },
      'meta.json',
    ),
  );
};

/**
 * The whole build: match, group, apply the publish rules, write every file to a fresh folder,
 * validate, check the size budget and audit it. Only a build that passes replaces the previous
 * output; a failed one is kept in data/build-failed (local, never published) to look at.
 */
export const build = (
  store: Store,
  config: Config,
  options: BuildOptions,
  log: Logger,
): BuildReport => {
  const { db } = store;
  const { thresholds, site } = config;
  const out = site.output;

  const step = <T>(name: string, work: () => T): T => {
    try {
      return work();
    } catch (error) {
      if (error instanceof BuildError) throw error;
      throw new BuildError(name, errorText(error));
    }
  };

  const match = step('match', () =>
    runMatching(store, thresholds, { force: options.force, dryRun: false }, log),
  );
  const grouped: Grouped = step('group routes', () =>
    regroup(store, thresholds, config.routes, false, false, log),
  );
  const zones = step('privacy zones', () => loadZones(config.privacyZones));
  const applied = step('privacy zones', () => applyZones(db, zones, thresholds, options.dryRun));
  const circles: Circle[] = applied.map((zone) => ({
    centre: zone.centre,
    radiusM: zone.baseRadiusM + zone.jitterM,
  }));
  const selection = step('publish rules', () =>
    selectPublic(db, { site, thresholds, zones: applied, salt: store.salt }),
  );
  const catalog: Catalog = step('lists', () => loadCatalog(thresholds));
  const published = selection.activities;
  const byActivityId = new Map(published.map((activity) => [activity.activityId, activity]));
  const byRef = new Map(published.map((activity) => [activity.ref, activity]));
  const progress = step('statuses', () =>
    resolveProgress(db, catalog, thresholds, new Set(byActivityId.keys())),
  );

  const files = new Map<string, string>();
  const referencePoints = new Set<string>();
  const reference = (lon: number, lat: number) => referencePoints.add(`${lon},${lat}`);
  const line = (points: readonly Position[]) =>
    publishLine(points, out.simplifyM, out.decimals).line;

  const shared: Shared = {
    db,
    store,
    config,
    thresholds,
    site,
    out,
    options,
    log,
    match,
    grouped,
    zones,
    applied,
    circles,
    selection,
    catalog,
    published,
    byActivityId,
    byRef,
    progress,
    files,
    reference,
    line,
  };
  step('write', () => {
    const reached = reachedStage(shared);
    const municipality = municipalityStage(shared);
    const route = routeStage(shared);
    const track = trackStage(shared, reached, municipality, route);
    const list = listStage(shared, reached, municipality);
    referenceRouteStage(shared, reached);
    const stats = statsStage(shared, track, list);
    const prefecture = prefectureStage(shared, stats);
    maskAndMetaStage(shared, route, track, list, prefecture);
  });

  // Write to a fresh folder beside the output, then check it before it replaces anything.
  const next = `${options.outDir}.next`;
  rmSync(next, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(next, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  const START_FILES = new Set([
    'meta.json',
    'activities.json',
    'lists.json',
    'prefectures.geojson',
    'mask.geojson',
    'stats.json',
    'routes.json',
  ]);
  const written: OutputFile[] = [...files].map(([path, content]) => ({
    path,
    bytes: Buffer.byteLength(content),
    gzipBytes: gzipSync(content, { level: 9 }).length,
    atStart: START_FILES.has(path),
  }));
  written.sort((a, b) => a.path.localeCompare(b.path));
  const startGzipBytes = sum(written.filter((file) => file.atStart).map((file) => file.gzipBytes));
  const budgetBytes = out.startBudgetKB * 1024;
  // Kept beside the store (never published), so `jam audit` on its own knows the same public
  // geometry: list places, reference routes and prefecture borders inside a zone are not leaks.
  writeFileAtomic(join(DATA_DIR, REFERENCE_POINTS_FILE), [...referencePoints].join('\n'));
  const forbidden = { ...forbiddenFor(store, config, selection, zones), referencePoints };
  const report = step('audit', () => audit(next, forbidden));
  const excluded = new Map<string, number>();
  for (const activity of selection.excluded)
    excluded.set(activity.reason, (excluded.get(activity.reason) ?? 0) + 1);
  const ok = report.ok && startGzipBytes <= budgetBytes;

  let writtenTo = options.outDir;
  if (!ok || options.dryRun) {
    // Never published: kept locally so the failure (or the dry run) can be looked at.
    rmSync(BUILD_FAILED_DIR, { recursive: true, force: true });
    mkdirSync(dirname(BUILD_FAILED_DIR), { recursive: true });
    renameSync(next, BUILD_FAILED_DIR);
    writtenTo = BUILD_FAILED_DIR;
  } else {
    const previous = `${options.outDir}.previous`;
    rmSync(previous, { recursive: true, force: true });
    mkdirSync(dirname(options.outDir), { recursive: true });
    if (existsSync(options.outDir)) renameSync(options.outDir, previous);
    renameSync(next, options.outDir);
    rmSync(previous, { recursive: true, force: true });
  }
  return {
    match,
    routesGrouped: grouped.routes.length,
    published: published.length,
    withTrack: published.filter((activity) => activity.fragments.length > 0).length,
    clipped: published.filter((activity) => activity.clipped).length,
    trackHidden: published.filter((activity) => activity.trackHidden && activity.hasGps).length,
    excluded,
    routes: files.has('routes.json')
      ? (JSON.parse(files.get('routes.json') ?? '{"routes":[]}') as { routes: unknown[] }).routes
          .length
      : 0,
    files: written,
    startGzipBytes,
    budgetBytes,
    audit: report,
    writtenTo,
    ok,
  };
};

/** The terrain settings as the raster-dem source the site adds to the map; null when off. */
const terrainSource = (terrain: SiteOptions['map']['terrain']): MetaFile['map']['terrain'] => {
  if (!terrain.enabled) return null;
  return {
    ...(terrain.sourceUrl ? { url: terrain.sourceUrl } : {}),
    ...(terrain.tiles ? { tiles: [terrain.tiles] } : {}),
    encoding: terrain.encoding,
    tileSize: terrain.tileSize,
    ...(terrain.maxzoom ? { maxzoom: terrain.maxzoom } : {}),
    ...(terrain.attribution ? { attribution: terrain.attribution } : {}),
  };
};

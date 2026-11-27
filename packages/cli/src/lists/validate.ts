import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PREFECTURE_CODES,
  catalogSchema,
  placesFileSchema,
  pointListFileSchema,
  routeListFileSchema,
} from '@jam/core';
import { z } from 'zod';

import { PrefectureIndex } from './prefecture-index.ts';
import { LISTS_DIR, loadPrefectureShapes } from './sources.ts';

/** An item is flagged when none of its prefectures is within this distance of its point. */
const PREFECTURE_TOLERANCE_M = 500;
const JAPAN = { minLon: 122, maxLon: 154, minLat: 20, maxLat: 46 };

interface ValidationReport {
  errors: string[];
  warnings: string[];
  summary: string[];
}

const prefectureFileSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      geometry: z.object({ type: z.enum(['Polygon', 'MultiPolygon']) }),
      properties: z.object({
        code: z.string(),
        ja: z.string(),
        en: z.string(),
        region: z.string(),
      }),
    }),
  ),
});
const creditsSchema = z.object({
  sources: z.array(z.object({ id: z.string(), attribution: z.string() })),
});

const readJson = (name: string): unknown => JSON.parse(readFileSync(join(LISTS_DIR, name), 'utf8'));

const issues = (error: z.ZodError): string =>
  error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

/** What a list file says about itself has to agree with the catalog. */
const checkHeader = (
  where: string,
  entry: { id: string; status: string; itemCount?: number | undefined },
  metadata: { id: string; status: string },
  count: number,
  errors: string[],
): void => {
  if (metadata.id !== entry.id)
    errors.push(`${where}: metadata id ${metadata.id} does not match the catalog.`);
  if (metadata.status !== entry.status) errors.push(`${where}: status differs from the catalog.`);
  if (entry.itemCount !== count)
    errors.push(`${where}: catalog says ${entry.itemCount} items, file has ${count}.`);
};

/** An item id is unique in its file and starts with its list's id. */
const checkItemId = (
  label: string,
  id: string,
  listId: string,
  seen: Set<string>,
  errors: string[],
): void => {
  if (seen.has(id)) errors.push(`${label}: duplicate id.`);
  seen.add(id);
  if (!id.startsWith(`${listId}-`)) errors.push(`${label}: id does not start with the list id.`);
};

export const validateLists = (): ValidationReport => {
  const report: ValidationReport = { errors: [], warnings: [], summary: [] };
  const { errors, warnings, summary } = report;

  if (!existsSync(join(LISTS_DIR, 'index.json'))) {
    errors.push('lists/index.json is missing. Run `jam lists build` first.');
    return report;
  }
  const catalog = catalogSchema.safeParse(readJson('index.json'));
  if (!catalog.success) {
    errors.push(`index.json: ${issues(catalog.error)}`);
    return report;
  }

  for (const name of ['prefectures.geojson', 'prefectures-detail.geojson']) {
    const file = prefectureFileSchema.safeParse(readJson(name));
    if (!file.success) {
      errors.push(`${name}: ${issues(file.error)}`);
      continue;
    }
    const codes = file.data.features.map((feature) => feature.properties.code);
    const missing = PREFECTURE_CODES.filter((code) => !codes.includes(code));
    if (codes.length !== 47 || missing.length > 0 || new Set(codes).size !== 47) {
      errors.push(
        `${name}: expected the 47 prefectures once each; missing ${missing.join(', ') || 'none'}.`,
      );
    }
  }

  const places = placesFileSchema.safeParse(readJson('places.geojson'));
  if (!places.success) {
    errors.push(`places.geojson: ${issues(places.error)}`);
    return report;
  }
  const placeById = new Map(
    places.data.features.map((feature) => [feature.properties.id, feature]),
  );
  if (placeById.size !== places.data.features.length)
    errors.push('places.geojson: duplicate place ids.');
  const referenced = new Set<string>();
  const index = new PrefectureIndex(loadPrefectureShapes('s0010'));
  const listIds = new Set(catalog.data.lists.map((entry) => entry.id));

  for (const entry of catalog.data.lists) {
    if (entry.status === 'blocked') {
      if (!entry.reason) errors.push(`${entry.id}: blocked without a reason.`);
      if (entry.file) errors.push(`${entry.id}: blocked but has a file.`);
      continue;
    }
    if (!entry.file) {
      errors.push(`${entry.id}: built list without a file.`);
      continue;
    }
    if (entry.kind === 'route') {
      validateRoutes(entry, report);
      continue;
    }
    if (entry.kind !== 'point') continue;
    const parsed = pointListFileSchema.safeParse(readJson(entry.file));
    if (!parsed.success) {
      errors.push(`${entry.file}: ${issues(parsed.error)}`);
      continue;
    }
    const { metadata, features } = parsed.data;
    const where = entry.file;
    checkHeader(where, entry, metadata, features.length, errors);
    const withCoordinates = features.filter((feature) => feature.geometry !== null).length;
    if (entry.withCoordinates !== withCoordinates)
      errors.push(`${where}: catalog coordinate count is wrong.`);
    if (metadata.expectedSize !== undefined && features.length !== metadata.expectedSize) {
      (metadata.status === 'ready' ? errors : warnings).push(
        `${where}: ${features.length} items, expected ${metadata.expectedSize}.`,
      );
    }
    if (metadata.status === 'ready' && withCoordinates !== features.length) {
      errors.push(`${where}: marked ready but some items have no coordinates.`);
    }
    if (
      metadata.status === 'partial' &&
      withCoordinates === features.length &&
      features.length === metadata.expectedSize
    ) {
      warnings.push(`${where}: marked partial but looks complete.`);
    }

    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const feature of features) {
      const item = feature.properties;
      const label = `${where} ${item.id}`;
      checkItemId(label, item.id, entry.id, ids, errors);
      if (orders.has(item.order)) errors.push(`${label}: duplicate order ${item.order}.`);
      orders.add(item.order);

      if (feature.geometry === null) {
        if (item.placeId !== null || item.coordinateSource !== null) {
          errors.push(`${label}: no geometry, so placeId and coordinateSource must be null.`);
        }
        if (!item.note) warnings.push(`${label}: no coordinates and no note saying why.`);
        continue;
      }
      const [lon, lat] = feature.geometry.coordinates;
      if (lon < JAPAN.minLon || lon > JAPAN.maxLon || lat < JAPAN.minLat || lat > JAPAN.maxLat) {
        errors.push(`${label}: coordinates ${lon}, ${lat} are outside Japan.`);
      }
      if (!item.placeId) {
        errors.push(`${label}: has geometry but no placeId.`);
        continue;
      }
      referenced.add(item.placeId);
      const place = placeById.get(item.placeId);
      if (!place) {
        errors.push(`${label}: place ${item.placeId} is not in places.geojson.`);
        continue;
      }
      if (!place.properties.lists.includes(entry.id))
        errors.push(`${label}: place ${place.properties.id} does not list ${entry.id}.`);
      const [plon, plat] = place.geometry.coordinates;
      if (plon !== lon || plat !== lat)
        errors.push(`${label}: coordinates differ from place ${place.properties.id}.`);
      if (item.prefectures.length === 0) {
        errors.push(`${label}: no prefectures.`);
      } else {
        const nearest = Math.min(
          ...item.prefectures.map((code) => index.distanceTo(code, feature.geometry!.coordinates)),
        );
        if (nearest > PREFECTURE_TOLERANCE_M && !item.note) {
          warnings.push(
            `${label}: ${Math.round(nearest)} m outside its prefectures (${item.prefectures.join(', ')}).`,
          );
        }
      }
    }
    summary.push(
      `${entry.id}: ${features.length}/${metadata.expectedSize ?? '?'} items, ${withCoordinates} with coordinates (${metadata.status})`,
    );
  }

  for (const place of places.data.features) {
    if (!referenced.has(place.properties.id))
      warnings.push(`places.geojson ${place.properties.id}: not used by any list.`);
    for (const list of place.properties.lists) {
      if (!listIds.has(list))
        errors.push(`places.geojson ${place.properties.id}: unknown list ${list}.`);
    }
  }

  if (!existsSync(join(LISTS_DIR, 'credits.json'))) {
    errors.push('credits.json is missing.');
  } else {
    const credits = creditsSchema.safeParse(readJson('credits.json'));
    if (!credits.success) errors.push(`credits.json: ${issues(credits.error)}`);
  }
  summary.push(`places: ${places.data.features.length}`);
  return report;
};

const inJapan = ([lon, lat]: [number, number]): boolean =>
  lon >= JAPAN.minLon && lon <= JAPAN.maxLon && lat >= JAPAN.minLat && lat <= JAPAN.maxLat;

const validateRoutes = (
  entry: { id: string; file?: string | undefined; status: string; itemCount?: number | undefined },
  { errors, warnings, summary }: ValidationReport,
): void => {
  if (!entry.file) return;
  const parsed = routeListFileSchema.safeParse(readJson(entry.file));
  if (!parsed.success) {
    errors.push(`${entry.file}: ${issues(parsed.error)}`);
    return;
  }
  const { metadata, features } = parsed.data;
  const where = entry.file;
  checkHeader(where, entry, metadata, features.length, errors);
  if (features.length === 0) errors.push(`${where}: no routes.`);
  const ids = new Set<string>();
  let km = 0;
  for (const feature of features) {
    const item = feature.properties;
    const label = `${where} ${item.id}`;
    checkItemId(label, item.id, entry.id, ids, errors);
    const lines =
      feature.geometry.type === 'LineString'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    const outside = lines.flat().filter((point) => !inJapan(point)).length;
    if (outside > 0) errors.push(`${label}: ${outside} points outside Japan.`);
    if (item.source === 'osm' && item.osmRelation === undefined)
      warnings.push(`${label}: from OpenStreetMap but no relation id.`);
    km += item.lengthKm;
  }
  summary.push(
    `${entry.id}: ${features.length} route item(s), ${Math.round(km)} km (${metadata.status})`,
  );
};

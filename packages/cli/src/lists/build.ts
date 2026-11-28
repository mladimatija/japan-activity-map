import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  type Catalog,
  type CatalogEntry,
  type ListItem,
  type ListMetadata,
  type MultiPolygonGeometry,
  type PlaceProperties,
  type PolygonGeometry,
  type Position,
  type RouteItem,
  type SourceRef,
  catalogSchema,
  placesFileSchema,
  pointListFileSchema,
  prefectureByJa,
  routeListFileSchema,
} from '@jam/core';

import { ROOT_DIR } from '../paths.ts';
import { MUNICIPALITIES_FILE } from './municipalities.ts';
import { type ListDefinition, LIST_DEFINITIONS } from './definitions.ts';
import { containsPoint, distanceM, distanceToOutlineM, roundPolygonal } from './geo.ts';
import { toGsiPlaces } from './gsi.ts';
import { romajiOf } from './names.ts';
import { collectionText, compareFile, jsonText, type WriteResult, writeText } from './output.ts';
import { loadOverrides } from './overrides.ts';
import {
  type PointContext,
  buildHighpoints,
  buildKongoList,
  buildPeaks3000,
  buildWikidataSet,
  buildCurated,
  buildWikipediaSet,
  buildYamanashi,
} from './points.ts';
import { PrefectureIndex } from './prefecture-index.ts';
import { Registry } from './registry.ts';
import { type Review, emptyReview, reviewText } from './review.ts';
import { type PostTownNaming, type RouteNaming, buildGpxRoute, buildOsmRoute } from './routes.ts';
import {
  LISTS_DIR,
  SOURCE_REFS,
  loadGsiList,
  loadPrefectureShapes,
  loadWikipediaSet,
  templeFile,
  wikipediaSetFile,
} from './sources.ts';

/** English names of the 四国八十八箇所 temples by number ("Ryōzen-ji"), when fetched. */
const shikokuTempleNames = (): Map<number, string> => {
  if (!existsSync(wikipediaSetFile('shikoku-88'))) return new Map();
  return new Map(
    loadWikipediaSet('shikoku-88').items.flatMap((item) =>
      item.en ? [[item.order, item.en.replace(/\s+Temple$/i, '')] as const] : [],
    ),
  );
};

const DISPLAY_DECIMALS = 5;
const DETAIL_DECIMALS = 6;
/** A route list with less than this share of its official length mapped is not built. */
const USABLE_SHARE = 0.5;
/** Below this share of its official length, a built route list is partial. */
const COMPLETE_SHARE = 0.9;
/** Islands the display outlines dropped are put back when they are at least this far from them. */
const ISLAND_GAP_M = 1000;
/** A place id from the previous build is reused for a place with the same name this close. */
const REUSE_M = 200;

const FOLDERS: Record<string, string> = {
  peaks: 'peaks',
  pilgrimage: 'pilgrimage',
  castles: 'castles',
  waterfalls: 'waterfalls',
  roads: 'roads',
};
const fileFor = (definition: ListDefinition) =>
  `${definition.kind === 'route' ? 'routes' : (FOLDERS[definition.theme] ?? 'points')}/${definition.id}.geojson`;

interface BuildSummary {
  files: { path: string; result: WriteResult | 'removed' }[];
  catalog: Catalog;
  review: Review;
}

interface PreviousPlace {
  id: string;
  ja: string;
  position: Position;
}

const loadPreviousPlaces = (): PreviousPlace[] => {
  const path = join(LISTS_DIR, 'places.geojson');
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    features?: {
      geometry?: { coordinates?: Position };
      properties?: { id?: string; name?: { ja?: string } };
    }[];
  };
  return (raw.features ?? []).flatMap((feature) => {
    const id = feature.properties?.id;
    const ja = feature.properties?.name?.ja;
    const position = feature.geometry?.coordinates;
    return id && ja && position ? [{ id, ja, position }] : [];
  });
};

type Outline = {
  type: 'Feature';
  geometry: PolygonGeometry | MultiPolygonGeometry;
  properties: { code: string; ja: string; en: string; region: string };
};

const outlines = (detail: 's0010' | 's0001', decimals: number): Outline[] =>
  loadPrefectureShapes(detail)
    .features.map((feature): Outline => {
      const prefecture = prefectureByJa(feature.properties.N03_001);
      if (!prefecture) throw new Error(`Unknown prefecture ${feature.properties.N03_001}`);
      return {
        type: 'Feature',
        geometry: roundPolygonal(feature.geometry, decimals),
        properties: {
          code: prefecture.code,
          ja: prefecture.ja,
          en: prefecture.en,
          region: prefecture.region,
        },
      };
    })
    .sort((a, b) => a.properties.code.localeCompare(b.properties.code));

/**
 * The simplified outlines drop small islands (飛島, 舳倉島, 南鳥島 and others). Each detailed
 * polygon that lies well away from the simplified shape is added back, rounded for display.
 */
const restoreIslands = (display: Outline, detail: Outline | undefined, review: Review): Outline => {
  if (!detail) return display;
  const polygons = (geometry: Outline['geometry']) =>
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const kept = polygons(display.geometry);
  const restored = polygons(detail.geometry).filter((polygon) => {
    const probe = polygon[0]?.[0];
    return (
      probe !== undefined &&
      !containsPoint(display.geometry, probe) &&
      distanceToOutlineM(display.geometry, probe) > ISLAND_GAP_M
    );
  });
  if (restored.length === 0) return display;
  review.islands.push(
    `${display.properties.en}: ${restored.length} ${restored.length === 1 ? 'island' : 'islands'} restored.`,
  );
  const geometry = roundPolygonal(
    { type: 'MultiPolygon', coordinates: [...kept, ...restored] } as MultiPolygonGeometry,
    DISPLAY_DECIMALS,
  );
  return { ...display, geometry };
};

export const buildLists = ({ dryRun }: { dryRun: boolean }): BuildSummary => {
  const review = emptyReview();
  const overrides = loadOverrides();
  const index = new PrefectureIndex(loadPrefectureShapes('s0010'));
  const gsiList = loadGsiList();
  const registry = new Registry();
  // Corrections to GSI's own prefecture column, from overrides.
  const gsi = toGsiPlaces(gsiList).map((place) => {
    const fixed = overrides.gsiPrefectures[String(place.serial)];
    if (!fixed) return place;
    review.prefectureChecks.push(
      `GSI ${place.serial} ${place.fullName}: prefectures corrected from ${place.prefectures.join(', ')} to ${fixed.join(', ')} (lists/overrides.jsonc).`,
    );
    return { ...place, prefectures: fixed.toSorted() };
  });
  const context: PointContext = {
    gsi,
    index,
    registry,
    review,
    overrides,
    usedNoteIds: new Set(),
    usedCoordinateIds: new Set(),
  };

  type Built =
    | { definition: ListDefinition; kind: 'point'; items: ListItem[]; sources: SourceRef[] }
    | {
        definition: ListDefinition;
        kind: 'route';
        items: RouteItem[];
        sources: SourceRef[];
        asOf?: string;
        missing?: number;
      }
    | { definition: ListDefinition; kind: 'blocked'; reason: string };
  const built: Built[] = [];
  const withGsi = (definition: ListDefinition) => [...definition.sources, ...gsiList.sources];

  const naming: RouteNaming = {
    context: { shikokuTemples: shikokuTempleNames() },
    overrides: overrides.routeNames,
    used: new Set(),
  };
  const postTownNaming: PostTownNaming = {
    overrides: overrides.postTownNames,
    used: new Set(),
    staged: new Set(),
  };
  for (const definition of LIST_DEFINITIONS) {
    const { builder } = definition;
    switch (builder.type) {
      case 'kongo':
        built.push({
          definition,
          kind: 'point',
          items: buildKongoList(context, definition, builder.file),
          sources: withGsi(definition),
        });
        break;
      case 'prefecture-highpoints':
        built.push({
          definition,
          kind: 'point',
          items: buildHighpoints(context, definition),
          sources: withGsi(definition),
        });
        break;
      case 'peaks-3000m':
        built.push({
          definition,
          kind: 'point',
          items: buildPeaks3000(context, definition),
          sources: withGsi(definition),
        });
        break;
      case 'yamanashi': {
        const items = buildYamanashi(context, definition);
        const usesOsm = items.some((item) => item.properties.coordinateSource === 'osm');
        built.push({
          definition,
          kind: 'point',
          items,
          sources: [...withGsi(definition), ...(usesOsm ? [SOURCE_REFS.osm] : [])],
        });
        break;
      }
      case 'wikidata':
        if (!existsSync(templeFile(builder.key))) {
          const reason = `Wikidata data not fetched yet. Run \`pnpm jam lists fetch wikidata\`, then build again.`;
          built.push({ definition, kind: 'blocked', reason });
          review.coordinates.push(`${definition.id}: not built. ${reason}`);
          break;
        }
        built.push({
          definition,
          kind: 'point',
          items: buildWikidataSet(context, definition, builder.key, builder.kind),
          sources: definition.sources,
        });
        break;
      case 'wikipedia-set':
        if (!existsSync(wikipediaSetFile(builder.key))) {
          const reason = `Wikipedia list not fetched yet. Run \`pnpm jam lists fetch wikipedia\`, then build again.`;
          built.push({ definition, kind: 'blocked', reason });
          review.coordinates.push(`${definition.id}: not built. ${reason}`);
          break;
        }
        built.push({
          definition,
          kind: 'point',
          items: buildWikipediaSet(context, definition, builder.key, builder.kind),
          sources: definition.sources,
        });
        break;
      case 'curated':
        built.push({
          definition,
          kind: 'point',
          items: buildCurated(context, definition, builder.folder, builder.file),
          sources: definition.sources,
        });
        break;
      case 'gpx-route': {
        const result = buildGpxRoute(index, review, definition, builder, postTownNaming);
        if ('blocked' in result) {
          built.push({ definition, kind: 'blocked', reason: result.blocked });
          review.routes.push(`${definition.id}: not built. ${result.blocked}`);
        } else {
          built.push({
            definition,
            kind: 'route',
            items: result.items,
            sources: definition.sources,
          });
        }
        break;
      }
      case 'osm-route': {
        const result = buildOsmRoute(
          index,
          review,
          definition,
          builder.route,
          builder.name,
          builder.exclude,
          builder.numeric ?? false,
          naming,
        );
        if ('blocked' in result) {
          const reason = builder.note ? `${result.blocked} ${builder.note}` : result.blocked;
          built.push({ definition, kind: 'blocked', reason });
          review.routes.push(`${definition.id}: not built. ${reason}`);
        } else if (
          definition.officialKm !== undefined &&
          result.items.reduce((sum, item) => sum + item.properties.lengthKm, 0) <
            definition.officialKm * USABLE_SHARE
        ) {
          const km = result.items.reduce((sum, item) => sum + item.properties.lengthKm, 0);
          const reason = `OpenStreetMap has only ${Math.round(km).toLocaleString('en')} km of the official ${definition.officialKm.toLocaleString('en')} km as route relations (data as of ${result.timestamp ?? 'unknown'}).`;
          built.push({ definition, kind: 'blocked', reason });
          review.routes.push(`${definition.id}: not built. ${reason}`);
        } else {
          built.push({
            definition,
            kind: 'route',
            items: result.items,
            sources: definition.sources,
            missing: result.missing.length,
            ...(result.timestamp ? { asOf: result.timestamp } : {}),
          });
          const km = result.items.reduce((sum, item) => sum + item.properties.lengthKm, 0);
          review.routes.push(
            `${definition.id}: ${result.items.length} relation(s), ${Math.round(km)} km, OpenStreetMap data as of ${result.timestamp ?? 'unknown'}.`,
          );
        }
        break;
      }
    }
  }
  for (const entry of built) {
    if (entry.kind === 'route' && entry.definition.builder.type === 'gpx-route') {
      const km = entry.items.reduce((sum, item) => sum + item.properties.lengthKm, 0);
      review.routes.push(
        `${entry.definition.id}: ${entry.items.length} item(s), ${Math.round(km)} km from the ${entry.definition.builder.source === 'gokaido' ? '五街道' : '環境省'} GPX tracks.`,
      );
    }
  }
  for (const id of Object.keys(overrides.itemNotes)) {
    if (!context.usedNoteIds.has(id))
      throw new Error(`overrides: itemNotes refers to unknown item ${id}`);
  }
  for (const relation of Object.keys(overrides.routeNames)) {
    if (!naming.used.has(relation))
      throw new Error(
        `overrides: routeNames refers to relation ${relation}, which no built route list has`,
      );
  }
  // Post-town names wait until every 五街道 is split into stages (its tracks and post towns are
  // fetched); a name none of them used is a mistake.
  const staged = LIST_DEFINITIONS.filter(
    (definition) => definition.builder.type === 'gpx-route' && definition.builder.stages,
  );
  if (staged.every((definition) => postTownNaming.staged.has(definition.id))) {
    for (const name of Object.keys(overrides.postTownNames)) {
      if (!postTownNaming.used.has(name))
        throw new Error(
          `overrides: postTownNames refers to ${name}, which is not a post town on any built 五街道 stage`,
        );
    }
  }
  // A list whose source is not fetched yet is not built; its corrections wait with it.
  const waiting = built.filter((list) => list.kind === 'blocked').map((list) => list.definition.id);
  const unused = (id: string) =>
    !context.usedCoordinateIds.has(id) && !waiting.some((list) => id.startsWith(`${list}-`));
  for (const id of Object.keys(overrides.itemNames)) {
    if (unused(id))
      throw new Error(
        `overrides: itemNames refers to ${id}, which is not an item of a Wikipedia list`,
      );
  }
  for (const id of Object.keys(overrides.itemCoordinates)) {
    if (unused(id))
      throw new Error(
        `overrides: itemCoordinates refers to ${id}, which is not an item of a list that reads them (山梨百名山 and the Wikipedia lists)`,
      );
  }

  // Keep place ids from the previous build when a source renumbers its rows.
  const previous = loadPreviousPlaces();
  const previousIds = new Set(previous.map((place) => place.id));
  const rename = new Map<string, string>();
  const taken = new Set(registry.places.keys());
  for (const place of registry.places.values()) {
    if (previousIds.has(place.id) || previous.length === 0) continue;
    const old = previous.find(
      (candidate) =>
        !taken.has(candidate.id) &&
        candidate.ja === place.ja &&
        distanceM(candidate.position, place.position) <= REUSE_M,
    );
    if (old) {
      rename.set(place.id, old.id);
      taken.add(old.id);
      review.idReuse.push(`${place.ja}: kept id ${old.id} instead of ${place.id}.`);
    }
  }
  const placeIdOf = (id: string) => rename.get(id) ?? id;

  const listOrder = LIST_DEFINITIONS.map((definition) => definition.id);
  const placeFeatures = [...registry.places.values()]
    .filter((place) => place.lists.size > 0)
    .map((place) => {
      const en = place.en ?? (place.kana ? romajiOf(place.kana) : place.ja);
      if (!place.en) review.romaji.push(`${place.ja} → ${en}`);
      const properties: PlaceProperties = {
        id: placeIdOf(place.id),
        kind: place.kind,
        name: { ja: place.ja, en, ...(place.kana ? { kana: place.kana } : {}) },
        ...(place.summit ? { summit: place.summit } : {}),
        ...(place.elevationM === undefined ? {} : { elevationM: place.elevationM }),
        prefectures: place.prefectures,
        coordinateSource: place.coordinateSource,
        ...(place.gsiSerial === undefined ? {} : { gsiSerial: place.gsiSerial }),
        ...(place.wikidata === undefined ? {} : { wikidata: place.wikidata }),
        lists: listOrder.filter((id) => place.lists.has(id)),
      };
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: place.position },
        properties,
      };
    })
    .sort((a, b) => a.properties.id.localeCompare(b.properties.id, 'en', { numeric: true }));
  placesFileSchema.parse({ type: 'FeatureCollection', features: placeFeatures });

  const files = new Map<string, string>();
  const catalogEntries: CatalogEntry[] = [];

  const detail = outlines('s0010', DETAIL_DECIMALS);
  const display = outlines('s0001', DISPLAY_DECIMALS).map((feature) =>
    restoreIslands(
      feature,
      detail.find((candidate) => candidate.properties.code === feature.properties.code),
      review,
    ),
  );
  files.set('prefectures.geojson', collectionText(display));
  files.set('prefectures-detail.geojson', collectionText(detail));
  catalogEntries.push({
    id: 'prefectures',
    title: { en: '47 prefectures', ja: '47都道府県' },
    kind: 'area',
    theme: 'areas',
    phase: 'first',
    status: display.length === 47 ? 'ready' : 'partial',
    expectedSize: 47,
    file: 'prefectures.geojson',
    itemCount: display.length,
  });
  files.set('places.geojson', collectionText(placeFeatures));

  const usedBy = new Map<string, { source: SourceRef; lists: Set<string> }>();
  const credit = (source: SourceRef, id: string) => {
    const entry = usedBy.get(source.id) ?? { source, lists: new Set<string>() };
    entry.lists.add(id);
    usedBy.set(source.id, entry);
  };
  credit(SOURCE_REFS.n03, 'prefectures');
  // The municipality list is made by the site build from the fetched outlines.
  if (existsSync(MUNICIPALITIES_FILE)) {
    credit(SOURCE_REFS.n03, 'municipalities');
    credit(SOURCE_REFS.cityNames, 'municipalities');
  }

  for (const entry of built) {
    const { definition } = entry;
    const base = {
      id: definition.id,
      title: definition.title,
      kind: definition.kind,
      theme: definition.theme,
      phase: definition.phase,
    };
    const expected =
      definition.expectedSize === undefined ? {} : { expectedSize: definition.expectedSize };
    if (entry.kind === 'blocked') {
      catalogEntries.push({ ...base, status: 'blocked', ...expected, reason: entry.reason });
      continue;
    }
    const sources = [...new Map(entry.sources.map((source) => [source.id, source])).values()];
    for (const source of sources) credit(source, definition.id);
    const file = fileFor(definition);
    let status: ListMetadata['status'];
    let withCoordinates: number | undefined;
    let reason: string | undefined;
    const sizeOk =
      definition.expectedSize === undefined || entry.items.length === definition.expectedSize;
    const metadata = (status: ListMetadata['status']): ListMetadata => ({
      id: definition.id,
      title: definition.title,
      kind: definition.kind,
      theme: definition.theme,
      phase: definition.phase,
      status,
      description:
        entry.kind === 'route' && entry.asOf
          ? `${definition.description} OpenStreetMap data as of ${entry.asOf}.`
          : definition.description,
      ...expected,
      ...(definition.countingRule ? { countingRule: definition.countingRule } : {}),
      sources,
    });
    if (entry.kind === 'point') {
      const items = entry.items.map((item) =>
        item.properties.placeId
          ? {
              ...item,
              properties: { ...item.properties, placeId: placeIdOf(item.properties.placeId) },
            }
          : item,
      );
      const missing = items.filter((item) => item.geometry === null);
      withCoordinates = items.length - missing.length;
      status = missing.length > 0 || !sizeOk ? 'partial' : 'ready';
      reason =
        missing.length > 0
          ? `No coordinates yet for: ${missing.map((item) => item.properties.name.ja).join(', ')}.`
          : sizeOk
            ? undefined
            : `Has ${items.length} of ${definition.expectedSize} items.`;
      const content = { type: 'FeatureCollection', metadata: metadata(status), features: items };
      pointListFileSchema.parse(content);
      files.set(file, collectionText(items, metadata(status)));
    } else {
      const missing = entry.missing ?? 0;
      const km = entry.items.reduce((sum, item) => sum + item.properties.lengthKm, 0);
      const short =
        definition.officialKm !== undefined && km < definition.officialKm * COMPLETE_SHARE;
      status = sizeOk && missing === 0 && !short ? 'ready' : 'partial';
      reason =
        missing > 0
          ? `${missing} matching OpenStreetMap relations are not fetched yet.`
          : !sizeOk
            ? `Has ${entry.items.length} of ${definition.expectedSize} items.`
            : short
              ? `Has ${Math.round(km).toLocaleString('en')} km of the official ${definition.officialKm?.toLocaleString('en')} km.`
              : undefined;
      routeListFileSchema.parse({
        type: 'FeatureCollection',
        metadata: metadata(status),
        features: entry.items,
      });
      files.set(file, collectionText(entry.items, metadata(status)));
    }
    catalogEntries.push({
      ...base,
      status,
      ...expected,
      file,
      itemCount: entry.items.length,
      ...(withCoordinates === undefined ? {} : { withCoordinates }),
      ...(reason ? { reason } : {}),
    });
  }

  const catalog = catalogSchema.parse({ schemaVersion: 1, lists: catalogEntries });
  files.set('index.json', jsonText(catalog));
  files.set(
    'credits.json',
    jsonText({
      sources: [...usedBy.values()].map(({ source, lists }) => ({ ...source, usedBy: [...lists] })),
    }),
  );
  files.set(
    'review.md',
    reviewText(review, [
      `GSI mountain list: edition ${gsiList.edition}.`,
      `${placeFeatures.length} places in ${built.filter((entry) => entry.kind !== 'blocked').length} built lists; ${built.filter((entry) => entry.kind === 'blocked').length} not built.`,
    ]),
  );

  const results: BuildSummary['files'] = [];
  for (const [name, text] of files) {
    const path = join(LISTS_DIR, name);
    const result = compareFile(path, text);
    if (!dryRun && result !== 'unchanged') writeText(path, text);
    results.push({ path: relative(ROOT_DIR, path), result });
  }
  // List files of lists that are no longer built (now blocked, or renamed) are generated, so
  // they go; anything else in these folders is left alone.
  for (const folder of new Set([...Object.values(FOLDERS), 'routes', 'points'])) {
    const dir = join(LISTS_DIR, folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.geojson') || files.has(`${folder}/${file}`)) continue;
      if (!dryRun) rmSync(join(dir, file));
      results.push({ path: relative(ROOT_DIR, join(dir, file)), result: 'removed' });
    }
  }
  return { files: results, catalog, review };
};

import { type Position, type RouteItem, prefectureByCode } from '@jam/core';

import type { ListDefinition } from './definitions.ts';
import { distanceM } from './geo.ts';
import { round } from './gsi.ts';
import type { PrefectureIndex } from './prefecture-index.ts';
import type { Review } from './review.ts';
import { type NameContext, type SourceName, numberDuplicates, routeNames } from './route-names.ts';
import {
  type OsmElement,
  gpxExists,
  gpxFiles,
  loadGpx,
  loadOsm,
  loadPostTowns,
} from './sources.ts';
import { chainOf, inOrder, project, slice } from './stages.ts';

/** Route coordinates keep 5 decimals (about 1 m). */
const ROUTE_DECIMALS = 5;
/** Prefectures are sampled at most this far apart along a line. */
const PREFECTURE_SAMPLE_M = 200;

type Line = [number, number][];

const cleanLine = (points: Position[]): Line => {
  const line: Line = [];
  for (const point of points) {
    const rounded = round(point, ROUTE_DECIMALS);
    const last = line.at(-1);
    if (!last || last[0] !== rounded[0] || last[1] !== rounded[1]) line.push(rounded);
  }
  return line;
};

const lengthKm = (lines: Line[]): number => {
  let metres = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (a && b) metres += distanceM(a, b);
    }
  }
  return Math.round(metres / 100) / 10;
};

const prefecturesAlong = (index: PrefectureIndex, lines: Line[]): string[] => {
  const codes = new Set<string>();
  for (const line of lines) {
    let since = Infinity;
    for (let i = 0; i < line.length; i++) {
      const point = line[i];
      if (!point) continue;
      const previous = line[i - 1];
      since += previous ? distanceM(previous, point) : 0;
      if (since < PREFECTURE_SAMPLE_M && i !== line.length - 1) continue;
      since = 0;
      const code = index.containing(point);
      if (code) codes.add(code);
    }
  }
  return [...codes].sort();
};

const geometryOf = (lines: Line[]): RouteItem['geometry'] => {
  const [only] = lines;
  return lines.length === 1 && only
    ? { type: 'LineString', coordinates: only }
    : { type: 'MultiLineString', coordinates: lines };
};

// --- GPX files ---------------------------------------------------------------------------------

export const buildGpxRoute = (
  index: PrefectureIndex,
  review: Review,
  definition: ListDefinition,
  builder: Extract<ListDefinition['builder'], { type: 'gpx-route' }>,
): { items: RouteItem[] } | { blocked: string } => {
  const files = builder.files === 'all' ? gpxFiles(builder.source) : builder.files;
  if (files.length === 0 || !files.every((file) => gpxExists(file, builder.source)))
    return {
      blocked: `GPX files not fetched yet. Run \`pnpm jam lists fetch ${builder.source}\`, then build again.`,
    };
  const loaded = files.map((file) => loadGpx(file, builder.source));
  const clean = (lines: Line[]) => lines.map(cleanLine).filter((line) => line.length >= 2);
  if (builder.stages) {
    const staged = buildStages(
      index,
      review,
      definition,
      builder,
      loaded.flatMap((gpx) => clean(gpx.lines)),
    );
    if (staged) return { items: staged };
  }
  const skip = builder.excludeTracks ? new RegExp(builder.excludeTracks) : undefined;
  const groups: { name?: string; lines: Line[] }[] =
    builder.split === 'track'
      ? loaded
          .flatMap((gpx) => gpx.tracks)
          .filter((track) => !(skip && track.name && skip.test(track.name)))
          .map((track) => ({ lines: clean(track.lines) }))
      : builder.split === 'file'
        ? loaded.map((gpx) => ({
            ...(gpx.name ? { name: gpx.name } : {}),
            lines: clean(gpx.lines),
          }))
        : [{ lines: loaded.flatMap((gpx) => clean(gpx.lines)) }];
  const kept = groups.filter(
    (group) => group.lines.length > 0 && prefecturesAlong(index, group.lines).length > 0,
  );
  const items = kept.map((group, i): RouteItem => {
    const order = i + 1;
    return {
      type: 'Feature',
      geometry: geometryOf(group.lines),
      properties: {
        id: `${definition.id}-${String(order).padStart(3, '0')}`,
        order,
        name: builder.split
          ? builder.trackNames
            ? endsName(index, group.lines, builder.trackNames)
            : {
                ja: `${builder.name.ja} ${group.name ?? order}`,
                en: `${builder.name.en} (${order})`,
              }
          : builder.name,
        lengthKm: lengthKm(group.lines),
        prefectures: prefecturesAlong(index, group.lines),
        source: builder.source,
        ...(builder.note && !builder.split ? { note: builder.note } : {}),
      },
    };
  });
  return { items };
};

/** "本線 東京都–大阪府": a label and the prefectures a line starts and ends in. */
const endsName = (
  index: PrefectureIndex,
  lines: Line[],
  label: { ja: string; en: string },
): { ja: string; en: string } => {
  const points = lines.flat();
  const first = points.map((point) => index.containing(point)).find(Boolean);
  const last = points
    .toReversed()
    .map((point) => index.containing(point))
    .find(Boolean);
  const named = [first, last].flatMap((code) => {
    const prefecture = code ? prefectureByCode(code) : undefined;
    return prefecture ? [prefecture] : [];
  });
  // In code order (east to west, roughly), whichever way the file runs.
  const [from, to] = named.toSorted((a, b) => a.code.localeCompare(b.code));
  if (!from) return label;
  const span = (key: 'ja' | 'en') =>
    to && to.code !== from.code ? `${from[key]}–${to[key]}` : from[key];
  return { ja: `${label.ja} ${span('ja')}`, en: `${label.en}, ${span('en')}` };
};

// --- Stages between post towns ------------------------------------------------------------------

/** Post towns further than this from the line are on another highway or a shared section. */
const ON_LINE_M = 1500;
/** Post towns closer together than this along the line are one stage boundary (合宿). */
const SAME_TOWN_M = 150;
/** A post town this close to an end of the line takes that end's place. */
const AT_END_M = 500;
/** Shorter stages are left out. */
const MIN_STAGE_KM = 0.3;
/** A stage whose ends are this many times further apart than its line is long has no line. */
const CROSSING_RATIO = 3;

interface Boundary {
  ja: string;
  en: string;
  alongM: number;
  /** Where the town is (or the end of the line), to tell a sea crossing from a short stage. */
  point: Position;
}

/** OpenStreetMap places named like the post towns (written by `lists fetch osm`). */
export const POST_TOWN_NODES = 'post-town-places.json';

/** The names a post town may have as a place: 芦野宿, 芦野宿跡, 芦野. */
export const townNames = (ja: string): string[] => {
  const base = ja.replace(/宿$/, '');
  return [...new Set([ja, `${ja}跡`, base])];
};

const looksLikeName = (ja: string) =>
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ja);

const buildStages = (
  index: PrefectureIndex,
  review: Review,
  definition: ListDefinition,
  builder: Extract<ListDefinition['builder'], { type: 'gpx-route' }>,
  lines: Line[],
): RouteItem[] | undefined => {
  const stages = builder.stages;
  if (!stages) return undefined;
  const towns = loadPostTowns(stages.towns);
  if (!towns) {
    review.routes.push(
      `${definition.id}: built whole. Its post towns are not fetched yet; run \`pnpm jam lists fetch wikipedia\` to split it into stages.`,
    );
    return undefined;
  }
  const chain = chainOf(lines);
  // Rows that are not post towns ("7" from another table) are skipped.
  const listed = towns.items.filter((town) => looksLikeName(town.ja));
  type Placed = {
    town: (typeof listed)[number];
    alongM: number;
    offM: number;
    point: Position;
    from: string;
  };
  const place = (town: (typeof listed)[number], point: Position, from: string): Placed => ({
    town,
    point,
    from,
    ...project(chain, point),
  });
  const onLine = listed.flatMap((town) => {
    const nearest = [
      ...(town.wikipedia
        ? [place(town, [town.wikipedia.lon, town.wikipedia.lat], 'wikipedia')]
        : []),
      ...(town.wikidata ? [place(town, [town.wikidata.lon, town.wikidata.lat], 'wikidata')] : []),
    ].sort((a, b) => a.offM - b.offM)[0];
    return nearest && nearest.offM <= ON_LINE_M ? [nearest] : [];
  });
  const { kept: ordered, dropped } = inOrder(onLine);

  // Towns with no usable position (none, off the line, or out of order): an OpenStreetMap place
  // of the same name, on the line between the towns either side of it.
  const places = new Map<string, Position[]>();
  for (const element of loadOsm(POST_TOWN_NODES)?.elements ?? []) {
    const name = element.tags.name;
    if (element.type !== 'node' || !name || element.lat === undefined || element.lon === undefined)
      continue;
    places.set(name, [...(places.get(name) ?? []), [element.lon, element.lat]]);
  }
  const kept = [...ordered];
  const fromOsm: Placed[] = [];
  for (const town of listed) {
    if (kept.some((entry) => entry.town === town)) continue;
    const before = kept.filter((entry) => entry.town.seq < town.seq).at(-1);
    const after = kept.find((entry) => entry.town.seq > town.seq);
    const fits = townNames(town.ja)
      .flatMap((name) => places.get(name) ?? [])
      .map((point) => place(town, point, 'osm'))
      .filter(
        (entry) =>
          entry.offM <= ON_LINE_M &&
          entry.alongM >= (before?.alongM ?? 0) &&
          entry.alongM <= (after?.alongM ?? chain.lengthM),
      )
      .sort((a, b) => a.offM - b.offM)[0];
    if (!fits) continue;
    kept.splice(after ? kept.indexOf(after) : kept.length, 0, fits);
    fromOsm.push(fits);
  }
  const placedTowns = new Set(kept.map((entry) => entry.town));
  const outOfOrder = dropped.filter((entry) => !placedTowns.has(entry.town));
  const elsewhere = listed.filter(
    (town) => !placedTowns.has(town) && !dropped.some((entry) => entry.town === town),
  );

  // Post towns at the same place (合宿, or articles shared by several) become one boundary.
  const groups: Placed[][] = [];
  for (const entry of kept) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    if (last && previous && entry.alongM - previous.alongM < SAME_TOWN_M) last.push(entry);
    else groups.push([entry]);
  }
  const boundaryOf = (group: Placed[]): Boundary => {
    const [first] = group;
    const articles = new Set(group.map((entry) => entry.town.article));
    const point = first?.point ?? [0, 0];
    if (group.length > 1 && articles.size === 1 && first?.town.article)
      return {
        ja: first.town.article,
        en: first.town.en ?? first.town.article,
        alongM: first.alongM,
        point,
      };
    return {
      ja: group.map((entry) => entry.town.ja).join('・'),
      en: group.map((entry) => entry.town.en ?? entry.town.ja).join(' / '),
      alongM: first?.alongM ?? 0,
      point,
    };
  };
  const inner = groups.map(boundaryOf);
  const firstPoint = lines[0]?.[0] ?? [0, 0];
  const lastPoint = lines.at(-1)?.at(-1) ?? [0, 0];
  const start: Boundary = { ...stages.start, alongM: 0, point: firstPoint };
  const end: Boundary = { ...stages.end, alongM: chain.lengthM, point: lastPoint };
  const firstInner = inner[0];
  if (firstInner && firstInner.alongM < AT_END_M) firstInner.alongM = 0;
  else inner.unshift(start);
  const lastInner = inner.at(-1);
  if (lastInner && lastInner !== inner[0] && chain.lengthM - lastInner.alongM < AT_END_M)
    lastInner.alongM = chain.lengthM;
  else inner.push(end);

  // Where one GPX file ends and the next begins (東海道's sea crossing).
  const gaps = chain.at.slice(0, -1).map((at) => at.at(-1) ?? 0);
  const items: RouteItem[] = [];
  const short: string[] = [];
  const crossings: string[] = [];
  for (let i = 1; i < inner.length; i++) {
    const from = inner[i - 1] as Boundary;
    const to = inner[i] as Boundary;
    const parts = slice(chain, from.alongM, to.alongM);
    const km = lengthKm(parts);
    // A stage across a gap has only the stubs either side of it: much shorter than the
    // distance between its two towns.
    if (
      gaps.some((gap) => gap >= from.alongM && gap <= to.alongM) &&
      distanceM(from.point, to.point) > km * 1000 * CROSSING_RATIO
    ) {
      crossings.push(`${from.ja}–${to.ja}`);
      continue;
    }
    const prefectures = prefecturesAlong(index, parts);
    if (km < MIN_STAGE_KM || prefectures.length === 0) {
      short.push(`${from.ja}–${to.ja}`);
      continue;
    }
    const order = items.length + 1;
    items.push({
      type: 'Feature',
      geometry: geometryOf(parts),
      properties: {
        id: `${definition.id}-${String(order).padStart(3, '0')}`,
        order,
        name: { ja: `${from.ja}–${to.ja}`, en: `${from.en} – ${to.en}` },
        lengthKm: km,
        prefectures,
        source: builder.source,
      },
    });
  }
  const names = (entries: { ja: string }[]) =>
    entries
      .slice(0, 8)
      .map((entry) => entry.ja)
      .join(', ') + (entries.length > 8 ? ', …' : '');
  review.routes.push(
    `${definition.id}: ${items.length} stages between ${groups.length} post towns from ${towns.page}.` +
      (fromOsm.length > 0
        ? ` Placed from OpenStreetMap (no usable position in the article): ${names(fromOsm.map((entry) => entry.town))}.`
        : '') +
      (elsewhere.length > 0
        ? ` ${elsewhere.length} not on this line (shared section, or no position found): ${names(elsewhere)}.`
        : '') +
      (outOfOrder.length > 0
        ? ` Left out as out of order (check their coordinates): ${names(outOfOrder.map((entry) => entry.town))}.`
        : '') +
      (short.length > 0 ? ` Left out as too short: ${short.join(', ')}.` : '') +
      (crossings.length > 0
        ? ` Left out as a crossing with no line (by sea): ${crossings.join(', ')}.`
        : ''),
  );
  return items;
};

// --- OpenStreetMap -----------------------------------------------------------------------------

export const ROUTES_INDEX = 'routes-index.json';
export const relationFile = (id: number) => `relation-${id}.json`;

const ROUTE_TAGS: Record<'bicycle' | 'hiking', string[]> = {
  bicycle: ['bicycle'],
  hiking: ['hiking', 'foot', 'walking'],
};

/** Relations in the fetched index that belong to a list. */
export const matchingRelations = (
  elements: readonly OsmElement[],
  route: 'bicycle' | 'hiking',
  pattern: string,
  exclude?: string,
): OsmElement[] => {
  const regex = new RegExp(pattern, 'i');
  const skip = exclude ? new RegExp(exclude, 'i') : undefined;
  const names = (element: OsmElement) =>
    [element.tags.name, element.tags['name:ja'], element.tags['name:en']].filter(
      (name): name is string => name !== undefined,
    );
  return elements.filter(
    (element) =>
      element.type === 'relation' &&
      ROUTE_TAGS[route].includes(element.tags.route ?? '') &&
      names(element).some((name) => regex.test(name)) &&
      !(skip && names(element).some((name) => skip.test(name))),
  );
};

/** How route items get their display names. */
export interface RouteNaming {
  context: NameContext;
  /** Hand corrections keyed by OpenStreetMap relation id (lists/overrides.jsonc). */
  overrides: Record<string, { ja?: string; en?: string }>;
  /** Relation ids whose correction was used, to report unknown ones. */
  used: Set<string>;
}

type OsmRouteResult =
  | { items: RouteItem[]; timestamp?: string; missing: number[] }
  | { blocked: string };

const refNumber = (element: OsmElement) => Number.parseFloat(element.tags.ref ?? '') || Infinity;

export const buildOsmRoute = (
  index: PrefectureIndex,
  review: Review,
  definition: ListDefinition,
  route: 'bicycle' | 'hiking',
  pattern: string,
  exclude: string | undefined,
  /** Order stages without a ref by the numbers in their names (1, 2, … 10), not as text. */
  numeric: boolean,
  naming: RouteNaming,
): OsmRouteResult => {
  const routesIndex = loadOsm(ROUTES_INDEX);
  if (!routesIndex)
    return {
      blocked: 'OpenStreetMap data not fetched yet. Run `pnpm jam lists fetch`, then build again.',
    };
  const timestamp = routesIndex.osm3s?.timestamp_osm_base;
  const matched = matchingRelations(routesIndex.elements, route, pattern, exclude);
  if (matched.length === 0) {
    return {
      blocked: `No OpenStreetMap route relation matches /${pattern}/ (data as of ${timestamp ?? 'unknown'}).`,
    };
  }

  // Each matched relation was fetched with its child relations; a route split into stages
  // becomes one item per stage.
  const leaves = new Map<number, OsmElement>();
  const missing: number[] = [];
  for (const top of matched) {
    const data = loadOsm(relationFile(top.id));
    if (!data) {
      missing.push(top.id);
      continue;
    }
    const byId = new Map(
      data.elements
        .filter((element) => element.type === 'relation')
        .map((element) => [element.id, element]),
    );
    const visit = (relation: OsmElement, depth: number) => {
      const children = (relation.members ?? [])
        .filter((member) => member.type === 'relation')
        .map((member) => byId.get(member.ref))
        .filter((child): child is OsmElement => child !== undefined);
      const hasWays = (relation.members ?? []).some((member) => member.type === 'way');
      if (children.length > 0 && !hasWays && depth < 3)
        for (const child of children) visit(child, depth + 1);
      else leaves.set(relation.id, relation);
    };
    const root = byId.get(top.id);
    if (root) visit(root, 0);
  }

  const ordered = [...leaves.values()].sort(
    (a, b) =>
      refNumber(a) - refNumber(b) ||
      (a.tags.name ?? '').localeCompare(b.tags.name ?? '', 'ja', { numeric }),
  );
  const items: RouteItem[] = [];
  const sourceNames: SourceName[] = [];
  for (const relation of ordered) {
    const seen = new Set<number>();
    const lines: Line[] = [];
    for (const member of relation.members ?? []) {
      if (member.type !== 'way' || seen.has(member.ref) || !member.geometry) continue;
      seen.add(member.ref);
      const points = member.geometry
        .filter((point) => point !== null)
        .map((point): Position => [point.lon, point.lat]);
      const line = cleanLine(points);
      if (line.length >= 2) lines.push(line);
    }
    if (lines.length === 0) {
      review.routes.push(
        `${definition.id}: relation ${relation.id} (${relation.tags.name ?? 'no name'}) has no way geometry; skipped.`,
      );
      continue;
    }
    const prefectures = prefecturesAlong(index, lines);
    if (prefectures.length === 0) continue;
    const order = items.length + 1;
    sourceNames.push({
      ja: relation.tags['name:ja'] ?? relation.tags.name ?? definition.title.ja,
      ...(relation.tags['name:en'] ? { en: relation.tags['name:en'] } : {}),
    });
    items.push({
      type: 'Feature',
      geometry: geometryOf(lines),
      properties: {
        id: `${definition.id}-${String(order).padStart(3, '0')}`,
        order,
        name: definition.title,
        lengthKm: lengthKm(lines),
        prefectures,
        source: 'osm',
        osmRelation: relation.id,
      },
    });
  }
  if (missing.length > 0) {
    review.routes.push(
      `${definition.id}: ${missing.length} of ${matched.length} matching relations have no geometry yet (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}). Run \`pnpm jam lists fetch osm\` again.`,
    );
  }
  if (items.length === 0) {
    return {
      blocked:
        missing.length > 0
          ? `Geometry for the ${missing.length} matching OpenStreetMap relations is not fetched yet. Run \`pnpm jam lists fetch osm\`.`
          : 'The matching OpenStreetMap relations have no usable geometry.',
    };
  }
  // Display names: cleaned by rule, then hand corrections by relation id, then numbered where
  // several stages still share a name.
  const cleaned = routeNames(definition, sourceNames, naming.context).map((name, i) => {
    const relation = String(items[i]?.properties.osmRelation ?? '');
    const fixed = naming.overrides[relation];
    if (!fixed) return name;
    naming.used.add(relation);
    return { ja: fixed.ja ?? name.ja, en: fixed.en ?? name.en };
  });
  numberDuplicates(cleaned).forEach((name, i) => {
    const item = items[i];
    if (item) item.properties.name = name;
  });
  return { items, missing, ...(timestamp ? { timestamp } : {}) };
};

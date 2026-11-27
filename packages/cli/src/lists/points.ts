import { PREFECTURES, prefectureByCode, type ListItem, type Position } from '@jam/core';

import type { ListDefinition } from './definitions.ts';
import { distanceM } from './geo.ts';
import { type GsiPlace, gsiItemName, round } from './gsi.ts';
import { namesOverlap, romajiOf, stripAlternatives } from './names.ts';
import type { Overrides } from './overrides.ts';
import type { PrefectureIndex } from './prefecture-index.ts';
import type { PlaceDraft, Registry } from './registry.ts';
import type { Review } from './review.ts';
import {
  type KongoFile,
  type KongoItem,
  type OsmElement,
  loadCurated,
  loadHighpoints,
  loadKongo,
  loadOsm,
  loadSambyakuNumbers,
  loadTemples,
  loadWikipediaSet,
  loadYamanashi,
} from './sources.ts';

/** A list item matches a GSI place within this distance... */
const MATCH_RADIUS_M = 1000;
/** ...when the heights differ by at most this much. */
const MATCH_ELEVATION_M = 10;
/** A point is questioned when it is this far outside every prefecture it is listed in... */
const PREFECTURE_WARN_M = 500;
/** ...or this far outside any one of them. */
const PREFECTURE_FAR_M = 3000;
/** Points without GSI prefectures also count neighbours whose border is this close. */
const BORDER_M = 300;
/** Places from other sources with the same name this close are one place. */
const SAME_PLACE_M = 200;
/** GSI rows left out of the 21-peak count: 荒川前岳 and 農鳥岳 (east summit). */
const EXCLUDED_FROM_3000M = new Set([616, 595]);
const YAMANASHI = '19';

export interface PointContext {
  gsi: GsiPlace[];
  index: PrefectureIndex;
  registry: Registry;
  review: Review;
  overrides: Overrides;
  usedNoteIds: Set<string>;
  usedCoordinateIds: Set<string>;
}

const pad = (n: number, width = 3) => String(n).padStart(width, '0');
const decimals = (n: number) => String(n).split('.')[1]?.length ?? 0;

const finishItem = (context: PointContext, item: ListItem): ListItem => {
  const note = context.overrides.itemNotes[item.properties.id];
  if (!note) return item;
  context.usedNoteIds.add(item.properties.id);
  return { ...item, properties: { ...item.properties, note } };
};

const pointItem = (
  listId: string,
  order: number,
  place: PlaceDraft | undefined,
  properties: Omit<
    ListItem['properties'],
    'id' | 'order' | 'placeId' | 'coordinateSource' | 'prefectures'
  > & {
    prefectures?: string[];
    id?: string;
  },
): ListItem => {
  const { id, prefectures, ...rest } = properties;
  place?.lists.add(listId);
  return {
    type: 'Feature',
    geometry: place ? { type: 'Point', coordinates: place.position } : null,
    properties: {
      id: id ?? `${listId}-${pad(order)}`,
      placeId: place?.id ?? null,
      order,
      ...rest,
      prefectures: prefectures ?? place?.prefectures ?? [],
      coordinateSource: place?.coordinateSource ?? null,
    },
  };
};

/** GSI's prefectures are trusted, but checked against the outlines once per place. */
const checkGsiPrefectures = (
  context: PointContext,
  place: GsiPlace,
  checked: Set<number>,
): void => {
  if (checked.has(place.serial)) return;
  checked.add(place.serial);
  const distances = place.prefectures.map((code) => ({
    code,
    distance: context.index.distanceTo(code, place.position),
  }));
  const nearest = Math.min(...distances.map((entry) => entry.distance));
  for (const { code, distance } of distances) {
    if (nearest > PREFECTURE_WARN_M || distance > PREFECTURE_FAR_M) {
      context.review.prefectureChecks.push(
        `GSI ${place.serial} ${place.fullName}: listed in ${prefectureByCode(code)?.en}, but the point is ${Math.round(distance)} m outside it.`,
      );
    }
  }
};
const checkedSerials = new Set<number>();

type Match =
  | { kind: 'match'; place: GsiPlace; distance: number; by: 'name' | 'elevation' }
  | { kind: 'other-point'; place: GsiPlace; distance: number }
  | { kind: 'none'; nearest?: { place: GsiPlace; distance: number } };

const matchGsi = (
  gsi: readonly GsiPlace[],
  name: string,
  elevationM: number,
  position: Position,
): Match => {
  const all = gsi.map((place) => ({ place, distance: distanceM(position, place.position) }));
  const near = all
    .filter((candidate) => candidate.distance <= MATCH_RADIUS_M)
    .sort((a, b) => a.distance - b.distance);
  const sameHeight = (candidate: { place: GsiPlace }) =>
    Math.abs(candidate.place.elevationM - elevationM) <= MATCH_ELEVATION_M;
  const sameName = (candidate: { place: GsiPlace }) => namesOverlap(name, candidate.place.fullName);
  const both = near.find((candidate) => sameName(candidate) && sameHeight(candidate));
  if (both) return { kind: 'match', ...both, by: 'name' };
  const height = near.find(sameHeight);
  if (height) return { kind: 'match', ...height, by: 'elevation' };
  const named = near.find(sameName);
  if (named) return { kind: 'other-point', ...named };
  const nearest = all.reduce<{ place: GsiPlace; distance: number } | undefined>(
    (best, candidate) => (!best || candidate.distance < best.distance ? candidate : best),
    undefined,
  );
  return nearest ? { kind: 'none', nearest } : { kind: 'none' };
};

// --- kongo lists -------------------------------------------------------------------------------

export const buildKongoList = (
  context: PointContext,
  definition: ListDefinition,
  file: KongoFile,
): ListItem[] => {
  const { registry, review, index } = context;
  const sambyakuNumbers = file === 'sambyakumeizan' ? loadSambyakuNumbers() : undefined;
  const placeUse = new Map<string, number[]>();
  const items = loadKongo(file).map((entry: KongoItem) => {
    const position: Position = [entry.longitude, entry.latitude];
    const match = matchGsi(context.gsi, entry.name, entry.elevation, position);
    let place: PlaceDraft;
    if (match.kind === 'match') {
      place = registry.forGsi(match.place);
      checkGsiPrefectures(context, match.place, checkedSerials);
      place.en ??= entry.nameEn;
    } else {
      place = registry.external(
        {
          id: `ext-${definition.id}-${pad(entry.no)}`,
          kind: 'peak',
          position: round(position),
          ja: stripAlternatives(entry.name) || entry.name,
          en: entry.nameEn,
          ...(entry.kanaName ? { kana: entry.kanaName } : {}),
          elevationM: entry.elevation,
          prefectures: index.around(position, BORDER_M),
          coordinateSource: 'kongo',
        },
        SAME_PLACE_M,
      );
      const label = `${definition.id} #${entry.no} ${entry.name} (${entry.elevation} m)`;
      if (match.kind === 'other-point') {
        review.otherPoint.push(
          `${label}: GSI's ${match.place.fullName} (${match.place.elevationM} m) is ${Math.round(match.distance)} m away.`,
        );
      } else {
        const nearest = match.nearest
          ? ` Nearest GSI place: ${match.nearest.place.fullName} (${match.nearest.place.elevationM} m), ${Math.round(match.nearest.distance)} m away.`
          : '';
        review.fallbacks.push(`${label}.${nearest}`);
      }
      if (place.prefectures.length === 0)
        review.prefectureChecks.push(`${label}: no prefecture at its coordinates.`);
    }
    placeUse.set(place.id, [...(placeUse.get(place.id) ?? []), entry.no]);

    let sourceNumber: number | undefined;
    if (sambyakuNumbers) {
      sourceNumber =
        entry.yamapLandmarkId === undefined
          ? undefined
          : sambyakuNumbers.get(entry.yamapLandmarkId);
      if (sourceNumber === undefined)
        review.numbering.push(
          `${definition.id} #${entry.no} ${entry.name}: no number in the 300 Meizan source.`,
        );
    }
    return finishItem(
      context,
      pointItem(definition.id, entry.no, place, {
        ...(sourceNumber === undefined ? {} : { sourceNumber }),
        name: {
          ja: entry.name,
          en: entry.nameEn,
          ...(entry.kanaName ? { kana: entry.kanaName } : {}),
        },
        ...(place.elevationM === undefined ? {} : { elevationM: place.elevationM }),
      }),
    );
  });
  for (const [placeId, numbers] of placeUse) {
    if (numbers.length > 1)
      review.sharedPlaces.push(
        `${definition.id}: items ${numbers.map((n) => `#${n}`).join(', ')} share place ${placeId}.`,
      );
  }
  return items;
};

// --- Prefectural high points -------------------------------------------------------------------

export const buildHighpoints = (context: PointContext, definition: ListDefinition): ListItem[] => {
  const { registry, review, overrides } = context;
  const table = loadHighpoints();
  return table.items.map((row, i) => {
    const prefecture = PREFECTURES[i];
    if (!prefecture || prefecture.ja !== row.prefecture) {
      throw new Error(
        `GSI high points: row ${i + 1} is ${row.prefecture}, expected ${prefecture?.ja}`,
      );
    }
    const override = overrides.prefectureHighpoints[prefecture.code];
    const position = round([row.lon, row.lat]);
    const gsi = context.gsi.find(
      (candidate) =>
        distanceM(candidate.position, position) <= 150 &&
        Math.abs(candidate.elevationM - row.elevationM) <= 3,
    );
    let place: PlaceDraft;
    let name: { ja: string; en: string; kana?: string };
    if (gsi) {
      place = registry.forGsi(gsi);
      checkGsiPrefectures(context, gsi, checkedSerials);
      name = gsiItemName(gsi);
    } else {
      const named = row.kana !== undefined;
      const en = override?.en ?? (row.kana ? romajiOf(row.kana) : undefined);
      if (!en)
        throw new Error(`overrides: the high point of ${prefecture.en} needs an English name`);
      name = { ja: row.name, en, ...(row.kana ? { kana: row.kana } : {}) };
      place = registry.external(
        {
          id: `highpoint-${prefecture.code}`,
          kind: named ? 'peak' : 'point',
          position,
          ja: row.name,
          en,
          ...(row.kana ? { kana: row.kana } : {}),
          elevationM: row.elevationM,
          prefectures: [prefecture.code],
          coordinateSource: 'gsi',
        },
        0,
      );
      review.highpoints.push(
        `${prefecture.en}: ${row.name} (${row.elevationM} m)${override?.note ? `. ${override.note}` : ''}`,
      );
    }
    return finishItem(
      context,
      pointItem(definition.id, Number(prefecture.code), place, {
        id: `${definition.id}-${prefecture.code}`,
        name,
        elevationM: row.elevationM,
        prefectures: [prefecture.code],
        ...(override?.note ? { note: override.note } : {}),
      }),
    );
  });
};

// --- 3,000 m peaks -----------------------------------------------------------------------------

export const buildPeaks3000 = (context: PointContext, definition: ListDefinition): ListItem[] =>
  context.gsi
    .filter((place) => place.elevationM >= 3000 && !EXCLUDED_FROM_3000M.has(place.serial))
    .sort((a, b) => b.elevationM - a.elevationM || a.serial - b.serial)
    .map((gsi, i) => {
      checkGsiPrefectures(context, gsi, checkedSerials);
      const place = context.registry.forGsi(gsi);
      return finishItem(
        context,
        pointItem(definition.id, i + 1, place, {
          name: gsiItemName(gsi),
          elevationM: gsi.elevationM,
        }),
      );
    });

// --- 山梨百名山 -----------------------------------------------------------------------------------

const osmPeakName = (element: OsmElement): string | undefined =>
  element.tags['name:ja'] ?? element.tags.name;

export const buildYamanashi = (context: PointContext, definition: ListDefinition): ListItem[] => {
  const { registry, review, index } = context;
  const source = loadYamanashi();
  const osmPeaks = (loadOsm('yamanashi-peaks.json')?.elements ?? []).filter(
    (element) => element.type === 'node' && element.lat !== undefined && element.lon !== undefined,
  );
  if (osmPeaks.length === 0)
    review.coordinates.push(
      'yamanashi-hyakumeizan: no OpenStreetMap peaks fetched yet; run `pnpm jam lists fetch`.',
    );
  const nearYamanashi = (position: Position, metres: number) =>
    index.distanceTo(YAMANASHI, position) <= metres;

  return source.items.map((entry) => {
    const label = `yamanashi-hyakumeizan #${entry.no} ${entry.name} (${entry.elevationM} m)`;
    const kana = stripAlternatives(entry.kana);
    const fixed = context.overrides.itemCoordinates[`${definition.id}-${pad(entry.no)}`];
    if (fixed) {
      context.usedCoordinateIds.add(`${definition.id}-${pad(entry.no)}`);
      const position: Position = [fixed.lon, fixed.lat];
      const elevationM = fixed.elevationM ?? entry.elevationM;
      const place = registry.external(
        {
          id: `ext-${definition.id}-${pad(entry.no)}`,
          kind: 'peak',
          position: round(position),
          ja: entry.name,
          en: romajiOf(kana),
          kana,
          elevationM,
          prefectures: index.around(position, BORDER_M),
          coordinateSource: 'override',
        },
        SAME_PLACE_M,
      );
      review.coordinates.push(
        `${label}: placed by hand${fixed.elevationM ? ` at ${fixed.elevationM} m` : ''} (lists/overrides.jsonc).`,
      );
      return finishItem(
        context,
        pointItem(definition.id, entry.no, place, {
          name: { ja: entry.name, en: romajiOf(kana), kana },
          elevationM,
          note: fixed.note,
        }),
      );
    }
    const wiki: Position | undefined =
      entry.lat !== undefined && entry.lon !== undefined ? [entry.lon, entry.lat] : undefined;
    const wikiPrecise =
      wiki !== undefined &&
      entry.lat !== undefined &&
      entry.lon !== undefined &&
      decimals(entry.lat) >= 3 &&
      decimals(entry.lon) >= 3;
    // A rounded article position (to 0.1°) is only a rough hint, so search further around it.
    const wikiRadius = wikiPrecise ? 5000 : 15000;
    const byCloseness = <T extends { position: Position; height: number }>(candidates: T[]) =>
      candidates.sort((a, b) =>
        wiki
          ? distanceM(a.position, wiki) - distanceM(b.position, wiki)
          : Math.abs(a.height - entry.elevationM) - Math.abs(b.height - entry.elevationM),
      )[0];

    let place: PlaceDraft | undefined;
    let note: string | undefined;
    const gsi = byCloseness(
      context.gsi
        .filter(
          (candidate) =>
            (namesOverlap(entry.name, candidate.fullName) ||
              stripAlternatives(candidate.kanaMain) === kana) &&
            Math.abs(candidate.elevationM - entry.elevationM) <= 15 &&
            (candidate.prefectures.includes(YAMANASHI) ||
              nearYamanashi(candidate.position, 2000)) &&
            (!wiki || distanceM(candidate.position, wiki) <= wikiRadius),
        )
        .map((candidate) => ({
          candidate,
          position: candidate.position,
          height: candidate.elevationM,
        })),
    )?.candidate;
    if (gsi) {
      place = registry.forGsi(gsi);
      checkGsiPrefectures(context, gsi, checkedSerials);
    } else {
      const osm = byCloseness(
        osmPeaks
          .filter((element) => {
            const name = osmPeakName(element);
            if (!name || !namesOverlap(entry.name, name)) return false;
            const ele = Number.parseFloat(element.tags.ele ?? '');
            const position: Position = [element.lon ?? 0, element.lat ?? 0];
            return (
              // Heights in OSM vary; allow more when the name is exactly the same.
              (Number.isNaN(ele) ||
                Math.abs(ele - entry.elevationM) <= (name === entry.name ? 40 : 20)) &&
              nearYamanashi(position, 2000) &&
              (!wiki || distanceM(position, wiki) <= wikiRadius)
            );
          })
          .map((element) => ({
            element,
            position: [element.lon ?? 0, element.lat ?? 0] as Position,
            height: Number.parseFloat(element.tags.ele ?? '') || entry.elevationM,
          })),
      );
      const position: Position | undefined = osm?.position ?? (wikiPrecise ? wiki : undefined);
      if (position) {
        const coordinateSource = osm ? 'osm' : 'wikipedia';
        place = registry.external(
          {
            id: `ext-${definition.id}-${pad(entry.no)}`,
            kind: 'peak',
            position: round(position),
            ja: entry.name,
            en: romajiOf(kana),
            kana,
            elevationM: entry.elevationM,
            prefectures: index.around(position, BORDER_M),
            coordinateSource,
          },
          SAME_PLACE_M,
        );
        if (osm) {
          review.coordinates.push(
            `${label}: OpenStreetMap node ${osm.element.id} (${osmPeakName(osm.element)}).`,
          );
        } else {
          const castle =
            entry.article && entry.article !== entry.name && entry.article.endsWith('城');
          if (castle)
            note = `Placed at the coordinates of the article on ${entry.article}, the castle on the summit.`;
          review.coordinates.push(
            `${label}: Wikipedia article ${entry.article}${castle ? ' (a castle on the summit)' : ''}.`,
          );
        }
      } else {
        note =
          osmPeaks.length > 0
            ? `No coordinates yet: no match in GSI's list or OpenStreetMap, and the Wikipedia article gives ${wiki ? 'only a rounded position' : 'none'}.`
            : `No coordinates yet: not in GSI's list, and the Wikipedia article gives ${wiki ? 'only a rounded position' : 'none'}. OpenStreetMap peaks from \`jam lists fetch\` may place it.`;
        review.coordinates.push(
          `${label}: no coordinates${wiki ? ' (Wikipedia gives only a rounded position)' : ''}.`,
        );
      }
    }
    return finishItem(
      context,
      pointItem(definition.id, entry.no, place, {
        name: { ja: entry.name, en: romajiOf(kana), kana },
        elevationM: entry.elevationM,
        ...(place ? {} : { prefectures: [YAMANASHI] }),
        ...(note ? { note } : {}),
      }),
    );
  });
};

// --- Temples -----------------------------------------------------------------------------------

export const buildWikidataSet = (
  context: PointContext,
  definition: ListDefinition,
  key: string,
  kind: 'temple' | 'castle',
): ListItem[] => {
  const { registry, review, index } = context;
  const source = loadTemples(key);
  return source.items.map((entry) => {
    const ja = entry.ja.replace(/\s*\([^)]*\)$/, '');
    // romajiOf reads kana only; a kanji name with no English label keeps its Japanese form.
    const en = entry.en ?? (romajiOf(ja) || ja);
    let place: PlaceDraft | undefined;
    if (entry.lon !== undefined && entry.lat !== undefined) {
      const position: Position = [entry.lon, entry.lat];
      const prefectures = index.around(position, 100);
      if (prefectures.length === 0)
        review.prefectureChecks.push(
          `${definition.id} #${entry.order} ${ja}: no prefecture at its coordinates; left unplaced.`,
        );
      else
        place = registry.external(
          {
            id: `${kind}-${entry.qid.toLowerCase()}`,
            kind,
            position: round(position),
            ja,
            en,
            prefectures,
            coordinateSource: 'wikidata',
            wikidata: entry.qid,
          },
          0,
        );
    } else {
      review.coordinates.push(
        `${definition.id} #${entry.order} ${ja}: no coordinates on Wikidata (${entry.qid}).`,
      );
    }
    return finishItem(context, pointItem(definition.id, entry.order, place, { name: { ja, en } }));
  });
};

// --- Wikipedia list articles -------------------------------------------------------------------

/** Within this of a prefecture outline, a point is taken as on land. */
const ON_LAND_M = 300;
/** Small islands the outlines dropped: a point this close still gets the nearest prefecture. */
const NEAR_COAST_M = 3000;
/** Wikidata and Wikipedia positions further apart than this are noted for review. */
const DISAGREE_M = 1000;

/** What the members of a Wikipedia list are: the kind of place each becomes. */
export type WikipediaSetKind = 'temple' | 'castle' | 'peak' | 'waterfall';

export const buildWikipediaSet = (
  context: PointContext,
  definition: ListDefinition,
  key: string,
  kind: WikipediaSetKind,
  /** The fetched list; the checks pass their own. */
  source = loadWikipediaSet(key),
): ListItem[] => {
  const { registry, review, index } = context;
  for (const problem of source.problems ?? [])
    review.numbering.push(`${definition.id} (Wikipedia article ${source.page}): ${problem}`);
  return source.items.map((entry) => {
    const id = `${definition.id}-${pad(entry.order)}`;
    const fixed = context.overrides.itemCoordinates[id];
    // A renamed item was linked to the wrong article, so its Wikidata item is not its own.
    const renamed = fixed?.ja !== undefined;
    const ja = fixed?.ja ?? entry.ja.replace(/\s*\([^)]*\)$/, '');
    // romajiOf reads kana only; a kanji name with no English label keeps its Japanese form.
    const named = context.overrides.itemNames[id];
    if (named) context.usedCoordinateIds.add(id);
    const en = fixed?.en ?? named?.en ?? (renamed ? undefined : entry.en) ?? (romajiOf(ja) || ja);
    const label = `${definition.id} #${entry.order} ${ja}`;
    if (en === ja && kind !== 'temple' && kind !== 'castle')
      review.noEnglish.push(`${label}: no English label on Wikidata; the Japanese name is shown.`);
    if (fixed) context.usedCoordinateIds.add(id);
    if (fixed?.gsi !== undefined && !context.gsi.some((gsi) => gsi.serial === fixed.gsi))
      throw new Error(
        `overrides: itemCoordinates.${id} names GSI row ${fixed.gsi}, which is not in GSI's list`,
      );
    const candidates = [
      ...(fixed
        ? [{ position: [fixed.lon, fixed.lat] as Position, from: 'override' as const }]
        : []),
      // The article's own position first: Wikidata's is sometimes another site of the same name
      // (松坂城's pointed at 松ヶ島, 15 km away).
      ...(entry.wikipedia
        ? [
            {
              position: [entry.wikipedia.lon, entry.wikipedia.lat] as Position,
              from: 'wikipedia' as const,
            },
          ]
        : []),
      ...(entry.wikidata
        ? [
            {
              position: [entry.wikidata.lon, entry.wikidata.lat] as Position,
              from: 'wikidata' as const,
            },
          ]
        : []),
    ];
    const onLand = candidates.find((c) => index.around(c.position, ON_LAND_M).length > 0);
    const nearCoast =
      onLand ?? candidates.find((c) => index.around(c.position, NEAR_COAST_M).length > 0);
    const chosen = onLand ?? nearCoast;
    if (entry.wikidata && entry.wikipedia) {
      const apart = distanceM(
        [entry.wikidata.lon, entry.wikidata.lat],
        [entry.wikipedia.lon, entry.wikipedia.lat],
      );
      if (apart > DISAGREE_M)
        review.coordinates.push(
          `${label}: Wikidata and the Wikipedia article are ${(apart / 1000).toFixed(1)} km apart; used ${chosen ? `the ${chosen.from === 'wikipedia' ? 'article' : chosen.from} position` : 'neither'}.`,
        );
    }
    let place: PlaceDraft | undefined;
    if (chosen) {
      if (chosen !== candidates[0])
        review.coordinates.push(
          `${label}: ${candidates[0]?.from} coordinates are off land; used ${chosen.from}.`,
        );
      else if (!onLand)
        review.coordinates.push(
          `${label}: off the simplified coast; given the nearest prefecture.`,
        );
      if (chosen.from === 'override')
        review.coordinates.push(`${label}: placed by hand (lists/overrides.jsonc).`);
      // A mountain that GSI lists is that place (its summit, its height, shared with the other
      // lists it is on): the nearest GSI summit of the same name within reach of the article's
      // position, which is often not exactly on the top.
      const summit =
        kind === 'peak' && fixed?.gsi !== undefined
          ? context.gsi.find((gsi) => gsi.serial === fixed.gsi)
          : kind === 'peak' && chosen.from !== 'override'
            ? context.gsi
                .map((gsi) => ({ gsi, away: distanceM(chosen.position, gsi.position) }))
                .filter(({ gsi, away }) => away <= MATCH_RADIUS_M && namesOverlap(ja, gsi.fullName))
                .sort((a, b) => a.away - b.away)[0]?.gsi
            : undefined;
      if (summit) {
        place = registry.forGsi(summit);
        if (entry.en && !renamed) place.en ??= entry.en;
        return finishItem(
          context,
          pointItem(definition.id, entry.order, place, {
            name: { ja, en: en === ja ? (place.en ?? en) : en },
          }),
        );
      }
      place = registry.external(
        {
          id: `${kind}-${(renamed ? id : (entry.qid ?? id)).toLowerCase()}`,
          kind,
          position: round(chosen.position),
          ja,
          en,
          prefectures: index.around(chosen.position, onLand ? ON_LAND_M : NEAR_COAST_M),
          coordinateSource: chosen.from,
          ...(entry.qid && !renamed ? { wikidata: entry.qid } : {}),
        },
        0,
      );
    } else {
      review.coordinates.push(
        candidates.length > 0
          ? `${label}: every position is off land (${candidates.map((c) => c.from).join(', ')}); left unplaced.`
          : entry.article
            ? `${label}: no coordinates on Wikidata or in the article ${entry.article}.`
            : `${label}: no article linked from the list, so no coordinates.`,
      );
    }
    return finishItem(
      context,
      pointItem(definition.id, entry.order, place, {
        name: { ja, en },
        ...(fixed ? { note: fixed.note } : {}),
      }),
    );
  });
};

// --- Hand-assembled lists ----------------------------------------------------------------------

/** A list kept by hand, each item with its name, prefecture and (where one is known) a point. */
export const buildCurated = (
  context: PointContext,
  definition: ListDefinition,
  folder: string,
  file: string,
): ListItem[] => {
  const { registry, review, index } = context;
  return loadCurated(folder, file).items.map((entry) => {
    const label = `${definition.id} #${entry.order} ${entry.ja}`;
    let place: PlaceDraft | undefined;
    if (entry.lat !== undefined && entry.lon !== undefined && entry.from) {
      const position: Position = [entry.lon, entry.lat];
      const prefectures = index.around(position, ON_LAND_M);
      if (!prefectures.includes(entry.prefecture))
        review.prefectureChecks.push(
          `${label}: its point is in ${prefectures.join(', ') || 'no prefecture'}, not ${entry.prefecture} as the list says; left unplaced.`,
        );
      else
        place = registry.external(
          {
            id: `point-${definition.id}-${pad(entry.order)}`,
            kind: 'point',
            position: round(position),
            ja: entry.ja,
            en: entry.en,
            prefectures,
            coordinateSource: entry.from,
          },
          0,
        );
    } else {
      review.coordinates.push(`${label}: no position checked yet (lists/sources/${folder}).`);
    }
    return finishItem(
      context,
      pointItem(definition.id, entry.order, place, {
        name: { ja: entry.ja, en: entry.en },
        ...(place
          ? {}
          : {
              prefectures: [entry.prefecture],
              note: 'Not on the map yet: no point on this road has been checked.',
            }),
      }),
    );
  });
};

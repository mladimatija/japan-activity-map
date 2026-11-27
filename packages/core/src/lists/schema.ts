import { z } from 'zod';

import { PREFECTURE_CODES } from '../prefectures.ts';

/** Each list is one of three kinds, and each kind has its own matching rule. */
export const LIST_KINDS = ['point', 'route', 'area'] as const;
export const LIST_THEMES = [
  'peaks',
  'long-trails',
  'pilgrimage',
  'castles',
  'old-highways',
  'cycle-routes',
  'trail-running',
  'waterfalls',
  'roads',
  'areas',
] as const;
export const LIST_PHASES = ['first', 'later'] as const;
/** ready: complete. partial: membership complete, some items lack coordinates. blocked: not built. */
export const LIST_STATUSES = ['ready', 'partial', 'blocked'] as const;
export const COORDINATE_SOURCES = [
  'gsi',
  'kongo',
  'wikidata',
  'wikipedia',
  'osm',
  'override',
] as const;
/** What a place is, so the map can pick a marker. "point" is a spot that is not a summit. */
export const PLACE_KINDS = ['peak', 'temple', 'castle', 'waterfall', 'point'] as const;
/** Where a route's geometry comes from. */
export const ROUTE_SOURCES = ['gokaido', 'moe', 'osm'] as const;

const prefectureCode = z.enum(PREFECTURE_CODES as [string, ...string[]]);
const localizedName = z.strictObject({
  ja: z.string().min(1),
  en: z.string().min(1),
  kana: z.string().min(1).optional(),
});

export const sourceRefSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  licence: z.string().min(1),
  attribution: z.string().min(1),
  /** The licence and the credit as the site says them in Japanese, when they differ. */
  licenceJa: z.string().min(1).optional(),
  attributionJa: z.string().min(1).optional(),
});

export const listMetadataSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.strictObject({ en: z.string().min(1), ja: z.string().min(1) }),
  kind: z.enum(LIST_KINDS),
  theme: z.enum(LIST_THEMES),
  phase: z.enum(LIST_PHASES),
  status: z.enum(LIST_STATUSES),
  description: z.string().min(1),
  /** How many items the list should have once complete, where that is fixed. */
  expectedSize: z.int().positive().optional(),
  /** How the list was counted where sources disagree, for example the 3,000 m peaks. */
  countingRule: z.string().min(1).optional(),
  sources: z.array(sourceRefSchema).min(1),
});

const point = z.strictObject({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
});

export const listItemPropertiesSchema = z.strictObject({
  /** Stable id within the project, for example "hyakumeizan-001". */
  id: z.string().regex(/^[a-z0-9-]+$/),
  /** Shared place: a peak in several lists is one place, so repeat counts attach to it. */
  placeId: z.string().min(1).nullable(),
  /** Position in the list's own numbering. */
  order: z.int().positive(),
  /** Number in the list's original source, where it differs from order (for example the 300 Meizan). */
  sourceNumber: z.int().positive().optional(),
  name: localizedName,
  elevationM: z.number().optional(),
  prefectures: z.array(prefectureCode),
  coordinateSource: z.enum(COORDINATE_SOURCES).nullable(),
  note: z.string().min(1).optional(),
});

export const listItemSchema = z.strictObject({
  type: z.literal('Feature'),
  geometry: point.nullable(),
  properties: listItemPropertiesSchema,
});

export const pointListFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  metadata: listMetadataSchema,
  features: z.array(listItemSchema),
});

export const placePropertiesSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(PLACE_KINDS),
  name: localizedName,
  /** Named summit when the mountain has several, for example 旭岳 for 大雪山. */
  summit: z.string().min(1).optional(),
  elevationM: z.number().optional(),
  prefectures: z.array(prefectureCode).min(1),
  coordinateSource: z.enum(COORDINATE_SOURCES),
  /** Row number in GSI's mountain list, when the place comes from it. */
  gsiSerial: z.int().positive().optional(),
  /** Wikidata item, for places that come from Wikidata. */
  wikidata: z
    .string()
    .regex(/^Q\d+$/)
    .optional(),
  /** Ids of the lists this place belongs to. */
  lists: z.array(z.string()).min(1),
});

export const placesFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.strictObject({
      type: z.literal('Feature'),
      geometry: point,
      properties: placePropertiesSchema,
    }),
  ),
});

const lineString = z.strictObject({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
});
const multiLineString = z.strictObject({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)).min(1),
});

export const routeItemPropertiesSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  order: z.int().positive(),
  name: localizedName,
  /** Length of the geometry in kilometres, rounded to 0.1 km. */
  lengthKm: z.number().positive(),
  /** Prefectures the line passes through, in code order. */
  prefectures: z.array(prefectureCode).min(1),
  source: z.enum(ROUTE_SOURCES),
  /** OpenStreetMap relation, when the geometry comes from one. */
  osmRelation: z.int().positive().optional(),
  note: z.string().min(1).optional(),
});

export const routeItemSchema = z.strictObject({
  type: z.literal('Feature'),
  geometry: z.union([lineString, multiLineString]),
  properties: routeItemPropertiesSchema,
});

export const routeListFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  metadata: listMetadataSchema,
  features: z.array(routeItemSchema),
});

export const catalogEntrySchema = z.strictObject({
  id: z.string(),
  title: z.strictObject({ en: z.string(), ja: z.string() }),
  kind: z.enum(LIST_KINDS),
  theme: z.enum(LIST_THEMES),
  phase: z.enum(LIST_PHASES),
  status: z.enum(LIST_STATUSES),
  expectedSize: z.int().positive().optional(),
  /** File name inside lists/, for built lists. */
  file: z.string().optional(),
  itemCount: z.int().nonnegative().optional(),
  withCoordinates: z.int().nonnegative().optional(),
  /** Why a list is blocked or partial. */
  reason: z.string().optional(),
});

export const catalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  lists: z.array(catalogEntrySchema),
});

export type SourceRef = z.infer<typeof sourceRefSchema>;
export type ListMetadata = z.infer<typeof listMetadataSchema>;
export type ListItemProperties = z.infer<typeof listItemPropertiesSchema>;
export type ListItem = z.infer<typeof listItemSchema>;
export type PointListFile = z.infer<typeof pointListFileSchema>;
export type PlaceProperties = z.infer<typeof placePropertiesSchema>;
export type PlacesFile = z.infer<typeof placesFileSchema>;
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type RouteItem = z.infer<typeof routeItemSchema>;
export type RouteListFile = z.infer<typeof routeListFileSchema>;
export type PlaceKind = (typeof PLACE_KINDS)[number];
export type CoordinateSource = (typeof COORDINATE_SOURCES)[number];
export type Catalog = z.infer<typeof catalogSchema>;

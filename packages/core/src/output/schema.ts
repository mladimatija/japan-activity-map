import { z } from 'zod';

import { ACTIVITY_TYPES } from '../domain.ts';
import { LIST_KINDS, LIST_STATUSES, LIST_THEMES } from '../lists/schema.ts';

/**
 * The files `jam build` writes to dist/data and the web app reads. Bump the version on any change a
 * web app built for the old files could not read; the app refuses files of another version.
 */
export const OUTPUT_SCHEMA_VERSION = 5;

const publicId = z.string().regex(/^[0-9a-z]{16}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const code = z.string().regex(/^\d{2}$/);
const lonLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
/** A position, with elevation in metres when the track has it. */
const position = z.union([lonLat, z.tuple([z.number(), z.number(), z.number()])]);
const name = z.strictObject({ ja: z.string(), en: z.string() });
const activityType = z.enum(ACTIVITY_TYPES);
const metres = z.number().nonnegative();

/** meta.json: what was built, when, from what. Loaded first. */
export const metaFileSchema = z.strictObject({
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  builtAt: z.iso.datetime(),
  /** The newest activity date, so the site can say how current it is. */
  latestActivity: date.nullable(),
  counts: z.strictObject({
    activities: z.int().nonnegative(),
    withTrack: z.int().nonnegative(),
    routes: z.int().nonnegative(),
    lists: z.int().nonnegative(),
  }),
  /** Years with a tracks file, for loading tracks on demand. */
  trackYears: z.array(z.int()),
  publish: z.strictObject({
    stravaLinks: z.boolean(),
    activityNames: z.boolean(),
    timeOfDay: z.boolean(),
  }),
  site: z.strictObject({ title: z.string(), description: z.string() }),
  /** Saved views: a name and the address query that opens it (the part after #). */
  views: z.array(z.strictObject({ name: z.string(), query: z.string() })),
  /** The base map, from config/site.jsonc. */
  map: z.strictObject({
    styleUrl: z.url(),
    darkStyleUrl: z.url().nullable(),
    /** The shown area (west, south, east, north): the map cannot be moved or zoomed out past it. */
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    /** Elevation tiles for terrain and hillshade, as a MapLibre raster-dem source; null when off. */
    terrain: z
      .strictObject({
        url: z.url().optional(),
        tiles: z.array(z.string()).optional(),
        encoding: z.enum(['mapbox', 'terrarium']),
        tileSize: z.int(),
        maxzoom: z.int().optional(),
        attribution: z.string().optional(),
      })
      .nullable(),
  }),
  credits: z.array(
    z.strictObject({
      name: z.string(),
      url: z.url(),
      licence: z.string(),
      attribution: z.string(),
      /** In Japanese, when it differs (the site shows these when its language is Japanese). */
      licenceJa: z.string().optional(),
      attributionJa: z.string().optional(),
      usedBy: z.array(z.string()),
    }),
  ),
  /**
   * Present, and true, only when the data is made up (`jam demo`): the site then says so, and the
   * audit warns. Real builds leave it out.
   */
  demo: z.literal(true).optional(),
});

/** activities.json: one compact record per published activity. */
export const activityRecordSchema = z.strictObject({
  id: publicId,
  date,
  /** Local start "HH:MM", only when time of day is published. */
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  type: activityType,
  tags: z.array(z.string()),
  /** Where the activity came from: synced from Strava or a row of the manual sheet. */
  source: z.enum(['strava', 'sheet']),
  /** Its name; empty without one or with names not published (the site then shows its type). */
  name: z.string(),
  distanceM: metres.nullable(),
  gainM: metres.nullable(),
  movingS: z.int().nonnegative().nullable(),
  elapsedS: z.int().nonnegative().nullable(),
  /** Distance per prefecture, in metres, keyed by code. */
  prefectures: z.record(code, metres),
  /** Climb per prefecture, in metres, keyed by code; prefectures with none are left out. */
  prefectureGain: z.record(code, metres),
  /** List places reached, by place id. */
  places: z.array(z.string()),
  /** Reference route items covered, by item id. */
  routeItems: z.array(z.string()),
  /** Municipalities the track passes through, as the place ids of the municipality list's items. */
  areas: z.array(z.string()).optional(),
  /** The grouped route it belongs to, when that route has more than one published activity. */
  route: publicId.optional(),
  link: z.url().optional(),
  /** Year of the tracks file holding its track; absent without a published track. */
  trackYear: z.int().optional(),
  /** [west, south, east, north] of the published track. */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  start: lonLat.optional(),
  end: lonLat.optional(),
});
export const activitiesFileSchema = z.strictObject({
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  activities: z.array(activityRecordSchema),
});

export const itemStatusSchema = z.enum(['done', 'partial', 'dns', 'want', 'none']);
const listItemSchema = z.strictObject({
  id: z.string(),
  order: z.int(),
  name,
  status: itemStatusSchema,
  /** Point lists: where it is, and the shared place id. */
  placeId: z.string().nullable().optional(),
  /** Prefecture codes it is in or crosses. */
  prefectures: z.array(code),
  at: lonLat.optional(),
  elevationM: z.number().optional(),
  /** Visits by published activities; left out for places inside a privacy zone. */
  visits: z.int().nonnegative().optional(),
  first: date.nullable().optional(),
  latest: date.nullable().optional(),
  /** Route lists: covered and total length in metres. */
  coveredM: metres.optional(),
  lengthM: metres.optional(),
  /** Route lists: the covered stretches, as [from, to] metres along the route. */
  covered: z.array(z.tuple([metres, metres])).optional(),
});
/** lists.json: every list with its items and their status. */
export const listsFileSchema = z.strictObject({
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  lists: z.array(
    z.strictObject({
      id: z.string(),
      title: name,
      kind: z.enum(LIST_KINDS),
      theme: z.enum(LIST_THEMES),
      status: z.enum(LIST_STATUSES),
      counts: z.record(itemStatusSchema, z.int().nonnegative()),
      items: z.array(listItemSchema),
      coveredM: metres.optional(),
      lengthM: metres.optional(),
    }),
  ),
});

const polygon = z.array(z.array(lonLat));
/** prefectures.geojson: simplified outlines with names and your totals in each. */
export const prefecturesFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  features: z.array(
    z.strictObject({
      type: z.literal('Feature'),
      properties: z.strictObject({
        code,
        ja: z.string(),
        en: z.string(),
        region: z.string(),
        activities: z.int().nonnegative(),
        days: z.int().nonnegative(),
        distanceM: metres,
        gainM: metres,
        /** Distance by activity type. */
        byType: z.partialRecord(activityType, metres),
      }),
      geometry: z.union([
        z.strictObject({ type: z.literal('Polygon'), coordinates: polygon }),
        z.strictObject({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon) }),
      ]),
    }),
  ),
});

/**
 * prefectures/<code>.geojson: one prefecture in detail, which the map loads when it is selected:
 * its area (the coast to about 25 m) for the tint, and its land borders (to about 5 m) for the
 * line, which follows the real border however far in the map is zoomed.
 */
export const prefectureOutlineFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  features: z.tuple([
    z.strictObject({
      type: z.literal('Feature'),
      properties: z.strictObject({ code, part: z.literal('area') }),
      geometry: z.strictObject({ type: z.literal('MultiPolygon'), coordinates: z.array(polygon) }),
    }),
    z.strictObject({
      type: z.literal('Feature'),
      properties: z.strictObject({ code, part: z.literal('border') }),
      geometry: z.strictObject({
        type: z.literal('MultiLineString'),
        coordinates: z.array(z.array(lonLat)),
      }),
    }),
  ]),
});

/**
 * mask.geojson: everything the site does not show, as one world polygon whose holes are Japan's land
 * and a band of sea around it. The map draws it in the base map's sea colour over the base map.
 */
export const maskFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  features: z
    .array(
      z.strictObject({
        type: z.literal('Feature'),
        properties: z.strictObject({}),
        geometry: z.strictObject({ type: z.literal('Polygon'), coordinates: polygon }),
      }),
    )
    .length(1),
});

const total = z.strictObject({
  activities: z.int().nonnegative(),
  distanceM: metres,
  gainM: metres,
  movingS: z.int().nonnegative(),
});
/** stats.json: totals the charts need, worked out at build time. */
export const statsFileSchema = z.strictObject({
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  total,
  byType: z.partialRecord(activityType, total),
  byYear: z.record(z.string().regex(/^\d{4}$/), total),
  /** "YYYY-MM" → totals. */
  byMonth: z.record(z.string().regex(/^\d{4}-\d{2}$/), total),
  byPrefecture: z.record(code, total),
  /** Activities by local start hour (0–23) per weekday (0 = Monday): totals only, no times. */
  hourByWeekday: z.array(z.array(z.int().nonnegative()).length(24)).length(7),
  /** The same counts for each activity type. */
  hourByWeekdayByType: z.partialRecord(
    activityType,
    z.array(z.array(z.int().nonnegative()).length(24)).length(7),
  ),
  /** Per list: the dates items were first done, and the running count. */
  completion: z.record(z.string(), z.array(z.strictObject({ date, done: z.int().positive() }))),
});

/** routes.json: grouped routes with their representative line. */
export const routesFileSchema = z.strictObject({
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  routes: z.array(
    z.strictObject({
      id: publicId,
      /** The name: one given in config/routes.jsonc, or the automatic one as `jam routes` shows it. */
      name: z.string(),
      /**
       * What an automatic name is made of, so the site says it in its language: the place it is
       * named after, the length, whether it is a loop, and a number when several look alike.
       */
      auto: z
        .strictObject({
          place: name,
          km: z.number().nonnegative(),
          loop: z.boolean(),
          n: z.int().min(2).optional(),
        })
        .optional(),
      type: activityType,
      count: z.int().positive(),
      reversed: z.int().nonnegative(),
      first: date,
      latest: date,
      minDistanceM: metres,
      maxDistanceM: metres,
      fastestS: z.int().positive().nullable(),
      medianS: z.int().positive().nullable(),
      bestPaceS: z.number().positive().nullable(),
      medianPaceS: z.number().positive().nullable(),
      variantOf: publicId.optional(),
      activities: z.array(publicId),
      /** The representative's published track, cut at privacy zones: one or more pieces. */
      line: z.array(z.array(lonLat)),
    }),
  ),
});

/** reference-routes/<list>.geojson: a route list's geometry and the stretches covered. */
export const referenceRouteFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  list: z.string(),
  features: z.array(
    z.strictObject({
      type: z.literal('Feature'),
      properties: z.strictObject({
        id: z.string(),
        order: z.int(),
        name,
        lengthM: metres,
        coveredM: metres,
        /** Covered stretches as [from, to] metres along the item, privacy zones taken out. */
        covered: z.array(z.tuple([metres, metres])),
        /** The same stretches as lines, ready to draw. */
        coveredLines: z.array(z.array(lonLat)),
      }),
      geometry: z.strictObject({
        type: z.literal('MultiLineString'),
        coordinates: z.array(z.array(lonLat)),
      }),
    }),
  ),
});

/** tracks/<year>.geojson: published tracks, cut at privacy zones and simplified. */
export const tracksFileSchema = z.strictObject({
  type: z.literal('FeatureCollection'),
  schemaVersion: z.literal(OUTPUT_SCHEMA_VERSION),
  year: z.int(),
  features: z.array(
    z.strictObject({
      type: z.literal('Feature'),
      properties: z.strictObject({
        id: publicId,
        type: activityType,
        /** Left out of the heatmap (commutes, by default). */
        heatmap: z.boolean(),
        /**
         * Seconds at each point, one list per line, counted from that line's first point (never a
         * time of day). Present when the track has times and `publish.paceAlongTracks` is on.
         */
        t: z.array(z.array(z.int().nonnegative())).optional(),
      }),
      geometry: z.strictObject({
        type: z.literal('MultiLineString'),
        coordinates: z.array(z.array(position)),
      }),
    }),
  ),
});

export type MetaFile = z.infer<typeof metaFileSchema>;
export type ActivityRecord = z.infer<typeof activityRecordSchema>;
export type ActivitiesFile = z.infer<typeof activitiesFileSchema>;
export type ListsFile = z.infer<typeof listsFileSchema>;
export type PrefecturesFile = z.infer<typeof prefecturesFileSchema>;
export type PrefectureOutlineFile = z.infer<typeof prefectureOutlineFileSchema>;
export type MaskFile = z.infer<typeof maskFileSchema>;
export type StatsFile = z.infer<typeof statsFileSchema>;
export type RoutesFile = z.infer<typeof routesFileSchema>;
export type ReferenceRouteFile = z.infer<typeof referenceRouteFileSchema>;
export type TracksFile = z.infer<typeof tracksFileSchema>;

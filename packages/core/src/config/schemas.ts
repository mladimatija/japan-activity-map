import { z } from 'zod';

import { ACTIVITY_SOURCES, ACTIVITY_TYPES, type ActivityType } from '../domain.ts';

const activityType = z.enum(ACTIVITY_TYPES);
const metres = z.number().positive();

/**
 * The saved views the site offers when site.jsonc names none. A query is the part of a site address
 * after #, as the filter panel writes it. Dates are counted back from today (when=, firstin=,
 * idle=), so none goes stale. A view without list= works on whichever list is open. One about an
 * activity type, tag or list the build does not have is not offered.
 */
export const DEFAULT_VIEWS = [
  // Progress on the open list.
  { name: 'Still to do', query: 'status=none,want,dns,partial' },
  { name: 'Done', query: 'status=done' },
  { name: 'Done this year', query: 'status=done&firstin=this-year' },
  { name: 'Done more than once', query: 'visits=2-' },
  { name: 'Not reached in 3+ years', query: 'idle=3-' },
  // Activities.
  { name: 'This year', query: 'view=activities&when=this-year' },
  { name: 'Last 12 months', query: 'view=activities&when=12m' },
  { name: 'New ground this year', query: 'view=activities&when=this-year&firsts=1' },
  {
    name: 'Big mountain days (1,500 m+ climb)',
    query: 'view=activities&type=hike,trail_run&gain=1500-',
  },
  { name: 'Long runs (30 km+)', query: 'view=activities&type=run,trail_run&km=30-' },
  { name: 'All-day outings (6 h+)', query: 'view=activities&h=6-' },
  { name: 'Races', query: 'view=activities&tag=race' },
  { name: 'Overnight trips', query: 'view=activities&tag=overnight' },
  // The map and prefectures.
  { name: "Everywhere I've been (heatmap)", query: 'layers=prefectures,tracks&tracks=heat' },
  {
    name: 'Prefectures still to visit',
    query: 'view=prefectures&lacks=hike,walk,run,trail_run,ride',
  },
];

/** site.jsonc: what the public site shows and how it is built. */
export const siteOptionsSchema = z.strictObject({
  site: z
    .strictObject({
      title: z.string().min(1).default('Japan Activity Map'),
      description: z.string().default(''),
      baseUrl: z.url().optional(),
    })
    .prefault({}),
  /** Which activities the site is built from (docs/gpx.md). The sheet's own rows always count. */
  activities: z
    .strictObject({
      /**
       * `strava`: what `jam sync strava` fetched. `gpx`: what `jam sync gpx` imported. `garmin`:
       * what `jam sync garmin` fetched.
       */
      source: z.enum(ACTIVITY_SOURCES).default('strava'),
      gpx: z
        .strictObject({
          /** The type of a GPX file whose own `<type>` is missing or not understood. */
          defaultType: activityType.default('hike'),
          /**
           * The folder `jam sync gpx` reads without a path, relative to the repository root. Unset:
           * `activities` inside the data folder (data/activities).
           */
          folder: z.string().min(1).optional(),
        })
        .prefault({}),
      /** What `jam sync garmin` fetches through the Garmin Connect Personal API (docs/garmin.md). */
      garmin: z
        .strictObject({
          /** First and last day to fetch, YYYY-MM-DD. Left out: everything. */
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
          /** Fetch activities whose privacy on Garmin Connect is "Only Me". */
          includePrivate: z.boolean().default(false),
          /** Activity files (the full recordings) downloaded per sync; the next sync carries on. */
          filesPerSync: z.number().int().min(0).max(5000).default(100),
          /** Garmin activity type keys onto the five types, in addition to the built-in ones. */
          typeMap: z.record(z.string(), activityType).default({}),
          api: z
            .strictObject({
              baseUrl: z.url().default('https://personal.connectapi.garmin.com'),
              /** Pause between two file downloads, in milliseconds. */
              pauseMs: z.number().int().min(0).max(60_000).default(500),
            })
            .prefault({}),
        })
        .prefault({}),
    })
    .prefault({}),
  /** Where `jam deploy` publishes the site (docs/deploy.md). */
  deploy: z
    .strictObject({
      /** The service the site is published on. */
      host: z.enum(['cloudflare', 'netlify', 'github']).default('cloudflare'),
      /**
       * Cloudflare Pages: the project's name (<name>.pages.dev). Netlify: the project's name
       * (<name>.netlify.app). Unset: deploying to either is off.
       */
      projectName: z
        .string()
        .regex(/^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$/, {
          message: 'lower-case letters, digits and hyphens, at most 58 characters',
        })
        .optional(),
      /** Cloudflare Pages: the project's production branch; any other branch is a preview. */
      branch: z.string().min(1).default('main'),
      /** Netlify: the team a project is created in, when the account has several. */
      team: z.string().min(1).optional(),
      /** GitHub Pages: the repository the site is pushed to, as owner/name. */
      repository: z
        .string()
        .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/, {
          message: 'a GitHub repository as owner/name',
        })
        .optional(),
      /** GitHub Pages: the branch that holds the site and nothing else. Replaced on every deploy. */
      pagesBranch: z
        .string()
        .regex(/^[A-Za-z0-9._/-]+$/, { message: 'a branch name' })
        .default('gh-pages'),
      /**
       * More addresses the published page may load from, besides the map style's own (which
       * deploy looks up): a style or tile host it cannot see, for example.
       */
      extraHosts: z.array(z.url()).default([]),
    })
    .prefault({}),
  map: z
    .strictObject({
      styleUrl: z.url().default('https://tiles.openfreemap.org/styles/positron'),
      /**
       * The style for viewers whose system is set to dark: OpenFreeMap's Dark (Dark Matter, the
       * dark sibling of Positron) unless set. null gives everyone the light style.
       */
      darkStyleUrl: z.url().nullable().default('https://tiles.openfreemap.org/styles/dark'),
      /** Elevation tiles for the terrain and hillshade switch. */
      terrain: z
        .strictObject({
          enabled: z.boolean().default(false),
          /** A TileJSON address, which carries its own encoding and credit... */
          sourceUrl: z.url().optional(),
          /** ...or a tile address with {z}, {x} and {y}, described by the fields below. */
          tiles: z
            .string()
            .regex(/^https:\/\/.*\{z\}.*\{x\}.*\{y\}/, 'an https address with {z}, {x} and {y}')
            .optional(),
          /** How heights are packed into the pixels; most free sources use terrarium. */
          encoding: z.enum(['mapbox', 'terrarium']).default('mapbox'),
          tileSize: z.union([z.literal(256), z.literal(512)]).default(256),
          maxzoom: z.int().min(1).max(22).optional(),
          /** The credit the tiles ask for, shown on the map (HTML allowed). */
          attribution: z.string().optional(),
        })
        .refine((terrain) => !(terrain.sourceUrl && terrain.tiles), {
          message: 'Set either sourceUrl or tiles, not both.',
        })
        .refine((terrain) => !terrain.enabled || terrain.sourceUrl || terrain.tiles, {
          message: 'Terrain is enabled but has no source: set sourceUrl or tiles.',
        })
        .refine((terrain) => !terrain.tiles || terrain.attribution, {
          message: 'Tiles need an attribution: the credit their provider asks for.',
        })
        .prefault({}),
    })
    .prefault({}),
  /** Saved views offered in the filter panel, in order; replaces the defaults when set ([] for none). */
  views: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        /** The part of the site's address after #, e.g. "type=hike&year=2025". */
        query: z.string().regex(/^[^#?\s]*$/, 'the part of the address after #, without the #'),
      }),
    )
    .default(DEFAULT_VIEWS),
  output: z
    .strictObject({
      /** Published tracks are simplified so no point is moved more than this. */
      simplifyM: z.number().nonnegative().default(5),
      /** Decimals kept in published coordinates; 5 is about 1 m. */
      decimals: z.int().min(4).max(7).default(5),
      /** Budget for the files the site loads at start, compressed. */
      startBudgetKB: z.int().positive().default(1024),
    })
    .prefault({}),
  publish: z
    .strictObject({
      /** Build a link to each Strava activity into the public site. */
      stravaLinks: z.boolean().default(false),
      /** Publish activities set to "Only You" on Strava, when they were imported. */
      includeOnlyMeActivities: z.boolean().default(false),
      /**
       * Publish activities without GPS (treadmill, gym, manual entries with no coordinates) whose
       * time zone is Asia/Tokyo. They count in totals and statistics but never appear on the map.
       */
      activitiesWithoutGps: z.boolean().default(false),
      /** Publish activity names; when off, a generic label per type is used. */
      activityNames: z.boolean().default(true),
      /** Publish the time of day; when off, only dates are published. */
      timeOfDay: z.boolean().default(false),
      /**
       * Publish the seconds at each point of a track, for pace by kilometre in the activity
       * analysis. They count from the start of each published stretch, so they hold no time of day
       * and nothing about the time spent inside a privacy zone.
       */
      paceAlongTracks: z.boolean().default(true),
      /** Include commutes in the track heatmap. */
      commutesInHeatmap: z.boolean().default(false),
    })
    .prefault({}),
});

/** thresholds.jsonc: tolerances for matching, route grouping and privacy clipping. */
export const thresholdsSchema = z.strictObject({
  matching: z
    .strictObject({
      /** A place counts as visited when a track passes within this distance. */
      pointRadiusM: metres.default(200),
      /** Matches this close to the radius on a summary track are flagged as uncertain. */
      uncertainMarginM: z.number().nonnegative().default(50),
      /** Per-list radius overrides, keyed by list id. */
      perList: z.record(z.string(), z.strictObject({ pointRadiusM: metres })).default({}),
      /** Points this close to a prefecture outline count as in Japan (coastal paths, simplified coasts). */
      japanMarginM: z.number().nonnegative().default(2000),
      routes: z
        .strictObject({
          /** Covered stretches shorter than this are dropped, so crossing a route does not count. */
          minStretchM: metres.default(300),
          /** Gaps up to this long inside a covered stretch are bridged (GPS jitter, a short detour). */
          bridgeGapM: z.number().nonnegative().default(100),
          /** Share of a route item that must be covered for it to count as done. */
          completeShare: z.number().gt(0).max(1).default(0.95),
        })
        .prefault({}),
    })
    .prefault({}),
  routeGrouping: z
    .strictObject({
      startToleranceM: metres.default(200),
      endToleranceM: metres.default(200),
      distanceTolerancePct: z.number().positive().max(100).default(10),
      /**
       * Compare how much distinct street two tracks cover, not their total distance, so a route
       * run with one lap of a section or with three is the same route.
       */
      ignoreLaps: z.boolean().default(true),
      /** Web-map tile zoom for grid cells; 19 is roughly 60 m across in Japan. */
      gridZoom: z.int().min(10).max(22).default(19),
      /** Share of grid cells two tracks must have in common to be the same route. */
      minOverlapShare: z.number().gt(0).max(1).default(0.8),
    })
    .prefault({}),
  privacy: z
    .strictObject({
      /**
       * Each zone's centre is moved once, at random, by up to this share of its radius, and the
       * radius grows by the same amount so the real circle stays covered. Someone fitting a circle
       * to many cut points finds the moved centre: the real place is up to this far from it.
       */
      centreShiftShare: z.number().min(0).max(1).default(0.5),
      /** Each activity's zone radius varies by up to this much, so cut points do not form a circle. */
      radiusJitterM: z.number().nonnegative().default(50),
      /** Track fragments shorter than this are dropped after clipping. */
      minFragmentM: z.number().nonnegative().default(100),
    })
    .prefault({}),
});

const privacyZoneSchema = z
  .strictObject({
    label: z.string().min(1),
    radiusM: metres,
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    address: z.string().min(1).optional(),
  })
  .superRefine((zone, ctx) => {
    const hasLat = zone.lat !== undefined;
    const hasLon = zone.lon !== undefined;
    if (hasLat !== hasLon) {
      ctx.addIssue({
        code: 'custom',
        message: 'give both lat and lon',
        path: [hasLat ? 'lon' : 'lat'],
      });
    }
    if (!hasLat && !hasLon && zone.address === undefined) {
      ctx.addIssue({ code: 'custom', message: 'give either lat and lon, or an address' });
    }
  });

/** An activity as the routes file names it: its Strava id, or the act_ id of a sheet row. */
const activityRef = z
  .union([z.int().positive(), z.string().regex(/^(act_[0-9a-z]+|\d+)$/)])
  .transform(String);

/** routes.jsonc: manual control over grouped routes, keyed by activities so it survives regrouping. */
export const routesSchema = z.strictObject({
  /** Names for routes, keyed by any activity in the route. A name here replaces the automatic one. */
  names: z.record(z.string().regex(/^(act_[0-9a-z]+|\d+)$/), z.string().min(1)).default({}),
  /** Each entry: activities whose routes become one. */
  merge: z.array(z.array(activityRef).min(2)).default([]),
  /** Each entry: activities that leave their route and form a route of their own. */
  split: z.array(z.array(activityRef).min(1)).default([]),
});

/** privacy-zones.jsonc: places whose surroundings are cut from every published track. */
export const privacyZonesSchema = z
  .strictObject({
    zones: z.array(privacyZoneSchema).default([]),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.zones.forEach((zone, index) => {
      if (seen.has(zone.label)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate label "${zone.label}"`,
          path: ['zones', index, 'label'],
        });
      }
      seen.add(zone.label);
    });
  });

export const DEFAULT_SPORT_TYPE_MAP: Record<string, ActivityType> = {
  Hike: 'hike',
  Walk: 'walk',
  Run: 'run',
  TrailRun: 'trail_run',
  Ride: 'ride',
  GravelRide: 'ride',
  MountainBikeRide: 'ride',
};

/** strava.jsonc: what the Strava sync fetches. */
export const stravaSchema = z.strictObject({
  import: z
    .strictObject({
      /** First day to fetch (inclusive, ISO date). Leave out to start from the beginning. */
      from: z.iso.date().optional(),
      /** Last day to fetch (inclusive, ISO date). Leave out to fetch up to today. */
      to: z.iso.date().optional(),
      /** Activity types to keep; Strava filters by date only, so this is applied after fetching. */
      activityTypes: z
        .array(activityType)
        .min(1)
        .default([...ACTIVITY_TYPES]),
      /** Also fetch activities set to "Only You". Needs read-all access, so rerun `strava auth` after turning it on. */
      includePrivate: z.boolean().default(false),
    })
    .refine((value) => !value.from || !value.to || value.from <= value.to, {
      message: '"from" must not be after "to"',
      path: ['to'],
    })
    .prefault({}),
  /** Strava sport type to project activity type; unmapped sport types are skipped and reported. */
  sportTypeMap: z.record(z.string(), activityType).default({ ...DEFAULT_SPORT_TYPE_MAP }),
  /** The weekly job skips the pull when the last one is newer than this. */
  staleAfterDays: z.int().positive().default(7),
  /**
   * After each pull, full GPS samples (heights and times, for height profiles and the activity
   * analysis) for up to this many activities in Japan that only have the list's simplified track,
   * newest first, one request each. 80 stays inside one 15-minute Strava window; 0 turns it off.
   */
  fullTracksPerSync: z.int().min(0).default(80),
  /** Where the API lives. Strava moves to https://api-v3.strava.com during 2027. */
  api: z
    .strictObject({
      baseUrl: z.url().default('https://www.strava.com/api/v3'),
      oauthUrl: z.url().default('https://www.strava.com/oauth'),
      /** Local port for the sign-in redirect; the app's callback domain must be "localhost". */
      redirectPort: z.int().min(1024).max(65535).default(8723),
      /** Activities per list page; Strava allows up to 200. */
      pageSize: z.int().min(1).max(200).default(200),
    })
    .prefault({}),
});

/** True for an IANA time zone name the runtime knows, such as Asia/Tokyo. */
export const isTimeZone = (name: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/** sheet.jsonc: where the manual activity sheet is and how to read it. */
export const sheetSchema = z.strictObject({
  /** The sheet, CSV or .xlsx, relative to the repository root. Keep it in data/, which is git-ignored. */
  path: z.string().min(1).default('data/activities.csv'),
  /** Time zone for dates and times that do not carry an offset or a time_zone column. */
  timeZone: z
    .string()
    .default('Asia/Tokyo')
    .refine(isTimeZone, { message: 'not a known IANA time zone' }),
});

/** secrets.jsonc: credentials. Never committed and never filled in from an example file. */
export const secretsSchema = z.strictObject({
  /** A Garmin Connect personal API key (docs/garmin.md). Kept like a password. */
  garmin: z.strictObject({ apiKey: z.string().min(1) }).optional(),
  strava: z
    .strictObject({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
    })
    .optional(),
  deploy: z
    .strictObject({
      /** A Cloudflare API token that may edit Pages (Account, Cloudflare Pages, Edit). */
      apiToken: z.string().min(1).optional(),
      /** The Cloudflare account the Pages project is in: 32 hex characters. */
      accountId: z
        .string()
        .regex(/^[0-9a-f]{32}$/, {
          message: 'a Cloudflare account id is 32 characters, 0-9 and a-f',
        })
        .optional(),
      /** A Netlify personal access token. */
      netlifyToken: z.string().min(1).optional(),
    })
    .optional(),
});

export type SiteOptions = z.infer<typeof siteOptionsSchema>;
export type Thresholds = z.infer<typeof thresholdsSchema>;
export type RoutesConfig = z.infer<typeof routesSchema>;
export type PrivacyZones = z.infer<typeof privacyZonesSchema>;
export type PrivacyZone = PrivacyZones['zones'][number];
export type StravaConfig = z.infer<typeof stravaSchema>;
export type SheetConfig = z.infer<typeof sheetSchema>;
export type Secrets = z.infer<typeof secretsSchema>;

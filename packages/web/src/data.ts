import type {
  ActivitiesFile,
  ActivityRecord,
  ListsFile,
  MaskFile,
  MetaFile,
  PrefectureOutlineFile,
  PrefecturesFile,
  ReferenceRouteFile,
  RoutesFile,
  StatsFile,
  TracksFile,
} from '@jam/core/output';

/** The data version this app reads; it must match `schemaVersion` in every file. */
const SCHEMA_VERSION = 5;

export type List = ListsFile['lists'][number];
export type ListItem = List['items'][number];
export type Route = RoutesFile['routes'][number];
export type Prefecture = PrefecturesFile['features'][number];
export type {
  ActivityRecord,
  MetaFile,
  PrefectureOutlineFile,
  ReferenceRouteFile,
  StatsFile,
  TracksFile,
};

/** Everything loaded at start, with lookups built once. */
export interface Data {
  meta: MetaFile;
  activities: ActivityRecord[];
  lists: List[];
  prefectures: PrefecturesFile;
  /** Everything outside Japan and its band of sea, covered on the map. */
  mask: MaskFile;
  stats: StatsFile;
  routes: Route[];
  activityById: Map<string, ActivityRecord>;
  routeById: Map<string, Route>;
  listById: Map<string, List>;
  prefectureByCode: Map<string, Prefecture>;
  /** Every list item for a place, across lists. */
  itemsByPlace: Map<string, { list: List; item: ListItem }[]>;
  /** Activities that reached each place, newest first. */
  visitsByPlace: Map<string, ActivityRecord[]>;
  /** Activities that covered each reference route item, newest first. */
  activitiesByRouteItem: Map<string, ActivityRecord[]>;
}

class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

const base = new URL('./data/', document.baseURI);

const fetchJson = async <T>(file: string): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(new URL(file, base));
  } catch {
    throw new DataError(`Could not load ${file}. Check your connection and reload.`);
  }
  if (response.status === 404)
    throw new DataError(
      `${file} is missing. The site's data has not been built yet (pnpm jam build).`,
    );
  if (!response.ok) throw new DataError(`Could not load ${file} (${response.status}).`);
  let value: { schemaVersion?: number };
  try {
    value = (await response.json()) as { schemaVersion?: number };
  } catch {
    // A host that answers a missing file with its own page (and status 200) lands here.
    throw new DataError(
      `${file} is not data: the server answered with something else. Publish the site's data folder again.`,
    );
  }
  if (value === null || typeof value !== 'object')
    throw new DataError(`${file} is not data in the form this site reads.`);
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new DataError(
      `${file} is data version ${value.schemaVersion ?? 'unknown'}, but this version of the site reads version ${SCHEMA_VERSION}. Rebuild the data and the site together.`,
    );
  }
  return value as T;
};

/** In development every file is checked against the schemas the build uses; in production that code is not even loaded. */
const validate = async (file: string, value: unknown): Promise<void> => {
  if (!import.meta.env.DEV) return;
  const schemas = await import('@jam/core/output');
  const schema = {
    'meta.json': schemas.metaFileSchema,
    'activities.json': schemas.activitiesFileSchema,
    'lists.json': schemas.listsFileSchema,
    'prefectures.geojson': schemas.prefecturesFileSchema,
    'mask.geojson': schemas.maskFileSchema,
    'stats.json': schemas.statsFileSchema,
    'routes.json': schemas.routesFileSchema,
  }[file];
  const result = schema?.safeParse(value);
  if (result && !result.success) {
    const issue = result.error.issues[0];
    throw new DataError(
      `${file} does not match its schema at ${issue?.path.join('.') || 'the top'}: ${issue?.message ?? 'invalid'}`,
    );
  }
};

/**
 * What each start file must hold for the site to stand up: checked in production too, where the
 * full schemas are not loaded. A file cut short or from another site fails here with its name,
 * not later as an error deep in a page.
 */
const SHAPES: Record<string, [key: string, kind: 'array' | 'object'][]> = {
  'meta.json': [
    ['site', 'object'],
    ['map', 'object'],
    ['views', 'array'],
    ['credits', 'array'],
  ],
  'activities.json': [['activities', 'array']],
  'lists.json': [['lists', 'array']],
  'prefectures.geojson': [['features', 'array']],
  'mask.geojson': [['features', 'array']],
  'routes.json': [['routes', 'array']],
};

const checkShape = (file: string, value: unknown): void => {
  const record = value as Record<string, unknown>;
  for (const [key, kind] of SHAPES[file] ?? []) {
    const part = record[key];
    const ok = kind === 'array' ? Array.isArray(part) : part !== null && typeof part === 'object';
    if (!ok)
      throw new DataError(
        `${file} is incomplete (no ${key}). Rebuild the data (pnpm jam build) and publish it again.`,
      );
  }
};

/** Adds a value to the list under a key, making the list on first use. */
const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const load = async <T>(file: string): Promise<T> => {
  const value = await fetchJson<T>(file);
  checkShape(file, value);
  await validate(file, value);
  return value;
};

const byNewest = (a: ActivityRecord, b: ActivityRecord) => b.date.localeCompare(a.date);

/** Fetches the seven start files in parallel and builds the lookups. */
export const loadData = async (): Promise<Data> => {
  const [meta, activitiesFile, listsFile, prefectures, mask, stats, routesFile] = await Promise.all(
    [
      load<MetaFile>('meta.json'),
      load<ActivitiesFile>('activities.json'),
      load<ListsFile>('lists.json'),
      load<PrefecturesFile>('prefectures.geojson'),
      load<MaskFile>('mask.geojson'),
      load<StatsFile>('stats.json'),
      load<RoutesFile>('routes.json'),
    ],
  );
  const activities = activitiesFile.activities;
  const itemsByPlace = new Map<string, { list: List; item: ListItem }[]>();
  for (const list of listsFile.lists) {
    for (const item of list.items) {
      if (!item.placeId) continue;
      push(itemsByPlace, item.placeId, { list, item });
    }
  }
  const visitsByPlace = new Map<string, ActivityRecord[]>();
  const activitiesByRouteItem = new Map<string, ActivityRecord[]>();
  for (const activity of activities) {
    // Municipalities are places of their own list only: they are not among `places`, so they stay
    // out of "places reached", repeats and firsts, which are about the lists' own places.
    for (const place of [...activity.places, ...(activity.areas ?? [])])
      push(visitsByPlace, place, activity);
    for (const item of activity.routeItems) push(activitiesByRouteItem, item, activity);
  }
  for (const list of [...visitsByPlace.values(), ...activitiesByRouteItem.values()])
    list.sort(byNewest);
  return {
    meta,
    activities,
    lists: listsFile.lists,
    prefectures,
    mask,
    stats,
    routes: routesFile.routes,
    activityById: new Map(activities.map((activity) => [activity.id, activity])),
    routeById: new Map(routesFile.routes.map((route) => [route.id, route])),
    listById: new Map(listsFile.lists.map((list) => [list.id, list])),
    prefectureByCode: new Map(
      prefectures.features.map((feature) => [feature.properties.code, feature]),
    ),
    itemsByPlace,
    visitsByPlace,
    activitiesByRouteItem,
  };
};

/** Files loaded on demand: a year of tracks, a route list's geometry. Each is fetched once. */
const cache = new Map<string, Promise<unknown>>();
export const loadOnce = <T>(file: string): Promise<T> => {
  let pending = cache.get(file) as Promise<T> | undefined;
  if (!pending) {
    pending = fetchJson<T>(file);
    // A failed load can be tried again later.
    pending.catch(() => cache.delete(file));
    cache.set(file, pending);
  }
  return pending;
};

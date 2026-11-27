import { ACTIVITY_TYPES, EVENT_TAGS } from '@jam/core/domain';

import type { ActivityRecord, Data, List, ListItem } from './data.ts';
import { REGIONS } from '@jam/core/prefectures';
import { localized } from './i18n.ts';
import type { Status } from './map/palette.ts';

export type ActivityType = ActivityRecord['type'];
export type Source = ActivityRecord['source'];
/** A numeric range; either end open. */
export interface Range {
  min: number | null;
  max: number | null;
}
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Metric = 'activities' | 'days' | 'km' | 'gain';
/** A window of time counted back from today, so a link or saved view never goes stale. */
export type When = '30d' | '12m' | 'this-year' | 'last-year';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** Activities on a route done more than once, or on one done only once. */
export type Repeat = 'repeated' | 'once';

/**
 * Every filter the site has, in three scopes. Activity facets narrow the activities, and everything
 * built from them (tracks, routes, prefecture totals, visit counts). Place facets narrow the active
 * list's rows and pins. Prefecture facets pick prefectures by what was done in them.
 */
export interface Filters {
  types: ActivityType[];
  tags: string[];
  years: Range;
  when: When | null;
  seasons: Season[];
  months: number[];
  days: Weekday[];
  prefs: string[];
  /** Activities that reached a place or covered a stretch of any of these lists. */
  onLists: string[];
  /** Only activities that reached a place, a route stretch or a prefecture for the first time. */
  firsts: boolean;
  repeat: Repeat | null;
  sources: Source[];
  km: Range;
  gain: Range;
  /** Moving time, in hours. */
  hours: Range;

  status: Status[];
  /** The list's places in one prefecture (opened from a prefecture's detail). */
  in: string | null;
  regions: string[];
  elev: Range;
  visits: Range;
  /** Places first reached in this window. */
  firstIn: When | null;
  /** Whole years since a place was last reached. */
  idle: Range;

  has: ActivityType[];
  lacks: ActivityType[];
  metric: { key: Metric; min: number } | null;
}

const OPEN: Range = { min: null, max: null };

export const NO_FILTERS: Filters = {
  types: [],
  tags: [],
  years: OPEN,
  when: null,
  seasons: [],
  months: [],
  days: [],
  prefs: [],
  onLists: [],
  firsts: false,
  repeat: null,
  sources: [],
  km: OPEN,
  gain: OPEN,
  hours: OPEN,
  status: [],
  in: null,
  regions: [],
  elev: OPEN,
  visits: OPEN,
  firstIn: null,
  idle: OPEN,
  has: [],
  lacks: [],
  metric: null,
};

export const SEASONS: { id: Season; label: string; months: number[] }[] = localized([
  { id: 'spring', label: 'Spring', months: [3, 4, 5] },
  { id: 'summer', label: 'Summer', months: [6, 7, 8] },
  { id: 'autumn', label: 'Autumn', months: [9, 10, 11] },
  { id: 'winter', label: 'Winter', months: [12, 1, 2] },
]);
export const MONTHS = localized([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);
export const WHENS: { id: When; label: string }[] = localized([
  { id: '30d', label: 'Last 30 days' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'this-year', label: 'This year' },
  { id: 'last-year', label: 'Last year' },
]);
export const WEEKDAYS: { id: Weekday; label: string }[] = localized([
  { id: 'mon', label: 'Monday' },
  { id: 'tue', label: 'Tuesday' },
  { id: 'wed', label: 'Wednesday' },
  { id: 'thu', label: 'Thursday' },
  { id: 'fri', label: 'Friday' },
  { id: 'sat', label: 'Saturday' },
  { id: 'sun', label: 'Sunday' },
]);
export const REPEATS: { id: Repeat; label: string }[] = localized([
  { id: 'repeated', label: 'Routes done more than once' },
  { id: 'once', label: 'Routes done once' },
]);
export const SOURCES: { id: Source; label: string }[] = localized([
  { id: 'strava', label: 'Strava' },
  { id: 'sheet', label: 'Manual sheet' },
]);
export const METRICS: { id: Metric; label: string; unit: string }[] = localized([
  { id: 'activities', label: 'Activities', unit: '' },
  { id: 'days', label: 'Days out', unit: 'days' },
  { id: 'km', label: 'Distance', unit: 'km' },
  { id: 'gain', label: 'Climb', unit: 'm' },
]);
const TYPES = ACTIVITY_TYPES as readonly ActivityType[];
const TAGS = EVENT_TAGS as readonly string[];
const STATUS_IDS: Status[] = ['done', 'partial', 'dns', 'want', 'none'];

const ACTIVITY_KEYS = [
  'types',
  'tags',
  'years',
  'when',
  'seasons',
  'months',
  'days',
  'prefs',
  'onLists',
  'firsts',
  'repeat',
  'sources',
  'km',
  'gain',
  'hours',
] as const;
const PLACE_KEYS = ['status', 'in', 'regions', 'elev', 'visits', 'firstIn', 'idle'] as const;
const PREFECTURE_KEYS = ['has', 'lacks', 'metric'] as const;
type ActivityKey = (typeof ACTIVITY_KEYS)[number];
export type PlaceKey = (typeof PLACE_KEYS)[number];

const isSet = (value: Filters[keyof Filters]) =>
  value === null || value === false
    ? false
    : Array.isArray(value)
      ? value.length > 0
      : typeof value === 'object' && 'max' in value
        ? value.min !== null || value.max !== null
        : true;

const activityFiltersOn = (filters: Filters) => ACTIVITY_KEYS.some((key) => isSet(filters[key]));
const prefectureFiltersOn = (filters: Filters) =>
  PREFECTURE_KEYS.some((key) => isSet(filters[key]));
/** How many facets are set, for the Filters button. */
export const filterCount = (filters: Filters) =>
  (Object.keys(NO_FILTERS) as (keyof Filters)[]).filter((key) => isSet(filters[key])).length;

export type Scope = 'activities' | 'places' | 'prefectures';
const SCOPE_KEYS: Record<Scope, readonly (keyof Filters)[]> = {
  activities: ACTIVITY_KEYS,
  places: PLACE_KEYS,
  prefectures: PREFECTURE_KEYS,
};
/** How many facets of one scope are set, for a folded group's heading. */
export const scopeCount = (filters: Filters, scope: Scope) =>
  SCOPE_KEYS[scope].filter((key) => isSet(filters[key])).length;
/** The change that clears one scope's facets. */
export const clearScope = (scope: Scope): Partial<Filters> =>
  Object.fromEntries(SCOPE_KEYS[scope].map((key) => [key, NO_FILTERS[key]]));

// ---------------------------------------------------------------------------------------------
// Time counted from today.

const pad = (value: number) => String(value).padStart(2, '0');
const isoDay = (day: Date) =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;

/** The first and last day, inclusive, of a window counted back from today. */
export const whenSpan = (when: When, now = new Date()): [string, string] => {
  const year = now.getFullYear();
  if (when === 'this-year') return [`${year}-01-01`, `${year}-12-31`];
  if (when === 'last-year') return [`${year - 1}-01-01`, `${year - 1}-12-31`];
  const from = new Date(now);
  if (when === '30d') from.setDate(from.getDate() - 29);
  else {
    from.setFullYear(from.getFullYear() - 1);
    from.setDate(from.getDate() + 1);
  }
  return [isoDay(from), isoDay(now)];
};
const within = (day: string | null | undefined, when: When | null) => {
  if (!when) return true;
  if (!day) return false;
  const [from, to] = whenSpan(when);
  return day >= from && day <= to;
};

/** How many of these days fall in each window, for the "When" options' counts. */
export const countByWhen = (days: readonly (string | null | undefined)[]): Map<When, number> =>
  new Map(WHENS.map(({ id }) => [id, days.filter((day) => within(day, id)).length]));

/** Whole years from a day to today. */
const yearsSince = (day: string, now = new Date()): number => {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  let years = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) years--;
  return Math.max(0, years);
};

const WEEKDAY_IDS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
/** The day of the week of a local "YYYY-MM-DD" date. */
/** 0 for Sunday to 6 for Saturday, of a local "YYYY-MM-DD" date. */
export const weekdayIndex = (day: string): number => new Date(`${day}T00:00:00Z`).getUTCDay();
const weekdayOf = (day: string): Weekday => WEEKDAY_IDS[weekdayIndex(day)] ?? 'mon';

// ---------------------------------------------------------------------------------------------
// The address. Lists are comma-separated, ranges are "min-max" with either end left out.

const RANGE = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/;

const parseRange = (text: string | null): Range => {
  if (!text) return OPEN;
  if (/^\d+$/.test(text)) return { min: Number(text), max: Number(text) };
  const match = RANGE.exec(text);
  if (!match) return OPEN;
  const min = match[1] === undefined ? null : Number(match[1]);
  const max = match[2] === undefined ? null : Number(match[2]);
  if (min !== null && max !== null && min > max) return OPEN;
  return { min, max };
};

const formatRange = (range: Range) =>
  range.min !== null && range.min === range.max
    ? String(range.min)
    : `${range.min ?? ''}-${range.max ?? ''}`;

const parseList = <T extends string>(text: string | null, allowed: readonly T[]): T[] =>
  text
    ? [...new Set(text.split(','))].filter((part): part is T =>
        (allowed as readonly string[]).includes(part),
      )
    : [];

const CODE = /^\d{2}$/;
const ID = /^[0-9a-z-]{1,64}$/;

/** Reads the filters from the address's parameters. Anything malformed or unknown is dropped. */
export const decodeFilters = (params: URLSearchParams): Filters => {
  const months = parseList(
    params.get('month'),
    MONTHS.map((_, i) => String(i + 1)),
  ).map(Number);
  const metricText = params.get('min');
  const metricMatch = metricText
    ? /^(activities|days|km|gain):(\d+(?:\.\d+)?)$/.exec(metricText)
    : null;
  const inPrefecture = params.get('in');
  const whenOf = (key: string) =>
    parseList(
      params.get(key),
      WHENS.map((entry) => entry.id),
    )[0] ?? null;
  return {
    types: parseList(params.get('type'), TYPES),
    tags: parseList(params.get('tag'), TAGS),
    years: parseRange(params.get('year')),
    when: whenOf('when'),
    seasons: parseList(
      params.get('season'),
      SEASONS.map((season) => season.id),
    ),
    months,
    days: parseList(
      params.get('day'),
      WEEKDAYS.map((day) => day.id),
    ),
    prefs: (params.get('pref') ?? '')
      .split(',')
      .filter((code, i, all) => CODE.test(code) && all.indexOf(code) === i),
    onLists: (params.get('on') ?? '')
      .split(',')
      .filter((id, i, all) => ID.test(id) && all.indexOf(id) === i),
    firsts: params.get('firsts') === '1',
    repeat:
      parseList(
        params.get('repeat'),
        REPEATS.map((entry) => entry.id),
      )[0] ?? null,
    sources: parseList(
      params.get('source'),
      SOURCES.map((source) => source.id),
    ),
    km: parseRange(params.get('km')),
    gain: parseRange(params.get('gain')),
    hours: parseRange(params.get('h')),
    status: parseList(params.get('status'), STATUS_IDS),
    in: inPrefecture && CODE.test(inPrefecture) ? inPrefecture : null,
    regions: parseList(
      params.get('region'),
      REGIONS.map((region) => region.id),
    ),
    elev: parseRange(params.get('elev')),
    visits: parseRange(params.get('visits')),
    firstIn: whenOf('firstin'),
    idle: parseRange(params.get('idle')),
    has: parseList(params.get('has'), TYPES),
    lacks: parseList(params.get('lacks'), TYPES),
    metric: metricMatch ? { key: metricMatch[1] as Metric, min: Number(metricMatch[2]) } : null,
  };
};

/** Writes the set filters into address parameters, in a fixed order so equal views give equal links. */
export const encodeFilters = (filters: Filters, params: URLSearchParams): void => {
  const list = (key: string, values: readonly (string | number)[]) => {
    if (values.length) params.set(key, values.join(','));
  };
  const range = (key: string, value: Range) => {
    if (value.min !== null || value.max !== null) params.set(key, formatRange(value));
  };
  list('type', filters.types);
  list('tag', filters.tags);
  range('year', filters.years);
  if (filters.when) params.set('when', filters.when);
  list('season', filters.seasons);
  list('month', filters.months);
  list('day', filters.days);
  list('pref', filters.prefs);
  list('on', filters.onLists);
  if (filters.firsts) params.set('firsts', '1');
  if (filters.repeat) params.set('repeat', filters.repeat);
  list('source', filters.sources);
  range('km', filters.km);
  range('gain', filters.gain);
  range('h', filters.hours);
  list('status', filters.status);
  if (filters.in) params.set('in', filters.in);
  list('region', filters.regions);
  range('elev', filters.elev);
  range('visits', filters.visits);
  if (filters.firstIn) params.set('firstin', filters.firstIn);
  range('idle', filters.idle);
  list('has', filters.has);
  list('lacks', filters.lacks);
  if (filters.metric) params.set('min', `${filters.metric.key}:${filters.metric.min}`);
};

/** What the published activities actually have: only these are ever offered as filters. */
interface Present {
  types: ActivityType[];
  tags: string[];
  sources: Source[];
}

const presentCache = new WeakMap<Data, Present>();
export const presentIn = (data: Data): Present => {
  let present = presentCache.get(data);
  if (!present) {
    const types = new Set(data.activities.map((activity) => activity.type));
    const tags = new Set(data.activities.flatMap((activity) => activity.tags));
    const sources = new Set(data.activities.map((activity) => activity.source));
    present = {
      types: TYPES.filter((type) => types.has(type)),
      tags: TAGS.filter((tag) => tags.has(tag)),
      sources: SOURCES.map((source) => source.id).filter((id) => sources.has(id)),
    };
    presentCache.set(data, present);
  }
  return present;
};

/** Whether a view's filters only use types, tags and sources the data has. */
export const usesOnlyPresent = (filters: Filters, data: Data): boolean => {
  const present = presentIn(data);
  return (
    [...filters.types, ...filters.has, ...filters.lacks].every((type) =>
      present.types.includes(type),
    ) &&
    filters.tags.every((tag) => present.tags.includes(tag)) &&
    filters.sources.every((source) => present.sources.includes(source))
  );
};

/**
 * Drops what the data does not have: an unknown list or prefecture in a link, or an activity type,
 * tag or source no published activity has.
 */
export const settleFilters = (filters: Filters, data: Data): Filters => {
  const present = presentIn(data);
  const keep = <T>(values: T[], allowed: readonly T[]) => {
    const kept = values.filter((value) => allowed.includes(value));
    return kept.length === values.length ? values : kept;
  };
  const next: Filters = {
    ...filters,
    prefs: keep(
      filters.prefs,
      data.prefectures.features.map((feature) => feature.properties.code),
    ),
    onLists: keep(filters.onLists, [...data.listById.keys()]),
    in: filters.in && data.prefectureByCode.has(filters.in) ? filters.in : null,
    types: keep(filters.types, present.types),
    has: keep(filters.has, present.types),
    lacks: keep(filters.lacks, present.types),
    tags: keep(filters.tags, present.tags),
    sources: keep(filters.sources, present.sources),
  };
  return (Object.keys(next) as (keyof Filters)[]).every((key) => next[key] === filters[key])
    ? filters
    : next;
};

// ---------------------------------------------------------------------------------------------
// The results. One function per scope; everything on screen derives from `derive`.

const inRange = (value: number | null | undefined, range: Range) =>
  (range.min === null || (value ?? 0) >= range.min) &&
  (range.max === null || (value ?? 0) <= range.max);

const monthOf = (activity: ActivityRecord) => Number(activity.date.slice(5, 7));
export const seasonOf = (month: number): Season =>
  SEASONS.find((season) => season.months.includes(month))?.id ?? 'winter';

/** Place ids and route item ids of a list, for "activities on this list". */
const listTargets = new WeakMap<List, Set<string>>();
const targetsOf = (list: List): Set<string> => {
  let targets = listTargets.get(list);
  if (!targets) {
    targets = new Set(
      list.items.flatMap((item) =>
        list.kind === 'route' ? [item.id] : item.placeId ? [item.placeId] : [],
      ),
    );
    listTargets.set(list, targets);
  }
  return targets;
};

/**
 * The activities that reached something for the first time: a list place, a stretch of a route
 * list, or a prefecture. In date order over every published activity, so "new" means new to you,
 * whatever the other filters.
 */
const firstsCache = new WeakMap<Data, Set<string>>();
export const firstsOf = (data: Data): Set<string> => {
  let firsts = firstsCache.get(data);
  if (!firsts) {
    firsts = new Set();
    const seen = new Set<string>();
    const ordered = data.activities.toSorted(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.time ?? '').localeCompare(b.time ?? '') ||
        a.id.localeCompare(b.id),
    );
    for (const activity of ordered) {
      const reached = [
        ...activity.places.map((id) => `place:${id}`),
        ...activity.routeItems.map((id) => `route:${id}`),
        ...Object.keys(activity.prefectures).map((code) => `pref:${code}`),
      ];
      let isNew = false;
      for (const key of reached)
        if (!seen.has(key)) {
          seen.add(key);
          isNew = true;
        }
      if (isNew) firsts.add(activity.id);
    }
    firstsCache.set(data, firsts);
  }
  return firsts;
};

const hoursOf = (activity: ActivityRecord) => {
  const seconds = activity.movingS ?? activity.elapsedS;
  return seconds === null ? null : seconds / 3600;
};

type Test = (activity: ActivityRecord, filters: Filters, data: Data) => boolean;

/** One test per activity facet, so a facet's option counts can leave that facet out. */
const ACTIVITY_TESTS: Record<ActivityKey, Test> = {
  types: (a, f) => f.types.length === 0 || f.types.includes(a.type),
  tags: (a, f) => f.tags.length === 0 || f.tags.some((tag) => a.tags.includes(tag)),
  years: (a, f) => inRange(Number(a.date.slice(0, 4)), f.years),
  when: (a, f) => within(a.date, f.when),
  seasons: (a, f) => f.seasons.length === 0 || f.seasons.includes(seasonOf(monthOf(a))),
  months: (a, f) => f.months.length === 0 || f.months.includes(monthOf(a)),
  days: (a, f) => f.days.length === 0 || f.days.includes(weekdayOf(a.date)),
  prefs: (a, f) => f.prefs.length === 0 || f.prefs.some((code) => code in a.prefectures),
  onLists: (a, f, data) => {
    const lists = f.onLists.flatMap((id) => data.listById.get(id) ?? []);
    if (lists.length === 0) return true;
    return lists.some((list) => {
      const targets = targetsOf(list);
      return (list.kind === 'route' ? a.routeItems : a.places).some((id) => targets.has(id));
    });
  },
  firsts: (a, f, data) => !f.firsts || firstsOf(data).has(a.id),
  repeat: (a, f) => !f.repeat || (f.repeat === 'repeated') === (a.route !== undefined),
  sources: (a, f) => f.sources.length === 0 || f.sources.includes(a.source),
  km: (a, f) => inRange(a.distanceM === null ? null : a.distanceM / 1000, f.km),
  gain: (a, f) => inRange(a.gainM, f.gain),
  hours: (a, f) => {
    const hours = hoursOf(a);
    return (
      (f.hours.min === null && f.hours.max === null) || (hours !== null && inRange(hours, f.hours))
    );
  },
};

/** The activities that pass every activity facet, except `skip` when counting that facet's options. */
export const filterActivities = (
  data: Data,
  filters: Filters,
  skip?: ActivityKey,
): ActivityRecord[] => {
  const tests = ACTIVITY_KEYS.filter((key) => key !== skip && isSet(filters[key])).map(
    (key) => ACTIVITY_TESTS[key],
  );
  if (tests.length === 0) return data.activities;
  return data.activities.filter((activity) => tests.every((test) => test(activity, filters, data)));
};

/** For one activity facet: how many activities each option would match, given the other facets. */
export const activityCounts = (
  data: Data,
  filters: Filters,
  key: ActivityKey,
  valuesOf: (activity: ActivityRecord) => readonly (string | number)[],
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const activity of filterActivities(data, filters, key))
    for (const value of new Set(valuesOf(activity)))
      counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return counts;
};

export const activityValues = {
  types: (a: ActivityRecord) => [a.type],
  tags: (a: ActivityRecord) => a.tags,
  seasons: (a: ActivityRecord) => [seasonOf(monthOf(a))],
  months: (a: ActivityRecord) => [monthOf(a)],
  prefs: (a: ActivityRecord) => Object.keys(a.prefectures),
  sources: (a: ActivityRecord) => [a.source],
  years: (a: ActivityRecord) => [Number(a.date.slice(0, 4))],
  days: (a: ActivityRecord) => [weekdayOf(a.date)],
  repeat: (a: ActivityRecord): Repeat[] => [a.route === undefined ? 'once' : 'repeated'],
};

export interface PrefectureTotals {
  activities: number;
  days: number;
  distanceM: number;
  gainM: number;
  byType: Partial<Record<ActivityType, number>>;
  /** Activities per type, for "has" and "lacks". */
  countByType: Partial<Record<ActivityType, number>>;
}

/** Totals per prefecture from a set of activities: what the map colours and the tooltips show. */
const prefectureTotals = (activities: readonly ActivityRecord[]): Map<string, PrefectureTotals> => {
  const totals = new Map<string, PrefectureTotals>();
  const days = new Map<string, Set<string>>();
  for (const activity of activities) {
    for (const [code, metres] of Object.entries(activity.prefectures)) {
      const entry = totals.get(code) ?? {
        activities: 0,
        days: 0,
        distanceM: 0,
        gainM: 0,
        byType: {},
        countByType: {},
      };
      entry.activities++;
      entry.distanceM += metres;
      entry.gainM += activity.prefectureGain[code] ?? 0;
      entry.byType[activity.type] = (entry.byType[activity.type] ?? 0) + metres;
      entry.countByType[activity.type] = (entry.countByType[activity.type] ?? 0) + 1;
      totals.set(code, entry);
      const seen = days.get(code) ?? new Set<string>();
      seen.add(activity.date);
      days.set(code, seen);
    }
  }
  for (const [code, entry] of totals) entry.days = days.get(code)?.size ?? 0;
  return totals;
};

const metricValue = (totals: PrefectureTotals | undefined, key: Metric) =>
  !totals
    ? 0
    : key === 'km'
      ? totals.distanceM / 1000
      : key === 'gain'
        ? totals.gainM
        : totals[key];

/** Whether a prefecture passes the prefecture facets. */
const prefectureMatches = (totals: PrefectureTotals | undefined, filters: Filters): boolean => {
  const counts = totals?.countByType ?? {};
  return (
    filters.has.every((type) => (counts[type] ?? 0) > 0) &&
    filters.lacks.every((type) => !counts[type]) &&
    (!filters.metric || metricValue(totals, filters.metric.key) >= filters.metric.min)
  );
};

type PlaceTest = (item: ListItem, filters: Filters, context: PlaceContext) => boolean;
interface PlaceContext {
  data: Data;
  visits: (item: ListItem) => number;
}

const PLACE_TESTS: Record<PlaceKey, PlaceTest> = {
  status: (item, f) => f.status.length === 0 || f.status.includes(item.status),
  in: (item, f) => !f.in || item.prefectures.includes(f.in),
  regions: (item, f, { data }) => {
    if (f.regions.length === 0) return true;
    const code = item.prefectures[0];
    const region = code ? data.prefectureByCode.get(code)?.properties.region : undefined;
    return region !== undefined && f.regions.includes(region);
  },
  elev: (item, f) =>
    (f.elev.min === null && f.elev.max === null) ||
    (item.elevationM !== undefined && inRange(item.elevationM, f.elev)),
  visits: (item, f, { visits }) => inRange(visits(item), f.visits),
  firstIn: (item, f) => within(item.first, f.firstIn),
  // A place never reached has no "since": it is left out once this is set.
  idle: (item, f) => !!item.latest && inRange(yearsSince(item.latest), f.idle),
};

export interface Derived {
  filters: Filters;
  /** The activities that pass the activity facets: the one result everything else builds on. */
  activities: ActivityRecord[];
  activityIds: Set<string> | null;
  totals: Map<string, PrefectureTotals>;
  /** Prefectures passing the prefecture facets; null when none are set. */
  matching: Set<string> | null;
  /** Visits to a place in the filtered activities (the published count when no activity facet is set). */
  visits: (item: ListItem) => number;
  /** The list items passing the place facets, except `skip` when counting that facet's options. */
  items: (list: List, skip?: PlaceKey) => ListItem[];
}

let cached: { data: Data; filters: Filters; derived: Derived } | undefined;

/** Everything the filters decide, worked out once per change of filters. */
export const derive = (data: Data, filters: Filters): Derived => {
  if (cached && cached.data === data && cached.filters === filters) return cached.derived;
  const activitiesOn = activityFiltersOn(filters);
  const activities = filterActivities(data, filters);
  const totals = prefectureTotals(activities);
  const placeCounts = new Map<string, number>();
  if (activitiesOn)
    for (const activity of activities)
      for (const place of [...activity.places, ...(activity.areas ?? [])])
        placeCounts.set(place, (placeCounts.get(place) ?? 0) + 1);
  const visits = (item: ListItem) =>
    activitiesOn ? (item.placeId ? (placeCounts.get(item.placeId) ?? 0) : 0) : (item.visits ?? 0);
  const context: PlaceContext = { data, visits };
  const derived: Derived = {
    filters,
    activities,
    activityIds: activitiesOn ? new Set(activities.map((activity) => activity.id)) : null,
    totals,
    matching: prefectureFiltersOn(filters)
      ? new Set(
          data.prefectures.features
            .map((feature) => feature.properties.code)
            .filter((code) => prefectureMatches(totals.get(code), filters)),
        )
      : null,
    visits,
    items: (list, skip) => {
      const tests = PLACE_KEYS.filter((key) => key !== skip && isSet(filters[key])).map(
        (key) => PLACE_TESTS[key],
      );
      return tests.length === 0
        ? list.items
        : list.items.filter((item) => tests.every((test) => test(item, filters, context)));
    },
  };
  cached = { data, filters, derived };
  return derived;
};

/** Sum of distance and climb, for the result line. */
export const summarise = (activities: readonly ActivityRecord[]) => {
  let distanceM = 0;
  let gainM = 0;
  for (const activity of activities) {
    distanceM += activity.distanceM ?? 0;
    gainM += activity.gainM ?? 0;
  }
  return { count: activities.length, distanceM, gainM };
};

interface Figures {
  activities: number;
  days: number;
  distanceM: number;
  gainM: number;
  byType: Partial<Record<ActivityType, number>>;
}

const NOTHING: Figures = { activities: 0, days: 0, distanceM: 0, gainM: 0, byType: {} };

/**
 * A prefecture's totals as the map shows them: the published figures, or with activity filters on,
 * the figures of the matching activities only.
 */
export const figuresOf = (data: Data, derived: Derived, code: string): Figures => {
  if (derived.activityIds) return derived.totals.get(code) ?? NOTHING;
  const p = data.prefectureByCode.get(code)?.properties;
  return p
    ? {
        activities: p.activities,
        days: p.days,
        distanceM: p.distanceM,
        gainM: p.gainM,
        byType: p.byType,
      }
    : NOTHING;
};

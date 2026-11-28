/** The shape of a setup step, shared by the terminal wizard and the web wizard. Data only. */
import type { Config, ConfigKey } from '@jam/core';

import type { JsonPath, Patch } from './jsonc.ts';

export type Kind =
  | 'text'
  | 'number'
  | 'confirm'
  | 'choice'
  | 'multi'
  | 'secret'
  | 'location'
  | 'zones'
  | 'json'
  | 'info';

export type Mode = 'quick' | 'full' | 'change';

/** What a changed setting makes stale; the wizard turns these into "run this next". */
export type Affects = 'strava-auth' | 'full-pull' | 'match' | 'regroup' | 'zones' | 'build';

/** What is true on this machine, found from files rather than remembered. */
export interface Facts {
  /** Whether Strava app credentials are stored. Never the values. */
  stravaCredentials: boolean;
  /** The saved Strava sign-in's granted scope, or null when not signed in. */
  stravaScope: string | null;
  /** List ids the index names whose files are not on this machine. */
  listsMissing: string[];
  listsBuilt: boolean;
  sheetExists: boolean;
  /** Whether the folder `jam sync gpx` reads by default is there. */
  gpxFolderExists: boolean;
  /** Whether a Garmin personal API key is stored. Never the value. */
  garminKey: boolean;
  siteBuilt: boolean;
  /** Whether this version has the `demo` command. */
  demoAvailable: boolean;
}

export interface Ctx {
  mode: Mode;
  /** Answers so far, by step id. */
  answers: Record<string, unknown>;
  /** The config as it is now, defaults filled in. */
  config: Config;
  facts: Facts;
}

export interface SettingRef {
  file: ConfigKey;
  path: JsonPath;
  sensitive?: 'secret' | 'location';
}

export interface Option {
  value: string | number | boolean;
  label: string;
  help?: string;
}

export interface Step {
  /** Also the key in an answers file. */
  id: string;
  group: string;
  /** quick: only in quick setup. full: full setup and change mode. both: everywhere. */
  tier: 'quick' | 'full' | 'both';
  title: string;
  help?: string;
  kind: Kind;
  options?: Option[];
  /** For text and number: an empty answer removes the key. */
  optional?: boolean;
  /** The answer shown first when the config has none. */
  default?: unknown;
  setting?: SettingRef;
  /** The current answer, when it is not simply the value at `setting.path`. */
  read?: (ctx: Ctx) => unknown;
  /** The config values an answer becomes, when it is not one value at `setting.path`. */
  map?: (answer: unknown, ctx: Ctx) => Patch[];
  /** A reason to ask again, beyond what the file's schema says. */
  check?: (answer: unknown, ctx: Ctx) => string | undefined;
  when?: (ctx: Ctx) => boolean;
  affects?: Affects[];
}

export const BUILD: Affects[] = ['build'];
export const MATCH: Affects[] = ['match', 'build'];
export const REGROUP: Affects[] = ['regroup', 'build'];
export const ZONES: Affects[] = ['zones', 'build'];
export const PULL: Affects[] = ['full-pull', 'match', 'build'];

/** One value at one path: the common case. Full setup and change mode unless `extra` says otherwise. */
export const setting = (
  id: string,
  group: string,
  kind: Kind,
  title: string,
  file: ConfigKey,
  path: JsonPath,
  extra: Partial<Step> = {},
): Step => ({ id, group, tier: 'full', kind, title, setting: { file, path }, ...extra });

/** Whether a source was chosen in the "where do activities come from" answer. */
export const has = (ctx: Ctx, source: string): boolean => {
  const chosen = ctx.answers.sources;
  return Array.isArray(chosen) ? chosen.includes(source) : false;
};

/** Roughly the box Japan fits in, islands included; a home outside it is a typing mistake. */
const JAPAN_BOX = { south: 20, north: 46, west: 122, east: 154 };

export interface LatLon {
  lat: number;
  lon: number;
}

/** "35.68, 139.76" or { lat, lon } as a position; null for an empty answer; a string says what is wrong. */
export const parseLocation = (answer: unknown): LatLon | null | string => {
  let lat: number;
  let lon: number;
  if (answer === null || answer === undefined || answer === '') return null;
  if (typeof answer === 'string') {
    const parts = answer.split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 2) return 'Give latitude and longitude, for example 35.6812, 139.7671.';
    lat = Number(parts[0]);
    lon = Number(parts[1]);
  } else if (typeof answer === 'object') {
    lat = Number((answer as Partial<LatLon>).lat);
    lon = Number((answer as Partial<LatLon>).lon);
  } else return 'Give latitude and longitude.';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'Latitude and longitude are numbers.';
  if (
    lat < JAPAN_BOX.south ||
    lat > JAPAN_BOX.north ||
    lon < JAPAN_BOX.west ||
    lon > JAPAN_BOX.east
  )
    return 'That is outside Japan. Latitude comes first (about 24 to 46), then longitude (about 123 to 154).';
  return { lat, lon };
};

/** A typed or sent answer as text; anything that is not a plain value reads as empty. */
export const str = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : '';

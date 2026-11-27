import {
  ACTIVITY_TYPES,
  type ActivityType,
  EVENT_TAGS,
  type EventTag,
  isTimeZone,
} from '@jam/core';

/** What a row records about the places it links to (see templates/README.md). */
export const ROW_STATUSES = ['done', 'dns', 'repeat', 'want'] as const;
export type RowStatus = (typeof ROW_STATUSES)[number];
/** Statuses that describe an outing that happened, so the row becomes an activity. */
export const OUTING_STATUSES: readonly RowStatus[] = ['done', 'dns', 'repeat'];

interface ColumnSpec {
  name: string;
  required: boolean;
  description: string;
}

/** Every column, in template order. Headers are matched case-insensitively; spaces count as _. */
export const COLUMNS: ColumnSpec[] = [
  { name: 'row_id', required: true, description: 'Stable id you assign; the key for updates' },
  { name: 'date', required: true, description: 'YYYY-MM-DD, optionally with HH:MM and an offset' },
  { name: 'end_date', required: false, description: 'Last day of a multi-day trip' },
  {
    name: 'time_zone',
    required: false,
    description: 'IANA zone; default from config (Asia/Tokyo)',
  },
  { name: 'activity_type', required: true, description: 'Hike, Walk, Run, Trail Run or Ride' },
  {
    name: 'event_tags',
    required: false,
    description: 'Comma-separated: race, training, commute, group, solo, overnight',
  },
  { name: 'name', required: true, description: 'Free text' },
  {
    name: 'place',
    required: false,
    description: 'Place id, list item id or exact name; several separated by ;',
  },
  { name: 'status', required: false, description: 'done, DNS, repeat or want; default done' },
  { name: 'lat', required: false, description: 'Latitude, for a place in no list' },
  { name: 'lon', required: false, description: 'Longitude, with lat' },
  { name: 'distance_km', required: false, description: 'Used when there is no track' },
  { name: 'elevation_gain_m', required: false, description: 'Total climb in metres' },
  { name: 'duration', required: false, description: 'H:MM or H:MM:SS, or minutes' },
  { name: 'gpx_path', required: false, description: 'Track file, relative to the sheet' },
  {
    name: 'strava_id',
    required: false,
    description: 'Makes the row an override for that Strava activity',
  },
  {
    name: 'show_strava_link',
    required: false,
    description: 'yes or no: per-activity override of the link setting',
  },
  { name: 'hide', required: false, description: 'yes keeps the activity out of the public build' },
  { name: 'notes', required: false, description: 'Free text, for example "cairn only"' },
];

export const normaliseHeader = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const TYPE_NAMES: Record<string, ActivityType> = Object.fromEntries(
  ACTIVITY_TYPES.flatMap((type) => [
    [type, type],
    [type.replace('_', ' '), type],
    [type.replace('_', ''), type],
  ]),
);

export const parseActivityType = (text: string): ActivityType | undefined =>
  TYPE_NAMES[text.trim().toLowerCase()];

export const parseTags = (text: string): { tags: EventTag[]; unknown: string[] } => {
  const parts = text
    .split(/[,、]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const tags = [
    ...new Set(
      parts.filter((part): part is EventTag => (EVENT_TAGS as readonly string[]).includes(part)),
    ),
  ];
  return {
    tags,
    unknown: parts.filter((part) => !(EVENT_TAGS as readonly string[]).includes(part)),
  };
};

export const parseStatus = (text: string): RowStatus | undefined => {
  const value = text.trim().toLowerCase();
  if (value === '') return 'done';
  return (ROW_STATUSES as readonly string[]).includes(value) ? (value as RowStatus) : undefined;
};

export const parseFlag = (text: string): boolean | undefined | 'invalid' => {
  const value = text.trim().toLowerCase();
  if (value === '') return undefined;
  if (['yes', 'y', 'true', '1', 'はい'].includes(value)) return true;
  if (['no', 'n', 'false', '0', 'いいえ'].includes(value)) return false;
  return 'invalid';
};

/** H:MM, H:MM:SS or a number of minutes, as seconds. */
export const parseDuration = (text: string): number | undefined => {
  const value = text.trim();
  const clock = /^(\d+):([0-5]\d)(?::([0-5]\d))?$/.exec(value);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 60);
  return undefined;
};

export const parseNumber = (text: string): number | undefined => {
  const value = text.trim().replace(/,/g, '');
  return value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
};

export { isTimeZone };

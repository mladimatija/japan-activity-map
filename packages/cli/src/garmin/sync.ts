/**
 * Pulls the key owner's activities from Garmin Connect into the store. Only rows whose source is
 * `garmin` are ever read or written. A pull has two halves: the list (a summary of each activity)
 * and the files (each activity's own recording, which holds the track). Files are fetched a
 * limited number per run, newest first; the next run carries on.
 */
import type { ActivityType, Config, EventTag } from '@jam/core';

import { errorText, JamError } from '../errors.ts';
import { xmlText } from '../lists/zip.ts';
import type { Logger } from '../logger.ts';
import { looksLikeFit } from '../fit.ts';
import { fitActivity, type GpxActivity, gpxActivity } from '../gpx-import/activity.ts';
import { readGpxZip } from '../gpx-import/zip.ts';
import {
  ACTIVITY_COLUMNS,
  type Columns,
  differs,
  TRACK_COLUMNS,
  upsertActivity,
} from '../sheet/sync.ts';
import { backupDatabase } from '../store/backups.ts';
import { keyedId } from '../store/ids.ts';
import type { SqlValue } from '../store/sqlite.ts';
import type { Store } from '../store/store.ts';
import {
  type GarminApi,
  GarminFileError,
  GarminLimitError,
  GarminRequestError,
  PAGE_SIZE,
} from './http.ts';
import { garminActivityType } from './types.ts';

/** The smallest page the list is asked for when Garmin keeps timing out on larger ones. */
const SMALLEST_PAGE = 12;
/** Files in a row without an answer before the run gives up. */
const MOST_STUMBLES = 5;

/** What the list says about one activity. Only `activityId` is certain to be there. */
interface Summary {
  activityId: number;
  activityName?: string | null;
  startTimeLocal?: string | null;
  startTimeGMT?: string | null;
  distance?: number | null;
  duration?: number | null;
  elapsedDuration?: number | null;
  movingDuration?: number | null;
  elevationGain?: number | null;
  startLatitude?: number | null;
  startLongitude?: number | null;
  endLatitude?: number | null;
  endLongitude?: number | null;
  hasPolyline?: boolean | null;
  activityType?: { typeKey?: string | null } | null;
  eventType?: { typeKey?: string | null } | null;
  privacy?: { typeKey?: string | null } | null;
}

/** What is kept of a summary beside the columns: enough to know whether a file is worth asking for. */
interface Raw {
  id: number;
  type: string | null;
  hasPolyline: boolean;
  /** Why the file gave no track, once it was fetched and did not: it is not asked for again. */
  fileProblem?: string;
}

const TYPE_NAMES: Record<ActivityType, string> = {
  hike: 'Hike',
  walk: 'Walk',
  run: 'Run',
  trail_run: 'Trail Run',
  ride: 'Ride',
};
const EVENTS: Record<string, EventTag> = { race: 'race', training: 'training' };

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const rounded = (value: unknown): number | null => {
  const n = finite(value);
  return n === null ? null : Math.round(n);
};
/** Garmin writes "2026-11-20 07:12:33"; the store keeps "2026-11-20T07:12:33". */
const stamp = (text: string | null | undefined): string | undefined => {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(text ?? '');
  return match ? `${match[1]}T${match[2]}` : undefined;
};

/** The store id of a Garmin activity: the same on every pull, and after a wipe. */
export const garminActivityId = (activityId: number): string =>
  keyedId('act', `garmin:${activityId}`);

export const isSummary = (value: unknown): value is Summary =>
  typeof value === 'object' &&
  value !== null &&
  Number.isSafeInteger((value as { activityId?: unknown }).activityId);

type Verdict =
  | { keep: true; id: string; columns: Columns; raw: Raw }
  | { keep: false; reason: 'type' | 'private' | 'undated'; type: string };

/** A summary as the store's columns, or why it is not kept. `has_track` is decided by the caller. */
export const summaryColumns = (
  summary: Summary,
  options: Config['site']['activities']['garmin'],
  timeZone: string,
): Verdict => {
  const typeKey = summary.activityType?.typeKey ?? null;
  const type = garminActivityType(typeKey ?? undefined, options.typeMap);
  if (!type) return { keep: false, reason: 'type', type: typeKey ?? 'unknown' };
  const only = summary.privacy?.typeKey === 'private';
  if (only && !options.includePrivate)
    return { keep: false, reason: 'private', type: typeKey ?? '' };
  const gmt = stamp(summary.startTimeGMT);
  const local = stamp(summary.startTimeLocal) ?? gmt;
  if (!gmt || !local) return { keep: false, reason: 'undated', type: typeKey ?? '' };
  const event = EVENTS[summary.eventType?.typeKey ?? ''];
  const duration = rounded(summary.duration);
  const raw: Raw = {
    id: summary.activityId,
    type: typeKey,
    // Only a plain "no" counts: a list that leaves the field out must not mean no tracks at all.
    hasPolyline: summary.hasPolyline !== false,
  };
  return {
    keep: true,
    id: garminActivityId(summary.activityId),
    raw,
    columns: {
      source: 'garmin',
      strava_id: null,
      start_time: `${gmt}.000Z`,
      start_local: local,
      time_zone: timeZone,
      activity_type: type,
      sport_type: typeKey,
      event_tags: JSON.stringify(event ? [event] : []),
      name: summary.activityName?.trim() || TYPE_NAMES[type],
      distance_m: rounded(summary.distance),
      elevation_gain_m: rounded(summary.elevationGain),
      moving_time_s: rounded(summary.movingDuration) ?? duration,
      elapsed_time_s: rounded(summary.elapsedDuration) ?? duration,
      // Garmin's own word where it gives one; nothing says "everyone" when the field is missing.
      visibility: summary.privacy?.typeKey ? (only ? 'only_me' : 'everyone') : null,
      has_track: 0,
      start_lat: finite(summary.startLatitude),
      start_lon: finite(summary.startLongitude),
      end_lat: finite(summary.endLatitude),
      end_lon: finite(summary.endLongitude),
      raw: JSON.stringify(raw),
    },
  };
};

export interface GarminPull {
  listed: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  skippedTypes: Map<string, number>;
  skippedPrivate: number;
  files: {
    fetched: number;
    withTrack: number;
    withoutTrack: number;
    /** Asked for and not answered this run; asked for again next run. */
    unanswered: number;
    left: number;
  };
  /** Set when Garmin asked to slow down part of the way through. */
  limited?: string;
  backup?: string;
}

interface Options {
  /** Ask for everything in the range again, and remove what Garmin no longer lists. */
  full: boolean;
  /**
   * This run only: the days to list and to fetch files for (inclusive, YYYY-MM-DD). It narrows
   * the configured range, and the pull is not counted as one that later pulls carry on from.
   */
  range?: { from?: string; to?: string };
  /** Files to fetch this run; undefined for the configured number. */
  files?: number;
  dryRun: boolean;
}

const rawOf = (row: Record<string, SqlValue>): Raw | undefined => {
  try {
    const raw = JSON.parse(String(row.raw ?? '')) as Raw;
    return Number.isSafeInteger(raw.id) ? raw : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What Garmin sent for one activity, as a track: a zip holding the recording, or the recording
 * itself. Throws an Error saying why there is no track in it.
 */
const recording = (bytes: Uint8Array, id: number, name: string, timeZone: string): GpxActivity => {
  const read = { defaultType: 'hike' as const, timeZone };
  if (looksLikeFit(bytes)) return fitActivity(bytes, { label: `${id}.fit`, name }, read);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const file = readGpxZip(bytes, `activity ${id}`).entries[0];
    if (!file) throw new Error('its file is neither FIT nor GPX');
    const ref = { label: file.name, name };
    return /\.fit$/i.test(file.name)
      ? fitActivity(file.read(), ref, read)
      : gpxActivity(xmlText(file.read()), ref, read);
  }
  return gpxActivity(xmlText(bytes), { label: `${id}.gpx`, name }, read);
};

/** The settings that decide which activities are kept, as one text to compare. */
const keptBy = (settings: Config['site']['activities']['garmin']): string =>
  JSON.stringify([
    settings.from ?? null,
    settings.to ?? null,
    settings.includePrivate,
    Object.entries(settings.typeMap).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);

/**
 * A week before the last good pull: activities synced late from a watch still arrive. Undefined,
 * so that everything is listed, when there was none or when it kept activities by other settings:
 * turning Only Me on, or adding a type, has to reach the old activities too.
 */
const since = (store: Store, kept: string): string | undefined => {
  const details = (row: { details: string | null }): { kept?: string; range?: unknown } => {
    try {
      return JSON.parse(row.details ?? '{}') as { kept?: string; range?: unknown };
    } catch {
      return {};
    }
  };
  // The newest good pull since the last wipe. A pull of one range says nothing about the days
  // outside it, and a wipe starts the history over: after one, everything is listed again.
  const history = store.db.all<{ started_at: string; outcome: string; details: string | null }>(
    `SELECT started_at, outcome, details FROM pulls WHERE source = 'garmin' ORDER BY id DESC`,
  );
  const wipedAt = history.findIndex((row) => row.outcome === 'wiped');
  const last = (wipedAt < 0 ? history : history.slice(0, wipedAt)).find(
    (row) => (row.outcome === 'ok' || row.outcome === 'partial') && !details(row).range,
  );
  if (!last) return undefined;
  if (details(last).kept !== kept) return undefined;
  return new Date(Date.parse(last.started_at) - 7 * 86_400_000).toISOString().slice(0, 10);
};

export const pullGarmin = async (
  store: Store,
  api: GarminApi,
  config: Pick<Config, 'site' | 'sheet'>,
  options: Options,
  log: Logger,
): Promise<GarminPull> => {
  const { db } = store;
  const settings = config.site.activities.garmin;
  const result: GarminPull = {
    listed: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    skippedTypes: new Map(),
    skippedPrivate: 0,
    files: { fetched: 0, withTrack: 0, withoutTrack: 0, unanswered: 0, left: 0 },
  };
  const { range } = options;
  const later = (a: string | undefined, b: string | undefined) =>
    a && b ? (a > b ? a : b) : (a ?? b);
  const earlier = (a: string | undefined, b: string | undefined) =>
    a && b ? (a < b ? a : b) : (a ?? b);
  const incremental = options.full || range ? undefined : since(store, keptBy(settings));
  /** The first and last day wanted at all: the settings, narrowed by this run's range. */
  const firstDay = later(settings.from, range?.from);
  const endDate = earlier(settings.to, range?.to);
  if (firstDay && endDate && firstDay > endDate)
    throw new JamError(
      `Nothing to fetch: ${firstDay} to ${endDate} is no range of days. --from and --to narrow activities.garmin.from and to in config/site.jsonc; they do not reach outside them.`,
    );
  const startDate = later(incremental, firstDay);
  // Garmin does not say whether it counts days by local time or by GMT. One day more is asked for
  // on each side and the answer cut back to the days wanted, so that an activity early or late in
  // a day is neither missed nor, on a full pull of a range, taken for one Garmin no longer has.
  const shifted = (day: string | undefined, by: number) =>
    day
      ? new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10)
      : day;
  const [askFrom, askTo] = [shifted(startDate, -1), shifted(endDate, 1)];
  const wantedDay = (entry: { startTimeLocal?: string | null }): boolean => {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(entry.startTimeLocal ?? '')?.[0];
    return !day || ((!firstDay || day >= firstDay) && (!endDate || day <= endDate));
  };
  /** Whether a stored activity started inside this run's range. */
  const inRange = (startLocal: SqlValue | undefined): boolean => {
    if (!range) return true;
    const day = String(startLocal ?? '').slice(0, 10);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  };

  // The list, page by page.
  const kept: Extract<Verdict, { keep: true }>[] = [];
  /** Listed, and no longer kept: set to Only Me since, or to a type that is skipped. */
  const dropped: string[] = [];
  // A long page can be more than Garmin's gateway waits for: when a page keeps failing, it is
  // asked for again in halves, and the smaller size is kept for the rest of the run.
  let limit = PAGE_SIZE;
  for (let start = 0; ;) {
    let page: unknown[];
    try {
      page = await api.list({
        start,
        limit,
        ...(askFrom ? { startDate: askFrom } : {}),
        ...(askTo ? { endDate: askTo } : {}),
      });
    } catch (failure) {
      if (!(failure instanceof GarminRequestError) || limit <= SMALLEST_PAGE) throw failure;
      limit = Math.max(SMALLEST_PAGE, Math.floor(limit / 2));
      log.debug(`Garmin: the list did not answer; asking for ${limit} at a time`);
      continue;
    }
    for (const entry of page) {
      if (!isSummary(entry) || !wantedDay(entry)) continue;
      result.listed++;
      const verdict = summaryColumns(entry, settings, config.sheet.timeZone);
      if (verdict.keep) kept.push(verdict);
      else if (verdict.reason !== 'undated') dropped.push(garminActivityId(entry.activityId));
      if (verdict.keep) continue;
      if (verdict.reason === 'private') result.skippedPrivate++;
      else result.skippedTypes.set(verdict.type, (result.skippedTypes.get(verdict.type) ?? 0) + 1);
    }
    log.progress(
      result.listed,
      Math.max(result.listed, start + page.length),
      'Garmin activities listed',
    );
    if (page.length < limit) break;
    start += page.length;
  }

  const current = new Map(
    db
      .all<Record<string, SqlValue>>(`SELECT * FROM activities WHERE source = 'garmin'`)
      .map((row) => [String(row.id), row]),
  );
  const tracked = new Set(
    db
      .all<{ activity_id: string }>(
        `SELECT t.activity_id FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'garmin'`,
      )
      .map((row) => row.activity_id),
  );
  // What the file already gave stays: the list knows nothing of a track's end or of a file problem.
  const columns = ACTIVITY_COLUMNS.filter((column) => column !== 'raw' && column !== 'has_track');
  for (const entry of kept) {
    const row = current.get(entry.id);
    const before = row ? rawOf(row) : undefined;
    // A full pull asks again for the files that gave nothing.
    if (before?.fileProblem && !options.full) entry.raw.fileProblem = before.fileProblem;
    entry.columns.raw = JSON.stringify(entry.raw);
    entry.columns.has_track = tracked.has(entry.id) ? 1 : 0;
    if (tracked.has(entry.id) && row) {
      entry.columns.end_lat = entry.columns.end_lat ?? row.end_lat ?? null;
      entry.columns.end_lon = entry.columns.end_lon ?? row.end_lon ?? null;
    }
    if (!row) result.added++;
    else if (differs(row, entry.columns, columns).length > 0) result.updated++;
    else result.unchanged++;
  }
  // Only a full pull has seen everything, so only a full pull can say what Garmin no longer has.
  // What was listed and is no longer kept goes on any pull: an activity set to Only Me since it
  // was fetched must not stay on the site.
  const listedIds = new Set(kept.map((entry) => entry.id));
  // With a range, a full pull has seen everything inside it and nothing outside.
  const gone = options.full
    ? [...current.entries()]
        .filter(([id, row]) => !listedIds.has(id) && inRange(row.start_local))
        .map(([id]) => id)
    : dropped.filter((id) => current.has(id));
  result.removed = gone.length;

  const fileLimit = options.files ?? settings.filesPerSync;
  const wanted = (raw: Raw | undefined, id: string) =>
    raw?.hasPolyline === true && !raw.fileProblem && !tracked.has(id);
  if (options.dryRun) {
    const waiting =
      kept.filter((entry) => wanted(entry.raw, entry.id)).length +
      [...current.entries()].filter(
        ([id, row]) =>
          !listedIds.has(id) &&
          !gone.includes(id) &&
          inRange(row.start_local) &&
          wanted(rawOf(row), id),
      ).length;
    result.files.left = waiting;
    return result;
  }

  if (gone.length > 0) result.backup = await backupDatabase(db, 'before-wipe-garmin-full');
  const now = new Date().toISOString();
  const pull = db.transaction(() => {
    const started = db.run(
      `INSERT INTO pulls (source, started_at, range_from, range_to, include_private, outcome) VALUES ('garmin', ?, ?, ?, ?, 'running')`,
      [now, startDate ?? null, endDate ?? null, settings.includePrivate ? 1 : 0],
    );
    for (const entry of kept)
      upsertActivity(db, store.salt, entry.id, entry.columns, current.get(entry.id), now);
    for (const id of gone)
      db.run(`DELETE FROM activities WHERE id = ? AND source = 'garmin'`, [id]);
    return started.lastId;
  });

  // The files: newest first, so a new outing has its track on the first run after it.
  const queue = db
    .all<Record<string, SqlValue>>(
      `SELECT a.id, a.raw, a.name, a.start_time, a.start_local FROM activities a
       WHERE a.source = 'garmin' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.activity_id = a.id)
       ORDER BY a.start_time DESC`,
    )
    .filter((row) => inRange(row.start_local) && wanted(rawOf(row), String(row.id)));
  const batch = queue.slice(0, fileLimit);
  result.files.left = queue.length - batch.length;
  let outcome: 'ok' | 'partial' = 'ok';
  let error: string | undefined;
  let stumbles = 0;
  try {
    for (const [index, row] of batch.entries()) {
      const raw = rawOf(row);
      if (!raw) continue;
      let track: Columns | undefined;
      let ends: [SqlValue, SqlValue] = [null, null];
      let problem: string | undefined;
      let bytes: Uint8Array | undefined;
      try {
        bytes = await api.file(raw.id);
        if (!bytes) problem = 'Garmin has no file for it';
      } catch (failure) {
        if (failure instanceof GarminLimitError) {
          outcome = 'partial';
          error = failure.message;
          result.limited = failure.message;
          result.files.left += batch.length - index;
          break;
        }
        if (failure instanceof GarminRequestError) {
          // Garmin did not answer for this one (a timeout at its gateway, usually). It is asked
          // for again next run; the others go on, more slowly (the client widens its own gap).
          // Several in a row end the run.
          result.files.unanswered++;
          stumbles++;
          log.debug(`Garmin activity ${raw.id}: no answer (${failure.message})`);
          if (stumbles >= MOST_STUMBLES) {
            outcome = 'partial';
            error = failure.message;
            result.limited = `Garmin Connect stopped answering (${stumbles} files in a row). What was fetched is kept; run the command again later and it carries on.`;
            result.files.left += batch.length - index - 1;
            break;
          }
          continue;
        }
        if (!(failure instanceof GarminFileError)) throw failure;
        problem = failure.message;
      }
      stumbles = 0;
      result.files.fetched++;
      if (bytes) {
        // A file that cannot be read says so once and is not asked for on every run after.
        try {
          const parsed = recording(
            bytes,
            raw.id,
            String(row.name ?? raw.id),
            config.sheet.timeZone,
          );
          track = parsed.track;
          ends = [parsed.activity.end_lat ?? null, parsed.activity.end_lon ?? null];
        } catch (failure) {
          problem = errorText(failure);
        }
      }
      db.transaction(() => {
        if (track) {
          db.run(
            `INSERT INTO tracks (activity_id, ${TRACK_COLUMNS.join(', ')}, fetched_at) VALUES (?, ${TRACK_COLUMNS.map(() => '?').join(', ')}, ?)
           ON CONFLICT (activity_id) DO UPDATE SET ${TRACK_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, fetched_at = excluded.fetched_at`,
            [String(row.id), ...TRACK_COLUMNS.map((column) => track?.[column] ?? null), now],
          );
          db.run(
            `UPDATE activities SET has_track = 1, end_lat = COALESCE(end_lat, ?), end_lon = COALESCE(end_lon, ?), updated_at = ? WHERE id = ?`,
            [ends[0], ends[1], now, String(row.id)],
          );
          result.files.withTrack++;
        } else {
          db.run(`UPDATE activities SET raw = ?, updated_at = ? WHERE id = ?`, [
            JSON.stringify({ ...raw, fileProblem: problem ?? 'no track' }),
            now,
            String(row.id),
          ]);
          result.files.withoutTrack++;
          log.debug(`Garmin activity ${raw.id}: no track (${problem ?? 'no track'})`);
        }
      });
      log.progress(index + 1, batch.length, 'Garmin files fetched');
    }
  } catch (failure) {
    // The list is in, so the pull counts as one to carry on from: the run after this one lists
    // only what is new and goes on with the files.
    db.run(
      `UPDATE pulls SET finished_at = ?, added = ?, updated = ?, removed = ?, outcome = 'partial', error = ?, details = ? WHERE id = ?`,
      [
        new Date().toISOString(),
        result.added,
        result.updated,
        result.removed,
        errorText(failure),
        JSON.stringify({
          listed: result.listed,
          files: result.files,
          full: options.full,
          kept: keptBy(settings),
          ...(range ? { range } : {}),
        }),
        pull,
      ],
    );
    throw failure;
  }
  db.run(
    `UPDATE pulls SET finished_at = ?, added = ?, updated = ?, removed = ?, outcome = ?, error = ?, details = ? WHERE id = ?`,
    [
      new Date().toISOString(),
      result.added,
      result.updated,
      result.removed,
      outcome,
      error ?? null,
      JSON.stringify({
        listed: result.listed,
        files: result.files,
        full: options.full,
        kept: keptBy(settings),
        ...(range ? { range } : {}),
      }),
      pull,
    ],
  );
  return result;
};

/** Deletes every Garmin activity with its track, after a copy of the store. Nothing else is touched. */
export const wipeGarmin = async (
  store: Store,
  dryRun: boolean,
): Promise<{ activities: number; tracks: number; backup?: string }> => {
  const { db } = store;
  const number = (sql: string) => Number(db.get<{ n: number }>(sql)?.n ?? 0);
  const activities = number(`SELECT COUNT(*) AS n FROM activities WHERE source = 'garmin'`);
  const tracks = number(
    `SELECT COUNT(*) AS n FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'garmin'`,
  );
  if (dryRun) return { activities, tracks };
  const backup = await backupDatabase(db, 'before-wipe-garmin');
  db.transaction(() => {
    db.run(`DELETE FROM activities WHERE source = 'garmin'`);
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO pulls (source, started_at, finished_at, outcome, added, updated, removed) VALUES ('garmin', ?, ?, 'wiped', 0, 0, ?)`,
      [now, now, activities],
    );
  });
  return { activities, tracks, backup };
};

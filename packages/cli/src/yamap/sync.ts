/**
 * Pulls the user's own YAMAP activities into the store. Only rows whose source is `yamap` are ever
 * read or written. A pull has two halves: the list (what YAMAP says about each activity) and the
 * tracks (each activity's recording, as YAMAP's own GPX export). Tracks are fetched a limited
 * number per run, newest first; the next run carries on.
 *
 * The list is given to anyone; the tracks only to their owner, with a sign-in token that expires.
 * When YAMAP refuses the token, the run keeps the list, stops asking for tracks, and says so:
 * nothing is marked as having no track because of it.
 */
import type { ActivityType, Config } from '@jam/core';

import { errorText, JamError } from '../errors.ts';
import { type GpxActivity, gpxActivity } from '../gpx-import/activity.ts';
import { xmlText } from '../lists/zip.ts';
import type { Logger } from '../logger.ts';
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
import { type YamapApi, YamapLimitError, YamapRequestError, YamapTokenError } from './http.ts';

/** What the list or the details say about one activity. Only `id` is certain to be there. */
interface Summary {
  id: number;
  title?: string | null;
  /** Unix seconds. */
  start_at?: number | null;
  finish_at?: number | null;
  /** Hours east of GMT, 9 in Japan. */
  time_zone?: number | null;
  /** Metres. */
  distance?: number | null;
  cumulative_up?: number | null;
  has_points?: boolean | null;
  public_type?: string | null;
}

/** What is kept of a summary beside the columns. */
interface Raw {
  id: number;
  url: string;
  /** Only a plain "no" from YAMAP counts as having no track. */
  hasPoints: boolean;
  /** Why the track gave nothing, once it was fetched and did not: it is not asked for again. */
  trackProblem?: string;
}

const TYPE_NAMES: Record<ActivityType, string> = {
  hike: 'Hike',
  walk: 'Walk',
  run: 'Run',
  trail_run: 'Trail Run',
  ride: 'Ride',
};
/** Tracks in a row without an answer before the run gives up. */
const MOST_STUMBLES = 5;

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The store id of a YAMAP activity: the same on every pull, and after a wipe. */
export const yamapActivityId = (id: number): string => keyedId('act', `yamap:${id}`);

export const isSummary = (value: unknown): value is Summary =>
  typeof value === 'object' &&
  value !== null &&
  Number.isSafeInteger((value as { id?: unknown }).id);

/** The local wall-clock time of a moment, `hours` east of GMT, as the store keeps it. */
const localAt = (ms: number, hours: number): string =>
  new Date(ms + hours * 3_600_000).toISOString().slice(0, 19);

/** A summary as the store's columns; undefined when it does not say when the activity started. */
export const summaryColumns = (
  summary: Summary,
  type: ActivityType,
  timeZone: string,
): { id: string; columns: Columns; raw: Raw; day: string } | undefined => {
  const start = finite(summary.start_at);
  if (start === undefined) return undefined;
  const finish = finite(summary.finish_at);
  const hours = finite(summary.time_zone) ?? 9;
  const local = localAt(start * 1000, hours);
  const raw: Raw = {
    id: summary.id,
    url: `https://yamap.com/activities/${summary.id}`,
    hasPoints: summary.has_points !== false,
  };
  const distance = finite(summary.distance);
  const climb = finite(summary.cumulative_up);
  return {
    id: yamapActivityId(summary.id),
    raw,
    day: local.slice(0, 10),
    columns: {
      source: 'yamap',
      strava_id: null,
      start_time: new Date(start * 1000).toISOString(),
      start_local: local,
      time_zone: timeZone,
      activity_type: type,
      sport_type: null,
      event_tags: '[]',
      name: summary.title?.trim() || TYPE_NAMES[type],
      distance_m: distance === undefined ? null : Math.round(distance),
      elevation_gain_m: climb === undefined ? null : Math.round(climb),
      // YAMAP gives no moving time; the track does, once it is fetched.
      moving_time_s: null,
      elapsed_time_s: finish !== undefined && finish >= start ? Math.round(finish - start) : null,
      // Only a plain "public" counts as public; anything else YAMAP says is treated as private.
      visibility: summary.public_type
        ? summary.public_type === 'public'
          ? 'everyone'
          : 'only_me'
        : null,
      has_track: 0,
      start_lat: null,
      start_lon: null,
      end_lat: null,
      end_lon: null,
      raw: JSON.stringify(raw),
    },
  };
};

export interface YamapPull {
  listed: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** Activities whose start YAMAP did not say, even when asked for their details. */
  undated: number;
  tracks: {
    fetched: number;
    withTrack: number;
    withoutTrack: number;
    /** Asked for and not answered this run; asked for again next run. */
    unanswered: number;
    left: number;
  };
  /** Set when YAMAP refused the sign-in token: the message to show. */
  tokenRefused?: string;
  /** Set when tracks were wanted and there is no token at all. */
  tokenMissing?: boolean;
  /** Set when YAMAP asked to slow down, or stopped answering, part of the way through. */
  limited?: string;
  backup?: string;
}

interface Options {
  /** List everything again, and remove what YAMAP no longer lists. */
  full: boolean;
  /** This run only: the days to list and to fetch tracks for (inclusive, YYYY-MM-DD). */
  range?: { from?: string; to?: string };
  /** Tracks to fetch this run; undefined for the configured number. */
  tracks?: number;
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
 * Whether a pull since the last wipe read the whole list, with the same first day configured:
 * only then is everything older than a page of known activities sure to be in the store.
 */
const wholeListRead = (store: Store, from: string | null): boolean => {
  const history = store.db.all<{ outcome: string; details: string | null }>(
    `SELECT outcome, details FROM pulls WHERE source = 'yamap' ORDER BY id DESC`,
  );
  const wipedAt = history.findIndex((row) => row.outcome === 'wiped');
  return (wipedAt < 0 ? history : history.slice(0, wipedAt)).some((row) => {
    try {
      const details = JSON.parse(row.details ?? '{}') as { wholeList?: boolean; from?: unknown };
      return details.wholeList === true && (details.from ?? null) === from;
    } catch {
      return false;
    }
  });
};

/** A recording as a track, read by the same code as any GPX file. */
const recording = (
  bytes: Uint8Array,
  id: number,
  name: string,
  type: ActivityType,
  timeZone: string,
): GpxActivity =>
  gpxActivity(xmlText(bytes), { label: `${id}.gpx`, name }, { defaultType: type, timeZone });

export const pullYamap = async (
  store: Store,
  api: YamapApi,
  config: Pick<Config, 'site' | 'sheet'>,
  options: Options,
  log: Logger,
): Promise<YamapPull> => {
  const { db } = store;
  const settings = config.site.activities.yamap;
  const userId = settings.userId;
  if (!userId)
    throw new JamError(
      'No YAMAP user id. Put the number from your profile address (yamap.com/users/<number>) in config/site.jsonc as activities.yamap.userId, or run `pnpm jam setup`. See docs/yamap.md.',
    );
  const result: YamapPull = {
    listed: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
    undated: 0,
    tracks: { fetched: 0, withTrack: 0, withoutTrack: 0, unanswered: 0, left: 0 },
  };
  const { range } = options;
  const later = (a: string | undefined, b: string | undefined) =>
    a && b ? (a > b ? a : b) : (a ?? b);
  const earlier = (a: string | undefined, b: string | undefined) =>
    a && b ? (a < b ? a : b) : (a ?? b);
  const firstDay = later(settings.from, range?.from);
  const lastDay = earlier(settings.to, range?.to);
  if (firstDay && lastDay && firstDay > lastDay)
    throw new JamError(
      `Nothing to fetch: ${firstDay} to ${lastDay} is no range of days. --from and --to narrow activities.yamap.from and to in config/site.jsonc; they do not reach outside them.`,
    );
  const wantedDay = (day: string) => (!firstDay || day >= firstDay) && (!lastDay || day <= lastDay);

  const current = new Map(
    db
      .all<Record<string, SqlValue>>(`SELECT * FROM activities WHERE source = 'yamap'`)
      .map((row) => [String(row.id), row]),
  );
  const tracked = new Set(
    db
      .all<{ activity_id: string }>(
        `SELECT t.activity_id FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'yamap'`,
      )
      .map((row) => row.activity_id),
  );

  // The list, page by page. YAMAP has no "since": a plain pull stops at the first page that holds
  // nothing new. That is only safe when the pages run from the newest activity to the oldest,
  // which is checked on every page, and when some earlier pull has read the whole list, so that
  // everything older is known to be in the store already (a pull of some days does not count).
  const readBefore = wholeListRead(store, settings.from ?? null);
  const kept: NonNullable<ReturnType<typeof summaryColumns>>[] = [];
  const seen = new Set<string>();
  let newestFirst = true;
  let before = Number.POSITIVE_INFINITY;
  let everything = true;
  for (let page = 1; ;) {
    const answer = await api.list(userId, page);
    let fresh = 0;
    let allBeforeRange = answer.activities.length > 0;
    for (const entry of answer.activities) {
      if (!isSummary(entry)) continue;
      let summary = entry;
      // A list that leaves the start out: the details have it.
      if (finite(summary.start_at) === undefined) {
        const details = await api.activity(entry.id);
        if (isSummary(details)) summary = { ...details, ...entry, start_at: details.start_at };
      }
      const start = finite(summary.start_at);
      if (start !== undefined) {
        if (start > before) newestFirst = false;
        before = start;
      }
      const columns = summaryColumns(summary, settings.defaultType, config.sheet.timeZone);
      if (!columns) {
        result.undated++;
        allBeforeRange = false;
        continue;
      }
      seen.add(columns.id);
      if (!firstDay || columns.day >= firstDay) allBeforeRange = false;
      if (!wantedDay(columns.day)) continue;
      result.listed++;
      if (!current.has(columns.id)) fresh++;
      kept.push(columns);
    }
    log.progress(
      result.listed,
      Math.max(result.listed, answer.total ?? result.listed),
      'YAMAP activities listed',
    );
    if (answer.next === undefined) break;
    if (newestFirst && allBeforeRange) {
      // Past the first day wanted: the rest is older still.
      everything = false;
      break;
    }
    if (newestFirst && readBefore && !options.full && !range && fresh === 0) {
      // A page with nothing new, and everything older is in the store already.
      everything = false;
      break;
    }
    page = answer.next;
  }

  const columnsToCompare = ACTIVITY_COLUMNS.filter(
    (column) =>
      ![
        'raw',
        'has_track',
        'moving_time_s',
        'start_lat',
        'start_lon',
        'end_lat',
        'end_lon',
      ].includes(column),
  );
  for (const entry of kept) {
    const row = current.get(entry.id);
    const was = row ? rawOf(row) : undefined;
    // A full pull asks again for the tracks that gave nothing.
    if (was?.trackProblem && !options.full) entry.raw.trackProblem = was.trackProblem;
    entry.columns.raw = JSON.stringify(entry.raw);
    if (row) {
      // What the track gave stays: the list knows nothing of it.
      entry.columns.has_track = tracked.has(entry.id) ? 1 : 0;
      for (const column of [
        'moving_time_s',
        'start_lat',
        'start_lon',
        'end_lat',
        'end_lon',
      ] as const)
        entry.columns[column] = row[column] ?? null;
      entry.columns.distance_m = entry.columns.distance_m ?? row.distance_m ?? null;
      entry.columns.elevation_gain_m =
        entry.columns.elevation_gain_m ?? row.elevation_gain_m ?? null;
      entry.columns.elapsed_time_s = entry.columns.elapsed_time_s ?? row.elapsed_time_s ?? null;
    }
    if (!row) result.added++;
    else if (differs(row, entry.columns, columnsToCompare).length > 0) result.updated++;
    else result.unchanged++;
  }
  // Only a full pull that read the list to its end has seen everything, so only it can say what
  // is gone; with a range, only inside the range.
  const inRange = (row: Record<string, SqlValue>) =>
    wantedDay(String(row.start_local ?? '').slice(0, 10));
  const gone =
    options.full && (everything || range)
      ? [...current.entries()]
          .filter(([id, row]) => !seen.has(id) && inRange(row))
          .map(([id]) => id)
      : [];
  result.removed = gone.length;

  const trackLimit = options.tracks ?? settings.tracksPerSync;
  const wanted = (raw: Raw | undefined, id: string) =>
    raw !== undefined && raw.hasPoints && !raw.trackProblem && !tracked.has(id);
  if (options.dryRun) {
    const listedIds = new Set(kept.map((entry) => entry.id));
    result.tracks.left =
      kept.filter((entry) => wanted(entry.raw, entry.id)).length +
      [...current.entries()].filter(
        ([id, row]) =>
          !listedIds.has(id) && !gone.includes(id) && inRange(row) && wanted(rawOf(row), id),
      ).length;
    return result;
  }

  if (gone.length > 0) result.backup = await backupDatabase(db, 'before-wipe-yamap-full');
  const now = new Date().toISOString();
  const pull = db.transaction(() => {
    const started = db.run(
      `INSERT INTO pulls (source, started_at, range_from, range_to, outcome) VALUES ('yamap', ?, ?, ?, 'running')`,
      [now, firstDay ?? null, lastDay ?? null],
    );
    for (const entry of kept)
      upsertActivity(db, store.salt, entry.id, entry.columns, current.get(entry.id), now);
    for (const id of gone) db.run(`DELETE FROM activities WHERE id = ? AND source = 'yamap'`, [id]);
    return started.lastId;
  });

  // The tracks: newest first, so a new outing has its track on the first run after it.
  const queue = db
    .all<Record<string, SqlValue>>(
      `SELECT a.* FROM activities a
       WHERE a.source = 'yamap' AND NOT EXISTS (SELECT 1 FROM tracks t WHERE t.activity_id = a.id)
       ORDER BY a.start_time DESC`,
    )
    .filter((row) => inRange(row) && wanted(rawOf(row), String(row.id)));
  const batch = api.hasToken ? queue.slice(0, trackLimit) : [];
  result.tracks.left = queue.length - batch.length;
  let outcome: 'ok' | 'partial' = 'ok';
  let error: string | undefined;
  let stumbles = 0;
  const finish = (failure?: unknown) =>
    db.run(
      `UPDATE pulls SET finished_at = ?, added = ?, updated = ?, removed = ?, outcome = ?, error = ?, details = ? WHERE id = ?`,
      [
        new Date().toISOString(),
        result.added,
        result.updated,
        result.removed,
        failure === undefined ? outcome : 'partial',
        failure === undefined ? (error ?? null) : errorText(failure),
        JSON.stringify({
          listed: result.listed,
          tracks: result.tracks,
          full: options.full,
          ...(range ? { range } : {}),
          // Without a range, the pull read the list as far as the settings reach, or stopped where
          // an earlier one like it had: nothing older is left unlisted.
          ...(range ? {} : { wholeList: true, from: settings.from ?? null }),
          ...(result.tokenRefused ? { tokenRefused: true } : {}),
        }),
        pull,
      ],
    );
  if (!api.hasToken && queue.length > 0) {
    outcome = 'partial';
    result.tokenMissing = true;
    error = 'no sign-in token';
  }
  try {
    for (const [index, row] of batch.entries()) {
      const raw = rawOf(row);
      if (!raw) continue;
      let parsed: GpxActivity | undefined;
      let problem: string | undefined;
      let bytes: Uint8Array | undefined;
      try {
        bytes = await api.track(raw.id);
        if (!bytes) problem = 'YAMAP has no track for it';
      } catch (failure) {
        if (failure instanceof YamapTokenError) {
          // Not this activity's fault: nothing is marked, and no more tracks are asked for.
          outcome = 'partial';
          error = failure.message;
          result.tokenRefused = failure.message;
          result.tracks.left += batch.length - index;
          break;
        }
        if (failure instanceof YamapLimitError) {
          outcome = 'partial';
          error = failure.message;
          result.limited = failure.message;
          result.tracks.left += batch.length - index;
          break;
        }
        if (!(failure instanceof YamapRequestError)) throw failure;
        result.tracks.unanswered++;
        stumbles++;
        log.debug(`YAMAP activity ${raw.id}: no answer (${failure.message})`);
        if (stumbles >= MOST_STUMBLES) {
          outcome = 'partial';
          error = failure.message;
          result.limited = `YAMAP stopped answering (${stumbles} tracks in a row). What was fetched is kept; run the command again later and it carries on.`;
          result.tracks.left += batch.length - index - 1;
          break;
        }
        continue;
      }
      stumbles = 0;
      result.tracks.fetched++;
      if (bytes) {
        // A track that cannot be read says so once and is not asked for on every run after.
        try {
          parsed = recording(
            bytes,
            raw.id,
            String(row.name ?? raw.id),
            String(row.activity_type) as ActivityType,
            config.sheet.timeZone,
          );
        } catch (failure) {
          problem = errorText(failure);
        }
      }
      db.transaction(() => {
        if (parsed) {
          const { track, activity } = parsed;
          db.run(
            `INSERT INTO tracks (activity_id, ${TRACK_COLUMNS.join(', ')}, fetched_at) VALUES (?, ${TRACK_COLUMNS.map(() => '?').join(', ')}, ?)
             ON CONFLICT (activity_id) DO UPDATE SET ${TRACK_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, fetched_at = excluded.fetched_at`,
            [String(row.id), ...TRACK_COLUMNS.map((column) => track[column] ?? null), now],
          );
          // YAMAP's own figures stay where it gave them; the track fills in the rest.
          db.run(
            `UPDATE activities SET has_track = 1,
               moving_time_s = ?, start_lat = ?, start_lon = ?, end_lat = ?, end_lon = ?,
               distance_m = COALESCE(distance_m, ?), elevation_gain_m = COALESCE(elevation_gain_m, ?),
               elapsed_time_s = COALESCE(elapsed_time_s, ?), updated_at = ? WHERE id = ?`,
            [
              activity.moving_time_s ?? null,
              activity.start_lat ?? null,
              activity.start_lon ?? null,
              activity.end_lat ?? null,
              activity.end_lon ?? null,
              activity.distance_m ?? null,
              activity.elevation_gain_m ?? null,
              activity.elapsed_time_s ?? null,
              now,
              String(row.id),
            ],
          );
          result.tracks.withTrack++;
        } else {
          db.run(`UPDATE activities SET raw = ?, updated_at = ? WHERE id = ?`, [
            JSON.stringify({ ...raw, trackProblem: problem ?? 'no track' }),
            now,
            String(row.id),
          ]);
          result.tracks.withoutTrack++;
          log.debug(`YAMAP activity ${raw.id}: no track (${problem ?? 'no track'})`);
        }
      });
      log.progress(index + 1, batch.length, 'YAMAP tracks fetched');
    }
  } catch (failure) {
    // The list is in; the run after this one carries on with the tracks.
    finish(failure);
    throw failure;
  }
  finish();
  return result;
};

/** Deletes every YAMAP activity with its track, after a copy of the store. Nothing else is touched. */
export const wipeYamap = async (
  store: Store,
  dryRun: boolean,
): Promise<{ activities: number; tracks: number; backup?: string }> => {
  const { db } = store;
  const number = (sql: string) => Number(db.get<{ n: number }>(sql)?.n ?? 0);
  const activities = number(`SELECT COUNT(*) AS n FROM activities WHERE source = 'yamap'`);
  const tracks = number(
    `SELECT COUNT(*) AS n FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'yamap'`,
  );
  if (dryRun) return { activities, tracks };
  const backup = await backupDatabase(db, 'before-wipe-yamap');
  db.transaction(() => {
    db.run(`DELETE FROM activities WHERE source = 'yamap'`);
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO pulls (source, started_at, finished_at, outcome, added, updated, removed) VALUES ('yamap', ?, ?, 'wiped', 0, 0, ?)`,
      [now, now, activities],
    );
  });
  return { activities, tracks, backup };
};

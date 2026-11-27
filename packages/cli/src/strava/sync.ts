import type { ActivityType, StravaConfig } from '@jam/core';

import type { Logger } from '../logger.ts';
import { shownPath } from '../paths.ts';
import { zonedToUtc, utcToLocal } from '../sheet/time.ts';
import { backupDatabase } from '../store/backups.ts';
import { newId, publicId } from '../store/ids.ts';
import type { Database, SqlValue } from '../store/sqlite.ts';
import type { Store } from '../store/store.ts';
import { StravaAuthError, StravaDailyLimitError } from './http.ts';
import { type ActivitySource, type SourceActivity, summaryTrack } from './source.ts';
import { errorText } from '../errors.ts';

type Columns = Record<string, SqlValue>;

const COLUMNS = [
  'strava_id',
  'start_time',
  'start_local',
  'time_zone',
  'activity_type',
  'sport_type',
  'event_tags',
  'name',
  'distance_m',
  'elevation_gain_m',
  'moving_time_s',
  'elapsed_time_s',
  'visibility',
  'has_track',
  'start_lat',
  'start_lon',
  'end_lat',
  'end_lon',
] as const;

/** Strava's workout_type values that mean a race: 1 for runs, 11 for rides. */
const RACE_WORKOUT_TYPES = new Set([1, 11]);

interface PullSettings {
  config: StravaConfig;
  /** Zone for turning dates in config and pull history into day boundaries. */
  timeZone: string;
  scope: string;
  dryRun: boolean;
}

interface PullReport {
  pullId?: number;
  kind: 'full' | 'incremental' | 'resumed';
  from: string | null;
  to: string | null;
  pages: number;
  added: number;
  updated: number;
  unchanged: number;
  skipped: Record<string, number>;
  removedPrivate: number;
  orphanedOverrides: string[];
  notReturned: number;
  outcome: 'ok' | 'partial' | 'failed';
  error?: string;
}

type PullRow = {
  id: number;
  started_at: string;
  range_from: string | null;
  range_to: string | null;
  activity_types: string;
  include_private: number | null;
  outcome: string;
  cursor: string | null;
  added: number;
  updated: number;
  details: string | null;
};

const json = (value: unknown) => JSON.stringify(value);

/** "(GMT+09:00) Asia/Tokyo" → "Asia/Tokyo". */
const zoneName = (value: string | undefined) => value?.split(') ').at(-1)?.trim() || null;

const columnsFor = (
  activity: SourceActivity,
  type: ActivityType,
): { columns: Columns; raw: string; track?: [number, number][] } => {
  const track = summaryTrack(activity);
  const tags: string[] = [];
  if (
    activity.workout_type !== undefined &&
    activity.workout_type !== null &&
    RACE_WORKOUT_TYPES.has(activity.workout_type)
  )
    tags.push('race');
  if (activity.commute) tags.push('commute');
  const [startLat, startLon] = activity.start_latlng?.length === 2 ? activity.start_latlng : [];
  const [endLat, endLon] = activity.end_latlng?.length === 2 ? activity.end_latlng : [];
  const { map: _map, ...rest } = activity;
  return {
    columns: {
      strava_id: activity.id,
      start_time: new Date(activity.start_date).toISOString(),
      // Strava writes local time with a Z it does not mean.
      start_local: activity.start_date_local.replace(/Z$/, '').slice(0, 19),
      time_zone: zoneName(activity.timezone),
      activity_type: type,
      sport_type: activity.sport_type ?? activity.type ?? null,
      event_tags: json(tags),
      name: activity.name,
      distance_m: activity.distance,
      elevation_gain_m: activity.total_elevation_gain,
      moving_time_s: activity.moving_time,
      elapsed_time_s: activity.elapsed_time,
      visibility: activity.visibility ?? (activity.private ? 'only_me' : 'everyone'),
      has_track: track ? 1 : 0,
      start_lat: startLat ?? null,
      start_lon: startLon ?? null,
      end_lat: endLat ?? null,
      end_lon: endLon ?? null,
    },
    raw: json(rest),
    ...(track ? { track } : {}),
  };
};

const differs = (current: Columns, next: Columns) =>
  COLUMNS.some((column) => {
    const a = current[column] ?? null;
    const b = next[column] ?? null;
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-6 : a !== b;
  });

const dayStart = (date: string, zone: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return zonedToUtc({ y: y ?? 1970, m: m ?? 1, d: d ?? 1, h: 0, mi: 0, s: 0 }, zone);
};

/** Pulls after the most recent wipe; a wipe starts the history over. */
const pullsSinceWipe = (db: Database): PullRow[] => {
  const wipe = db.get<{ started_at: string }>(
    `SELECT started_at FROM pulls WHERE source = 'strava' AND outcome = 'wiped' ORDER BY started_at DESC, id DESC LIMIT 1`,
  );
  return db.all<PullRow>(
    `SELECT id, started_at, range_from, range_to, activity_types, include_private, outcome, cursor, added, updated, details
       FROM pulls WHERE source = 'strava' AND outcome <> 'wiped' AND started_at > ? ORDER BY started_at DESC, id DESC`,
    [wipe?.started_at ?? ''],
  );
};

interface StaleCheck {
  stale: boolean;
  lastOk?: string;
}

export const staleness = (db: Database, maxAgeDays: number): StaleCheck => {
  const lastOk = pullsSinceWipe(db).find((pull) => pull.outcome === 'ok');
  if (!lastOk) return { stale: true };
  const age = Date.now() - new Date(lastOk.started_at).getTime();
  return { stale: age >= maxAgeDays * 86_400_000, lastOk: lastOk.started_at };
};

const upsert = (
  db: Database,
  salt: string,
  entry: ReturnType<typeof columnsFor>,
  now: string,
): 'added' | 'updated' | 'unchanged' => {
  const current = db.get<Columns>(`SELECT * FROM activities WHERE strava_id = ?`, [
    entry.columns.strava_id ?? null,
  ]);
  let id: string;
  let result: 'added' | 'updated' | 'unchanged';
  if (!current) {
    id = newId('act');
    db.run(
      `INSERT INTO activities (id, public_id, source, ${COLUMNS.join(', ')}, raw, created_at, updated_at)
       VALUES (?, ?, 'strava', ${COLUMNS.map(() => '?').join(', ')}, ?, ?, ?)`,
      [
        id,
        publicId(salt, id),
        ...COLUMNS.map((column) => entry.columns[column] ?? null),
        entry.raw,
        now,
        now,
      ],
    );
    result = 'added';
  } else {
    id = String(current.id);
    if (differs(current, entry.columns)) {
      db.run(
        `UPDATE activities SET ${COLUMNS.map((column) => `${column} = ?`).join(', ')}, raw = ?, updated_at = ? WHERE id = ?`,
        [...COLUMNS.map((column) => entry.columns[column] ?? null), entry.raw, now, id],
      );
      result = 'updated';
    } else {
      // Kudos and similar counters change all the time; keep the record current without calling it a change.
      if (current.raw !== entry.raw)
        db.run('UPDATE activities SET raw = ? WHERE id = ?', [entry.raw, id]);
      result = 'unchanged';
    }
  }
  const track = db.get<{ detail: string; coordinates: string }>(
    'SELECT detail, coordinates FROM tracks WHERE activity_id = ?',
    [id],
  );
  if (entry.track) {
    const coordinates = json(entry.track);
    // A full track from --streams is kept; the summary only replaces another summary.
    if (!track || (track.detail === 'summary' && track.coordinates !== coordinates)) {
      db.run(
        `INSERT INTO tracks (activity_id, detail, coordinates, point_count, elevations, times, fetched_at) VALUES (?, 'summary', ?, ?, NULL, NULL, ?)
         ON CONFLICT (activity_id) DO UPDATE SET detail = 'summary', coordinates = excluded.coordinates, point_count = excluded.point_count, elevations = NULL, times = NULL, fetched_at = excluded.fetched_at`,
        [id, coordinates, entry.track.length, now],
      );
      if (track && result === 'unchanged') result = 'updated';
    }
  }
  return result;
};

/** Removes stored "Only You" activities when private activities are no longer imported. */
const removePrivate = async (store: Store, dryRun: boolean, log: Logger): Promise<number> => {
  const count = Number(
    store.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM activities WHERE source = 'strava' AND visibility = 'only_me'`,
    )?.n ?? 0,
  );
  if (count === 0 || dryRun) return count;
  const backup = await backupDatabase(store.db, 'before-wipe-private');
  store.db.run(`DELETE FROM activities WHERE source = 'strava' AND visibility = 'only_me'`);
  log.info(
    `Private activities are off: removed ${count} stored "Only You" ${count === 1 ? 'activity' : 'activities'} (copy first: ${shownPath(backup)}).`,
  );
  return count;
};

export const pullStrava = async (
  store: Store,
  source: ActivitySource,
  settings: PullSettings,
  log: Logger,
): Promise<PullReport> => {
  const { db } = store;
  const { config, timeZone, dryRun } = settings;
  const types = [...new Set(config.import.activityTypes)].sort();
  const includePrivate = config.import.includePrivate;
  const removedPrivate = includePrivate ? 0 : await removePrivate(store, dryRun, log);

  // What a pull covered. An incremental pull is only safe when the last one covered the same
  // types, range and private option; any change makes the next pull a full one.
  const settingsKey = json({
    types,
    includePrivate,
    from: config.import.from ?? null,
    to: config.import.to ?? null,
  });
  const keyOf = (pull: PullRow) =>
    (JSON.parse(pull.details ?? '{}') as { settings?: string }).settings;
  const history = pullsSinceWipe(db);
  const lastOk = history.find((pull) => pull.outcome === 'ok');
  const resumable = history.find(
    (pull) =>
      (pull.outcome === 'running' || pull.outcome === 'partial') &&
      pull.cursor !== null &&
      keyOf(pull) === settingsKey &&
      (!lastOk || pull.started_at > lastOk.started_at),
  );
  const baseline = lastOk && keyOf(lastOk) === settingsKey ? lastOk : undefined;
  if (lastOk && !baseline && !resumable) {
    log.info(
      'The import settings changed since the last pull (types, dates or private activities), so this is a full pull.',
    );
  }

  const configFrom = config.import.from ? dayStart(config.import.from, timeZone) : undefined;
  const configTo = config.import.to
    ? new Date(dayStart(config.import.to, timeZone).getTime() + 86_400_000)
    : undefined;
  let kind: PullReport['kind'];
  let from: Date | undefined;
  let to: Date | undefined;
  let page = 1;
  let pullId: number | undefined;
  let added = 0;
  let updated = 0;
  let skipped: Record<string, number> = {};
  if (resumable) {
    kind = 'resumed';
    from = resumable.range_from ? new Date(resumable.range_from) : undefined;
    to = resumable.range_to ? new Date(resumable.range_to) : undefined;
    page = (JSON.parse(resumable.cursor ?? '{"page":0}') as { page: number }).page + 1;
    pullId = resumable.id;
    added = Number(resumable.added);
    updated = Number(resumable.updated);
    skipped =
      (JSON.parse(resumable.details ?? '{}') as { skipped?: Record<string, number> }).skipped ?? {};
    log.info(`Resuming the interrupted pull from page ${page}.`);
  } else if (baseline) {
    kind = 'incremental';
    // From the start of the day of the last successful pull, inclusive.
    const lastDay = utcToLocal(new Date(baseline.started_at), timeZone).slice(0, 10);
    from = dayStart(lastDay, timeZone);
    if (configFrom && configFrom > from) from = configFrom;
    to = configTo;
  } else {
    kind = 'full';
    from = configFrom;
    to = configTo;
  }
  const after = from ? Math.floor(from.getTime() / 1000) : 0;
  const before = to ? Math.floor(to.getTime() / 1000) : undefined;
  const started = new Date().toISOString();
  if (!dryRun && pullId === undefined) {
    pullId = db.run(
      `INSERT INTO pulls (source, started_at, range_from, range_to, activity_types, include_private, outcome, cursor, details)
       VALUES ('strava', ?, ?, ?, ?, ?, 'running', '{"page":0}', ?)`,
      [
        started,
        from?.toISOString() ?? null,
        to?.toISOString() ?? null,
        json(types),
        includePrivate ? 1 : 0,
        json({ scope: settings.scope, kind, settings: settingsKey }),
      ],
    ).lastId;
  } else if (!dryRun && pullId !== undefined) {
    db.run(`UPDATE pulls SET outcome = 'running', error = NULL WHERE id = ?`, [pullId]);
  }

  const report: PullReport = {
    ...(pullId === undefined ? {} : { pullId }),
    kind,
    from: from?.toISOString() ?? null,
    to: to?.toISOString() ?? null,
    pages: 0,
    added,
    updated,
    unchanged: 0,
    skipped,
    removedPrivate,
    orphanedOverrides: [],
    notReturned: 0,
    outcome: 'ok',
  };
  const seen = new Set<number>();
  const allowed = new Set<string>(types);
  const save = (outcome: string, cursor: number, error?: string) => {
    if (dryRun || pullId === undefined) return;
    db.run(
      `UPDATE pulls SET outcome = ?, cursor = ?, added = ?, updated = ?, details = ?, error = ?, finished_at = ? WHERE id = ?`,
      [
        outcome,
        json({ page: cursor }),
        report.added,
        report.updated,
        json({ scope: settings.scope, kind, settings: settingsKey, skipped: report.skipped }),
        error ?? null,
        outcome === 'running' ? null : new Date().toISOString(),
        pullId,
      ],
    );
  };

  try {
    for (;;) {
      const activities = await source.listPage({
        after,
        ...(before === undefined ? {} : { before }),
        page,
        perPage: config.api.pageSize,
      });
      if (activities.length === 0) break;
      const now = new Date().toISOString();
      const handle = () => {
        for (const activity of activities) {
          seen.add(activity.id);
          const sport = activity.sport_type ?? activity.type ?? 'Unknown';
          const type = config.sportTypeMap[sport];
          const skip = (reason: string) => {
            report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
          };
          if (!type) {
            skip(`unmapped sport type ${sport}`);
            continue;
          }
          if (!allowed.has(type)) {
            skip(`type ${type} not imported`);
            continue;
          }
          const visibility = activity.visibility ?? (activity.private ? 'only_me' : 'everyone');
          if (visibility === 'only_me' && !includePrivate) {
            skip('Only You (private activities off)');
            continue;
          }
          if (dryRun) {
            const current = db.get<Columns>('SELECT * FROM activities WHERE strava_id = ?', [
              activity.id,
            ]);
            if (!current) report.added++;
            else if (differs(current, columnsFor(activity, type).columns)) report.updated++;
            else report.unchanged++;
            continue;
          }
          const result = upsert(db, store.salt, columnsFor(activity, type), now);
          if (result === 'added') report.added++;
          else if (result === 'updated') report.updated++;
          else report.unchanged++;
        }
        save('running', page);
      };
      // Each page is one transaction, and its position is saved with it, so an interruption loses at most one page.
      if (dryRun) handle();
      else db.transaction(handle);
      report.pages++;
      log.info(`  page ${page}: ${activities.length} activities`);
      if (activities.length < config.api.pageSize) break;
      page++;
    }
  } catch (error) {
    const message = errorText(error);
    const resumableError = !(error instanceof StravaAuthError);
    report.outcome = resumableError ? 'partial' : 'failed';
    report.error = message;
    save(report.outcome, page - 1, message);
    if (error instanceof StravaDailyLimitError || resumableError) return report;
    throw error;
  }

  if (kind === 'full' || (kind === 'resumed' && !from)) {
    // A full pull saw every activity in range, so it can tell what has gone from Strava.
    const stored = db.all<{ strava_id: number; start_time: string }>(
      `SELECT strava_id, start_time FROM activities WHERE source = 'strava' AND strava_id IS NOT NULL`,
    );
    // A resumed pull only saw its own pages, so only a pull that ran start to finish can tell.
    report.notReturned =
      kind !== 'full'
        ? 0
        : stored.filter(
            (row) =>
              !seen.has(Number(row.strava_id)) &&
              (!from || row.start_time >= from.toISOString()) &&
              (!to || row.start_time < to.toISOString()),
          ).length;
    report.orphanedOverrides = db
      .all<{ target_id: string }>(
        `SELECT DISTINCT target_id FROM overrides
          WHERE target_kind = 'activity' AND target_id LIKE 'strava:%'
            AND CAST(substr(target_id, 8) AS INTEGER) NOT IN (SELECT strava_id FROM activities WHERE strava_id IS NOT NULL)`,
      )
      .map((row) => row.target_id);
  }
  save('ok', page);
  return report;
};

/** Records a run that stopped before it could fetch anything, such as a failed sign-in. */
export const recordFailedPull = (db: Database, config: StravaConfig, error: string): void => {
  const types = [...new Set(config.import.activityTypes)].sort();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO pulls (source, started_at, finished_at, activity_types, include_private, outcome, error) VALUES ('strava', ?, ?, ?, ?, 'failed', ?)`,
    [now, now, json(types), config.import.includePrivate ? 1 : 0, error],
  );
};

/** Deletes every Strava activity and its track; sheet rows, overrides and route names stay. */
export const wipeStrava = async (
  store: Store,
  dryRun: boolean,
): Promise<{ activities: number; tracks: number; backup?: string }> => {
  const { db } = store;
  const activities = Number(
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM activities WHERE source = 'strava'`)?.n ?? 0,
  );
  const tracks = Number(
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'strava'`,
    )?.n ?? 0,
  );
  if (dryRun) return { activities, tracks };
  const backup = await backupDatabase(db, 'before-wipe-strava');
  db.transaction(() => {
    db.run(`DELETE FROM activities WHERE source = 'strava'`);
    // The marker makes the next pull a full one, with the range and types from config.
    db.run(
      `INSERT INTO pulls (source, started_at, finished_at, outcome, added, updated, removed) VALUES ('strava', ?, ?, 'wiped', 0, 0, ?)`,
      [new Date().toISOString(), new Date().toISOString(), activities],
    );
  });
  return { activities, tracks, backup };
};

interface StreamsReport {
  fetched: number;
  missing: number;
  remaining: number;
}

/** A track that starts in the box around Japan: the only ones the site can publish. */
const STARTS_IN_JAPAN = `json_extract(t.coordinates, '$[0][0]') BETWEEN 122 AND 154 AND json_extract(t.coordinates, '$[0][1]') BETWEEN 20 AND 46`;

/**
 * Downloads full samples for activities that only have the summary track: those in Japan first,
 * newest first. `japanOnly` leaves out the rest, which the site never publishes.
 */
export const fetchStreams = async (
  store: Store,
  source: ActivitySource,
  selection: { ids?: number[]; limit: number; japanOnly?: boolean },
  dryRun: boolean,
  log: Logger,
): Promise<StreamsReport> => {
  const { db } = store;
  const where = selection.ids
    ? `a.strava_id IN (${selection.ids.map(() => '?').join(', ')})`
    : `a.has_track = 1 AND (t.detail IS NULL OR t.detail = 'summary')${selection.japanOnly ? ` AND ${STARTS_IN_JAPAN}` : ''}`;
  const queue = db.all<{ id: string; strava_id: number; start_time: string; name: string }>(
    `SELECT a.id, a.strava_id, a.start_time, a.name FROM activities a LEFT JOIN tracks t ON t.activity_id = a.id
      WHERE a.source = 'strava' AND ${where}
      ORDER BY CASE WHEN ${STARTS_IN_JAPAN} THEN 0 ELSE 1 END, a.start_time DESC`,
    selection.ids ?? [],
  );
  const batch = queue.slice(0, selection.limit);
  if (dryRun) return { fetched: 0, missing: 0, remaining: queue.length };
  let fetched = 0;
  let missing = 0;
  for (const [index, activity] of batch.entries()) {
    log.progress(index, batch.length, 'tracks');
    const track = await source.getTrack(Number(activity.strava_id));
    const now = new Date().toISOString();
    if (!track) {
      missing++;
      log.info(`  ${activity.strava_id} ${activity.name}: no GPS samples`);
      continue;
    }
    const start = new Date(activity.start_time).getTime();
    const times = track.times
      ? track.times.map((seconds) => new Date(start + seconds * 1000).toISOString())
      : null;
    // One activity per write, so stopping part way keeps everything fetched so far.
    db.run(
      `INSERT INTO tracks (activity_id, detail, coordinates, point_count, elevations, times, fetched_at) VALUES (?, 'full', ?, ?, ?, ?, ?)
       ON CONFLICT (activity_id) DO UPDATE SET detail = 'full', coordinates = excluded.coordinates, point_count = excluded.point_count, elevations = excluded.elevations, times = excluded.times, fetched_at = excluded.fetched_at`,
      [
        activity.id,
        json(track.coordinates),
        track.coordinates.length,
        track.elevations ? json(track.elevations) : null,
        times ? json(times) : null,
        now,
      ],
    );
    db.run('UPDATE activities SET has_track = 1 WHERE id = ?', [activity.id]);
    fetched++;
    log.info(`  ${activity.strava_id} ${activity.name}: ${track.coordinates.length} points`);
  }
  return { fetched, missing, remaining: queue.length - batch.length };
};

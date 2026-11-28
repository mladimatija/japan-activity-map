/** Puts GPX activities into the store. Only rows whose source is `gpx` are ever read or written. */
import { errorText } from '../errors.ts';
import { xmlText } from '../lists/zip.ts';
import type { Logger } from '../logger.ts';
import { ACTIVITY_COLUMNS, differs, TRACK_COLUMNS, upsertActivity } from '../sheet/sync.ts';
import { backupDatabase } from '../store/backups.ts';
import type { SqlValue } from '../store/sqlite.ts';
import type { Store } from '../store/store.ts';
import { fitActivity, type GpxActivity, gpxActivity } from './activity.ts';
import type { GpxSource } from './files.ts';

export interface SkippedFile {
  file: string;
  reason: string;
  /** The file could not be read as an activity at all (not: it repeats one already read). */
  unreadable: boolean;
}

/**
 * Reads every source as an activity. A file that cannot be one is skipped with its reason, and so
 * is a second file with the start time of one already read: two files, one activity.
 */
export const readActivities = (
  sources: GpxSource[],
  options: Parameters<typeof gpxActivity>[2],
  log?: Logger,
): { activities: GpxActivity[]; skipped: SkippedFile[] } => {
  const byId = new Map<string, GpxActivity>();
  const skipped: SkippedFile[] = [];
  for (const [index, source] of sources.entries()) {
    try {
      const activity = /\.fit$/i.test(source.label)
        ? fitActivity(source.read(), source, options)
        : gpxActivity(xmlText(source.read()), source, options);
      const earlier = byId.get(activity.id);
      if (earlier)
        skipped.push({
          file: source.label,
          reason: activity.key.startsWith('time:')
            ? `starts at the same second as ${earlier.file}, so it is the same activity`
            : `the same track as ${earlier.file}`,
          unreadable: false,
        });
      else byId.set(activity.id, activity);
    } catch (error) {
      skipped.push({ file: source.label, reason: errorText(error), unreadable: true });
    }
    log?.progress(index + 1, sources.length, 'GPX files');
  }
  return { activities: [...byId.values()], skipped };
};

interface GpxChange {
  kind: 'added' | 'updated' | 'removed';
  file: string;
  name: string;
  details: string[];
}

interface GpxPlan {
  changes: GpxChange[];
  unchanged: number;
  /** Activities --replace would have removed, kept because their own file could not be read. */
  held: { file: string; name: string }[];
  /** Writes the plan. With removals, the store is copied to data/backups first. */
  apply(pull: { path: string; files: number; skipped: number }): Promise<{ backup?: string }>;
}

const count = (changes: GpxChange[], kind: GpxChange['kind']) =>
  changes.filter((change) => change.kind === kind).length;

/**
 * Works out what importing `activities` would change, without writing anything. `unreadable` names
 * the files of this import that could not be read: with `replace`, an activity that came from one
 * of them is kept, since a damaged file is not a wish to delete what it held.
 */
export const planGpxSync = (
  store: Store,
  activities: GpxActivity[],
  replace: boolean,
  unreadable: ReadonlySet<string> = new Set(),
): GpxPlan => {
  const { db } = store;
  const current = new Map(
    db
      .all<Record<string, SqlValue>>(`SELECT * FROM activities WHERE source = 'gpx'`)
      .map((row) => [String(row.id), row]),
  );
  const tracks = new Map(
    db
      .all<Record<string, SqlValue>>(
        `SELECT t.* FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'gpx'`,
      )
      .map((row) => [String(row.activity_id), row]),
  );
  // The file a row was read from may change (a folder one time, an archive the next) without the
  // activity changing, so `raw` is kept current (upsertActivity compares every column) but is
  // never a reason to call a row updated.
  const columns = ACTIVITY_COLUMNS.filter((column) => column !== 'raw');
  const changes: GpxChange[] = [];
  let unchanged = 0;
  for (const activity of activities) {
    const row = current.get(activity.id);
    if (!row) {
      changes.push({ kind: 'added', file: activity.file, name: activity.name, details: [] });
      continue;
    }
    const details = [
      ...differs(row, activity.activity, columns),
      ...(differs(tracks.get(activity.id), activity.track, TRACK_COLUMNS).length > 0
        ? ['track']
        : []),
    ];
    if (details.length > 0)
      changes.push({ kind: 'updated', file: activity.file, name: activity.name, details });
    else unchanged++;
  }
  const wanted = new Set(activities.map((activity) => activity.id));
  const fileOf = (row: Record<string, SqlValue>): string => {
    try {
      return (JSON.parse(String(row.raw ?? '{}')) as { file?: string }).file ?? '';
    } catch {
      // The name alone says which one it is.
      return '';
    }
  };
  const gone = replace ? [...current.values()].filter((row) => !wanted.has(String(row.id))) : [];
  const removed = gone.filter((row) => !unreadable.has(fileOf(row)));
  const held = gone
    .filter((row) => unreadable.has(fileOf(row)))
    .map((row) => ({ file: fileOf(row), name: String(row.name ?? row.id) }));
  for (const row of removed)
    changes.push({
      kind: 'removed',
      file: fileOf(row),
      name: String(row.name ?? row.id),
      details: [],
    });

  const apply: GpxPlan['apply'] = async (pull) => {
    const backup =
      removed.length > 0 ? await backupDatabase(db, 'before-wipe-gpx-replace') : undefined;
    db.transaction(() => {
      const now = new Date().toISOString();
      const started = db.run(
        `INSERT INTO pulls (source, started_at, source_file, outcome) VALUES ('gpx', ?, ?, 'running')`,
        [now, pull.path],
      );
      for (const activity of activities) {
        upsertActivity(
          db,
          store.salt,
          activity.id,
          activity.activity,
          current.get(activity.id),
          now,
        );
        if (differs(tracks.get(activity.id), activity.track, TRACK_COLUMNS).length > 0)
          db.run(
            `INSERT INTO tracks (activity_id, ${TRACK_COLUMNS.join(', ')}, fetched_at) VALUES (?, ${TRACK_COLUMNS.map(() => '?').join(', ')}, ?)
             ON CONFLICT (activity_id) DO UPDATE SET ${TRACK_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, fetched_at = excluded.fetched_at`,
            [activity.id, ...TRACK_COLUMNS.map((column) => activity.track[column] ?? null), now],
          );
      }
      // Tracks and cached matches go with their activity. The source is named again in the
      // statement itself: whatever the plan held, no Strava or sheet row can be deleted here.
      for (const row of removed)
        db.run(`DELETE FROM activities WHERE id = ? AND source = 'gpx'`, [String(row.id)]);
      db.run(
        `UPDATE pulls SET finished_at = ?, added = ?, updated = ?, removed = ?, outcome = 'ok', details = ? WHERE id = ?`,
        [
          new Date().toISOString(),
          count(changes, 'added'),
          count(changes, 'updated'),
          removed.length,
          JSON.stringify({ files: pull.files, skipped: pull.skipped, replace }),
          started.lastId,
        ],
      );
    });
    return backup ? { backup } : {};
  };
  return { changes, unchanged, held, apply };
};

/** Deletes every GPX activity with its track, after a copy of the store. Nothing else is touched. */
export const wipeGpx = async (
  store: Store,
  dryRun: boolean,
): Promise<{ activities: number; tracks: number; backup?: string }> => {
  const { db } = store;
  const number = (sql: string) => Number(db.get<{ n: number }>(sql)?.n ?? 0);
  const activities = number(`SELECT COUNT(*) AS n FROM activities WHERE source = 'gpx'`);
  const tracks = number(
    `SELECT COUNT(*) AS n FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'gpx'`,
  );
  if (dryRun) return { activities, tracks };
  const backup = await backupDatabase(db, 'before-wipe-gpx');
  db.transaction(() => {
    db.run(`DELETE FROM activities WHERE source = 'gpx'`);
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO pulls (source, started_at, finished_at, outcome, added, updated, removed) VALUES ('gpx', ?, ?, 'wiped', 0, 0, ?)`,
      [now, now, activities],
    );
  });
  return { activities, tracks, backup };
};

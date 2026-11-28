/**
 * Full tracks for Strava activities from files on disk, instead of one API request each: the
 * files a bulk export tool saves (strava-bulk-gpx, for one), or Strava's own account export.
 * Each file is matched to a stored Strava activity by the id a list (`activities.csv`) beside it
 * gives, by the id in its name, or, failing both, by the time it starts. Only the track is taken;
 * the activity's own figures stay what Strava said.
 *
 * Strava's account export names its files by upload, not by activity, and gzips some of them
 * (`activities/123.fit.gz`); its `activities.csv` says which activity each is. So the list comes
 * before the name, and whatever the match, a file that starts on another day than its activity
 * is refused: a number in a name is not always the activity's.
 */
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { ActivityType } from '@jam/core';

import { errorText } from '../errors.ts';
import { fitActivity, type GpxActivity, gpxActivity } from '../gpx-import/activity.ts';
import { collectGpx, type GpxSource } from '../gpx-import/files.ts';
import { xmlText } from '../lists/zip.ts';
import type { Logger } from '../logger.ts';
import { parseCsv } from '../sheet/read.ts';
import { TRACK_COLUMNS } from '../sheet/sync.ts';

/** The most a gzipped file may unpack to. */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
import type { Store } from '../store/store.ts';

const LIST_NAME = /^activities\.csv$/i;
/** Beside .gpx and .fit: the list, and the gzipped files of Strava's account export. */
const ALSO = /^activities\.csv$|\.(gpx|fit)\.gz$/i;
/** A file matched by id must start within this of its activity. */
const SAME_DAY_MS = 24 * 3_600_000;
/** What an export tool appends to a file whose start and end it has cut off. */
const TRIMMED = /_trimmed\.(gpx|fit)(\.gz)?$/i;
/** A file whose track starts within this of an activity's start is that activity's. */
const SAME_START_MS = 5 * 60_000;

export interface TracksFromReport {
  files: number;
  /** Tracks written. */
  attached: number;
  /** Activities that already had a full track and were left alone. */
  keptFull: number;
  /** Files for a Strava activity the store does not hold, or that matched none. */
  unmatched: { label: string; why: string }[];
  unreadable: { label: string; why: string }[];
  /** How many files were matched each way. */
  by: { name: number; list: number; time: number };
}

interface StoredActivity {
  id: string;
  stravaId: number;
  startMs: number;
  type: ActivityType;
  full: boolean;
  name: string;
}

/** The Strava id in a file name: `strava_123.gpx`, `123_Morning Run.gpx`, `123.fit`. */
export const idInName = (name: string): number | undefined => {
  const match = /^(?:strava[_-])?(\d{6,})(?:[_\-. ]|$)/i.exec(name);
  return match ? Number(match[1]) : undefined;
};

/**
 * File name → Strava id, from an `activities.csv` as strava-bulk-gpx writes it: the id in the
 * first column, the file's path inside the archive in some other column. Any column layout.
 */
export const idsByFile = (csv: string): Map<string, number> => {
  const map = new Map<string, number>();
  for (const record of parseCsv(csv)) {
    const id = Number(record[0]?.trim());
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const file = record.find((cell) => /\.(gpx|fit|tcx)(\.gz)?$/i.test(cell.trim()));
    if (file) map.set(basename(file.trim()).toLowerCase(), id);
  }
  return map;
};

const read = (source: GpxSource, type: ActivityType, timeZone: string): GpxActivity => {
  const ref = { label: source.label, name: source.name };
  const options = { defaultType: type, timeZone };
  const gzipped = /\.gz$/i.test(source.label);
  const bytes = gzipped
    ? new Uint8Array(gunzipSync(source.read(), { maxOutputLength: MAX_UNPACKED_BYTES }))
    : source.read();
  return /\.fit(\.gz)?$/i.test(source.label)
    ? fitActivity(bytes, ref, options)
    : gpxActivity(xmlText(bytes), ref, options);
};

export const attachTracks = (
  store: Store,
  path: string,
  options: { dryRun: boolean; replace: boolean; timeZone: string },
  log: Logger,
): TracksFromReport => {
  const { db } = store;
  const collected = collectGpx(path, undefined, ALSO);
  const lists = collected.sources.filter((source) => LIST_NAME.test(basename(source.label)));
  const files = collected.sources.filter((source) => !LIST_NAME.test(basename(source.label)));
  const listed = new Map<string, number>();
  for (const list of lists)
    for (const [file, id] of idsByFile(xmlText(list.read()))) listed.set(file, id);

  const stored = db
    .all<{
      id: string;
      strava_id: number;
      start_time: string;
      activity_type: string;
      name: string;
      detail: string | null;
    }>(
      `SELECT a.id, a.strava_id, a.start_time, a.activity_type, a.name, t.detail
         FROM activities a LEFT JOIN tracks t ON t.activity_id = a.id
        WHERE a.source = 'strava' AND a.strava_id IS NOT NULL`,
    )
    .map((row): StoredActivity => ({
      id: row.id,
      stravaId: Number(row.strava_id),
      startMs: Date.parse(row.start_time),
      type: row.activity_type as ActivityType,
      full: row.detail === 'full',
      name: row.name,
    }));
  const byStravaId = new Map(stored.map((activity) => [activity.stravaId, activity]));
  const byStart = stored.toSorted((a, b) => a.startMs - b.startMs);
  /** The one activity starting within SAME_START_MS of `ms`; undefined when none or several. */
  const startingAt = (ms: number): StoredActivity | undefined => {
    const near = byStart.filter((activity) => Math.abs(activity.startMs - ms) <= SAME_START_MS);
    return near.length === 1 ? near[0] : undefined;
  };

  const report: TracksFromReport = {
    files: files.length,
    attached: 0,
    keptFull: 0,
    unmatched: [],
    unreadable: [],
    by: { name: 0, list: 0, time: 0 },
  };
  const now = new Date().toISOString();
  for (const [index, source] of files.entries()) {
    log.progress(index, files.length, 'files');
    const fileName = basename(source.label);
    if (TRIMMED.test(fileName)) {
      report.unmatched.push({
        label: source.label,
        why: 'its start and end were cut off by the export; export it again without hiding them',
      });
      continue;
    }
    const fromList = listed.get(fileName.toLowerCase());
    const named = fromList ?? idInName(fileName);
    let activity: StoredActivity | undefined;
    let how: keyof TracksFromReport['by'] | undefined;
    if (named !== undefined) {
      activity = byStravaId.get(named);
      if (!activity) {
        report.unmatched.push({
          label: source.label,
          why: `Strava activity ${named} is not in the store`,
        });
        continue;
      }
      how = fromList !== undefined ? 'list' : 'name';
    }
    let parsed: GpxActivity;
    try {
      parsed = read(source, activity?.type ?? 'hike', options.timeZone);
      if (!activity) {
        activity = startingAt(Date.parse(String(parsed.activity.start_time)));
        if (!activity) {
          report.unmatched.push({
            label: source.label,
            why: 'no Strava id in its name, and no stored activity starts when it does',
          });
          continue;
        }
        how = 'time';
        // Read again by the activity's own type when the file names none: the type decides which
        // speed counts as a GPS jump.
        if (activity.type !== 'hike' && !parsed.activity.sport_type)
          parsed = read(source, activity.type, options.timeZone);
      }
    } catch (failure) {
      report.unreadable.push({ label: source.label, why: errorText(failure) });
      continue;
    }
    const startsMs = Date.parse(String(parsed.activity.start_time));
    // Only a track with times says when it started; one without is taken on its id.
    const timed = parsed.track.times !== null && parsed.track.times !== undefined;
    if (how !== 'time' && timed && Math.abs(startsMs - activity.startMs) > SAME_DAY_MS) {
      report.unmatched.push({
        label: source.label,
        why: `it starts on ${new Date(startsMs).toISOString().slice(0, 10)}, not when Strava activity ${activity.stravaId} did; the number in its name is not that activity's`,
      });
      continue;
    }
    if (activity.full && !options.replace) {
      report.keptFull++;
      continue;
    }
    report.by[how ?? 'time']++;
    report.attached++;
    if (options.dryRun) {
      activity.full = true;
      continue;
    }
    const { track } = parsed;
    const current = activity;
    db.transaction(() => {
      db.run(
        `INSERT INTO tracks (activity_id, ${TRACK_COLUMNS.join(', ')}, fetched_at) VALUES (?, ${TRACK_COLUMNS.map(() => '?').join(', ')}, ?)
         ON CONFLICT (activity_id) DO UPDATE SET ${TRACK_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, fetched_at = excluded.fetched_at`,
        [current.id, ...TRACK_COLUMNS.map((column) => track[column] ?? null), now],
      );
      db.run(
        `UPDATE activities SET has_track = 1, end_lat = COALESCE(end_lat, ?), end_lon = COALESCE(end_lon, ?), updated_at = ? WHERE id = ?`,
        [parsed.activity.end_lat ?? null, parsed.activity.end_lon ?? null, now, current.id],
      );
    });
    current.full = true;
    log.debug(
      `  ${current.stravaId} ${current.name}: ${String(track.point_count ?? 0)} points from ${source.label}`,
    );
  }
  return report;
};

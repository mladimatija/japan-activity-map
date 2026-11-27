import { relative } from 'node:path';

import { distanceM } from '../lists/geo.ts';
import { ROOT_DIR } from '../paths.ts';
import { newId, publicId } from '../store/ids.ts';
import type { Store } from '../store/store.ts';
import type { Database, SqlValue } from '../store/sqlite.ts';
import { type LinkIndex, type LinkTarget } from './links.ts';
import { OUTING_STATUSES } from './spec.ts';
import { utcToLocal } from './time.ts';
import type { SheetRow } from './validate.ts';

/** A resolved link from a row to a place, list item or route, with what the row says about it. */
interface RowLink {
  ref: string;
  kind: LinkTarget['kind'];
  id: string;
  status: SheetRow['status'];
}

export interface LinkIssue {
  rowId: string;
  line: number;
  ref: string;
  reason: 'missing' | 'ambiguous';
  candidates: LinkTarget[];
}

type Columns = Record<string, SqlValue>;

interface DesiredRow {
  row: SheetRow;
  data: string;
  activity?: Columns;
  track?: Columns;
  overrides: Map<string, string>;
}

interface RowChange {
  rowId: string;
  name: string;
  kind: 'added' | 'updated' | 'removed';
  details: string[];
}

interface SyncPlan {
  file: string;
  changes: RowChange[];
  unchanged: number;
  linkIssues: LinkIssue[];
  links: number;
  apply(): { pullId: number };
}

const ACTIVITY_COLUMNS = [
  'source',
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
  'raw',
] as const;
const TRACK_COLUMNS = ['detail', 'coordinates', 'point_count', 'elevations', 'times'] as const;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const json = (value: unknown) => JSON.stringify(value);
const overrideKey = (kind: string, id: string, field: string) => `${kind}\u0000${id}\u0000${field}`;

/** The row as stored in sheet_rows.data and activities.raw: parsed values, no track points. */
const rowData = (row: SheetRow, links: RowLink[]): Record<string, unknown> => {
  const { gpx: _gpx, gpxFile: _file, line: _line, date, ...rest } = row;
  return { ...rest, date: date.local, links };
};

const trackOf = (
  row: SheetRow,
):
  | {
      columns: Columns;
      lengthM: number;
      first?: [number, number];
      last?: [number, number];
      startUtc?: Date;
      elapsedS?: number;
    }
  | undefined => {
  if (!row.gpx) return undefined;
  const points = row.gpx.segments.flat();
  const coordinates = points.map(
    (point) => [round6(point.lon), round6(point.lat)] as [number, number],
  );
  let lengthM = 0;
  for (const segment of row.gpx.segments) {
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i - 1];
      const b = segment[i];
      if (a && b) lengthM += distanceM([a.lon, a.lat], [b.lon, b.lat]);
    }
  }
  const elevations = points.every((point) => point.ele !== undefined)
    ? points.map((point) => point.ele ?? 0)
    : null;
  const times = points.every((point) => point.time !== undefined)
    ? points.map((point) => point.time ?? '')
    : null;
  const startUtc = times?.[0] ? new Date(times[0]) : undefined;
  const endUtc = times?.at(-1) ? new Date(times.at(-1) ?? '') : undefined;
  return {
    columns: {
      detail: 'full',
      coordinates: json(coordinates),
      point_count: coordinates.length,
      elevations: elevations ? json(elevations) : null,
      times: times ? json(times) : null,
    },
    lengthM,
    ...(coordinates[0] ? { first: coordinates[0] } : {}),
    ...(coordinates.at(-1) ? { last: coordinates.at(-1) } : {}),
    ...(startUtc && !Number.isNaN(startUtc.getTime()) ? { startUtc } : {}),
    ...(startUtc && endUtc && !Number.isNaN(endUtc.getTime())
      ? { elapsedS: Math.round((endUtc.getTime() - startUtc.getTime()) / 1000) }
      : {}),
  };
};

const activityOf = (
  row: SheetRow,
  data: Record<string, unknown>,
  track: ReturnType<typeof trackOf>,
): Columns => {
  // A date without a time takes the track's start time when the track starts on that day.
  let start = row.date.utc;
  let local = row.date.local;
  if (
    !row.date.hasTime &&
    track?.startUtc &&
    utcToLocal(track.startUtc, row.timeZone).slice(0, 10) === row.date.local
  ) {
    start = track.startUtc;
    local = utcToLocal(start, row.timeZone);
  }
  const startPoint =
    track?.first ??
    (row.lat !== undefined && row.lon !== undefined
      ? ([row.lon, row.lat] as [number, number])
      : undefined);
  return {
    source: 'sheet',
    strava_id: null,
    start_time: start.toISOString(),
    start_local: local,
    time_zone: row.timeZone,
    activity_type: row.activityType,
    sport_type: null,
    event_tags: json(row.eventTags),
    name: row.name,
    distance_m: row.distanceM ?? (track ? Math.round(track.lengthM) : null),
    elevation_gain_m: row.elevationGainM ?? null,
    moving_time_s: row.durationS ?? null,
    elapsed_time_s: track?.elapsedS ?? row.durationS ?? null,
    visibility: null,
    has_track: track ? 1 : 0,
    start_lat: startPoint ? startPoint[1] : null,
    start_lon: startPoint ? startPoint[0] : null,
    end_lat: track?.last ? track.last[1] : null,
    end_lon: track?.last ? track.last[0] : null,
    raw: json(data),
  };
};

/** Overrides a row sets, keyed by target and field. Values are JSON. */
const overridesOf = (row: SheetRow, links: RowLink[], target: string): Map<string, string> => {
  const out = new Map<string, string>();
  const set = (field: string, value: unknown) =>
    out.set(overrideKey('activity', target, field), json(value));
  if (row.stravaId !== undefined) {
    // Manual entries win over Strava's own values.
    set('name', row.name);
    set('activity_type', row.activityType);
    if (row.eventTags.length > 0) set('event_tags', row.eventTags);
    if (row.showStravaLink !== undefined) set('show_strava_link', row.showStravaLink);
  }
  if (links.length > 0) set('links', links);
  if (row.hide !== undefined) set('hide', row.hide);
  if (row.notes) set('notes', row.notes);
  return out;
};

const differs = (
  current: Record<string, SqlValue> | undefined,
  desired: Columns,
  columns: readonly string[],
): string[] => {
  if (!current) return [...columns];
  return columns.filter((column) => {
    const a = current[column] ?? null;
    const b = desired[column] ?? null;
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > 1e-9 : a !== b;
  });
};

/** Works out what importing `rows` would change, without writing anything. */
export const planSync = (
  store: Store,
  rows: SheetRow[],
  sheetPath: string,
  links: LinkIndex,
): SyncPlan => {
  const { db } = store;
  const file = relative(ROOT_DIR, sheetPath) || sheetPath;
  const currentRows = new Map(
    db
      .all<{
        row_key: string;
        file: string;
        line: number;
        data: string;
        activity_id: string | null;
      }>('SELECT row_key, file, line, data, activity_id FROM sheet_rows')
      .map((row) => [row.row_key, row]),
  );
  const currentActivities = new Map(
    db
      .all<Record<string, SqlValue>>(`SELECT * FROM activities WHERE source = 'sheet'`)
      .map((row) => [String(row.id), row]),
  );
  const currentTracks = new Map(
    db
      .all<Record<string, SqlValue>>(
        `SELECT t.* FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'sheet'`,
      )
      .map((row) => [String(row.activity_id), row]),
  );
  const currentOverrides = new Map(
    db
      .all<{ target_kind: string; target_id: string; field: string; value: string }>(
        `SELECT target_kind, target_id, field, value FROM overrides WHERE source = 'sheet'`,
      )
      .map((row) => [overrideKey(row.target_kind, row.target_id, row.field), row.value]),
  );

  const linkIssues: LinkIssue[] = [];
  let linkCount = 0;
  const desired = new Map<string, DesiredRow & { activityId?: string }>();
  for (const row of rows) {
    const resolved: RowLink[] = [];
    for (const ref of row.placeRefs) {
      const result = links.resolve(ref);
      if (result.ok) {
        resolved.push({ ref, kind: result.target.kind, id: result.target.id, status: row.status });
        linkCount++;
      } else {
        linkIssues.push({
          rowId: row.rowId,
          line: row.line,
          ref,
          reason: result.reason,
          candidates: result.reason === 'ambiguous' ? result.candidates : [],
        });
      }
    }
    const data = rowData(row, resolved);
    const isOuting = OUTING_STATUSES.includes(row.status) && row.stravaId === undefined;
    const previous = currentRows.get(row.rowId);
    const activityId = isOuting ? (previous?.activity_id ?? newId('act')) : undefined;
    const track = isOuting ? trackOf(row) : undefined;
    const target = row.stravaId !== undefined ? `strava:${row.stravaId}` : activityId;
    desired.set(row.rowId, {
      row,
      data: json(data),
      ...(activityId ? { activityId, activity: activityOf(row, data, track) } : {}),
      ...(track ? { track: track.columns } : {}),
      overrides: target && row.status !== 'want' ? overridesOf(row, resolved, target) : new Map(),
    });
  }

  const changes: RowChange[] = [];
  let unchanged = 0;
  const desiredOverrides = new Map<string, string>();
  for (const entry of desired.values())
    for (const [key, value] of entry.overrides) desiredOverrides.set(key, value);
  const overrideChangesFor = (kind: string, id: string) =>
    [...new Set([...desiredOverrides.keys(), ...currentOverrides.keys()])].filter((key) => {
      const [k, target] = key.split('\u0000');
      return k === kind && target === id && desiredOverrides.get(key) !== currentOverrides.get(key);
    });

  for (const [rowId, entry] of desired) {
    const previous = currentRows.get(rowId);
    const details: string[] = [];
    if (!previous) {
      changes.push({ rowId, name: entry.row.name, kind: 'added', details: [] });
      continue;
    }
    if (previous.data !== entry.data) details.push('sheet values');
    if (entry.activityId) {
      const changed = differs(
        currentActivities.get(entry.activityId),
        entry.activity ?? {},
        ACTIVITY_COLUMNS,
      ).filter((column) => column !== 'raw');
      if (changed.length > 0) details.push(...changed);
      const trackChanged = entry.track
        ? differs(currentTracks.get(entry.activityId), entry.track, TRACK_COLUMNS).length > 0
        : currentTracks.has(entry.activityId);
      if (trackChanged) details.push('track');
    } else if (previous.activity_id) {
      details.push('no longer an activity');
    }
    const target =
      entry.row.stravaId !== undefined ? `strava:${entry.row.stravaId}` : entry.activityId;
    const previousTarget = (() => {
      try {
        const old = JSON.parse(previous.data) as { stravaId?: number };
        return old.stravaId !== undefined
          ? `strava:${old.stravaId}`
          : (previous.activity_id ?? undefined);
      } catch {
        return previous.activity_id ?? undefined;
      }
    })();
    const overrideChanges = new Set([
      ...(target ? overrideChangesFor('activity', target) : []),
      ...(previousTarget && previousTarget !== target
        ? overrideChangesFor('activity', previousTarget)
        : []),
    ]);
    if (overrideChanges.size > 0)
      details.push(...[...overrideChanges].map((key) => `override ${key.split('\u0000')[2]}`));
    if (details.length > 0)
      changes.push({
        rowId,
        name: entry.row.name,
        kind: 'updated',
        details: [...new Set(details)],
      });
    else unchanged++;
  }
  for (const [rowId, previous] of currentRows) {
    if (desired.has(rowId)) continue;
    let name = rowId;
    try {
      name = (JSON.parse(previous.data) as { name?: string }).name ?? rowId;
    } catch {
      // Keep the row id as the label.
    }
    changes.push({ rowId, name, kind: 'removed', details: [] });
  }

  const apply = () =>
    db.transaction(() => {
      const now = new Date().toISOString();
      const pull = db.run(
        `INSERT INTO pulls (source, started_at, source_file, outcome) VALUES ('sheet', ?, ?, 'running')`,
        [now, file],
      );
      // Removed rows: their activities go too (tracks and cached results cascade).
      for (const [rowId, previous] of currentRows) {
        if (desired.has(rowId)) continue;
        db.run('DELETE FROM sheet_rows WHERE row_key = ?', [rowId]);
        if (previous.activity_id)
          db.run(`DELETE FROM activities WHERE id = ? AND source = 'sheet'`, [
            previous.activity_id,
          ]);
      }
      for (const [rowId, entry] of desired) {
        const previous = currentRows.get(rowId);
        if (previous?.activity_id && previous.activity_id !== entry.activityId) {
          db.run(`DELETE FROM activities WHERE id = ? AND source = 'sheet'`, [
            previous.activity_id,
          ]);
        }
        if (entry.activityId && entry.activity) {
          upsertActivity(
            db,
            store.salt,
            entry.activityId,
            entry.activity,
            currentActivities.get(entry.activityId),
            now,
          );
          const currentTrack = currentTracks.get(entry.activityId);
          if (entry.track) {
            if (differs(currentTrack, entry.track, TRACK_COLUMNS).length > 0) {
              db.run(
                `INSERT INTO tracks (activity_id, ${TRACK_COLUMNS.join(', ')}, fetched_at) VALUES (?, ${TRACK_COLUMNS.map(() => '?').join(', ')}, ?)
                 ON CONFLICT (activity_id) DO UPDATE SET ${TRACK_COLUMNS.map((column) => `${column} = excluded.${column}`).join(', ')}, fetched_at = excluded.fetched_at`,
                [
                  entry.activityId,
                  ...TRACK_COLUMNS.map((column) => entry.track?.[column] ?? null),
                  now,
                ],
              );
            }
          } else if (currentTrack) {
            db.run('DELETE FROM tracks WHERE activity_id = ?', [entry.activityId]);
          }
        }
        const activityId = entry.activityId ?? null;
        if (!previous) {
          db.run(
            'INSERT INTO sheet_rows (row_key, file, line, data, activity_id, imported_at) VALUES (?, ?, ?, ?, ?, ?)',
            [rowId, file, entry.row.line, entry.data, activityId, now],
          );
        } else if (
          previous.data !== entry.data ||
          previous.activity_id !== activityId ||
          previous.file !== file
        ) {
          db.run(
            'UPDATE sheet_rows SET file = ?, line = ?, data = ?, activity_id = ?, imported_at = ? WHERE row_key = ?',
            [file, entry.row.line, entry.data, activityId, now, rowId],
          );
        } else if (previous.line !== entry.row.line) {
          // Moved within the sheet: keep the line current without counting it as a change.
          db.run('UPDATE sheet_rows SET line = ? WHERE row_key = ?', [entry.row.line, rowId]);
        }
      }
      for (const [key, value] of desiredOverrides) {
        if (currentOverrides.get(key) === value) continue;
        const [kind, target, field] = key.split('\u0000');
        db.run(
          `INSERT INTO overrides (target_kind, target_id, field, value, source, created_at) VALUES (?, ?, ?, ?, 'sheet', ?)
           ON CONFLICT (target_kind, target_id, field) DO UPDATE SET value = excluded.value, source = excluded.source, created_at = excluded.created_at`,
          [kind ?? '', target ?? '', field ?? '', value, now],
        );
      }
      for (const key of currentOverrides.keys()) {
        if (desiredOverrides.has(key)) continue;
        const [kind, target, field] = key.split('\u0000');
        db.run(
          `DELETE FROM overrides WHERE target_kind = ? AND target_id = ? AND field = ? AND source = 'sheet'`,
          [kind ?? '', target ?? '', field ?? ''],
        );
      }
      const count = (kind: RowChange['kind']) =>
        changes.filter((change) => change.kind === kind).length;
      db.run(
        `UPDATE pulls SET finished_at = ?, added = ?, updated = ?, removed = ?, outcome = 'ok' WHERE id = ?`,
        [new Date().toISOString(), count('added'), count('updated'), count('removed'), pull.lastId],
      );
      return { pullId: pull.lastId };
    });

  return { file, changes, unchanged, linkIssues, links: linkCount, apply };
};

const upsertActivity = (
  db: Database,
  salt: string,
  id: string,
  columns: Columns,
  current: Record<string, SqlValue> | undefined,
  now: string,
): void => {
  if (!current) {
    db.run(
      `INSERT INTO activities (id, public_id, ${ACTIVITY_COLUMNS.join(', ')}, created_at, updated_at) VALUES (?, ?, ${ACTIVITY_COLUMNS.map(() => '?').join(', ')}, ?, ?)`,
      [
        id,
        publicId(salt, id),
        ...ACTIVITY_COLUMNS.map((column) => columns[column] ?? null),
        now,
        now,
      ],
    );
    return;
  }
  const changed = differs(current, columns, ACTIVITY_COLUMNS);
  if (changed.length === 0) return;
  db.run(
    `UPDATE activities SET ${changed.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...changed.map((column) => columns[column] ?? null), now, id],
  );
};

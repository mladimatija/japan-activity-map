/** One GPX file as one activity: what goes into the store's `activities` and `tracks` rows. */
import { createHash } from 'node:crypto';

import type { ActivityType } from '@jam/core';

import { parseFit } from '../fit.ts';
import { type Gpx, gpxInfo, type GpxInfo, type GpxPoint, parseGpx } from '../gpx.ts';
import { distanceM } from '../lists/geo.ts';
import { parseDate, utcToLocal } from '../sheet/time.ts';
import type { Columns } from '../sheet/sync.ts';
import { keyedId } from '../store/ids.ts';
import { gpxActivityType } from './type.ts';

/**
 * Moving time is judged over stretches of at least this long, by how far the stretch got as the
 * crow flies: a watch that writes a point a second wobbles on the spot at a standstill, and that
 * wobble must not count as walking.
 */
const STRETCH_S = 30;
/** Slower than this over a stretch (about 0.5 km/h) counts as standing still. A steep climb is slow. */
const MOVING_MPS = 0.15;
/**
 * The most time one stretch can count: its length at a slow walk plus its climb at a slow climb.
 * A recorder that writes a point every 20 m says nothing of a rest between two points; this keeps
 * a long rest inside one stretch from counting as moving.
 */
const SLOWEST_MPS = 0.25;
const SLOWEST_CLIMB_MPS = 0.1;
/** Faster than this is not something the activity does: a jump of the GPS. */
const TOP_MPS: Record<ActivityType, number> = {
  hike: 5,
  walk: 5,
  run: 10,
  trail_run: 10,
  ride: 30,
};
/** Between two points written in the same second, more than this is a jump. */
const JUMP_M = 30;
/** More jumps than this share of the points, and the track is left as it was recorded. */
const MOST_JUMPS = 0.05;
/** A rise counts once it passes this, so the wobble of GPS heights adds no climb. */
const CLIMB_STEP_M = 5;

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const json = (value: unknown) => JSON.stringify(value);

/** What tells one GPX activity from another: its start time, or its points when it has no times. */
export const gpxKey = (
  startTime: Date | undefined,
  coordinates: readonly (readonly [number, number])[],
): string =>
  startTime
    ? `time:${startTime.toISOString().slice(0, 19)}Z`
    : `hash:${createHash('sha256').update(json(coordinates)).digest('hex').slice(0, 32)}`;

/** The store id of the GPX activity with this key: the same on every import. */
export const gpxActivityId = (key: string): string => keyedId('act', `gpx:${key}`);

/** Metres climbed along the heights, counting a rise only once it exceeds the step. */
export const climbM = (elevations: readonly number[]): number => {
  let anchor = elevations[0] ?? 0;
  let gain = 0;
  for (const height of elevations) {
    if (height >= anchor + CLIMB_STEP_M) {
      gain += height - anchor;
      anchor = height;
    } else if (height < anchor) anchor = height;
  }
  return gain;
};

/**
 * The points without the jumps of the GPS: a point is dropped when getting to it from the last
 * point kept would take more than the activity's top speed. The allowance grows with time, so a
 * track that really moved on is picked up again a few points later. The first point always stays.
 * When that would drop more than MOST_JUMPS of the points, the track is not what its type says (a
 * ride imported as a hike) and it is left as recorded. Needs a time on every point.
 */
export const withoutJumps = (segment: readonly GpxPoint[], topMps: number): GpxPoint[] => {
  const kept: GpxPoint[] = [];
  for (const point of segment) {
    const before = kept.at(-1);
    if (!before) {
      kept.push(point);
      continue;
    }
    const seconds = (Date.parse(point.time ?? '') - Date.parse(before.time ?? '')) / 1000;
    const step = distanceM([before.lon, before.lat], [point.lon, point.lat]);
    // Two points in the same second cannot be told apart by speed: the wobble of a few metres stays.
    if (seconds > 0 ? step / seconds > topMps : step > JUMP_M) continue;
    kept.push(point);
  }
  // A short track may lose a point or two whatever its length.
  const most = Math.max(2, segment.length * MOST_JUMPS);
  return segment.length - kept.length > most ? [...segment] : kept;
};

/**
 * Seconds in motion along one segment: see STRETCH_S, MOVING_MPS and SLOWEST_MPS. `stamps` are
 * the points' times in milliseconds.
 */
export const movingSeconds = (segment: readonly GpxPoint[], stamps: readonly number[]): number => {
  let moving = 0;
  let from = 0;
  let path = 0;
  for (let i = 1; i < segment.length; i++) {
    const [a, b] = [segment[i - 1], segment[i]];
    if (!a || !b) continue;
    path += distanceM([a.lon, a.lat], [b.lon, b.lat]);
    const seconds = ((stamps[i] ?? 0) - (stamps[from] ?? 0)) / 1000;
    if (seconds < STRETCH_S && i < segment.length - 1) continue;
    const start = segment[from];
    if (start && seconds > 0) {
      const crow = distanceM([start.lon, start.lat], [b.lon, b.lat]);
      if (crow / seconds >= MOVING_MPS) {
        const climb =
          start.ele !== undefined && b.ele !== undefined ? Math.abs(b.ele - start.ele) : 0;
        moving += Math.min(seconds, path / SLOWEST_MPS + climb / SLOWEST_CLIMB_MPS);
      }
    }
    from = i;
    path = 0;
  }
  return moving;
};

/** A date in a file name, such as 2025-04-12, 20250412 or 2025_04_12; undefined without one. */
export const dateInName = (name: string): string | undefined => {
  const match = /(?<!\d)((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/.exec(name);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
};

export interface GpxFileRef {
  /** How the file is named in messages: its path under the folder, or inside its archive. */
  label: string;
  /** The file name without folder or extension. */
  name: string;
}

export interface GpxActivity {
  id: string;
  key: string;
  file: string;
  name: string;
  activity: Columns;
  track: Columns;
}

interface Options {
  defaultType: ActivityType;
  /** For the local start time, and for a date that comes from the file name. */
  timeZone: string;
}

/**
 * Reads a GPX file as one activity, however many tracks and segments it has. Throws an Error
 * whose message says why the file cannot be one (not GPX, no line, no date).
 */
export const gpxActivity = (xml: string, file: GpxFileRef, options: Options): GpxActivity =>
  trackActivity({ ...parseGpx(xml), info: gpxInfo(xml) }, file, options);

/** The same for a FIT file, as watches and bike computers record them. */
export const fitActivity = (bytes: Uint8Array, file: GpxFileRef, options: Options): GpxActivity => {
  const track = parseFit(bytes);
  if (track.segments.length === 0)
    throw new Error('no track: the file has no two points with a position');
  return trackActivity(track, file, options);
};

/** A parsed track file as one activity. */
export const trackActivity = (
  { segments: recorded, info }: Gpx & { info: GpxInfo },
  file: GpxFileRef,
  options: Options,
): GpxActivity => {
  const type = gpxActivityType(info.type) ?? options.defaultType;
  // Jumps are told by speed, so only a track with a time on every point can lose them.
  const allTimed = recorded.every((segment) =>
    segment.every((point) => Number.isFinite(Date.parse(point.time ?? ''))),
  );
  const segments = allTimed
    ? recorded.map((segment) => withoutJumps(segment, TOP_MPS[type]))
    : recorded;
  const jumps = recorded.flat().length - segments.flat().length;
  const points: GpxPoint[] = segments.flat();
  const coordinates = points.map(
    (point) => [round6(point.lon), round6(point.lat)] as [number, number],
  );
  const elevations = points.every((point) => point.ele !== undefined)
    ? points.map((point) => point.ele ?? 0)
    : null;
  const stamps = points.map((point) => (point.time ? Date.parse(point.time) : Number.NaN));
  const timed = stamps.every((stamp) => Number.isFinite(stamp));
  const times = timed ? points.map((point) => point.time ?? '') : null;

  let lengthM = 0;
  let movingS = 0;
  let index = 0;
  for (const segment of segments) {
    for (let i = 1; i < segment.length; i++) {
      const [a, b] = [segment[i - 1], segment[i]];
      if (!a || !b) continue;
      lengthM += distanceM([a.lon, a.lat], [b.lon, b.lat]);
    }
    if (timed) movingS += movingSeconds(segment, stamps.slice(index, index + segment.length));
    index += segment.length;
  }

  let start: Date | undefined;
  let local: string | undefined;
  // A loop, not Math.min(...stamps): a track of several days has more points than a call takes.
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const stamp of stamps) {
    if (stamp < earliest) earliest = stamp;
    if (stamp > latest) latest = stamp;
  }
  const trackStart = timed ? new Date(earliest) : undefined;
  if (trackStart) start = trackStart;
  else if (info.time && Number.isFinite(Date.parse(info.time))) start = new Date(info.time);
  else {
    const named = dateInName(file.name);
    const parsed = named ? parseDate(named, options.timeZone) : undefined;
    if (parsed) {
      start = parsed.utc;
      local = parsed.local;
    }
  }
  if (!start)
    throw new Error(
      'no date: its points carry no times, and neither its metadata nor its file name has one',
    );
  const elapsedS = timed ? Math.round((latest - earliest) / 1000) : null;
  const key = gpxKey(trackStart, coordinates);
  const name = info.name ?? file.name;
  const [first, last] = [coordinates[0], coordinates.at(-1)];
  return {
    id: gpxActivityId(key),
    key,
    file: file.label,
    name,
    activity: {
      source: 'gpx',
      strava_id: null,
      start_time: start.toISOString(),
      start_local: local ?? utcToLocal(start, options.timeZone),
      time_zone: options.timeZone,
      activity_type: type,
      sport_type: info.type ?? null,
      event_tags: '[]',
      name,
      distance_m: Math.round(lengthM),
      elevation_gain_m: elevations ? Math.round(climbM(elevations)) : null,
      moving_time_s: timed ? Math.round(movingS) : null,
      elapsed_time_s: elapsedS,
      visibility: null,
      has_track: 1,
      start_lat: first ? first[1] : null,
      start_lon: first ? first[0] : null,
      end_lat: last ? last[1] : null,
      end_lon: last ? last[0] : null,
      raw: json({
        file: file.label,
        key,
        type: info.type ?? null,
        ...(jumps > 0 ? { jumps } : {}),
      }),
    },
    track: {
      detail: 'full',
      coordinates: json(coordinates),
      point_count: coordinates.length,
      elevations: elevations ? json(elevations) : null,
      times: times ? json(times) : null,
    },
  };
};

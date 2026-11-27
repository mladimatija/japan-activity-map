import type { Position } from 'geojson';
import { create } from 'zustand';

import type { ActivityRecord } from './data.ts';
import { metresBetween } from './format.ts';
import { distanceM, FOOT_M, formatUnits, isImperial, type Units } from './units.ts';
import { tracksByYear } from './lazy.ts';

/** A point of a published track. */
export interface Sample {
  /** Metres along the published stretches; the jump over a privacy zone is not counted. */
  d: number;
  lon: number;
  lat: number;
  /** Height in metres, when the track has heights. */
  z: number | null;
  /** Moving seconds from the start, when the track has times: pauses are left out. */
  t: number | null;
  /** Which published stretch it is on; a privacy zone between two stretches is a gap. */
  stretch: number;
}

/**
 * The slowest speed that still counts as moving, in m/s. Between two points with a longer time
 * than that speed explains, the rest is a pause (a steep hike can be very slow).
 */
const SLOWEST: Partial<Record<string, number>> = { ride: 1.5, run: 0.8 };

const featureOf = (activity: ActivityRecord) =>
  activity.trackYear === undefined
    ? undefined
    : tracksByYear
        .get(activity.trackYear)
        ?.features.find((candidate) => candidate.properties.id === activity.id);

const samplesCache = new WeakMap<object, Sample[]>();

/** The published track's points, once its year has loaded. */
export const samplesOf = (activity: ActivityRecord): Sample[] | null => {
  const feature = featureOf(activity);
  if (!feature) return null;
  const known = samplesCache.get(feature);
  if (known) return known;
  const lines = feature.geometry.coordinates as Position[][];
  const seconds = feature.properties.t;
  const timed =
    seconds !== undefined && lines.every((line, i) => seconds[i]?.length === line.length);
  const slowest = SLOWEST[activity.type] ?? 0.25;
  const out: Sample[] = [];
  let d = 0;
  let moving = 0;
  lines.forEach((line, stretch) => {
    line.forEach((point, i) => {
      const before = line[i - 1];
      if (before) {
        const step = metresBetween(before, point);
        d += step;
        if (timed) {
          const elapsed = (seconds[stretch]?.[i] ?? 0) - (seconds[stretch]?.[i - 1] ?? 0);
          moving += Math.min(elapsed, step / slowest);
        }
      }
      out.push({
        d,
        lon: point[0] ?? 0,
        lat: point[1] ?? 0,
        z: point[2] ?? null,
        t: timed ? moving : null,
        stretch,
      });
    });
  });
  samplesCache.set(feature, out);
  return out;
};

/** Distance along a track against height, for tracks published with heights. */
export const profileOf = (activity: ActivityRecord): { d: number; z: number }[] | null => {
  const samples = samplesOf(activity);
  if (!samples || samples.length < 2 || samples.some((sample) => sample.z === null)) return null;
  return samples.map((sample) => ({ d: sample.d, z: sample.z ?? 0 }));
};

/** Gradient bands, steepest downhill first: the limits between them, as fractions. */
const GRADE_LIMITS = [-0.08, -0.03, 0.03, 0.08] as const;
export const gradeBand = (grade: number): number => {
  const band = GRADE_LIMITS.findIndex((limit) => grade < limit);
  return band < 0 ? GRADE_LIMITS.length : band;
};

export interface Stretch {
  from: number;
  to: number;
  /** Height gained over the distance, as a fraction (0.12 is 12%). */
  grade: number;
}

export interface Split {
  from: number;
  to: number;
  /** Moving seconds. */
  seconds: number;
  climb: number;
  descent: number;
}

export interface Analysis {
  samples: Sample[];
  total: number;
  /** Heights smoothed over about 80 m, one per sample; null without heights. */
  smooth: number[] | null;
  /** The gradient at each sample, over about 100 m around it; null without heights. */
  grades: number[] | null;
  heights: {
    low: number;
    high: number;
    climb: number;
    descent: number;
    /** The steepest climb and descent over `steepM`. */
    up: Stretch | null;
    down: Stretch | null;
    steepM: number;
    /** Metres in each gradient band, steepest downhill first. */
    bands: number[];
  } | null;
  /** Moving time per stretch of `splitM`, when the track has times. */
  splits: Split[] | null;
  splitM: number;
  moving: number | null;
}

/** The first index at or after `from` whose distance is at least `d`, or -1. */
const indexAtOrAfter = (samples: Sample[], d: number, from = 0): number => {
  let low = from;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((samples[mid]?.d ?? 0) < d) low = mid + 1;
    else high = mid;
  }
  return low < samples.length ? low : -1;
};

/** A value interpolated at distance `d` along the samples. */
export const valueAt = (samples: Sample[], values: readonly number[], d: number): number => {
  const i = indexAtOrAfter(samples, d);
  if (i <= 0) return values[i < 0 ? values.length - 1 : 0] ?? 0;
  const a = samples[i - 1] as Sample;
  const b = samples[i] as Sample;
  const share = b.d > a.d ? (d - a.d) / (b.d - a.d) : 1;
  return (values[i - 1] ?? 0) + ((values[i] ?? 0) - (values[i - 1] ?? 0)) * share;
};

/** Where distance `d` is on the map, between the two samples around it. */
export const positionAt = (samples: Sample[], d: number): [number, number] => {
  const i = indexAtOrAfter(samples, d);
  const b = samples[i < 0 ? samples.length - 1 : i] as Sample;
  const a = samples[Math.max(0, i - 1)] as Sample;
  if (i <= 0 || b.d <= a.d) return [b.lon, b.lat];
  const share = (d - a.d) / (b.d - a.d);
  return [a.lon + (b.lon - a.lon) * share, a.lat + (b.lat - a.lat) * share];
};

/** The points between two distances, for drawing that part of the track. */
export const pathBetween = (samples: Sample[], from: number, to: number): [number, number][] => {
  const inside = samples
    .filter((sample) => sample.d > from && sample.d < to)
    .map((sample): [number, number] => [sample.lon, sample.lat]);
  return [positionAt(samples, from), ...inside, positionAt(samples, to)];
};

/** Each sample's mean over a window of distance around it, without reaching into another stretch. */
const smoothed = (samples: Sample[], values: number[], halfM: number): number[] => {
  const out: number[] = [];
  let start = 0;
  let end = 0;
  let sum = 0;
  for (const sample of samples) {
    while (
      end < samples.length &&
      (samples[end] as Sample).d <= sample.d + halfM &&
      (samples[end] as Sample).stretch === sample.stretch
    ) {
      sum += values[end] ?? 0;
      end++;
    }
    while (
      (samples[start] as Sample).d < sample.d - halfM ||
      (samples[start] as Sample).stretch !== sample.stretch
    ) {
      sum -= values[start] ?? 0;
      start++;
    }
    out.push(sum / Math.max(1, end - start));
  }
  return out;
};

/** Height gained between two samples over the distance, or null when it is too short to say. */
const gradeBetween = (samples: Sample[], smooth: number[], a: number, b: number) => {
  const span = (samples[b]?.d ?? 0) - (samples[a]?.d ?? 0);
  return span > 0 ? ((smooth[b] ?? 0) - (smooth[a] ?? 0)) / span : null;
};

// Splits and the steepest stretch are measured in round lengths of the units shown, so the
// analysis is kept per units: per kilometre and over 200 m, or per mile and over 660 ft.
const SPLIT_STEPS = [1, 2, 5, 10];
const STEEP_FEET = { ride: 1650, other: 660 };

const analysisCache: Record<Units, WeakMap<Sample[], Analysis>> = {
  metric: new WeakMap(),
  imperial: new WeakMap(),
};

/** Heights, gradients and pace along the published track. */
export const analysisOf = (activity: ActivityRecord): Analysis | null => {
  const samples = samplesOf(activity);
  if (!samples || samples.length < 2) return null;
  const cache = analysisCache[formatUnits()];
  const known = cache.get(samples);
  if (known) return known;
  const total = (samples.at(-1) as Sample).d;
  const hasHeights = samples.every((sample) => sample.z !== null);
  const smooth = hasHeights
    ? smoothed(
        samples,
        samples.map((sample) => sample.z ?? 0),
        40,
      )
    : null;

  let grades: number[] | null = null;
  let heights: Analysis['heights'] = null;
  if (smooth) {
    // The gradient at a point: from 50 m before it to 50 m after, within its stretch.
    const near = (i: number, step: -1 | 1) => {
      const sample = samples[i] as Sample;
      let k = i;
      for (
        let other = samples[k + step];
        other?.stretch === sample.stretch && Math.abs((samples[k] as Sample).d - sample.d) < 50;
        other = samples[k + step]
      )
        k += step;
      return k;
    };
    grades = samples.map((_, i) => {
      const grade = gradeBetween(samples, smooth, near(i, -1), near(i, 1)) ?? 0;
      return Math.max(-0.6, Math.min(0.6, grade));
    });
    const steepM = isImperial()
      ? (activity.type === 'ride' ? STEEP_FEET.ride : STEEP_FEET.other) * FOOT_M
      : activity.type === 'ride'
        ? 500
        : 200;
    let up: Stretch | null = null;
    let down: Stretch | null = null;
    let climb = 0;
    let descent = 0;
    const bands: number[] = Array.from({ length: GRADE_LIMITS.length + 1 }, () => 0);
    let j = 0;
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i] as Sample;
      const next = samples[i + 1];
      if (next && next.stretch === sample.stretch) {
        const rise = (smooth[i + 1] ?? 0) - (smooth[i] ?? 0);
        if (rise > 0) climb += rise;
        else descent -= rise;
        const band = gradeBand(((grades[i] ?? 0) + (grades[i + 1] ?? 0)) / 2);
        bands[band] = (bands[band] ?? 0) + (next.d - sample.d);
      }
      // The steepest stretch at least `steepM` long, starting here.
      j = Math.max(j, i);
      while (j < samples.length - 1 && (samples[j] as Sample).d - sample.d < steepM) j++;
      const end = samples[j] as Sample;
      if (end.stretch !== sample.stretch || end.d - sample.d < steepM) continue;
      const grade = gradeBetween(samples, smooth, i, j) ?? 0;
      if (!up || grade > up.grade) up = { from: sample.d, to: end.d, grade };
      if (!down || grade < down.grade) down = { from: sample.d, to: end.d, grade };
    }
    const zs = samples.map((sample) => sample.z ?? 0);
    heights = {
      low: Math.min(...zs),
      high: Math.max(...zs),
      climb,
      descent,
      up: up && up.grade > 0 ? up : null,
      down: down && down.grade < 0 ? down : null,
      steepM,
      bands,
    };
  }

  // Splits: one per kilometre or mile (five for rides), longer when there would be more than 25.
  const times = samples.every((sample) => sample.t !== null)
    ? samples.map((sample) => sample.t ?? 0)
    : null;
  const splitM =
    (SPLIT_STEPS.find(
      (step) => step >= (activity.type === 'ride' ? 5 : 1) && total / (step * distanceM()) <= 25,
    ) ?? (SPLIT_STEPS.at(-1) as number)) * distanceM();
  let splits: Split[] | null = null;
  if (times && total >= 100) {
    splits = [];
    for (let from = 0; from < total - 1; from += splitM) {
      const to = Math.min(total, from + splitM);
      let climb = 0;
      let descent = 0;
      if (smooth) {
        let previous = valueAt(samples, smooth, from);
        const first = Math.max(0, indexAtOrAfter(samples, from));
        for (let i = first; i < samples.length && (samples[i] as Sample).d < to; i++) {
          const value = smooth[i] ?? previous;
          // Across a privacy zone the height jumps; that is no climb.
          const jump = i > first && samples[i - 1]?.stretch !== samples[i]?.stretch;
          if (!jump && value > previous) climb += value - previous;
          else if (!jump) descent += previous - value;
          previous = value;
        }
        const last = valueAt(samples, smooth, to);
        if (last > previous) climb += last - previous;
        else descent += previous - last;
      }
      splits.push({
        from,
        to,
        seconds: valueAt(samples, times, to) - valueAt(samples, times, from),
        climb,
        descent,
      });
    }
  }
  const analysis: Analysis = {
    samples,
    total,
    smooth,
    grades,
    heights,
    splits,
    splitM,
    moving: times ? (times.at(-1) ?? null) : null,
  };
  cache.set(samples, analysis);
  return analysis;
};

/**
 * Where along the open activity's track the profile or the map is pointing: a distance (from the
 * profile, or from the pointer near the track on the map), or a part of it (a split). A store of
 * its own, so moving along the profile re-renders only the profile and redraws one map source.
 */
interface TrackCursor {
  id: string | null;
  d: number | null;
  range: [number, number] | null;
  from: 'profile' | 'map' | 'split' | null;
}

const NONE: TrackCursor = { id: null, d: null, range: null, from: null };
const useCursor = create<TrackCursor>()(() => NONE);

export const pointTrack = (id: string, d: number, from: 'profile' | 'map'): void => {
  const state = useCursor.getState();
  if (state.id !== id || state.d !== d || state.from !== from)
    useCursor.setState({ id, d, range: null, from });
};

export const pointSplit = (id: string, range: [number, number]): void =>
  useCursor.setState({ id, d: null, range, from: 'split' });

/** Lets go, when what is pointing is `from` (or anything, without it). */
export const releaseTrack = (from?: TrackCursor['from']): void => {
  const state = useCursor.getState();
  if (state.id !== null && (!from || state.from === from)) useCursor.setState(NONE);
};

export const getTrackCursor = (): TrackCursor => useCursor.getState();
export const subscribeTrackCursor = (listener: () => void): (() => void) =>
  useCursor.subscribe(listener);

/** The distance pointed at along this activity's track, from wherever. */
export const useTrackPoint = (id: string): number | null =>
  useCursor((state) => (state.id === id ? state.d : null));
export const useTrackRange = (id: string): [number, number] | null =>
  useCursor((state) => (state.id === id ? state.range : null));

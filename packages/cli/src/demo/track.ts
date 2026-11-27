/**
 * The pieces a made-up track is built from: lines resampled at an even spacing, a wandering line
 * between two points, GPS-like drift, a height model and a pace model, and a GPX writer. Nothing
 * here reads the network or the clock; every random choice comes from the generator passed in.
 */
import type { ActivityType } from '@jam/core';

import type { Rng } from './rng.ts';

export type LonLat = [number, number];

/** A point of a finished track: position, height in metres, seconds since the start. */
export interface TrackPoint {
  lon: number;
  lat: number;
  ele: number;
  t: number;
}

const M_PER_DEG_LAT = 110_950;
const mPerDegLon = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Distance in metres between two points; flat-earth, which is exact enough over a track's legs. */
export const distM = (a: LonLat, b: LonLat): number =>
  Math.hypot((b[0] - a[0]) * mPerDegLon((a[1] + b[1]) / 2), (b[1] - a[1]) * M_PER_DEG_LAT);

/** The point `east` and `north` metres from `from`. */
export const offsetM = (from: LonLat, east: number, north: number): LonLat => [
  from[0] + east / mPerDegLon(from[1]),
  from[1] + north / M_PER_DEG_LAT,
];

/** Distance along the line at each point, starting at 0. */
export const cumulativeM = (line: readonly LonLat[]): number[] => {
  const out = [0];
  for (let i = 1; i < line.length; i++)
    out.push((out[i - 1] as number) + distM(line[i - 1] as LonLat, line[i] as LonLat));
  return out;
};

export const lengthM = (line: readonly LonLat[]): number => cumulativeM(line).at(-1) ?? 0;

/** The stretch of the line between two distances from its start, with exact end points. */
export const sliceLine = (line: readonly LonLat[], fromM: number, toM: number): LonLat[] => {
  const cum = cumulativeM(line);
  const total = cum.at(-1) ?? 0;
  const [start, end] = [Math.max(0, fromM), Math.min(total, toM)];
  const at = (metres: number, i: number): LonLat => {
    const [a, b] = [line[i - 1] as LonLat, line[i] as LonLat];
    const span = (cum[i] as number) - (cum[i - 1] as number);
    const share = span === 0 ? 0 : (metres - (cum[i - 1] as number)) / span;
    return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share];
  };
  const out: LonLat[] = [];
  for (let i = 1; i < line.length; i++) {
    const [before, here] = [cum[i - 1] as number, cum[i] as number];
    if (here < start || before > end) continue;
    if (out.length === 0) out.push(before >= start ? (line[i - 1] as LonLat) : at(start, i));
    out.push(here <= end ? (line[i] as LonLat) : at(end, i));
  }
  return out;
};

/** The same line with a point every `stepM` metres (and its last point kept). */
export const densify = (line: readonly LonLat[], stepM: number): LonLat[] => {
  if (line.length < 2) return [...line];
  const cum = cumulativeM(line);
  const total = cum.at(-1) ?? 0;
  const n = Math.max(1, Math.round(total / stepM));
  const out: LonLat[] = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const metres = (total * k) / n;
    while (i < line.length - 1 && (cum[i] as number) < metres) i++;
    const [a, b] = [line[i - 1] as LonLat, line[i] as LonLat];
    const span = (cum[i] as number) - (cum[i - 1] as number);
    const share =
      span === 0 ? 0 : Math.min(1, Math.max(0, (metres - (cum[i - 1] as number)) / span));
    out.push([a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]);
  }
  return out;
};

/** Rounds the corners of a hand-drawn line (Chaikin), keeping both ends where they are. */
export const roundCorners = (line: readonly LonLat[], passes = 2): LonLat[] => {
  let current = [...line];
  for (let pass = 0; pass < passes && current.length > 2; pass++) {
    const next: LonLat[] = [current[0] as LonLat];
    for (let i = 0; i < current.length - 1; i++) {
      const [a, b] = [current[i] as LonLat, current[i + 1] as LonLat];
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    }
    next.push(current.at(-1) as LonLat);
    current = next;
  }
  return current;
};

/**
 * A wandering line from `a` to `b`, as a path up a hillside does: each leg's middle is pushed
 * sideways by up to `wobble` of the leg's length, again and again on the halves.
 */
export const wander = (a: LonLat, b: LonLat, rng: Rng, wobble = 0.16, depth = 6): LonLat[] => {
  let line: LonLat[] = [a, b];
  let amount = wobble;
  for (let level = 0; level < depth; level++) {
    const next: LonLat[] = [line[0] as LonLat];
    for (let i = 1; i < line.length; i++) {
      const [p, q] = [line[i - 1] as LonLat, line[i] as LonLat];
      const leg = distM(p, q);
      const mid: LonLat = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      // Sideways: the leg's direction turned a quarter.
      const east = (q[0] - p[0]) * mPerDegLon(mid[1]);
      const north = (q[1] - p[1]) * M_PER_DEG_LAT;
      const push = leg === 0 ? 0 : (rng.range(-1, 1) * amount * leg) / leg;
      next.push(offsetM(mid, -north * push, east * push), q);
    }
    line = next;
    amount *= 0.72;
  }
  return line;
};

/** A closed loop from `start` and back, about `radiusM` across, leaning towards `bearing` (radians). */
export const loopFrom = (start: LonLat, rng: Rng, radiusM: number, bearing: number): LonLat[] => {
  const centre = offsetM(start, Math.sin(bearing) * radiusM, Math.cos(bearing) * radiusM);
  const corners = rng.int(5, 8);
  const first = bearing + Math.PI;
  const turn = rng.chance(0.5) ? 1 : -1;
  const line: LonLat[] = [start];
  for (let i = 1; i < corners; i++) {
    const angle = first + (turn * 2 * Math.PI * i) / corners;
    const radius = radiusM * rng.range(0.7, 1.25);
    line.push(offsetM(centre, Math.sin(angle) * radius, Math.cos(angle) * radius));
  }
  line.push(start);
  return roundCorners(line, 2);
};

/**
 * Moves each point sideways and along by a slowly drifting amount of about `metres`, as a GPS
 * track differs from the path walked. The drift is smooth, so the line grows hardly any longer.
 */
export const gpsDrift = (line: readonly LonLat[], rng: Rng, metres: number): LonLat[] => {
  let [east, north] = [rng.gauss() * metres, rng.gauss() * metres];
  return line.map((point) => {
    east = east * 0.94 + rng.gauss() * metres * 0.34;
    north = north * 0.94 + rng.gauss() * metres * 0.34;
    return offsetM(point, east, north);
  });
};

/** Smooth noise along a distance: random values every `waveM` metres, eased between. */
const valueNoise = (rng: Rng, totalM: number, waveM: number) => {
  const knots = Array.from({ length: Math.ceil(totalM / waveM) + 2 }, () => rng.range(-1, 1));
  return (metres: number) => {
    const at = metres / waveM;
    const i = Math.floor(at);
    const share = at - i;
    const eased = share * share * (3 - 2 * share);
    return (knots[i] ?? 0) * (1 - eased) + (knots[i + 1] ?? 0) * eased;
  };
};

/**
 * Heights along a line. `anchors` fix the height at shares of the way (0 to 1), eased between;
 * `roughM` adds hills of about that size, fading to nothing at each anchor so a summit keeps its
 * height. Nothing rises above the highest anchor by more than a little or drops below 1 m.
 */
export const heightsAlong = (
  line: readonly LonLat[],
  anchors: readonly (readonly [number, number])[],
  rng: Rng,
  roughM: number,
): number[] => {
  const cum = cumulativeM(line);
  const total = cum.at(-1) ?? 1;
  const sorted = [...anchors].sort((a, b) => a[0] - b[0]);
  const top = Math.max(...sorted.map(([, ele]) => ele));
  const waves = [
    [valueNoise(rng, total, 2400), 1],
    [valueNoise(rng, total, 700), 0.4],
    [valueNoise(rng, total, 180), 0.12],
  ] as const;
  return cum.map((metres) => {
    const share = metres / total;
    let j = sorted.findIndex(([at]) => at >= share);
    if (j === -1) j = sorted.length - 1;
    const [toShare, toEle] = sorted[j] as readonly [number, number];
    const [fromShare, fromEle] = sorted[Math.max(0, j - 1)] as readonly [number, number];
    const span = toShare - fromShare;
    const local = span <= 0 ? 1 : Math.min(1, Math.max(0, (share - fromShare) / span));
    const eased = local * local * (3 - 2 * local);
    const base = fromEle + (toEle - fromEle) * (0.5 * local + 0.5 * eased);
    const nearest = Math.min(...sorted.map(([at]) => Math.abs(at - share))) * total;
    const fade = Math.min(1, nearest / 600);
    const noise = waves.reduce((sum, [wave, weight]) => sum + wave(metres) * weight, 0);
    const ele = base + noise * roughM * fade;
    return Math.round(Math.max(1, Math.min(ele, top + roughM * 0.1)) * 10) / 10;
  });
};

/** How a type moves on the flat, in metres a second, before fitness and the day's form. */
const FLAT_SPEED: Record<ActivityType, number> = {
  hike: 1.22,
  walk: 1.38,
  run: 2.95,
  trail_run: 2.45,
  ride: 6.9,
};

/** Speed on a slope as a share of the speed on the flat. `grade` is rise over run. */
export const slopeFactor = (type: ActivityType, grade: number): number => {
  const g = Math.max(-0.45, Math.min(0.45, grade));
  if (type === 'hike' || type === 'walk') {
    // Tobler's hiking function, scaled so the flat is 1: fastest a little downhill.
    return Math.exp(-3.5 * Math.abs(g + 0.05)) / Math.exp(-0.175);
  }
  if (type === 'ride') {
    return g >= 0 ? 1 / (1 + 13 * g) : Math.min(1.9, 1 + -g * 9);
  }
  // Running: the cost of a slope rises steeply uphill and dips a little downhill.
  const cost = Math.max(0.78, 1 + 3.6 * g + 13 * g * g);
  return 1 / (type === 'trail_run' ? cost * (1 + Math.abs(g)) : cost);
};

export interface PaceOptions {
  type: ActivityType;
  /** Multiplies the speed: 1 is the type's ordinary speed, 1.2 a race. */
  effort: number;
  /** Stops along the way: none (a race), or the type's usual few. */
  pauses: boolean;
  /** Long stops at shares of the way (0 to 1), in seconds: a hut for the night, a lunch. */
  stops?: readonly (readonly [number, number])[];
}

/**
 * Seconds since the start at each point: speed follows the type and the slope under each leg,
 * drifts by a few percent as form does, and stops now and then (a view, a traffic light).
 */
export const timesAlong = (
  line: readonly LonLat[],
  heights: readonly number[],
  rng: Rng,
  options: PaceOptions,
): number[] => {
  const cum = cumulativeM(line);
  const total = cum.at(-1) ?? 0;
  const flat = FLAT_SPEED[options.type] * options.effort;
  const pauseEveryM = { hike: 4500, walk: 3500, run: 6000, trail_run: 5000, ride: 9000 }[
    options.type
  ];
  const pauseS = {
    hike: [60, 420],
    walk: [20, 150],
    run: [15, 60],
    trail_run: [30, 180],
    ride: [20, 240],
  }[options.type] as [number, number];
  const stops = [...(options.stops ?? [])].sort((a, b) => a[0] - b[0]);
  let form = 1;
  let t = 0;
  let nextStop = 0;
  // A slope is felt over a stretch, not one leg: look about 60 m each way.
  const span = Math.max(1, Math.round(60 / Math.max(1, total / Math.max(1, line.length - 1))));
  const out = [0];
  for (let i = 1; i < line.length; i++) {
    const leg = (cum[i] as number) - (cum[i - 1] as number);
    const [lo, hi] = [Math.max(0, i - span), Math.min(line.length - 1, i + span - 1)];
    const run = (cum[hi] as number) - (cum[lo] as number);
    const grade = run > 0 ? ((heights[hi] as number) - (heights[lo] as number)) / run : 0;
    form = Math.max(0.88, Math.min(1.12, form + rng.gauss() * 0.012 - (form - 1) * 0.05));
    // Tiring: the last third of a long day is a few percent slower.
    const tired = 1 - 0.05 * Math.max(0, (cum[i] as number) / Math.max(1, total) - 0.66) * 3;
    const speed = Math.max(0.25, flat * slopeFactor(options.type, grade) * form * tired);
    t += leg / speed;
    if (options.pauses && rng.chance(leg / pauseEveryM)) t += rng.range(pauseS[0], pauseS[1]);
    while (
      nextStop < stops.length &&
      (cum[i] as number) / Math.max(1, total) >= (stops[nextStop] as readonly [number, number])[0]
    ) {
      t += (stops[nextStop] as readonly [number, number])[1];
      nextStop++;
    }
    out.push(Math.round(t));
  }
  // Times must rise strictly for the pace and split calculations.
  for (let i = 1; i < out.length; i++)
    if ((out[i] as number) <= (out[i - 1] as number)) out[i] = (out[i - 1] as number) + 1;
  return out;
};

/** Total climb in metres, counting only rises that add up to more than `noiseM` in one go. */
export const climbM = (heights: readonly number[], noiseM = 3): number => {
  let gain = 0;
  let low = heights[0] ?? 0;
  let last = low;
  for (const ele of heights) {
    if (ele > last + noiseM) {
      gain += ele - last;
      last = ele;
    } else if (ele < last - noiseM) last = ele;
    low = Math.min(low, ele);
  }
  return Math.round(gain);
};

/** Puts positions, heights and times together. */
export const toTrack = (
  line: readonly LonLat[],
  heights: readonly number[],
  times: readonly number[],
): TrackPoint[] =>
  line.map(([lon, lat], i) => ({ lon, lat, ele: heights[i] ?? 0, t: times[i] ?? i }));

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A GPX 1.1 file with one track of one segment; `startMs` is the UTC time of the first point. */
export const gpxText = (name: string, startMs: number, points: readonly TrackPoint[]): string => {
  const rows = points.map(
    (point) =>
      `<trkpt lat="${point.lat.toFixed(6)}" lon="${point.lon.toFixed(6)}"><ele>${point.ele.toFixed(1)}</ele><time>${new Date(startMs + point.t * 1000).toISOString().replace('.000', '')}</time></trkpt>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="japan-activity-map demo" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${escapeXml(name)}</name><trkseg>\n${rows.join('\n')}\n</trkseg></trk>\n</gpx>\n`;
};

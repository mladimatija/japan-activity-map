/**
 * Writes a made-up athlete's history: sheet rows and GPX tracks, from the story in story.ts and a
 * seeded generator. The same seed, end date, years, language and lists give the same rows and
 * the same files, byte for byte. Nothing here reads the clock, the network or the real store.
 */
import type { ActivityType, EventTag } from '@jam/core';

import { type DemoLists, type DemoPlace, longestChain } from './lists.ts';
import { demoName, type DemoLang, type NameKey } from './names.ts';
import { createRng, type Rng } from './rng.ts';
import {
  ARAKAWA,
  COMMUTE,
  DEMO_HOME,
  EAST_GARDENS,
  FROM_BAY,
  JINBA_TAKAO,
  LOCAL_HILL,
  PALACE_LOOP,
  SUMIDA,
  SUMIDA_SHORT_SHARE,
  TAMA,
  TAMA_TURNS,
  TO_ARAKAWA,
  TO_PALACE,
  TRIPS,
  type Trip,
  WANTED,
} from './story.ts';
import {
  climbM,
  cumulativeM,
  densify,
  distM,
  gpsDrift,
  gpxText,
  heightsAlong,
  lengthM,
  loopFrom,
  type LonLat,
  offsetM,
  roundCorners,
  sliceLine,
  timesAlong,
  toTrack,
  wander,
} from './track.ts';

export interface DemoOptions {
  seed: number;
  /** Last day of the history, YYYY-MM-DD. */
  until: string;
  years: number;
  lang: DemoLang;
}

/** One sheet row, by column name (see sheet/spec.ts). */
export type DemoRow = Record<string, string>;

export interface DemoHistory {
  rows: DemoRow[];
  /** Trips of the story left out because the lists on this machine lack what they name. */
  skipped: string[];
}

/** Bumped when the generator changes what a seed produces, so an old demo folder can be told. */
export const GENERATOR_VERSION = 1;

const DAY_MS = 86_400_000;
const STEP_FOOT_M = 25;
const STEP_RIDE_M = 60;

const dayOf = (date: string): number => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const dateOf = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** 0 is Sunday. */
const weekdayOf = (day: number): number => (((day + 4) % 7) + 7) % 7;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A line with its heights: the ground an outing covers, before a day's GPS drift and pace. */
interface Course {
  line: LonLat[];
  heights: number[];
}

const join = (...parts: Course[]): Course => {
  const out: Course = { line: [], heights: [] };
  for (const part of parts) {
    const skip = out.line.length > 0 ? 1 : 0;
    out.line.push(...part.line.slice(skip));
    out.heights.push(...part.heights.slice(skip));
  }
  return out;
};
const reversed = (course: Course): Course => ({
  line: course.line.toReversed(),
  heights: course.heights.toReversed(),
});
const outAndBack = (course: Course): Course => join(course, reversed(course));
/** The part of a course between two shares of its length. */
const part = (course: Course, from: number, to: number): Course => {
  const cum = cumulativeM(course.line);
  const total = cum.at(-1) ?? 0;
  const first = Math.max(
    0,
    cum.findIndex((metres) => metres >= from * total),
  );
  let last = cum.findIndex((metres) => metres >= to * total);
  if (last === -1) last = cum.length - 1;
  return {
    line: course.line.slice(first, last + 1),
    heights: course.heights.slice(first, last + 1),
  };
};

/** A hand-drawn line as a course: corners rounded, a point every `stepM`, heights between corners. */
const drawn = (
  corners: readonly (readonly [number, number, number])[],
  stepM: number,
  rng: Rng,
  roughM = 1.2,
): Course => {
  const raw = corners.map(([lon, lat]) => [lon, lat] as LonLat);
  const cum = cumulativeM(raw);
  const total = cum.at(-1) ?? 1;
  const line = densify(roundCorners(raw, 2), stepM);
  const anchors = corners.map(([, , ele], i) => [(cum[i] ?? 0) / total, ele] as const);
  return { line, heights: heightsAlong(line, anchors, rng, roughM) };
};

/** What an outing becomes: a sheet row, and a track unless it has no GPS. */
interface Draft {
  type: ActivityType;
  name: string;
  /** Minutes after local midnight. */
  startMin: number;
  tags?: EventTag[];
  course?: Course;
  /** Multiplies the type's ordinary speed. */
  effort?: number;
  pauses?: boolean;
  stops?: readonly (readonly [number, number])[];
  /** Days after the first that the outing ends on. */
  extraDays?: number;
  timeZone?: string;
  utcOffset?: number;
  place?: string;
  status?: string;
  notes?: string;
  hide?: boolean;
  /** For a row without GPS. */
  manual?: { km: number; seconds: number };
}

interface Plan {
  day: number;
  key: string;
  make(rng: Rng): Draft | undefined;
}

const clock = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const two = (n: number) => String(n).padStart(2, '0');
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
};

const SHEET_COLUMNS = [
  'row_id',
  'date',
  'end_date',
  'time_zone',
  'activity_type',
  'event_tags',
  'name',
  'place',
  'status',
  'lat',
  'lon',
  'distance_km',
  'elevation_gain_m',
  'duration',
  'gpx_path',
  'strava_id',
  'show_strava_link',
  'hide',
  'notes',
] as const;

const TYPE_CELL: Record<ActivityType, string> = {
  hike: 'Hike',
  walk: 'Walk',
  run: 'Run',
  trail_run: 'Trail Run',
  ride: 'Ride',
};

/** The rows as a CSV sheet, in the template's column order. */
export const sheetCsv = (rows: readonly DemoRow[]): string => {
  const cell = (text: string) => (/[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const lines = [SHEET_COLUMNS.join(',')];
  for (const row of rows) lines.push(SHEET_COLUMNS.map((name) => cell(row[name] ?? '')).join(','));
  return `${lines.join('\n')}\n`;
};

/**
 * Generates the history. Each track is handed to `writeTrack` with its file name (relative to the
 * sheet) as it is made, so the caller decides where files go and nothing large is kept in memory.
 */
export const generateDemo = (
  options: DemoOptions,
  lists: DemoLists,
  writeTrack: (file: string, text: string) => void,
): DemoHistory => {
  const { lang } = options;
  const root = createRng(options.seed);
  const name = (key: NameKey, values?: Record<string, string>) => demoName(key, lang, values);
  const until = dayOf(options.until);
  const untilDate = new Date(until * DAY_MS);
  const start =
    Math.round(
      Date.UTC(
        untilDate.getUTCFullYear() - options.years,
        untilDate.getUTCMonth(),
        untilDate.getUTCDate(),
      ) / DAY_MS,
    ) + 1;
  const windowOf = (day: number) => clamp(Math.floor((day - start) / 365.25), 0, options.years - 1);
  /** Fitter each year: 0.9 of ordinary speed at the start, a little over 1 at the end. */
  const fitness = (day: number) => 0.9 + 0.15 * ((day - start) / Math.max(1, until - start));

  // The ground: every course is drawn once, from its own seed, so each repeat follows it exactly.
  const ground = root.fork('ground');
  const toPalace = drawn(TO_PALACE, STEP_FOOT_M, ground.fork('to-palace'));
  const palace = drawn(PALACE_LOOP, STEP_FOOT_M, ground.fork('palace'));
  const gardens = drawn(EAST_GARDENS, STEP_FOOT_M, ground.fork('gardens'));
  const sumida = drawn(SUMIDA, STEP_FOOT_M, ground.fork('sumida'));
  const temple = drawn(
    [...SUMIDA, [139.7972, 35.7128, 4], [139.7966, 35.7146, 5]],
    STEP_FOOT_M,
    ground.fork('temple'),
  );
  const bank = drawn(ARAKAWA, STEP_FOOT_M, ground.fork('bank'));
  const bankRide = drawn(ARAKAWA, STEP_RIDE_M, ground.fork('bank'));
  const toBank = drawn(TO_ARAKAWA, STEP_FOOT_M, ground.fork('to-bank'));
  const toBankRide = drawn(TO_ARAKAWA, STEP_RIDE_M, ground.fork('to-bank'));
  const fromBay = drawn(FROM_BAY, STEP_FOOT_M, ground.fork('from-bay'));
  const tama = drawn(TAMA, STEP_RIDE_M, ground.fork('tama'), 2);
  const commute = drawn(COMMUTE, STEP_RIDE_M / 2, ground.fork('commute'));
  const ridge = drawn(JINBA_TAKAO, STEP_FOOT_M, ground.fork('ridge'), 30);
  /** Where the way from home meets the bank (小松川), as a share of the bank's length. */
  const bankJoin =
    lengthM(ARAKAWA.slice(0, 5).map(([lon, lat]) => [lon, lat] as LonLat)) /
    lengthM(ARAKAWA.map(([lon, lat]) => [lon, lat] as LonLat));
  const courses = {
    palace: join(toPalace, palace, reversed(toPalace)),
    palaceClockwise: join(toPalace, reversed(palace), reversed(toPalace)),
    palaceLaps: join(toPalace, palace, palace, reversed(toPalace)),
    gardens: outAndBack(join(toPalace, gardens)),
    sumida: outAndBack(sumida),
    sumidaShort: outAndBack(part(sumida, 0, SUMIDA_SHORT_SHARE)),
    temple,
    longRun: join(toBank, reversed(part(bank, 0, bankJoin)), fromBay),
    arakawaRun: outAndBack(join(toBank, part(bank, bankJoin, bankJoin + 0.12))),
    arakawaRide: outAndBack(join(toBankRide, part(bankRide, bankJoin, 1))),
    tamaFutako: outAndBack(part(tama, 0, TAMA_TURNS.futako)),
    tamaFuchu: outAndBack(part(tama, 0, TAMA_TURNS.fuchu)),
    tamaHamura: outAndBack(part(tama, 0, TAMA_TURNS.hamura)),
    commute,
    commuteHome: reversed(commute),
    ridge,
  } satisfies Record<string, Course>;

  /** A race course of exactly `km` along the bank and back, away from home. */
  const raceCourse = (km: number): Course => {
    const raw = ARAKAWA.map(([lon, lat]) => [lon, lat] as LonLat);
    // A touch over, as a measured course is: a track must not come up short of the distance.
    const out = densify(
      sliceLine(roundCorners(raw, 2), 3000, 3000 + km * 500 * 1.004),
      STEP_FOOT_M,
    );
    const heights = heightsAlong(
      out,
      [
        [0, 3],
        [1, 4],
      ],
      ground.fork(`race-${km}`),
      1,
    );
    return outAndBack({ line: out, heights });
  };

  /** A path up to the summits and back the same way, from a trailhead drawn below the first. */
  const approach = (
    summits: readonly DemoPlace[],
    from: readonly [number, number, number] | undefined,
    rng: Rng,
  ): Course | undefined => {
    const first = summits[0];
    if (!first || summits.some((summit) => summit.elevationM === undefined)) return undefined;
    const top = first.elevationM ?? 0;
    let head: readonly [number, number, number];
    if (from) head = from;
    else {
      const gain = clamp(top * 0.5, 350, 1450);
      const away = clamp(gain / 0.16, 2200, 8000);
      const bearing = rng.range(0, Math.PI * 2);
      const [lon, lat] = offsetM(first.at, Math.sin(bearing) * away, Math.cos(bearing) * away);
      head = [lon, lat, Math.round(top - gain)];
    }
    const stops: (readonly [LonLat, number])[] = [
      [[head[0], head[1]], head[2]],
      ...summits.map((summit) => [summit.at, summit.elevationM ?? 0] as const),
    ];
    const legs: Course[] = [];
    for (let i = 1; i < stops.length; i++) {
      const [[a, eleA], [b, eleB]] = [
        stops[i - 1] as readonly [LonLat, number],
        stops[i] as readonly [LonLat, number],
      ];
      const line = densify(wander(a, b, rng, i === 1 ? 0.15 : 0.08), STEP_FOOT_M);
      // Between two summits the ridge dips to a col.
      const anchors: (readonly [number, number])[] =
        i === 1
          ? [
              [0, eleA],
              [1, eleB],
            ]
          : [
              [0, eleA],
              [0.5, Math.min(eleA, eleB) - Math.min(180, distM(a, b) * 0.06)],
              [1, eleB],
            ];
      legs.push({ line, heights: heightsAlong(line, anchors, rng, i === 1 ? 22 : 10) });
    }
    return join(...legs);
  };

  const skipped: string[] = [];
  const plans: Plan[] = [];
  const taken = new Set<number>();

  /** A free weekend day in the trip's month and year of the history; two in a row for a night out. */
  const dayFor = (trip: Trip): number | undefined => {
    const fits = (day: number) =>
      day >= start &&
      day <= until &&
      windowOf(day) === trip.year &&
      new Date(day * DAY_MS).getUTCMonth() + 1 === trip.month;
    const nights = 'overnight' in trip && trip.overnight ? 1 : 0;
    for (const weekdays of [
      [6, 0],
      [1, 2, 3, 4, 5],
    ])
      for (let day = start; day <= until; day++) {
        if (!fits(day) || !weekdays.includes(weekdayOf(day)) || taken.has(day)) continue;
        if (nights && (weekdayOf(day) !== 6 || taken.has(day + 1) || day + 1 > until)) continue;
        taken.add(day);
        if (nights) taken.add(day + 1);
        return day;
      }
    return undefined;
  };

  const tripPlan = (trip: Trip, index: number): Plan | undefined => {
    if (trip.year >= options.years) return undefined;
    if (trip.kind === 'peak') {
      const summits = trip.peaks.map((id) => lists.place(id));
      if (summits.some((summit) => !summit)) {
        skipped.push(`peak ${trip.peaks.join(', ')}: not in the lists`);
        return undefined;
      }
      const places = summits as DemoPlace[];
      const day = dayFor(trip);
      if (day === undefined) return undefined;
      return {
        day,
        key: `trip-${index}`,
        make: (rng) => {
          // The path depends on the summits alone, so a second visit climbs the same way.
          const up = approach(places, trip.from, root.fork(`approach-${trip.peaks.join('+')}`));
          if (!up) return undefined;
          const type = trip.type ?? 'hike';
          const [a, b] = [places[0] as DemoPlace, places[1]];
          const names = { name: a.name[lang], other: b?.name[lang] ?? '' };
          if (trip.dns) {
            return {
              type,
              name: name('hikeDns', names),
              startMin: rng.int(330, 420),
              course: outAndBack(part(up, 0, 0.62)),
              effort: rng.range(0.95, 1.05),
              pauses: true,
              place: trip.peaks.join(';'),
              status: 'DNS',
              notes: name('noteDns'),
            };
          }
          return {
            type,
            name: name(type === 'trail_run' ? 'trailRun' : b ? 'hikeTwo' : 'hike', names),
            startMin: rng.int(trip.overnight ? 390 : 330, trip.overnight ? 480 : 450),
            course: outAndBack(up),
            effort: rng.range(0.95, 1.08),
            pauses: true,
            // A long rest on top; a night at the hut on a two-day trip.
            stops: trip.overnight
              ? [
                  [0.36, 15.5 * 3600],
                  [0.5, 1200],
                ]
              : [[0.5, rng.range(900, 2400)]],
            ...(trip.overnight ? { extraDays: 1, tags: ['overnight'] as EventTag[] } : {}),
            ...(!trip.overnight && rng.chance(0.35)
              ? { tags: [rng.chance(0.5) ? 'group' : 'solo'] as EventTag[] }
              : {}),
          };
        },
      };
    }
    if (trip.kind === 'route') {
      const item = lists.routeItem(trip.list, trip.item);
      if (!item || item.chains.length === 0) {
        skipped.push(`route ${trip.item}: not in the lists`);
        return undefined;
      }
      const day = dayFor(trip);
      if (day === undefined) return undefined;
      return {
        day,
        key: `trip-${index}`,
        make: (rng) => {
          let raw: LonLat[];
          if (trip.slice)
            raw = sliceLine(longestChain(item), trip.slice[0] * 1000, trip.slice[1] * 1000);
          else {
            // Every piece end to end, as far as each starts near where the last one stopped.
            raw = [...(item.chains[0] as LonLat[])];
            for (const chain of item.chains.slice(1)) {
              if (distM(raw.at(-1) as LonLat, chain[0] as LonLat) > 3000) break;
              raw.push(...chain);
            }
          }
          if (raw.length < 2) return undefined;
          const line = densify(raw, trip.type === 'ride' ? STEP_RIDE_M : STEP_FOOT_M);
          const [from, to, rough] = trip.heights;
          const heights = heightsAlong(
            line,
            [
              [0, from],
              [1, to],
            ],
            root.fork(`route-${trip.item}`),
            rough,
          );
          return {
            type: trip.type,
            name: name(trip.type === 'ride' ? 'routeRide' : 'routeWalk', { name: item.name[lang] }),
            startMin: rng.int(390, 510),
            course: { line, heights },
            effort: rng.range(0.92, 1.03),
            pauses: true,
            stops: trip.overnight ? [[0.5, 15 * 3600]] : [[0.5, rng.range(1200, 3000)]],
            // The whole item end to end: the row says so, as a person who finished it would.
            // (A track alone seldom reaches the share that counts as done on a route drawn in
            // many short pieces.)
            ...(trip.slice ? {} : { place: item.id }),
            ...(trip.overnight ? { extraDays: 1, tags: ['overnight'] as EventTag[] } : {}),
          };
        },
      };
    }
    if (trip.kind === 'visit') {
      const places = trip.places.map((id) => lists.place(id));
      if (places.some((place) => !place)) {
        skipped.push(`visit ${trip.places.join(', ')}: not in the lists`);
        return undefined;
      }
      const stops = places as DemoPlace[];
      const day = dayFor(trip);
      if (day === undefined) return undefined;
      return {
        day,
        key: `trip-${index}`,
        make: (rng) => {
          const first = stops[0] as DemoPlace;
          const bearing = rng.range(0, Math.PI * 2);
          const away = rng.range(1100, 1900);
          const corners = [
            offsetM(first.at, Math.sin(bearing) * away, Math.cos(bearing) * away),
            ...stops.map((stop) => stop.at),
          ];
          const pieces: LonLat[] = [];
          for (let i = 1; i < corners.length; i++)
            pieces.push(
              ...wander(corners[i - 1] as LonLat, corners[i] as LonLat, rng, 0.1, 4).slice(
                i === 1 ? 0 : 1,
              ),
            );
          const line = densify(pieces, STEP_FOOT_M);
          const base = rng.range(15, 60);
          const out = {
            line,
            heights: heightsAlong(
              line,
              [
                [0, base],
                [1, base + rng.range(5, 40)],
              ],
              rng,
              8,
            ),
          };
          return {
            type: 'walk',
            name: name('visit', { name: first.name[lang] }),
            startMin: rng.int(540, 780),
            course: outAndBack(out),
            effort: rng.range(0.9, 1),
            pauses: true,
            stops: [[0.5, rng.range(900, 2700)]],
          };
        },
      };
    }
    if (trip.kind === 'race') {
      const day = dayFor(trip);
      if (day === undefined) return undefined;
      return {
        day,
        key: `trip-${index}`,
        make: (rng) => ({
          type: 'run',
          name: name(trip.name),
          startMin: 540,
          course: raceCourse(trip.km),
          // Shorter races are run harder.
          effort: fitness(day) * (1.36 - 0.065 * Math.log2(trip.km / 5)) * rng.range(0.985, 1.015),
          pauses: false,
          tags: ['race'],
        }),
      };
    }
    const day = dayFor(trip);
    if (day === undefined) return undefined;
    return {
      day,
      key: `trip-${index}`,
      make: (rng) => {
        const line = densify(
          loopFrom(trip.at, rng, trip.radiusM, rng.range(0, Math.PI * 2)),
          STEP_FOOT_M,
        );
        const [low, high] = trip.heights;
        return {
          type: trip.type,
          name: name(trip.name),
          startMin: rng.int(390, 480),
          course: {
            line,
            heights: heightsAlong(
              line,
              [
                [0, low],
                [0.5, high],
                [1, low],
              ],
              rng,
              4,
            ),
          },
          effort: fitness(day) * rng.range(0.95, 1.03),
          pauses: true,
          timeZone: trip.timeZone,
          utcOffset: trip.utcOffset,
        };
      },
    };
  };

  TRIPS.forEach((trip, index) => {
    const plan = tripPlan(trip, index);
    if (plan) plans.push(plan);
  });

  // The weeks between trips: runs from home on weekdays, something longer at the weekend.
  // A loop from home leans south or west (bearing 120° to 330°), never north-east: a published
  // track's bounding box names its south-west corner, and for a track lying wholly north-east of
  // home that corner would be home itself, which the audit rightly refuses.
  const exploreRun = (rng: Rng, radius: readonly [number, number]): Course => {
    const bearing = (rng.range(120, 330) * Math.PI) / 180;
    const line = densify(
      loopFrom(DEMO_HOME, rng, rng.range(radius[0], radius[1]), bearing),
      STEP_FOOT_M,
    );
    return {
      line,
      heights: heightsAlong(
        line,
        [
          [0, 4],
          [0.5, rng.range(3, 24)],
          [1, 4],
        ],
        rng,
        3,
      ),
    };
  };
  const runStart = (rng: Rng) => (rng.chance(0.7) ? rng.int(350, 430) : rng.int(1140, 1245));
  const weekdayRun = (day: number, hide: boolean): Plan => ({
    day,
    key: 'run',
    make: (rng) => {
      const startMin = runStart(rng);
      const effort = fitness(day) * rng.range(0.95, 1.06);
      const base = { type: 'run' as const, startMin, effort, pauses: true };
      // One run is marked `hide` in the sheet, to show a row kept out of the public build.
      const hidden = hide ? { hide: true } : {};
      const pick = rng.weighted([
        ['palace', 0.36],
        ['palaceClockwise', 0.05],
        ['sumida', 0.22],
        ['sumidaShort', 0.12],
        ['palaceLaps', 0.07],
        ['explore', 0.18],
      ] as const);
      if (pick === 'explore')
        return {
          ...base,
          name: name(startMin < 720 ? 'morningRun' : 'eveningRun'),
          course: exploreRun(rng, [700, 1500]),
          ...hidden,
        };
      const key: NameKey =
        pick === 'sumida'
          ? 'sumidaRun'
          : pick === 'sumidaShort'
            ? 'sumidaShort'
            : pick === 'palaceLaps'
              ? 'palaceLaps'
              : 'palaceLoop';
      return { ...base, name: name(key), course: courses[pick], ...hidden };
    },
  });

  const localHill = lists.place(LOCAL_HILL.peak);
  let fillerRuns = 0;
  for (let monday = start + ((8 - weekdayOf(start)) % 7); monday + 6 <= until; monday += 7) {
    const rng = root.fork(`week-${monday - start}`);
    const year = windowOf(monday);
    const volume = year === 0 ? 0.72 : 1;
    const weekOfYear = Math.floor((monday - start - year * 365.25) / 7);
    // An injury in the third year: six weeks of walks only.
    if (year === 2 && weekOfYear >= 30 && weekOfYear < 36) {
      if (rng.chance(0.5) && !taken.has(monday + 6))
        plans.push({
          day: monday + 6,
          key: 'walk',
          make: (r) => ({
            type: 'walk',
            name: name('cityWalk'),
            startMin: r.int(600, 900),
            course: exploreRun(r, [650, 900]),
            effort: 0.9,
            pauses: true,
          }),
        });
      continue;
    }
    for (const [offset, chance] of [
      [1, 0.7],
      [3, 0.62],
    ] as const)
      if (rng.chance(chance * volume) && !taken.has(monday + offset)) {
        fillerRuns++;
        plans.push(weekdayRun(monday + offset, fillerRuns === 10));
      }
    if (!taken.has(monday + 2)) {
      if (rng.chance(0.14 * volume)) {
        plans.push({
          day: monday + 2,
          key: 'commute',
          make: (r) => ({
            type: 'ride',
            name: name('commute'),
            startMin: r.int(485, 520),
            course: courses.commute,
            effort: r.range(0.72, 0.85),
            pauses: true,
            tags: ['commute'],
          }),
        });
        if (rng.chance(0.55))
          plans.push({
            day: monday + 2,
            key: 'commute-home',
            make: (r) => ({
              type: 'ride',
              name: name('commuteHome'),
              startMin: r.int(1110, 1170),
              course: courses.commuteHome,
              effort: r.range(0.72, 0.85),
              pauses: true,
              tags: ['commute'],
            }),
          });
      } else if (rng.chance(0.07)) {
        plans.push({
          day: monday + 2,
          key: 'treadmill',
          make: (r) => {
            const km = r.pick([5, 6, 8, 10]);
            return {
              type: 'run',
              name: name('treadmill'),
              startMin: r.int(1150, 1260),
              manual: { km, seconds: (km * 1000) / (2.95 * fitness(monday) * r.range(0.95, 1.03)) },
              notes: name('noteTreadmill'),
            };
          },
        });
      }
    }
    if (rng.chance(0.05) && !taken.has(monday + 4))
      plans.push({
        day: monday + 4,
        key: 'short-walk',
        make: (r) => {
          // Round the block: all of it inside the home zone, so only its figures are published.
          const line = densify(
            loopFrom(DEMO_HOME, r, r.range(60, 110), r.range(0, Math.PI * 2)),
            10,
          );
          return {
            type: 'walk',
            name: name('shortWalk'),
            startMin: r.int(720, 800),
            course: { line, heights: line.map(() => 4) },
            effort: 0.95,
            pauses: false,
          };
        },
      });
    const saturday = monday + 5;
    if (!taken.has(saturday)) {
      const pick = rng.weighted([
        ['longRun', 0.24],
        ['arakawaRun', 0.1],
        ['ride', 0.24],
        ['hill', localHill ? 0.09 : 0],
        ['ridge', 0.05],
        ['none', 0.28 + (1 - volume) * 0.6],
      ] as const);
      if (pick === 'longRun' || pick === 'arakawaRun')
        plans.push({
          day: saturday,
          key: pick,
          make: (r) => ({
            type: 'run',
            name: name(pick),
            startMin: r.int(390, 510),
            course: courses[pick],
            effort: fitness(saturday) * r.range(0.9, 0.97),
            pauses: true,
            tags: ['training'],
          }),
        });
      else if (pick === 'ride')
        plans.push({
          day: saturday,
          key: 'ride',
          make: (r) => {
            const where = r.weighted([
              ['tamaFutako', 0.34],
              ['tamaFuchu', 0.26],
              ['tamaHamura', 0.12],
              ['arakawaRide', 0.28],
            ] as const);
            return {
              type: 'ride',
              name: name(
                where === 'arakawaRide'
                  ? 'arakawaRide'
                  : where === 'tamaHamura'
                    ? 'tamaLongRide'
                    : 'tamaRide',
              ),
              startMin: r.int(390, 540),
              course: courses[where],
              effort: (0.92 + 0.1 * (fitness(saturday) - 0.9)) * r.range(0.95, 1.05),
              pauses: true,
              stops: [[0.5, r.range(600, 1800)]],
            };
          },
        });
      else if (pick === 'hill' && localHill)
        plans.push({
          day: saturday,
          key: 'hill',
          make: (r) => {
            const up = approach(
              [localHill],
              LOCAL_HILL.from,
              root.fork(`approach-${localHill.id}`),
            );
            if (!up) return undefined;
            const running = r.chance(0.3);
            return {
              type: running ? 'trail_run' : 'hike',
              name: name(running ? 'trailRun' : 'hike', { name: localHill.name[lang] }),
              startMin: r.int(420, 600),
              course: outAndBack(up),
              effort: r.range(0.95, 1.08),
              pauses: true,
              stops: [[0.5, r.range(300, 1500)]],
            };
          },
        });
      else if (pick === 'ridge')
        plans.push({
          day: saturday,
          key: 'ridge',
          make: (r) => ({
            type: 'trail_run',
            name: name('ridgeRun', {
              name:
                lists.place('peak-375')?.name[lang] ?? (lang === 'ja' ? '陣馬山' : 'Mount Jinba'),
              other: localHill?.name[lang] ?? (lang === 'ja' ? '高尾山' : 'Mt. Takaosan'),
            }),
            startMin: r.int(420, 540),
            course: courses.ridge,
            effort: fitness(saturday) * r.range(0.95, 1.05),
            pauses: true,
          }),
        });
    }
    const sunday = monday + 6;
    if (!taken.has(sunday) && rng.chance(0.4 * volume)) {
      const pick = rng.weighted([
        ['easy', 0.38],
        ['gardens', 0.1],
        ['temple', 0.1],
        ['city', 0.14],
        ['explore', 0.28],
      ] as const);
      plans.push({
        day: sunday,
        key: pick,
        make: (r): Draft => {
          if (pick === 'easy')
            return {
              type: 'run',
              name: name(r.chance(0.5) ? 'palaceLoop' : 'sumidaRun'),
              startMin: r.int(420, 600),
              course: r.chance(0.5) ? courses.palace : courses.sumida,
              effort: fitness(sunday) * r.range(0.9, 0.98),
              pauses: true,
            };
          if (pick === 'explore')
            return {
              type: 'run',
              name: name('exploreRun'),
              startMin: r.int(420, 600),
              course: exploreRun(r, [1300, 2600]),
              effort: fitness(sunday) * r.range(0.93, 1.02),
              pauses: true,
            };
          const walk = {
            type: 'walk' as const,
            startMin: r.int(600, 900),
            effort: r.range(0.88, 1),
            pauses: true,
          };
          if (pick === 'gardens')
            return { ...walk, name: name('gardenWalk'), course: courses.gardens };
          if (pick === 'temple')
            return {
              ...walk,
              name: name('templeWalk', {
                name:
                  lists.place('temple-q615183')?.name[lang] ??
                  (lang === 'ja' ? '浅草寺' : 'Sensō-ji'),
              }),
              course: courses.temple,
            };
          return { ...walk, name: name('cityWalk'), course: exploreRun(r, [900, 1900]) };
        },
      });
    }
  }

  // Turn every plan into a row and a file, in date order.
  const drafts: { plan: Plan; draft: Draft }[] = [];
  const perDay = new Map<number, number>();
  for (const plan of plans.toSorted((a, b) => a.day - b.day || a.key.localeCompare(b.key))) {
    const nth = perDay.get(plan.day) ?? 0;
    perDay.set(plan.day, nth + 1);
    const draft = plan.make(root.fork(`outing-${plan.day - start}-${nth}-${plan.key}`));
    if (draft) drafts.push({ plan, draft });
  }
  drafts.sort((a, b) => a.plan.day - b.plan.day || a.draft.startMin - b.draft.startMin);

  const rows: DemoRow[] = [];
  drafts.forEach(({ plan, draft }, index) => {
    const rowId = `demo-${String(index + 1).padStart(4, '0')}`;
    const date = dateOf(plan.day);
    const two = (n: number) => String(n).padStart(2, '0');
    const row: DemoRow = {
      row_id: rowId,
      date,
      activity_type: TYPE_CELL[draft.type],
      name: draft.name,
      event_tags: (draft.tags ?? []).join(', '),
      ...(draft.extraDays ? { end_date: dateOf(plan.day + draft.extraDays) } : {}),
      ...(draft.timeZone ? { time_zone: draft.timeZone } : {}),
      ...(draft.place ? { place: draft.place } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.notes ? { notes: draft.notes } : {}),
      ...(draft.hide ? { hide: 'yes' } : {}),
    };
    if (draft.course) {
      const rng = root.fork(`track-${rowId}`);
      const line = gpsDrift(draft.course.line, rng, draft.type === 'ride' ? 2.2 : 1.8);
      const stops = draft.stops ?? [];
      const times = timesAlong(line, draft.course.heights, rng, {
        type: draft.type,
        effort: draft.effort ?? 1,
        pauses: draft.pauses ?? true,
        stops,
      });
      const startMs =
        plan.day * DAY_MS + draft.startMin * 60_000 - (draft.utcOffset ?? 9) * 3_600_000;
      const file = `tracks/${rowId}.gpx`;
      writeTrack(file, gpxText(draft.name, startMs, toTrack(line, draft.course.heights, times)));
      row.gpx_path = file;
      row.elevation_gain_m = String(climbM(draft.course.heights));
      // Moving time: the whole outing less its long stops (a night at a hut, lunch on top).
      const stopped = stops.reduce((sum, [, seconds]) => sum + seconds, 0);
      row.duration = clock((times.at(-1) ?? 0) - stopped);
    } else if (draft.manual) {
      row.date = `${date} ${two(Math.floor(draft.startMin / 60))}:${two(draft.startMin % 60)}`;
      row.distance_km = String(draft.manual.km);
      row.duration = clock(draft.manual.seconds);
    }
    rows.push(row);
  });

  // Summits still wanted: rows with a place and no outing.
  WANTED.forEach((id, index) => {
    const place = lists.place(id);
    if (!place) {
      skipped.push(`want ${id}: not in the lists`);
      return;
    }
    rows.push({
      row_id: `demo-want-${String(index + 1).padStart(2, '0')}`,
      date: options.until,
      activity_type: TYPE_CELL.hike,
      name: name('hikeWant', { name: place.name[lang] }),
      place: id,
      status: 'want',
    });
  });
  return { rows, skipped };
};

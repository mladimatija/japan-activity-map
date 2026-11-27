import type { ActivityRecord, Data, List, ListItem } from './data.ts';
import { distanceText, metresBetween } from './format.ts';
import { formatUnits, isImperial, MILE_M, type Units } from './units.ts';
import { t } from './i18n.ts';
import { samplesOf } from './profile.ts';

// --- Personal records ---------------------------------------------------------------------------

/** What a record measures; `effort` is the fastest stretch of `metres` inside one activity. */
export type RecordKind = 'distance' | 'climb' | 'time' | 'highest' | 'effort';

export interface PersonalRecord {
  id: string;
  kind: RecordKind;
  /** The activity type it is the best of. */
  type: string;
  /** Metres for an effort (1,000, 5,000…). */
  metres?: number;
  /** Metres, seconds or a height, as the kind says. */
  value: number;
  activity: ActivityRecord;
}

/** A record's name: "Longest", "Fastest 5 km", "Half marathon"… */
export const recordLabel = (record: Pick<PersonalRecord, 'kind' | 'metres'>): string => {
  if (record.kind === 'distance') return t('Longest');
  if (record.kind === 'climb') return t('Most climb');
  if (record.kind === 'time') return t('Longest moving time');
  if (record.kind === 'highest') return t('Highest point');
  if (record.metres === 21_097.5) return t('Fastest half marathon');
  if (record.metres === 42_195) return t('Fastest marathon');
  // Race distances keep their names in miles: nobody runs a "3 mi".
  if (isImperial() && record.metres === 5000) return t('Fastest {distance}', { distance: '5K' });
  if (isImperial() && record.metres === 10_000) return t('Fastest {distance}', { distance: '10K' });
  return t('Fastest {distance}', { distance: distanceText(record.metres, 0) });
};

/** The stretches timed inside an activity, by type; a type not here has none. */
const RUN_EFFORTS = [5000, 10_000, 21_097.5, 42_195];
const EFFORTS: Record<Units, Partial<Record<string, number[]>>> = {
  metric: {
    run: [1000, ...RUN_EFFORTS],
    trail_run: [1000, ...RUN_EFFORTS],
    ride: [10_000, 40_000, 100_000],
  },
  // One short effort per units: the mile here, the kilometre in metric. Rides in round miles.
  imperial: {
    run: [MILE_M, ...RUN_EFFORTS],
    trail_run: [MILE_M, ...RUN_EFFORTS],
    ride: [10 * MILE_M, 25 * MILE_M, 100 * MILE_M],
  },
};

/** The fewest moving seconds over `metres` anywhere along the track, or null when it is shorter. */
const fastest = (activity: ActivityRecord, metres: number): number | null => {
  const samples = samplesOf(activity);
  if (!samples || samples.some((sample) => sample.t === null)) return null;
  let best: number | null = null;
  let i = 0;
  for (let j = 1; j < samples.length; j++) {
    const end = samples[j] as (typeof samples)[number];
    const from = end.d - metres;
    if (from < 0) continue;
    while ((samples[i + 1]?.d ?? Infinity) <= from) i++;
    const a = samples[i] as (typeof samples)[number];
    const b = samples[i + 1] ?? a;
    const share = b.d > a.d ? (from - a.d) / (b.d - a.d) : 0;
    const start = (a.t ?? 0) + ((b.t ?? 0) - (a.t ?? 0)) * share;
    const seconds = (end.t ?? 0) - start;
    if (seconds > 0 && (best === null || seconds < best)) best = seconds;
  }
  return best;
};

/** The highest point of the published track, when it has heights. */
const highest = (activity: ActivityRecord): number | null => {
  const samples = samplesOf(activity);
  if (!samples || samples.some((sample) => sample.z === null)) return null;
  return Math.max(...samples.map((sample) => sample.z ?? 0));
};

const cache = new WeakMap<
  readonly ActivityRecord[],
  { loaded: number; units: Units; records: PersonalRecord[] }
>();

/**
 * The bests among these activities, per activity type: longest, most climb, longest moving time,
 * and from the tracks (those loaded, with heights and times) the highest point and the fastest
 * stretches. `loaded` is the store's counter, so the answer is worked out again as tracks arrive.
 */
export const recordsOf = (
  activities: readonly ActivityRecord[],
  loaded: number,
): PersonalRecord[] => {
  const known = cache.get(activities);
  const units = formatUnits();
  if (known && known.loaded === loaded && known.units === units) return known.records;
  const records = new Map<string, PersonalRecord>();
  const offer = (
    kind: RecordKind,
    activity: ActivityRecord,
    value: number | null | undefined,
    metres?: number,
  ) => {
    if (!value || value <= 0) return;
    const id = `${activity.type}:${kind}${metres ? `:${metres}` : ''}`;
    const held = records.get(id);
    // A lower time wins an effort; a higher figure wins the rest.
    if (!held || (kind === 'effort' ? value < held.value : value > held.value))
      records.set(id, { id, kind, type: activity.type, metres, value, activity });
  };
  for (const activity of activities) {
    offer('distance', activity, activity.distanceM);
    offer('climb', activity, activity.gainM);
    offer('time', activity, activity.movingS);
    offer('highest', activity, highest(activity));
    for (const metres of EFFORTS[units][activity.type] ?? [])
      if ((activity.distanceM ?? 0) >= metres)
        offer('effort', activity, fastest(activity, metres), metres);
  }
  const list = [...records.values()];
  cache.set(activities, { loaded, units, records: list });
  return list;
};

// --- Streaks and totals ---------------------------------------------------------------------------

const DAY = 86_400_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY);

export interface Streaks {
  /** The most days in a row with an activity, and the day it ended. */
  days: { count: number; end: string } | null;
  /** The most weeks in a row (Monday to Sunday) with an activity. */
  weeks: { count: number; end: string } | null;
  /** The day and the week with the most distance. */
  bigDay: { day: string; distanceM: number } | null;
  bigWeek: { monday: string; distanceM: number } | null;
}

export const streaksOf = (activities: readonly ActivityRecord[]): Streaks => {
  const byDay = new Map<string, number>();
  for (const activity of activities)
    byDay.set(activity.date, (byDay.get(activity.date) ?? 0) + (activity.distanceM ?? 0));
  const days = [...byDay.keys()].sort();
  // 1970-01-05 was a Monday: day 4.
  const weekOf = (day: string) => Math.floor((dayNumber(day) - 4) / 7);
  const mondayOf = (week: number) => new Date((week * 7 + 4) * DAY).toISOString().slice(0, 10);
  const longest = (numbers: number[], label: (n: number) => string) => {
    let best: { count: number; end: string } | null = null;
    let run = 0;
    numbers.forEach((n, i) => {
      run = i > 0 && n === (numbers[i - 1] ?? 0) + 1 ? run + 1 : 1;
      if (!best || run > best.count) best = { count: run, end: label(n) };
    });
    return best;
  };
  const byWeek = new Map<number, number>();
  for (const [day, metres] of byDay)
    byWeek.set(weekOf(day), (byWeek.get(weekOf(day)) ?? 0) + metres);
  const top = <K>(map: Map<K, number>) =>
    [...map].reduce<[K, number] | null>(
      (best, entry) => (!best || entry[1] > best[1] ? entry : best),
      null,
    );
  const bigDay = top(byDay);
  const bigWeek = top(byWeek);
  return {
    days: longest(days.map(dayNumber), (n) => new Date(n * DAY).toISOString().slice(0, 10)),
    weeks: longest(
      [...byWeek.keys()].sort((a, b) => a - b),
      (week) => mondayOf(week),
    ),
    bigDay: bigDay && bigDay[1] > 0 ? { day: bigDay[0], distanceM: bigDay[1] } : null,
    bigWeek:
      bigWeek && bigWeek[1] > 0 ? { monday: mondayOf(bigWeek[0]), distanceM: bigWeek[1] } : null,
  };
};

// --- Milestones -----------------------------------------------------------------------------------

/** The next round number after `done`: 5 and 10, then tens, quarters of a hundred, hundreds. */
export const nextRound = (done: number, total?: number): number | null => {
  const steps = [1, 5, 10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  let next = steps.find((step) => step > done);
  if (next === undefined) {
    const unit = done < 1000 ? 50 : done < 10_000 ? 500 : 1000;
    next = (Math.floor(done / unit) + 1) * unit;
  }
  if (total !== undefined) {
    if (done >= total) return null;
    next = Math.min(next, total);
  }
  return next;
};

export interface ListPace {
  list: List;
  done: number;
  total: number;
  next: number | null;
  /** Items first done in the 365 days up to the latest activity. */
  lastYear: number;
  /** The year the list is finished at that rate; null when nothing was done in the last year. */
  finish: number | null;
}

/** Each place list with something done: where it stands, its next round number and its pace. */
export const listPaces = (data: Data): ListPace[] => {
  const latest = data.meta.latestActivity ?? new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(latest) - 365 * DAY).toISOString().slice(0, 10);
  return data.lists
    .filter((list) => list.kind === 'point')
    .map((list) => {
      const done = list.items.filter((item) => item.status === 'done');
      const lastYear = done.filter((item) => (item.first ?? '') > since).length;
      const left = list.items.length - done.length;
      return {
        list,
        done: done.length,
        total: list.items.length,
        next: nextRound(done.length, list.items.length),
        lastYear,
        finish:
          left > 0 && lastYear > 0 ? Number(latest.slice(0, 4)) + Math.ceil(left / lastYear) : null,
      };
    })
    .filter((pace) => pace.done > 0)
    .sort((a, b) => b.done / b.total - a.done / a.total);
};

// --- Next up: trips to what is not done yet -------------------------------------------------------

export interface Trip {
  items: ListItem[];
  /** From the start point to the nearest of them, as the crow flies. */
  distanceM: number;
  /** The widest gap between two of them. */
  spanM: number;
}

/**
 * The places of a list not done yet, grouped into trips: places within `joinM` of another in the
 * group go together. Nearest trips first. `limit` keeps a very long list (municipalities) workable:
 * only that many of the nearest places are grouped.
 */
export const tripsOf = (
  list: List,
  start: readonly [number, number],
  joinM = 25_000,
  limit = 400,
): Trip[] => {
  const open = list.items
    .filter((item) => item.at && item.status !== 'done')
    .map((item) => ({
      item,
      at: item.at as [number, number],
      away: metresBetween(start, item.at ?? []),
    }))
    .sort((a, b) => a.away - b.away)
    .slice(0, limit);
  const group = open.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (group[root] !== root) root = group[root] as number;
    group[i] = root;
    return root;
  };
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++)
      if (
        metresBetween(
          (open[i] as (typeof open)[number]).at,
          (open[j] as (typeof open)[number]).at,
        ) <= joinM
      )
        group[find(j)] = find(i);
  const trips = new Map<number, typeof open>();
  open.forEach((entry, i) => trips.set(find(i), [...(trips.get(find(i)) ?? []), entry]));
  return [...trips.values()]
    .map((entries) => {
      let spanM = 0;
      for (const a of entries)
        for (const b of entries) spanM = Math.max(spanM, metresBetween(a.at, b.at));
      return {
        items: entries.map((entry) => entry.item),
        distanceM: Math.min(...entries.map((entry) => entry.away)),
        spanM,
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);
};

/**
 * The months a peak is usually free of snow: an estimate from its height and how far north it is
 * (about 150 m lower for each degree north of 35°N), not a forecast. Null for a place that is no
 * peak, or is low enough for any month.
 */
export const snowFreeMonths = (list: List, item: ListItem): [number, number] | null => {
  if (list.theme !== 'peaks' || item.elevationM === undefined || !item.at) return null;
  const height = item.elevationM + (item.at[1] - 35) * 150;
  if (height < 1000) return null;
  if (height < 1800) return [4, 11];
  if (height < 2500) return [6, 10];
  return [7, 9];
};

export const inSeason = (months: [number, number] | null, month: number): boolean =>
  !months || (month >= months[0] && month <= months[1]);

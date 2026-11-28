/**
 * How long the rest of a route would take at your own pace. The reference lines of routes carry
 * no heights, so this is not worked out from climb: it takes the pace you usually keep on
 * outings of the fitting kind, which already has the hills you usually meet in it. A rough
 * figure for planning, and said as one.
 */
import type { ActivityRecord } from './data.ts';

/** Outings shorter than this say little about the pace of a long one. */
const SHORTEST_M = { ride: 10_000, other: 3000 };
/** With fewer outings than this there is no "usual". */
const FEWEST = 3;

export interface UsualPace {
  secondsPerMetre: number;
  /** How many outings it is the median of. */
  count: number;
  kind: 'ride' | 'walk';
}

/** Whether a list is one that is ridden: its theme says so. */
export const paceKind = (theme: string): UsualPace['kind'] =>
  theme === 'cycle-routes' ? 'ride' : 'walk';

/**
 * The median moving pace of the published outings of a kind: rides for a cycle route, walks and
 * hikes for everything else (a run would make a trail look quicker than it is on foot with a
 * pack). Undefined with too few to go by.
 */
export const usualPace = (
  activities: readonly Pick<ActivityRecord, 'type' | 'distanceM' | 'movingS'>[],
  kind: UsualPace['kind'],
): UsualPace | undefined => {
  const fits = (type: string) =>
    kind === 'ride' ? type === 'ride' : type === 'hike' || type === 'walk';
  const shortest = kind === 'ride' ? SHORTEST_M.ride : SHORTEST_M.other;
  const paces = activities
    .filter(
      (activity) =>
        fits(activity.type) && (activity.distanceM ?? 0) >= shortest && (activity.movingS ?? 0) > 0,
    )
    .map((activity) => (activity.movingS ?? 0) / (activity.distanceM ?? 1))
    .sort((a, b) => a - b);
  if (paces.length < FEWEST) return undefined;
  const middle = Math.floor(paces.length / 2);
  const median =
    paces.length % 2
      ? (paces[middle] as number)
      : ((paces[middle - 1] as number) + (paces[middle] as number)) / 2;
  return { secondsPerMetre: median, count: paces.length, kind };
};

/**
 * Seconds for a distance at a pace, rounded as roughly as the estimate is: to a quarter of an
 * hour under ten hours, to the hour above.
 */
export const estimateSeconds = (metres: number, pace: UsualPace): number => {
  const seconds = metres * pace.secondsPerMetre;
  const step = seconds < 36_000 ? 900 : 3600;
  return Math.max(step, Math.round(seconds / step) * step);
};

/** The five activity types the project understands. Strava sport types map onto these. */
export const ACTIVITY_TYPES = ['hike', 'walk', 'run', 'trail_run', 'ride'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  hike: 'Hike',
  walk: 'Walk',
  run: 'Run',
  trail_run: 'Trail Run',
  ride: 'Ride',
};

/** Tags an activity can carry, from Strava flags or the manual sheet. */
export const EVENT_TAGS = ['race', 'training', 'commute', 'group', 'solo', 'overnight'] as const;
export type EventTag = (typeof EVENT_TAGS)[number];

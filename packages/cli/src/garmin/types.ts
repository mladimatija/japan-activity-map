/** Garmin Connect's activity types, onto the five this project keeps. */
import type { ActivityType } from '@jam/core';

/** By Garmin's type key. Anything else is skipped unless `activities.garmin.typeMap` names it. */
const BUILT_IN: Record<string, ActivityType> = {
  running: 'run',
  street_running: 'run',
  track_running: 'run',
  treadmill_running: 'run',
  indoor_running: 'run',
  virtual_run: 'run',
  obstacle_run: 'run',
  trail_running: 'trail_run',
  ultra_run: 'trail_run',
  hiking: 'hike',
  mountaineering: 'hike',
  rucking: 'hike',
  walking: 'walk',
  casual_walking: 'walk',
  speed_walking: 'walk',
  cycling: 'ride',
  road_biking: 'ride',
  mountain_biking: 'ride',
  gravel_cycling: 'ride',
  cyclocross: 'ride',
  downhill_biking: 'ride',
  track_cycling: 'ride',
  recumbent_cycling: 'ride',
  bmx: 'ride',
  e_bike_fitness: 'ride',
  e_bike_mountain: 'ride',
  indoor_cycling: 'ride',
  virtual_ride: 'ride',
};

/** The type a Garmin type key means, or undefined when the activity is not one this project keeps. */
export const garminActivityType = (
  typeKey: string | undefined,
  extra: Readonly<Record<string, ActivityType>> = {},
): ActivityType | undefined => (typeKey ? (extra[typeKey] ?? BUILT_IN[typeKey]) : undefined);

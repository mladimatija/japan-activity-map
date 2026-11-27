/** Answers that set several config values at once. */
import type { Config } from '@jam/core';

type Publish = Config['site']['publish'];

export interface PublishPreset {
  id: string;
  label: string;
  help: string;
  /** Only the switches the preset decides; the rest keep their value. */
  values: Partial<Publish>;
}

/** The switches the presets differ in, with the recommended (schema default) values. */
const RECOMMENDED: Partial<Publish> = {
  stravaLinks: false,
  activityNames: true,
  timeOfDay: false,
  paceAlongTracks: true,
};

export const PUBLISH_PRESETS: PublishPreset[] = [
  {
    id: 'recommended',
    label: 'Recommended',
    help: 'Names and pace along tracks; no Strava links, no time of day.',
    values: RECOMMENDED,
  },
  {
    id: 'private',
    label: 'More private',
    help: 'Also hides activity names and pace along tracks.',
    values: { ...RECOMMENDED, activityNames: false, paceAlongTracks: false },
  },
  {
    id: 'open',
    label: 'More open',
    help: 'Also publishes Strava links and the time of day.',
    values: { ...RECOMMENDED, stravaLinks: true, timeOfDay: true },
  },
  {
    id: 'keep',
    label: 'Keep what is set',
    help: 'Leave the publish switches as they are.',
    values: {},
  },
];

/** The preset the current switches amount to, if any. */
export const presetOf = (publish: Publish): string | undefined =>
  PUBLISH_PRESETS.find(
    (preset) =>
      preset.id !== 'keep' &&
      Object.entries(preset.values).every(
        ([key, value]) => publish[key as keyof Publish] === value,
      ),
  )?.id;

/** Mapzen's Terrain Tiles on AWS Open Data: free, no key (the example in site.example.jsonc). */
export const TERRAIN_MAPZEN = {
  tiles: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
  attribution:
    '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles</a>',
};

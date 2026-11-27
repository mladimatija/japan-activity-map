/** Setup steps for privacy zones, list downloads, matching, route grouping and routes.jsonc. */
import { MATCH, parseLocation, REGROUP, setting, type Step, str, ZONES } from './types.ts';

const checkZones = (answer: unknown): string | undefined => {
  if (!Array.isArray(answer)) return 'Zones are a list.';
  for (const zone of answer as Record<string, unknown>[]) {
    if (zone === null || typeof zone !== 'object') return 'Each zone is an object.';
    if ('address' in zone)
      return 'Addresses are not looked up. Give each zone a lat and lon instead.';
    const where = parseLocation(zone);
    if (where === null || typeof where === 'string')
      return `Zone "${str(zone.label)}": ${where ?? 'needs lat and lon.'}`;
  }
  return undefined;
};

const noZonesYet: Step['when'] = (ctx) => ctx.config.privacyZones.zones.length === 0;

const threshold = (
  group: 'privacy' | 'matching' | 'routeGrouping',
  path: string[],
  title: string,
  help?: string,
  kind: Step['kind'] = 'number',
): Step =>
  setting(`${group}.${path.join('.')}`, group, kind, title, 'thresholds', [group, ...path], {
    ...(help ? { help } : {}),
    affects: group === 'privacy' ? ZONES : group === 'matching' ? MATCH : REGROUP,
  });

export const TUNING_STEPS: Step[] = [
  {
    id: 'privacy.home',
    group: 'privacy',
    tier: 'quick',
    kind: 'location',
    title: 'Home location to hide (latitude, longitude)',
    help: 'Every published track loses the part near this point. Find it by right-clicking your home on a map. Empty skips it: tracks then show where they start.',
    setting: { file: 'privacyZones', path: ['zones'], sensitive: 'location' },
    read: () => '',
    map: () => [],
    check: (answer) => {
      const where = parseLocation(answer);
      return typeof where === 'string' ? where : undefined;
    },
    when: noZonesYet,
    affects: ZONES,
  },
  {
    id: 'privacy.radius',
    group: 'privacy',
    tier: 'quick',
    kind: 'number',
    title: 'Hide radius (m)',
    help: 'The centre is moved at random, so the real place is hidden somewhere inside.',
    default: 500,
    read: () => 500,
    map: (answer, ctx) => {
      const where = parseLocation(ctx.answers['privacy.home']);
      if (where === null || typeof where === 'string') return [];
      return [
        {
          file: 'privacyZones',
          path: ['zones'],
          value: [{ label: 'home', lat: where.lat, lon: where.lon, radiusM: answer }],
        },
      ];
    },
    when: (ctx) => {
      const where = parseLocation(ctx.answers['privacy.home']);
      return noZonesYet(ctx) && where !== null && typeof where !== 'string';
    },
    affects: ZONES,
  },
  {
    id: 'privacy.zones',
    group: 'privacy',
    tier: 'full',
    kind: 'zones',
    title: 'Privacy zones',
    help: 'Places whose surroundings are cut from every published track: a label, a position and a radius each.',
    setting: { file: 'privacyZones', path: ['zones'], sensitive: 'location' },
    check: checkZones,
    affects: ZONES,
  },
  threshold(
    'privacy',
    ['centreShiftShare'],
    'How far a zone centre may move (share of its radius)',
    'Higher hides more and cuts more track.',
  ),
  threshold('privacy', ['radiusJitterM'], 'How much each activity varies the radius (m)'),
  threshold('privacy', ['minFragmentM'], 'Shortest track fragment kept (m)'),

  // What to download now, not a setting. The options come from the fetch sources (engine.ts).
  {
    id: 'lists.fetch',
    group: 'lists',
    tier: 'full',
    kind: 'multi',
    title: 'Reference sources to download now',
    help: 'The committed lists work as they are. gokaido adds the five historic highways (not committed: non-commercial licence). osm takes several minutes; outlines is about 500 MB.',
    options: [],
    read: ({ facts }) => (facts.listsMissing.length > 0 ? ['gokaido', 'wikipedia'] : []),
    map: () => [],
    when: (ctx) => ctx.mode === 'full',
  },

  threshold('matching', ['pointRadiusM'], 'A place counts as visited within (m)'),
  threshold('matching', ['uncertainMarginM'], 'Flag matches this close to the radius (m)'),
  threshold(
    'matching',
    ['perList'],
    'Radius per list',
    'An object keyed by list id, such as { "nihon-100-meijo": { "pointRadiusM": 300 } }.',
    'json',
  ),
  threshold('matching', ['japanMarginM'], 'Margin round the coast that counts as Japan (m)'),
  threshold(
    'matching',
    ['routes', 'minStretchM'],
    'Shortest covered stretch of a route that counts (m)',
  ),
  threshold('matching', ['routes', 'bridgeGapM'], 'Longest gap bridged inside a stretch (m)'),
  threshold('matching', ['routes', 'completeShare'], 'Share of a route item that counts as done'),

  threshold('routeGrouping', ['startToleranceM'], 'Start tolerance (m)'),
  threshold('routeGrouping', ['endToleranceM'], 'End tolerance (m)'),
  threshold('routeGrouping', ['distanceTolerancePct'], 'Distance tolerance (%)'),
  threshold(
    'routeGrouping',
    ['ignoreLaps'],
    'Treat laps of a section as the same route',
    'Compares the street two tracks cover, not their total distance.',
    'confirm',
  ),
  threshold('routeGrouping', ['gridZoom'], 'Grid zoom', '19 is roughly 60 m across in Japan.'),
  threshold('routeGrouping', ['minOverlapShare'], 'Share of grid cells two tracks must share'),

  setting('routes.names', 'routes', 'json', 'Route names', 'routes', ['names'], {
    help: 'An object keyed by any activity in the route: { "12345678901": "Riverside loop" }. `pnpm jam routes review` lists candidates in data/routes-review.md.',
    affects: ['build'],
  }),
  setting('routes.merge', 'routes', 'json', 'Routes to merge', 'routes', ['merge'], {
    help: 'A list of lists of activities whose routes become one: [[123, 456]].',
    affects: ['build'],
  }),
  setting('routes.split', 'routes', 'json', 'Activities to split off', 'routes', ['split'], {
    help: 'A list of lists of activities that form a route of their own: [[789]].',
    affects: ['build'],
  }),
];

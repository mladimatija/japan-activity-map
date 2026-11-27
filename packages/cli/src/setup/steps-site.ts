/** Setup steps for site.jsonc: title, map, saved views, what is published, output. */
import type { Config } from '@jam/core';

import type { Patch } from './jsonc.ts';
import { PUBLISH_PRESETS, presetOf, TERRAIN_MAPZEN } from './presets.ts';
import { BUILD, type Ctx, setting, type Step, str } from './types.ts';

const publishSwitch = (key: keyof Config['site']['publish'], title: string, help: string): Step =>
  setting(`publish.${key}`, 'publish', 'confirm', title, 'site', ['publish', key], {
    help,
    affects: BUILD,
  });

const terrainIs = (ctx: Ctx, kind: string) => ctx.answers['map.terrain'] === kind;

/** A part of the terrain source: asked on its own, written by the terrain choice, which needs them together. */
const terrainPart = (
  key: 'sourceUrl' | 'tiles' | 'encoding' | 'tileSize' | 'maxzoom' | 'attribution',
  source: 'tilejson' | 'tiles',
  step: Pick<Step, 'kind' | 'title'> & Partial<Step>,
): Step => ({
  id: `map.terrain.${key}`,
  group: 'map',
  tier: 'full',
  read: ({ config }) => config.site.map.terrain[key] ?? '',
  map: () => [],
  when: (ctx) => terrainIs(ctx, source),
  ...step,
});

const terrainPatches = (answer: unknown, ctx: Ctx): Patch[] => {
  const at = (key: string, value: unknown): Patch => ({
    file: 'site',
    path: ['map', 'terrain', key],
    value,
  });
  const given = (key: string) => {
    const value = ctx.answers[`map.terrain.${key}`];
    return value === '' || value === null ? undefined : value;
  };
  if (answer === 'off') return [at('enabled', false)];
  if (answer === 'mapzen')
    return [
      at('sourceUrl', undefined),
      ...Object.entries(TERRAIN_MAPZEN).map(([key, value]) => at(key, value)),
      at('enabled', true),
    ];
  if (answer === 'tilejson')
    return [
      at('tiles', undefined),
      at('attribution', undefined),
      at('sourceUrl', given('sourceUrl')),
      at('enabled', true),
    ];
  return [
    at('sourceUrl', undefined),
    at('tiles', given('tiles')),
    at('encoding', given('encoding')),
    at('tileSize', given('tileSize')),
    at('maxzoom', given('maxzoom')),
    at('attribution', given('attribution')),
    at('enabled', true),
  ];
};

export const SITE_STEPS: Step[] = [
  setting('site.title', 'site', 'text', 'Site title', 'site', ['site', 'title'], {
    tier: 'both',
    help: 'Shown in the top bar and the browser tab.',
    affects: BUILD,
  }),
  setting('site.description', 'site', 'text', 'Site description', 'site', ['site', 'description'], {
    help: 'One line for search engines and link previews. May be empty.',
    affects: BUILD,
  }),

  setting('map.styleUrl', 'map', 'text', 'Map style (light)', 'site', ['map', 'styleUrl'], {
    help: 'Any MapLibre style address. OpenFreeMap Positron needs no key.',
    affects: BUILD,
  }),
  setting(
    'map.darkStyleUrl',
    'map',
    'text',
    'Map style for dark mode',
    'site',
    ['map', 'darkStyleUrl'],
    {
      help: 'A style address, or "none" to give everyone the light style.',
      read: (ctx) => ctx.config.site.map.darkStyleUrl ?? 'none',
      map: (answer) => [
        { file: 'site', path: ['map', 'darkStyleUrl'], value: answer === 'none' ? null : answer },
      ],
      affects: BUILD,
    },
  ),
  // The parts come first, so the choice that writes them has their answers.
  {
    id: 'map.terrain',
    group: 'map',
    tier: 'full',
    kind: 'choice',
    title: 'Terrain and hillshade',
    help: 'Elevation tiles for the terrain switch on the map.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'mapzen', label: 'Mapzen Terrain Tiles', help: 'Free, no key, on AWS Open Data.' },
      { value: 'tilejson', label: 'A TileJSON address', help: 'Carries its own credit.' },
      { value: 'tiles', label: 'A tile address', help: 'You give the encoding and the credit.' },
    ],
    read: ({ config }) => {
      const terrain = config.site.map.terrain;
      if (!terrain.enabled) return 'off';
      if (terrain.sourceUrl) return 'tilejson';
      return terrain.tiles === TERRAIN_MAPZEN.tiles ? 'mapzen' : 'tiles';
    },
    // Written by the last part below, once every part has its answer.
    map: (answer, ctx) =>
      answer === 'off' || answer === 'mapzen' ? terrainPatches(answer, ctx) : [],
    affects: BUILD,
  },
  terrainPart('sourceUrl', 'tilejson', {
    kind: 'text',
    title: 'TileJSON address',
    map: (_answer, ctx) =>
      terrainPatches('tilejson', {
        ...ctx,
        answers: { ...ctx.answers, 'map.terrain.sourceUrl': _answer },
      }),
  }),
  terrainPart('tiles', 'tiles', {
    kind: 'text',
    title: 'Tile address',
    help: 'An https address with {z}, {x} and {y}.',
  }),
  terrainPart('encoding', 'tiles', {
    kind: 'choice',
    title: 'How heights are packed',
    options: [
      { value: 'terrarium', label: 'terrarium' },
      { value: 'mapbox', label: 'mapbox' },
    ],
  }),
  terrainPart('tileSize', 'tiles', {
    kind: 'choice',
    title: 'Tile size',
    options: [
      { value: 256, label: '256' },
      { value: 512, label: '512' },
    ],
  }),
  terrainPart('maxzoom', 'tiles', {
    kind: 'number',
    optional: true,
    title: 'Deepest zoom the tiles have',
  }),
  terrainPart('attribution', 'tiles', {
    kind: 'text',
    title: 'Credit the tiles ask for',
    help: 'Shown on the map; HTML allowed.',
    map: (answer, ctx) =>
      terrainPatches('tiles', {
        ...ctx,
        answers: { ...ctx.answers, 'map.terrain.attribution': answer },
      }),
  }),

  {
    id: 'views',
    group: 'views',
    tier: 'full',
    kind: 'json',
    title: 'Saved views',
    help: 'A list of { "name", "query" }; the query is the part of a site address after #. "default" keeps the built-in ones, [] offers none.',
    setting: { file: 'site', path: ['views'] },
    read: () => 'default',
    map: (answer) =>
      answer === 'default' ? [] : [{ file: 'site', path: ['views'], value: answer }],
    affects: BUILD,
  },

  {
    id: 'publish.preset',
    group: 'publish',
    tier: 'quick',
    kind: 'choice',
    title: 'What to publish',
    help: 'Each choice sets several switches; full setup has every switch on its own.',
    options: PUBLISH_PRESETS.map(({ id, label, help }) => ({ value: id, label, help })),
    read: ({ config }) => presetOf(config.site.publish) ?? 'keep',
    map: (answer) => {
      const preset = PUBLISH_PRESETS.find((candidate) => candidate.id === answer);
      return Object.entries(preset?.values ?? {}).map(([key, value]) => ({
        file: 'site',
        path: ['publish', key],
        value,
      }));
    },
    affects: BUILD,
  },
  publishSwitch(
    'stravaLinks',
    'Link each activity to Strava',
    'A link leads back to your profile. Off: neither the link nor the Strava id is published.',
  ),
  publishSwitch(
    'activityNames',
    'Publish activity names',
    'Off: each activity is shown as its type, such as "Hike".',
  ),
  publishSwitch(
    'timeOfDay',
    'Publish the time of day',
    'Off: dates only. Start times repeated over months show a routine.',
  ),
  publishSwitch(
    'paceAlongTracks',
    'Publish pace along tracks',
    'Seconds at each point, restarting after each privacy zone; gives splits and records. No time of day.',
  ),
  publishSwitch(
    'activitiesWithoutGps',
    'Publish activities without GPS',
    'Treadmill and gym sessions count in totals; they never appear on the map.',
  ),
  publishSwitch(
    'includeOnlyMeActivities',
    'Publish "Only You" activities',
    'Only applies when they are imported (see Strava).',
  ),
  publishSwitch(
    'commutesInHeatmap',
    'Include commutes in the heatmap',
    'Commutes trace the line between home and work.',
  ),

  setting(
    'output.simplifyM',
    'output',
    'number',
    'Track simplification (m)',
    'site',
    ['output', 'simplifyM'],
    { help: 'No published point moves more than this.', affects: BUILD },
  ),
  setting(
    'output.decimals',
    'output',
    'number',
    'Decimals in coordinates',
    'site',
    ['output', 'decimals'],
    { help: '5 is about 1 m.', affects: BUILD },
  ),
  setting(
    'output.startBudgetKB',
    'output',
    'number',
    'Start-up size budget (KB, compressed)',
    'site',
    ['output', 'startBudgetKB'],
    { help: 'The build fails when the files loaded at start are larger.', affects: BUILD },
  ),
];

const deployHost = (ctx: Ctx): string =>
  str(ctx.answers['deploy.host'] ?? ctx.config.site.deploy.host);

export const DEPLOY_STEPS: Step[] = [
  setting(
    'deploy.host',
    'deploy',
    'choice',
    'Where to publish the site',
    'site',
    ['deploy', 'host'],
    {
      help: 'All three are free for a site like this. Cloudflare Pages and Netlify take an upload and need an API token in config/secrets.jsonc. GitHub Pages is a branch of a repository, pushed with the git sign-in this computer already has; on a free account that repository is public.',
      options: [
        { value: 'cloudflare', label: 'Cloudflare Pages' },
        { value: 'netlify', label: 'Netlify' },
        { value: 'github', label: 'GitHub Pages' },
      ],
    },
  ),
  setting(
    'deploy.projectName',
    'deploy',
    'text',
    'Project name',
    'site',
    ['deploy', 'projectName'],
    {
      optional: true,
      help: 'The project `pnpm jam deploy` uploads to; the site is then at <name>.pages.dev (Cloudflare) or <name>.netlify.app (Netlify). Lower-case letters, digits and hyphens. Leave it empty to keep deploying off.',
      when: (ctx) => deployHost(ctx) !== 'github',
      check: (answer) =>
        answer === '' || /^[a-z0-9]([a-z0-9-]{0,56}[a-z0-9])?$/.test(str(answer))
          ? undefined
          : 'Lower-case letters, digits and hyphens only, at most 58 characters.',
    },
  ),
  {
    id: 'deploy.apiToken',
    group: 'deploy',
    tier: 'full',
    kind: 'secret',
    optional: true,
    title: 'Cloudflare API token',
    help: 'Typed without being shown; stored in config/secrets.jsonc, readable only by you. Make one in the Cloudflare dashboard under My Profile > API Tokens, with the permission Account > Cloudflare Pages > Edit. Leave it empty to keep what is stored or to add it later; a single - removes it.',
    setting: { file: 'secrets', path: ['deploy', 'apiToken'], sensitive: 'secret' },
    when: (ctx) => deployHost(ctx) === 'cloudflare',
  },
  {
    id: 'deploy.accountId',
    group: 'deploy',
    tier: 'full',
    kind: 'text',
    optional: true,
    title: 'Cloudflare account id',
    help: '32 characters (0-9, a-f), shown in the dashboard under Workers & Pages. Stored in config/secrets.jsonc. Leave it empty to keep what is stored or to add it later; a single - removes it.',
    setting: { file: 'secrets', path: ['deploy', 'accountId'], sensitive: 'secret' },
    when: (ctx) => deployHost(ctx) === 'cloudflare',
    check: (answer) =>
      answer === '' || /^[0-9a-f]{32}$/.test(str(answer))
        ? undefined
        : 'An account id is 32 characters, 0-9 and a-f.',
  },
  {
    id: 'deploy.netlifyToken',
    group: 'deploy',
    tier: 'full',
    kind: 'secret',
    optional: true,
    title: 'Netlify access token',
    help: 'Typed without being shown; stored in config/secrets.jsonc, readable only by you. Make one in Netlify under User settings > Applications > Personal access tokens. Leave it empty to keep what is stored or to add it later; a single - removes it.',
    setting: { file: 'secrets', path: ['deploy', 'netlifyToken'], sensitive: 'secret' },
    when: (ctx) => deployHost(ctx) === 'netlify',
  },
  setting(
    'deploy.repository',
    'deploy',
    'text',
    'GitHub repository',
    'site',
    ['deploy', 'repository'],
    {
      optional: true,
      help: "As owner/name. The site is pushed to its gh-pages branch, which holds the site and nothing else, and is served at <owner>.github.io/<name>. It can be this project's own repository. Leave it empty to keep deploying off.",
      when: (ctx) => deployHost(ctx) === 'github',
      check: (answer) =>
        answer === '' || /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(str(answer))
          ? undefined
          : 'Give it as owner/name, for example mladimatija/japan-activity-map.',
    },
  ),
  setting(
    'site.baseUrl',
    'deploy',
    'text',
    'Public address of the site',
    'site',
    ['site', 'baseUrl'],
    {
      optional: true,
      help: 'Used for links and the share image. Leave it empty until the site has an address; on Cloudflare Pages, an address of your own keeps the pages.dev copies out of search engines.',
      affects: BUILD,
    },
  ),
];

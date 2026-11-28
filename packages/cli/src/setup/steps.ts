/**
 * Every question the setup wizard can ask, as data: no input or output here. The terminal wizard
 * and the web wizard both read this table, so they ask the same things and write the same files.
 */
import { FETCH_SOURCES } from '../lists/fetch.ts';
import { SOURCES } from './sources.ts';
import { DEPLOY_STEPS, SITE_STEPS } from './steps-site.ts';
import { TUNING_STEPS } from './steps-tuning.ts';
import type { Mode, Step } from './types.ts';

/** The groups, in the order full setup and the change menu go through them. */
export const GROUPS: { id: string; title: string }[] = [
  { id: 'site', title: 'Site' },
  { id: 'map', title: 'Map' },
  { id: 'views', title: 'Saved views' },
  { id: 'publish', title: 'What is published' },
  { id: 'output', title: 'Output' },
  { id: 'sources', title: 'Where activities come from' },
  ...SOURCES.map((source) => ({ id: `source:${source.id}`, title: source.label })),
  { id: 'privacy', title: 'Privacy' },
  { id: 'lists', title: 'Reference lists' },
  { id: 'matching', title: 'Matching' },
  { id: 'routeGrouping', title: 'Route grouping' },
  { id: 'routes', title: 'Routes' },
  { id: 'deploy', title: 'Deploy' },
];

/** Quick setup asks its few questions in this order instead. */
const QUICK_GROUPS = [
  'site',
  'sources',
  'source:strava',
  'source:gpx',
  'source:sheet',
  'privacy',
  'publish',
];

const FETCH_HELP: Partial<Record<(typeof FETCH_SOURCES)[number], string>> = {
  gokaido: 'The five historic highways. Not committed (non-commercial licence).',
  wikipedia: 'Temple, castle, flower-mountain and waterfall lists.',
  osm: 'Cycle routes and long trails. Several minutes.',
  outlines: 'Prefecture outlines in full detail. About 500 MB.',
  municipalities: 'Every municipality with its outline.',
};

const SOURCES_STEP: Step = {
  id: 'sources',
  group: 'sources',
  tier: 'both',
  kind: 'multi',
  title: 'Where do your activities come from?',
  help: 'One or more. Each source brings its own questions.',
  options: SOURCES.filter((source) => !source.standalone).map(({ id, label, help }) => ({
    value: id,
    label,
    help,
  })),
  read: ({ facts, config }) => {
    const fromGpx = config.site.activities.source === 'gpx';
    return [
      ...(!fromGpx && (facts.stravaCredentials || !facts.sheetExists) ? ['strava'] : []),
      ...(fromGpx ? ['gpx'] : []),
      ...(facts.sheetExists ? ['sheet'] : []),
    ];
  },
  // The site is built from Strava or from GPX files. With one of the two chosen, that one; with
  // both, the GPX group's first step asks; with neither (a sheet alone), the setting stays as it is.
  map: (answer) => {
    const chosen = Array.isArray(answer) ? answer.map(String) : [];
    const [strava, gpx] = [chosen.includes('strava'), chosen.includes('gpx')];
    return strava === gpx
      ? []
      : [{ file: 'site', path: ['activities', 'source'], value: gpx ? 'gpx' : 'strava' }];
  },
  check: (answer) =>
    Array.isArray(answer) && answer.length > 0 ? undefined : 'Choose at least one source.',
  // Change mode reaches every source's settings without asking.
  when: (ctx) => ctx.mode !== 'change',
};

export const STEPS: Step[] = [
  ...SITE_STEPS,
  SOURCES_STEP,
  ...SOURCES.flatMap((source) => source.steps),
  ...TUNING_STEPS.map((step) =>
    step.id === 'lists.fetch'
      ? {
          ...step,
          options: FETCH_SOURCES.map((source) => ({
            value: source,
            label: source,
            ...(FETCH_HELP[source] ? { help: FETCH_HELP[source] } : {}),
          })),
        }
      : step,
  ),
  ...DEPLOY_STEPS,
];

export const stepById = (id: string): Step | undefined => STEPS.find((step) => step.id === id);

const inMode = (step: Step, mode: Mode): boolean =>
  step.tier === 'both' || (mode === 'quick' ? step.tier === 'quick' : step.tier === 'full');

/** The steps a mode goes through, in order, optionally only some groups. */
export const stepsFor = (mode: Mode, groups?: readonly string[]): Step[] => {
  const order = mode === 'quick' ? QUICK_GROUPS : GROUPS.map((group) => group.id);
  return STEPS.filter(
    (step) =>
      inMode(step, mode) &&
      order.includes(step.group) &&
      // The source question decides which steps follow, so a group filter never drops it.
      (!groups || groups.includes(step.group) || step.id === 'sources'),
  )
    .map((step, index) => ({ step, index }))
    .sort((a, b) => order.indexOf(a.step.group) - order.indexOf(b.step.group) || a.index - b.index)
    .map(({ step }) => step);
};

/** A group as someone would type it: "strava" for "source:strava". */
export const groupNamed = (name: string): string | undefined =>
  GROUPS.find((group) => group.id === name || group.id === `source:${name}`)?.id;

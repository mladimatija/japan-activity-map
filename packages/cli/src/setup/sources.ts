/**
 * Where activities can come from. Each source is one entry with its own steps and actions, so
 * another source is one more entry and nothing else changes.
 */
import { ACTIVITY_TYPES } from '@jam/core';

import type { ActionId } from './actions.ts';
import { type Ctx, type Facts, has, PULL, setting, type Step, str } from './types.ts';

export interface Source {
  id: string;
  label: string;
  help: string;
  /**
   * A source that replaces the others and runs in its own data folder (the demo). It is offered on
   * the first screen instead of in the list of sources.
   */
  standalone?: boolean;
  /** Why the source cannot be chosen in this version, if it cannot. */
  unavailable?: (facts: Facts) => string | undefined;
  steps: Step[];
  /** The actions the source adds to a run, in order. */
  actions: (ctx: Ctx) => ActionId[];
}

const strava = (ctx: Ctx) => has(ctx, 'strava');
const sheet = (ctx: Ctx) => has(ctx, 'sheet');
const demo = (ctx: Ctx) => has(ctx, 'demo');

const stravaSetting = (...args: Parameters<typeof setting>): Step => {
  const step = setting(...args);
  return { ...step, group: 'source:strava', when: step.when ?? strava };
};

const STRAVA_STEPS: Step[] = (
  [
    {
      id: 'strava.appReady',
      group: 'source:strava',
      tier: 'both',
      kind: 'confirm',
      title: 'Is your Strava API application ready?',
      help: 'Create one at https://www.strava.com/settings/api with Authorization Callback Domain "localhost", then ask Strava to raise it to "up to 10 athletes": without that the API answers 403. Reading activities through the API also needs a Strava subscription. See docs/strava-setup.md.',
      default: true,
      read: () => true,
      map: () => [],
      when: (ctx) => strava(ctx) && !ctx.facts.stravaCredentials && ctx.mode !== 'change',
      check: (answer) =>
        answer === true ? undefined : 'Set the application up first, then run setup again.',
    },
    {
      id: 'strava.clientId',
      group: 'source:strava',
      tier: 'both',
      kind: 'text',
      title: 'Strava Client ID',
      help: 'The number on your application page. Stored in config/secrets.jsonc.',
      setting: { file: 'secrets', path: ['strava', 'clientId'], sensitive: 'secret' },
      // The file needs the id and the secret together: with none stored yet, the secret's step
      // writes both.
      map: (answer, ctx) =>
        ctx.facts.stravaCredentials
          ? [{ file: 'secrets', path: ['strava', 'clientId'], value: answer }]
          : [],
      when: strava,
      check: (answer) => (/^\d+$/.test(str(answer)) ? undefined : 'The Client ID is a number.'),
      affects: ['strava-auth'],
    },
    {
      id: 'strava.clientSecret',
      group: 'source:strava',
      tier: 'both',
      kind: 'secret',
      title: 'Strava Client Secret',
      help: 'Typed without being shown. Stored in config/secrets.jsonc, readable only by you.',
      setting: { file: 'secrets', path: ['strava', 'clientSecret'], sensitive: 'secret' },
      map: (answer, ctx) => [
        ...(ctx.facts.stravaCredentials
          ? []
          : [
              {
                file: 'secrets' as const,
                path: ['strava'],
                value: { clientId: str(ctx.answers['strava.clientId']), clientSecret: answer },
              },
            ]),
        { file: 'secrets', path: ['strava', 'clientSecret'], value: answer },
      ],
      when: strava,
      affects: ['strava-auth'],
    },
    {
      id: 'strava.includePrivate',
      group: 'source:strava',
      tier: 'both',
      kind: 'confirm',
      title: 'Import activities set to "Only You"?',
      help: 'Needs wider Strava access, so the sign-in is asked for again. In quick setup, yes also publishes them.',
      setting: { file: 'strava', path: ['import', 'includePrivate'] },
      map: (answer, ctx) => [
        { file: 'strava', path: ['import', 'includePrivate'], value: answer },
        ...(ctx.mode === 'quick'
          ? [{ file: 'site' as const, path: ['publish', 'includeOnlyMeActivities'], value: answer }]
          : []),
      ],
      when: strava,
      affects: ['strava-auth', 'full-pull', 'build'],
    },
    stravaSetting('strava.from', '', 'text', 'First day to fetch (YYYY-MM-DD)', 'strava', [
      'import',
      'from',
    ]),
    stravaSetting('strava.to', '', 'text', 'Last day to fetch (YYYY-MM-DD)', 'strava', [
      'import',
      'to',
    ]),
    stravaSetting(
      'strava.activityTypes',
      '',
      'multi',
      'Activity types to keep',
      'strava',
      ['import', 'activityTypes'],
      { options: ACTIVITY_TYPES.map((type) => ({ value: type, label: type })), affects: PULL },
    ),
    stravaSetting(
      'strava.sportTypeMap',
      '',
      'json',
      'Strava sport types and what they count as',
      'strava',
      ['sportTypeMap'],
      {
        help: 'An object such as { "Hike": "hike", "EBikeRide": "ride" }. Sport types not listed are skipped.',
        affects: PULL,
      },
    ),
    stravaSetting(
      'strava.staleAfterDays',
      '',
      'number',
      'Days before a pull counts as stale',
      'strava',
      ['staleAfterDays'],
      { help: 'The weekly job skips the pull when the last one is newer.' },
    ),
    stravaSetting(
      'strava.fullTracksPerSync',
      '',
      'number',
      'Full tracks fetched after each pull',
      'strava',
      ['fullTracksPerSync'],
      {
        help: 'Heights and times for height profiles, records and pace. 80 fits one 15-minute Strava window; 0 turns it off.',
      },
    ),
    {
      id: 'strava.fetchAllTracks',
      group: 'source:strava',
      tier: 'full',
      kind: 'confirm',
      title: 'Fetch a large batch of full tracks now?',
      help: 'Up to 400 activities, Japan first. About an hour, because Strava limits requests.',
      default: false,
      read: () => false,
      map: () => [],
      when: (ctx) => strava(ctx) && ctx.mode === 'full',
    },
    stravaSetting('strava.api.baseUrl', '', 'text', 'Strava API address', 'strava', [
      'api',
      'baseUrl',
    ]),
    stravaSetting('strava.api.oauthUrl', '', 'text', 'Strava sign-in address', 'strava', [
      'api',
      'oauthUrl',
    ]),
    stravaSetting(
      'strava.api.redirectPort',
      '',
      'number',
      'Local port for the sign-in redirect',
      'strava',
      ['api', 'redirectPort'],
    ),
    stravaSetting('strava.api.pageSize', '', 'number', 'Activities per page', 'strava', [
      'api',
      'pageSize',
    ]),
  ] satisfies Step[]
).map((step: Step): Step =>
  step.id === 'strava.from' || step.id === 'strava.to'
    ? {
        ...step,
        optional: true,
        help: step.id === 'strava.from' ? 'Empty: from the beginning.' : 'Empty: up to today.',
        affects: PULL,
      }
    : step,
);

const SHEET_STEPS: Step[] = [
  setting('sheet.path', 'source:sheet', 'text', 'Where the sheet is', 'sheet', ['path'], {
    help: 'CSV or .xlsx, relative to the repository. Keep it in data/. Start from templates/activity-sheet.csv; the columns are in templates/README.md.',
    when: sheet,
  }),
  setting(
    'sheet.timeZone',
    'source:sheet',
    'text',
    'Time zone for the sheet',
    'sheet',
    ['timeZone'],
    { help: 'For dates and times without an offset.', when: sheet },
  ),
];

/** Options for `jam demo`, not settings: nothing here is written to a config file. */
const demoOption = (step: Pick<Step, 'id' | 'kind' | 'title'> & Partial<Step>): Step => ({
  group: 'source:demo',
  tier: 'full',
  optional: true,
  read: () => step.default ?? '',
  map: () => [],
  when: demo,
  ...step,
});

const DEMO_STEPS: Step[] = [
  demoOption({
    id: 'demo.years',
    kind: 'number',
    title: 'Years of made-up history',
    help: 'Empty: the demo command decides.',
  }),
  demoOption({
    id: 'demo.seed',
    kind: 'number',
    title: 'Seed',
    help: 'The same seed gives the same history. Empty: the demo command decides.',
  }),
  demoOption({
    id: 'demo.until',
    kind: 'text',
    title: 'Last day of the history (YYYY-MM-DD)',
    help: 'Empty: today.',
    check: (answer) =>
      !answer || /^\d{4}-\d{2}-\d{2}$/.test(str(answer)) ? undefined : 'A date as YYYY-MM-DD.',
  }),
  demoOption({
    id: 'demo.lang',
    kind: 'choice',
    optional: false,
    title: 'Language of the made-up names',
    options: [
      { value: 'en', label: 'English' },
      { value: 'ja', label: 'Japanese' },
    ],
    default: 'en',
  }),
];

export const SOURCES: Source[] = [
  {
    id: 'demo',
    label: 'Demo data',
    help: 'A made-up history, kept in its own folder, to see the site before connecting anything.',
    standalone: true,
    unavailable: (facts) => (facts.demoAvailable ? undefined : 'not available in this version'),
    steps: DEMO_STEPS,
    actions: () => ['demo'],
  },
  {
    id: 'strava',
    label: 'Strava',
    help: 'Your activities through the Strava API. Needs a Strava API application and a subscription.',
    steps: STRAVA_STEPS,
    actions: (ctx) => [
      'strava-auth',
      'sync-strava',
      ...(ctx.answers['strava.fetchAllTracks'] === true ? (['sync-strava-tracks'] as const) : []),
    ],
  },
  {
    id: 'sheet',
    label: 'A sheet you keep by hand',
    help: 'A CSV or .xlsx file of activities, with GPX tracks if you have them.',
    steps: SHEET_STEPS,
    actions: () => ['sync-sheet'],
  },
];

export const sourceById = (id: string): Source | undefined =>
  SOURCES.find((source) => source.id === id);

/**
 * The commands the wizard may run: a fixed list. Arguments are decided here from the answers and
 * the state of the machine, never taken from a caller, so the web wizard cannot be made to run
 * anything else.
 */
import { join } from 'node:path';

import { findCommand } from '../commands/index.ts';
import { JamError } from '../errors.ts';
import type { GlobalFlags } from '../commands/types.ts';
import { FETCH_SOURCES } from '../lists/fetch.ts';
import { type Logger, parseProgress } from '../logger.ts';
import { ROOT_DIR } from '../paths.ts';
import { PNPM, runLines } from '../process.ts';
import { canReadActivities, hasReadAll } from '../strava/auth.ts';
import { sourceById } from './sources.ts';
import { type Affects, type Ctx, str } from './types.ts';

export const ACTION_IDS = [
  'demo',
  'demo-clear',
  'lists-fetch',
  'lists-build',
  'lists-validate',
  'strava-auth',
  'sync-strava',
  'sync-strava-tracks',
  'sync-sheet',
  'sync-gpx',
  'sync-garmin',
  'match',
  'routes',
  'routes-review',
  'routes-regroup',
  'zones',
  'zones-preview',
  'build',
  'web-build',
] as const;
export type ActionId = (typeof ACTION_IDS)[number];

export interface Action {
  id: ActionId;
  title: string;
  /** A `jam` command run inside this process: its name words. */
  command?: string[];
  args?: (ctx: Ctx) => string[];
  options?: Record<string, string | boolean>;
  /** More options, from the answers: added to `options`. */
  answered?: (ctx: Ctx) => Record<string, string>;
  /** Run as a separate process instead: the program and its arguments. */
  child?: (ctx: Ctx) => { file: string; args: string[] };
  network?: boolean;
  browser?: boolean;
  /** How long it can take, when that is worth saying. */
  slow?: string;
}

const MAIN = join(ROOT_DIR, 'packages/cli/src/main.ts');

/** The sources to download: what full setup chose, or in quick setup only what is missing. */
const fetchArgs = (ctx: Ctx): string[] => {
  const chosen = ctx.answers['lists.fetch'];
  const wanted = Array.isArray(chosen)
    ? chosen.map(String)
    : ctx.facts.listsMissing.length > 0
      ? ['gokaido', 'wikipedia']
      : [];
  return wanted.filter((source) => (FETCH_SOURCES as readonly string[]).includes(source));
};

/** `--from` and `--to` for one source's pull, from the "this run only" answers. */
const rangeOptions =
  (source: 'strava' | 'garmin') =>
  (ctx: Ctx): Record<string, string> => {
    const day = (id: string) => {
      const value = str(ctx.answers[id] ?? '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
    };
    const from = day(`${source}.pull.from`);
    const to = day(`${source}.pull.to`);
    return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
  };

/** An action's options for this run: the fixed ones and those the answers give. */
const optionsOf = (action: Action, ctx: Ctx): Record<string, string | boolean> => ({
  ...action.options,
  ...action.answered?.(ctx),
});

const demoArgs = (ctx: Ctx): string[] => {
  const args = ['demo'];
  const option = (flag: string, id: string, shape: RegExp) => {
    const value = ctx.answers[id];
    if (value !== undefined && value !== '' && shape.test(str(value))) args.push(flag, str(value));
  };
  option('--seed', 'demo.seed', /^\d+$/);
  option('--until', 'demo.until', /^\d{4}-\d{2}-\d{2}$/);
  option('--years', 'demo.years', /^\d+$/);
  option('--lang', 'demo.lang', /^(en|ja)$/);
  return args;
};

export const ACTIONS: Record<ActionId, Action> = {
  // The demo keeps its own data folder (it sets JAM_DATA_DIR for itself), which this process
  // cannot switch to once started: a child process.
  demo: {
    id: 'demo',
    title: 'Make demo data and build a demo site',
    child: (ctx) => ({ file: process.execPath, args: [MAIN, ...demoArgs(ctx)] }),
  },
  'demo-clear': {
    id: 'demo-clear',
    title: 'Remove the demo data',
    child: () => ({ file: process.execPath, args: [MAIN, 'demo', '--clear'] }),
  },
  'lists-fetch': {
    id: 'lists-fetch',
    title: 'Download reference sources',
    command: ['lists', 'fetch'],
    args: fetchArgs,
    network: true,
    slow: 'a minute or two; osm several minutes; outlines about 500 MB',
  },
  'lists-build': {
    id: 'lists-build',
    title: 'Build the reference lists',
    command: ['lists', 'build'],
  },
  'lists-validate': {
    id: 'lists-validate',
    title: 'Check the reference lists',
    command: ['lists', 'validate'],
  },
  'strava-auth': {
    id: 'strava-auth',
    title: 'Sign in to Strava',
    command: ['strava', 'auth'],
    network: true,
    browser: true,
  },
  'sync-strava': {
    id: 'sync-strava',
    title: 'Fetch your Strava activities',
    command: ['sync', 'strava'],
    answered: rangeOptions('strava'),
    network: true,
    slow: 'a few minutes for a long history; waits when Strava limits requests',
  },
  'sync-strava-tracks': {
    id: 'sync-strava-tracks',
    title: 'Fetch full tracks for up to 400 activities',
    command: ['sync', 'strava'],
    options: { streams: 'missing', limit: '400' },
    network: true,
    slow: 'about an hour',
  },
  'sync-sheet': {
    id: 'sync-sheet',
    title: 'Import the activity sheet',
    command: ['sync', 'sheet'],
  },
  'sync-gpx': {
    id: 'sync-gpx',
    title: 'Import GPX files',
    command: ['sync', 'gpx'],
  },
  'sync-garmin': {
    id: 'sync-garmin',
    title: 'Fetch Garmin activities',
    command: ['sync', 'garmin'],
    answered: rangeOptions('garmin'),
    network: true,
  },
  match: { id: 'match', title: 'Match activities to the lists', command: ['match'] },
  routes: { id: 'routes', title: 'Group repeated activities into routes', command: ['routes'] },
  'routes-review': {
    id: 'routes-review',
    title: 'List routes that may need merging or splitting',
    command: ['routes', 'review'],
  },
  'routes-regroup': {
    id: 'routes-regroup',
    title: 'Regroup every route from scratch',
    command: ['routes', 'regroup'],
  },
  zones: { id: 'zones', title: 'Show what the privacy zones do', command: ['zones'] },
  'zones-preview': {
    id: 'zones-preview',
    title: 'Write the cut tracks to data/privacy-preview.geojson',
    command: ['zones'],
    options: { preview: true },
  },
  build: {
    id: 'build',
    title: 'Build the site data',
    command: ['build'],
    // The dev checks build into a temporary folder instead of dist/data.
    ...(process.env.JAM_SETUP_BUILD_OUT
      ? { options: { out: process.env.JAM_SETUP_BUILD_OUT } }
      : {}),
  },
  'web-build': {
    id: 'web-build',
    title: 'Build the web app (pnpm web:build)',
    child: () => ({
      file: PNPM,
      args: ['web:build'],
    }),
    slow: 'about a minute',
  },
};

export const isActionId = (id: string): id is ActionId =>
  (ACTION_IDS as readonly string[]).includes(id);

/** The command an action stands for, as someone would type it. */
export const shownCommand = (id: ActionId, ctx: Ctx): string => {
  const action = ACTIONS[id];
  if (id === 'web-build') return 'pnpm web:build';
  if (action.child) return `pnpm jam ${action.child(ctx).args.slice(1).join(' ')}`;
  const options = Object.entries(optionsOf(action, ctx)).map(([name, value]) =>
    value === true ? `--${name}` : `--${name} ${str(value)}`,
  );
  return ['pnpm jam', ...(action.command ?? []), ...(action.args?.(ctx) ?? []), ...options].join(
    ' ',
  );
};

export interface PlanItem {
  id: ActionId;
  /** Why the action is left out of this run, when it is. */
  skip?: string;
}

const signedIn = (ctx: Ctx, includePrivate: boolean): boolean => {
  const scope = ctx.facts.stravaScope;
  return scope !== null && canReadActivities(scope) && (!includePrivate || hasReadAll(scope));
};

/** Everything a first run does, in order, for the chosen sources. */
export const setupPlan = (ctx: Ctx, includePrivate: boolean): PlanItem[] => {
  const chosen = Array.isArray(ctx.answers.sources) ? ctx.answers.sources.map(String) : [];
  const plan: PlanItem[] = [];
  if (fetchArgs(ctx).length > 0) {
    plan.push({ id: 'lists-fetch' }, { id: 'lists-build' });
    if (ctx.mode === 'full') plan.push({ id: 'lists-validate' });
  }
  for (const id of chosen)
    for (const action of sourceById(id)?.actions(ctx) ?? []) {
      if (action === 'strava-auth' && signedIn(ctx, includePrivate))
        plan.push({ id: action, skip: 'already signed in' });
      else if (action === 'sync-sheet' && !ctx.facts.sheetExists)
        plan.push({ id: action, skip: 'the sheet file is not there yet' });
      else if (action === 'sync-gpx' && !ctx.facts.gpxFolderExists)
        plan.push({ id: action, skip: 'the GPX folder is not there yet' });
      else if (action === 'sync-garmin' && !ctx.facts.garminKey && !ctx.answers['garmin.apiKey'])
        plan.push({ id: action, skip: 'no Garmin personal API key yet' });
      else plan.push({ id: action });
    }
  plan.push(
    { id: 'match' },
    { id: 'routes' },
    { id: 'zones' },
    { id: 'build' },
    { id: 'web-build' },
  );
  return plan;
};

/** What changed settings make stale, as the actions that bring things up to date. */
export const followUps = (affects: ReadonlySet<Affects>): ActionId[] => {
  const order: [Affects, ActionId][] = [
    ['strava-auth', 'strava-auth'],
    ['full-pull', 'sync-strava'],
    ['pull-strava', 'sync-strava'],
    ['pull-garmin', 'sync-garmin'],
    ['match', 'match'],
    ['regroup', 'routes-regroup'],
    ['zones', 'zones-preview'],
    ['build', 'build'],
  ];
  return [...new Set(order.filter(([affect]) => affects.has(affect)).map(([, action]) => action))];
};

/** How a caller that can stop a run (the setup page) gets hold of it. */
export interface RunOptions {
  /** Run a command of ours as a process of its own, so it can be stopped. */
  separate?: boolean;
  /** Called with a function that stops the run, once there is something to stop. */
  onStoppable?: (stop: () => void) => void;
}

const runChild = async (
  file: string,
  args: string[],
  log: Logger,
  onStoppable?: RunOptions['onStoppable'],
): Promise<number> => {
  const result = await runLines(file, args, {
    // Our own commands then print their progress as lines, which are read back here.
    env: { ...process.env, JAM_PROGRESS: '1' },
    onLine: (line) => {
      const progress = parseProgress(line);
      if (progress) log.progress(progress.done, progress.total, progress.what);
      else log.info(line);
    },
    // Ctrl-C's signal: our commands stop at a safe point (a store transaction is rolled back, a
    // Strava pull has recorded its page), and the next run carries on from there.
    onStart: (child) => onStoppable?.(() => child.kill('SIGINT')),
  });
  if (result.missing) log.error(`Could not run ${file}: it was not found.`);
  return result.code;
};

/** Runs one whitelisted action and returns its exit code. Errors a person can act on become a line. */
export const runAction = async (
  id: ActionId,
  ctx: Ctx,
  flags: GlobalFlags,
  log: Logger,
  run: RunOptions = {},
): Promise<number> => {
  const action = ACTIONS[id];
  if (action.child) {
    const { file, args } = action.child(ctx);
    if (id.startsWith('demo') && !ctx.facts.demoAvailable) {
      log.error('Demo data is not available in this version.');
      return 1;
    }
    if (flags.dryRun) {
      if (!id.startsWith('demo')) {
        log.info(`Would run: ${shownCommand(id, ctx)}`);
        return 0;
      }
      return runChild(file, [...args, '--dry-run'], log, run.onStoppable);
    }
    return runChild(file, args, log, run.onStoppable);
  }
  const found = findCommand(action.command ?? []);
  if (!found) {
    log.error(`The command for "${action.title}" is not in this version.`);
    return 1;
  }
  // The Strava sign-in stays in this process: the page needs its address, and it ends by itself.
  if (run.separate && id !== 'strava-auth') {
    const given = Object.entries(optionsOf(action, ctx)).flatMap(([name, value]) =>
      value === true ? [`--${name}`] : typeof value === 'string' ? [`--${name}`, value] : [],
    );
    return runChild(
      process.execPath,
      [
        join(ROOT_DIR, 'packages/cli/src/main.ts'),
        '--config',
        flags.configDir,
        ...(flags.dryRun ? ['--dry-run'] : []),
        ...(action.command ?? []),
        ...(action.args?.(ctx) ?? []),
        ...given,
      ],
      log,
      run.onStoppable,
    );
  }
  const own = Object.fromEntries(
    Object.keys(found.command.options ?? {}).map((name) => [name, optionsOf(action, ctx)[name]]),
  );
  try {
    return await found.command.run({ flags, log, args: action.args?.(ctx) ?? [], options: own });
  } catch (error) {
    if (error instanceof JamError) log.error(error.message);
    else log.error(error instanceof Error ? (error.stack ?? error.message) : str(error));
    return 1;
  }
};

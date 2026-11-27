/**
 * The terminal wizard: asks the steps, shows what would change, writes the config files and runs
 * the plan. Everything it prints goes to the terminal only; the log gets step ids, never answers.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CommandContext } from '../commands/types.ts';
import { LISTS_DIR } from '../lists/sources.ts';
import { DATA_DIR, shownPath } from '../paths.ts';
import {
  ACTIONS,
  type ActionId,
  followUps,
  type PlanItem,
  runAction,
  setupPlan,
  shownCommand,
} from './actions.ts';
import {
  currentAnswer,
  draftChanges,
  draftConfig,
  type Draft,
  openDraft,
  SetupError,
  takeAnswer,
  writeDraft,
  secretStored,
} from './engine.ts';
import { applyMerge, mergeCandidates } from './merges.ts';
import { type Prompter, shown } from './prompt.ts';
import { SOURCES } from './sources.ts';
import { clearState, findFacts, loadState, saveState, type SetupState } from './state.ts';
import { changeGroups } from './stage.ts';
import { groupNamed, stepsFor } from './steps.ts';
import type { Affects, Ctx, Mode, Step } from './types.ts';

export interface WizardOptions {
  /** Unset: the first screen asks. */
  start?: 'demo' | Mode;
  /** `--change <group>`. */
  changeGroup?: string;
  /** `--only a,b`: just these groups. */
  only?: string[];
  /** Answer yes to "write" and "run". */
  yes: boolean;
  noRun: boolean;
  /** Secrets from the environment or stdin, by step id. */
  secrets: Record<string, string>;
  /** Scripted answers, when there are any: also `start`, `run` and `skip`. */
  answers?: Record<string, unknown>;
}

/** Review files worth reading after a run, with what each is. */
export const REVIEW_FILES: { name: string; path: string; what: string }[] = [
  { name: 'match', path: join(DATA_DIR, 'match-review.md'), what: 'new and uncertain matches' },
  { name: 'routes', path: join(DATA_DIR, 'routes-review.md'), what: 'routes to merge or split' },
  { name: 'sheet', path: join(DATA_DIR, 'sheet-review.md'), what: 'sheet rows needing a look' },
  { name: 'lists', path: join(LISTS_DIR, 'review.md'), what: 'what the list build left open' },
];

const confirm = async (
  prompter: Prompter,
  id: string,
  title: string,
  fallback: boolean,
): Promise<boolean> => {
  const answer = await prompter.ask({ id, kind: 'confirm', title, default: fallback });
  if (answer === undefined) return fallback;
  if (typeof answer === 'boolean') return answer;
  return /^(y|yes|true)$/i.test(shown(answer).trim());
};

/** The zone editor for a terminal: add and remove by label; positions are typed, never looked up. */
const editZones = async (prompter: Prompter, step: Step, current: unknown): Promise<unknown> => {
  const zones = Array.isArray(current) ? [...(current as Record<string, unknown>[])] : [];
  for (;;) {
    prompter.say('');
    prompter.say(
      zones.length === 0
        ? 'No privacy zones yet.'
        : `Privacy zones: ${zones.map((zone) => `${shown(zone.label)} (${shown(zone.radiusM)} m)`).join(', ')}`,
    );
    const next = await prompter.ask({
      id: `${step.id}.edit`,
      kind: 'choice',
      title: 'Change the zones?',
      options: [
        { value: 'done', label: 'Keep them as listed' },
        { value: 'add', label: 'Add a zone' },
        { value: 'remove', label: 'Remove a zone' },
      ],
      default: 'done',
    });
    if (next === 'add') {
      const label = await prompter.ask({
        id: 'zone.label',
        kind: 'text',
        title: 'Label (for example home)',
      });
      const where = await prompter.ask({
        id: 'zone.where',
        kind: 'location',
        title: 'Latitude, longitude',
      });
      const radius = await prompter.ask({
        id: 'zone.radius',
        kind: 'number',
        title: 'Radius (m)',
        default: 500,
      });
      const [lat, lon] = shown(where)
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      zones.push({ label: shown(label).trim(), lat, lon, radiusM: Number(radius ?? 500) });
    } else if (next === 'remove') {
      const label = await prompter.ask({
        id: 'zone.remove',
        kind: 'text',
        title: 'Label of the zone to remove',
      });
      const at = zones.findIndex((zone) => zone.label === shown(label).trim());
      if (at >= 0) zones.splice(at, 1);
      else prompter.say('No zone has that label.');
    } else return zones;
  }
};

interface Asked {
  ctx: Ctx;
  /** What the accepted answers make stale. */
  affects: Set<Affects>;
}

/** Goes through the steps, asking each that applies, until every answer is in the draft. */
const askSteps = async (
  steps: Step[],
  ctx: Ctx,
  draft: Draft,
  prompter: Prompter,
  options: WizardOptions,
  context: CommandContext,
  state: SetupState,
): Promise<Asked> => {
  const affects = new Set<Affects>();
  const scripted = options.answers;
  for (const step of steps) {
    if (step.when && !step.when(ctx)) continue;
    // Change mode from a file touches only what the file names.
    if (ctx.mode === 'change' && scripted && !(step.id in scripted) && !options.secrets[step.id])
      continue;
    const remembered = state.mode === ctx.mode ? state.answers[step.id] : undefined;
    const fallback = remembered ?? currentAnswer(step, ctx);
    for (;;) {
      let raw: unknown;
      if (step.setting?.sensitive === 'secret') {
        const stored = secretStored(step, ctx);
        raw =
          options.secrets[step.id] ??
          (prompter.interactive ? await prompter.ask({ ...step, stored }) : undefined);
        // "-" takes a stored one away again, where the step is one that may be left empty.
        if (step.optional && raw === '-') raw = '';
        else if (raw === undefined || raw === '') {
          // Stored already, or one that may be left for later (a deploy token).
          if (stored || step.optional) break;
          if (prompter.interactive) {
            prompter.say('This is needed.');
            continue;
          }
          throw new SetupError(
            'The Strava Client ID and Client Secret are needed and nobody is here to type them. Set JAM_STRAVA_CLIENT_ID and JAM_STRAVA_CLIENT_SECRET, or pipe them with --secrets-stdin.',
          );
        }
      } else if (step.kind === 'zones' && prompter.interactive) {
        raw = await editZones(prompter, step, fallback);
      } else {
        raw = await prompter.ask({ ...step, default: fallback });
        if (raw === undefined) raw = fallback;
        else if (step.optional && raw === '-') raw = '';
      }
      if (raw === undefined) {
        if (prompter.interactive) {
          prompter.say('This needs an answer.');
          continue;
        }
        throw new SetupError(`No answer for "${step.id}" and no default.`);
      }
      const before = JSON.stringify(draft.text);
      const problem = takeAnswer(draft, step, raw, ctx);
      if (!problem) {
        if (JSON.stringify(draft.text) !== before)
          for (const item of step.affects ?? []) affects.add(item);
        break;
      }
      if (!prompter.interactive) throw new SetupError(`${step.id}: ${problem}`);
      prompter.say(`  ${problem}`);
    }
    context.log.debug(`setup: answered ${step.id}`);
    if (!context.flags.dryRun) {
      state.mode = ctx.mode;
      state.answers = { ...ctx.answers };
      saveState(state);
    }
  }
  return { ctx, affects };
};

const label = (item: PlanItem, ctx: Ctx): string => {
  const action = ACTIONS[item.id];
  const notes = [
    action.network ? 'network' : '',
    action.browser ? 'opens a browser' : '',
    action.slow ? `slow: ${action.slow}` : '',
  ].filter(Boolean);
  return `${action.title}${notes.length > 0 ? ` [${notes.join('; ')}]` : ''}\n      ${shownCommand(item.id, ctx)}${item.skip ? `\n      skipped: ${item.skip}` : ''}`;
};

const showChanges = (prompter: Prompter, draft: Draft): number => {
  const changes = draftChanges(draft);
  if (changes.length === 0) {
    prompter.say('\nNo config file needs to change.');
    return 0;
  }
  prompter.say('\nConfig changes:');
  for (const change of changes) {
    prompter.say(
      `\n  ${shownPath(change.path)}${change.created ? (change.key === 'secrets' ? ' (new)' : ' (new, from the example)') : ''}`,
    );
    for (const row of change.diff) prompter.say(`    ${row}`);
  }
  return changes.length;
};

/** Runs the plan in order, remembering what finished so a rerun continues after a failure. */
const runPlan = async (
  plan: PlanItem[],
  ctx: Ctx,
  prompter: Prompter,
  context: CommandContext,
  state: SetupState,
): Promise<number> => {
  const ids = plan.map((item) => item.id);
  const resumed = state.run !== undefined && state.run.plan.join() === ids.join();
  const done = new Set<string>(resumed ? state.run?.done : []);
  for (const [index, item] of plan.entries()) {
    const title = `[${index + 1}/${plan.length}] ${ACTIONS[item.id].title}`;
    if (item.skip) {
      prompter.say(`\n${title}: skipped (${item.skip}).`);
      continue;
    }
    if (done.has(item.id)) {
      prompter.say(`\n${title}: done in the earlier run.`);
      continue;
    }
    prompter.say(`\n${title}\n  ${shownCommand(item.id, ctx)}`);
    const code = await runAction(item.id, ctx, context.flags, context.log);
    if (code !== 0) {
      prompter.say(
        `\n"${ACTIONS[item.id].title}" failed. Fix what it says, then run \`pnpm jam setup\` again: it continues from this step.`,
      );
      return 1;
    }
    done.add(item.id);
    if (!context.flags.dryRun) {
      state.run = { plan: ids, done: [...done] };
      saveState(state);
    }
  }
  return 0;
};

/**
 * Routes the grouping thinks may be one route, asked one by one (the most alike first, at most
 * 15). Each yes is written to config/routes.jsonc; then the routes are grouped and the site data
 * built again, so the answer shows. Only when someone is there to answer.
 */
const offerMerges = async (
  prompter: Prompter,
  context: CommandContext,
  ctx: Ctx,
): Promise<number> => {
  const { flags, log } = context;
  if (!prompter.interactive) return 0;
  const open = mergeCandidates(flags.configDir)
    .filter((candidate) => !candidate.merged)
    .slice(0, 15);
  if (open.length === 0) return 0;
  prompter.say(
    `\n${open.length} ${open.length === 1 ? 'pair of routes looks' : 'pairs of routes look'} like one route. Merge them?`,
  );
  let merged = 0;
  for (const candidate of open) {
    const names = candidate.routes.map((route) => `${route.name} (${route.count}×)`).join(' + ');
    if (
      await confirm(
        prompter,
        `merge.${candidate.index}`,
        `${names}: ${candidate.reason}. Merge?`,
        false,
      )
    ) {
      applyMerge(flags.configDir, candidate.index, flags.dryRun);
      merged += 1;
    }
  }
  if (merged === 0 || flags.dryRun) return 0;
  prompter.say(`\n${merged} merged in config/routes.jsonc. Grouping routes and building again…`);
  for (const id of ['routes', 'build'] as const) {
    const code = await runAction(id, ctx, flags, log);
    if (code !== 0) {
      prompter.say(`"${ACTIONS[id].title}" failed. Run \`pnpm jam ${id}\` when it is fixed.`);
      return code;
    }
  }
  return 0;
};

const summary = (prompter: Prompter, hasStrava: boolean): void => {
  prompter.say('\nSetup is complete.');
  const reviews = REVIEW_FILES.filter((file) => existsSync(file.path));
  if (reviews.length > 0) {
    prompter.say('Worth reading:');
    for (const file of reviews) prompter.say(`  ${shownPath(file.path)}: ${file.what}`);
  }
  prompter.say('See the site:');
  prompter.say('  pnpm web:preview');
  prompter.say('Check what the privacy zones cut (writes a local file to look at on a map):');
  prompter.say('  pnpm jam zones --preview');
  if (hasStrava) {
    prompter.say('Each week, or whenever you want the site up to date:');
    prompter.say('  pnpm jam update');
  }
  prompter.say('Change a setting later:');
  prompter.say('  pnpm jam setup --change');
  prompter.say('Publish the site (docs/deploy.md says what it needs first):');
  prompter.say('  pnpm jam deploy');
};

const demoRun = async (
  ctx: Ctx,
  draft: Draft,
  prompter: Prompter,
  options: WizardOptions,
  context: CommandContext,
  state: SetupState,
): Promise<number> => {
  ctx.answers.sources = ['demo'];
  const steps = SOURCES.find((source) => source.id === 'demo')?.steps ?? [];
  await askSteps(steps, ctx, draft, prompter, options, context, state);
  prompter.say(`\nPlan:\n  1. ${label({ id: 'demo' }, ctx)}`);
  prompter.say(
    'The demo keeps its data in its own folder; your own data and config are not touched.',
  );
  if (options.noRun) return 0;
  if (!(await confirm(prompter, 'run', 'Run it now?', prompter.interactive || options.yes)))
    return 0;
  const code = await runAction('demo', ctx, context.flags, context.log);
  if (code === 0) {
    clearState();
    prompter.say('\nRemove the demo data later with: pnpm jam demo --clear');
  }
  return code;
};

/** The first screen: demo data first, then the three ways through the settings. */
const askStart = async (
  prompter: Prompter,
  ctx: Ctx,
  state: SetupState,
): Promise<'demo' | Mode> => {
  const demo = SOURCES.find((source) => source.id === 'demo');
  const missing = demo?.unavailable?.(ctx.facts);
  for (;;) {
    const answer = await prompter.ask({
      id: 'start',
      kind: 'choice',
      title: 'What would you like to do?',
      options: [
        {
          value: 'demo',
          label: `Try with demo data${missing ? ` (${missing})` : ''}`,
          help: demo?.help ?? '',
        },
        {
          value: 'quick',
          label: 'Quick setup',
          help: 'About nine questions; recommended defaults.',
        },
        { value: 'full', label: 'Full setup', help: 'Every setting, group by group.' },
        { value: 'change', label: 'Change settings', help: 'One group of settings.' },
      ],
      default: state.mode ?? 'quick',
    });
    const start = answer === undefined ? (state.mode ?? 'quick') : shown(answer);
    if (start === 'demo' && missing) {
      if (!prompter.interactive) throw new SetupError(`Demo data is ${missing}.`);
      prompter.say(`  Demo data is ${missing}.`);
      continue;
    }
    if (start === 'demo' || start === 'quick' || start === 'full' || start === 'change')
      return start;
    if (!prompter.interactive) throw new SetupError(`"start" must be demo, quick, full or change.`);
  }
};

export const runWizard = async (
  options: WizardOptions,
  prompter: Prompter,
  context: CommandContext,
): Promise<number> => {
  const { flags } = context;
  const { draft, config } = openDraft(flags.configDir);
  const state = loadState();
  const ctx: Ctx = {
    mode: 'quick',
    answers: {},
    config,
    facts: findFacts(flags.configDir, config.sheet.path),
  };
  const start = options.start ?? (await askStart(prompter, ctx, state));
  if (start === 'demo') {
    ctx.mode = 'full';
    if (!ctx.facts.demoAvailable)
      throw new SetupError('Demo data is not available in this version.');
    return demoRun(ctx, draft, prompter, options, context, state);
  }
  ctx.mode = start;

  let groups = options.only;
  if (start === 'change') {
    // Every source's settings can be changed, whichever were chosen at setup.
    ctx.answers.sources = SOURCES.filter((source) => !source.standalone).map((source) => source.id);
    const available = changeGroups();
    let group = options.changeGroup ? groupNamed(options.changeGroup) : undefined;
    if (options.changeGroup && !group)
      throw new SetupError(
        `No group "${options.changeGroup}". Groups: ${available.map((item) => item.id.replace('source:', '')).join(', ')}.`,
      );
    if (!group && !groups) {
      const answer = await prompter.ask({
        id: 'group',
        kind: 'choice',
        title: 'Which settings?',
        options: available.map((item) => ({ value: item.id, label: item.title })),
      });
      group = groupNamed(shown(answer));
      if (!group)
        throw new SetupError('Say which group to change: `pnpm jam setup --change <group>`.');
    }
    if (group) groups = [group];
  }

  const steps = stepsFor(start, groups);
  const { affects } = await askSteps(steps, ctx, draft, prompter, options, context, state);
  const changed = showChanges(prompter, draft);
  const next = draftConfig(draft);
  const plan: PlanItem[] =
    start === 'change'
      ? followUps(affects).map((id: ActionId) => ({ id }))
      : setupPlan(ctx, next.strava.import.includePrivate);
  const skip = Array.isArray(options.answers?.skip) ? options.answers.skip.map(String) : [];
  for (const item of plan) if (skip.includes(item.id)) item.skip = 'left out by the answers file';

  if (plan.length > 0) {
    prompter.say(start === 'change' ? '\nTo bring things up to date, run next:' : '\nPlan:');
    plan.forEach((item, index) => prompter.say(`  ${index + 1}. ${label(item, ctx)}`));
  }
  if (next.privacyZones.zones.length === 0)
    prompter.say('\nNo privacy zone is set: published tracks will show where they start and end.');

  if (flags.dryRun) {
    prompter.say('\nDry run: nothing was written and nothing was run.');
    return 0;
  }
  if (changed > 0) {
    if (!(await confirm(prompter, 'write', 'Write these changes?', true))) {
      prompter.say('Nothing was written. Your answers are kept for the next run.');
      return 0;
    }
    writeDraft(draft);
    prompter.say(`Wrote ${changed} config ${changed === 1 ? 'file' : 'files'}.`);
    // New settings start a new run; an unfinished run with the same settings continues.
    delete state.run;
  }
  // Nothing is pending once the answers are in the files; only an unfinished run is worth keeping.
  state.answers = {};
  if (state.run) saveState(state);
  else clearState();

  if (plan.length === 0 || options.noRun) {
    if (options.noRun && plan.length > 0) prompter.say('Not running anything (--no-run).');
    clearState();
    return 0;
  }
  // Follow-ups after a change run only when asked; a first setup runs unless told not to.
  const fallback = start === 'change' ? false : prompter.interactive || options.yes;
  if (!(await confirm(prompter, 'run', 'Run these now?', fallback))) {
    prompter.say('Nothing was run. The commands above do it when you are ready.');
    return 0;
  }
  // The facts may have changed with the files just written (credentials now stored).
  ctx.facts = findFacts(flags.configDir, next.sheet.path);
  const code = await runPlan(plan, ctx, prompter, context, state);
  if (code !== 0) return code;
  clearState();
  if (plan.some((item) => item.id === 'routes')) {
    const again = await offerMerges(prompter, context, ctx);
    if (again !== 0) return again;
  }
  if (start !== 'change')
    summary(
      prompter,
      plan.some((item) => item.id === 'sync-strava'),
    );
  return 0;
};

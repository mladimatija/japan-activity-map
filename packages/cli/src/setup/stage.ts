/**
 * A whole set of answers taken at once, for a front end that sends them together (the web wizard):
 * which steps apply, what is wrong with which answer, what the files would become and what would
 * run. Nothing is written here.
 */
import type { ActionId, PlanItem } from './actions.ts';
import { ACTIONS, followUps, setupPlan, shownCommand } from './actions.ts';
import {
  type Change,
  currentAnswer,
  draftChanges,
  draftConfig,
  type Draft,
  openDraft,
  takeAnswer,
  secretStored,
} from './engine.ts';
import { SOURCES } from './sources.ts';
import { findFacts } from './state.ts';
import { GROUPS, stepsFor } from './steps.ts';
import type { Affects, Ctx, Mode, Option, Step } from './types.ts';

export type Start = 'demo' | Mode;

/** A step as a front end may see it: no functions, and no value for anything sensitive. */
export interface ShownStep {
  id: string;
  group: string;
  kind: Step['kind'];
  title: string;
  help?: string;
  options?: Option[];
  optional: boolean;
  /** secret: never sent back. location: only labels and radii are. */
  sensitive?: 'secret' | 'location';
  /** For a secret: whether one is stored already. */
  stored: boolean;
  value?: unknown;
}

export interface Staged {
  ctx: Ctx;
  draft: Draft;
  steps: ShownStep[];
  /** Step id to what is wrong with its answer. */
  errors: Record<string, string>;
  changes: Change[];
  plan: PlanItem[];
}

/** Zones without their positions: enough to list and remove them. */
const zoneSummary = (zones: unknown): unknown =>
  Array.isArray(zones)
    ? zones.map((zone: Record<string, unknown>) => ({ label: zone.label, radiusM: zone.radiusM }))
    : [];

/**
 * The page lists zones without positions, so it sends back `{ label, keep: true }` for one it
 * leaves alone: the position is filled in from the file here.
 */
const withKeptZones = (answer: unknown, ctx: Ctx): unknown => {
  if (!Array.isArray(answer)) return answer;
  return answer.map((zone: Record<string, unknown>) => {
    if (zone === null || typeof zone !== 'object' || zone.keep !== true) return zone;
    const stored = ctx.config.privacyZones.zones.find((item) => item.label === zone.label);
    return stored
      ? { ...stored, ...(typeof zone.radiusM === 'number' ? { radiusM: zone.radiusM } : {}) }
      : zone;
  });
};

export const stage = (
  configDir: string,
  start: Start,
  given: Record<string, unknown>,
  groups?: string[],
): Staged => {
  const { draft, config } = openDraft(configDir);
  const mode: Mode = start === 'demo' ? 'full' : start;
  const ctx: Ctx = { mode, answers: {}, config, facts: findFacts(configDir, config.sheet.path) };
  let steps: Step[];
  if (start === 'demo') {
    ctx.answers.sources = ['demo'];
    steps = SOURCES.find((source) => source.id === 'demo')?.steps ?? [];
  } else {
    if (start === 'change')
      ctx.answers.sources = SOURCES.filter((source) => !source.standalone).map(
        (source) => source.id,
      );
    steps = stepsFor(mode, groups);
  }

  const shown: ShownStep[] = [];
  const errors: Record<string, string> = {};
  const affects = new Set<Affects>();
  for (const step of steps) {
    if (step.when && !step.when(ctx)) continue;
    const sensitive = step.setting?.sensitive;
    const secret = sensitive === 'secret';
    const current = currentAnswer(step, ctx);
    let raw = given[step.id];
    if (raw === '' && secret) raw = undefined;
    // "-" takes a stored one away again, where the step is one that may be left empty.
    if (raw === '-' && secret && step.optional) raw = '';
    if (step.kind === 'zones') raw = withKeptZones(raw, ctx);
    if (raw === undefined) {
      if (secret && !step.optional && !ctx.facts.stravaCredentials && start !== 'change')
        errors[step.id] = 'This is needed.';
      // Unanswered: in change mode nothing happens; otherwise the current value stands.
      else if (!secret && start !== 'change' && current !== undefined) raw = current;
    }
    if (raw !== undefined) {
      const before = JSON.stringify(draft.text);
      const problem = takeAnswer(draft, step, raw, ctx);
      if (problem) errors[step.id] = problem;
      // A step that writes no setting is an option for a command: answering it is what counts.
      else if (JSON.stringify(draft.text) !== before || (step.runOption === true && raw !== ''))
        for (const item of step.affects ?? []) affects.add(item);
    }
    const value = secret
      ? undefined
      : step.kind === 'zones'
        ? zoneSummary(ctx.answers[step.id] ?? current)
        : sensitive === 'location'
          ? undefined
          : (ctx.answers[step.id] ?? current);
    shown.push({
      id: step.id,
      group: step.group,
      kind: step.kind,
      title: step.title,
      ...(step.help ? { help: step.help } : {}),
      ...(step.options ? { options: step.options } : {}),
      optional: step.optional === true,
      ...(sensitive ? { sensitive } : {}),
      stored: secret && secretStored(step, ctx),
      ...(value === undefined ? {} : { value }),
    });
  }

  const next = draftConfig(draft);
  const plan: PlanItem[] =
    start === 'demo'
      ? [
          ctx.facts.demoAvailable
            ? { id: 'demo' }
            : { id: 'demo', skip: 'not available in this version' },
        ]
      : start === 'change'
        ? followUps(affects).map((id: ActionId) => ({ id }))
        : setupPlan(ctx, next.strava.import.includePrivate);
  return { ctx, draft, steps: shown, errors, changes: draftChanges(draft), plan };
};

/** The groups that have something to change, for the change screen. */
export const changeGroups = (): { id: string; title: string }[] =>
  GROUPS.filter(
    (group) =>
      // These hold only questions about a first run (which sources, what to download, the demo).
      !['sources', 'lists', 'source:demo'].includes(group.id) &&
      stepsFor('change', [group.id]).length > 0,
  );

/** A plan as a front end shows it: titles, the command as typed, and what to warn about. */
export const planView = (plan: PlanItem[], ctx: Ctx) => {
  const order = Object.keys(ACTIONS);
  return plan.map((item) => {
    const action = ACTIONS[item.id];
    return {
      id: item.id,
      // Its place in the pipeline, so plans from several changes merge into one in the right order.
      order: order.indexOf(item.id),
      title: action.title,
      command: shownCommand(item.id, ctx),
      network: action.network === true,
      browser: action.browser === true,
      ...(action.slow ? { slow: action.slow } : {}),
      ...(item.skip ? { skip: item.skip } : {}),
    };
  });
};

/** Everything about staged answers that may leave the machine's memory: no secret, no position. */
export const viewOf = (result: Staged) => ({
  steps: result.steps,
  errors: result.errors,
  changes: result.changes.map(({ name, created, diff }) => ({ name, created, diff })),
  plan: planView(result.plan, result.ctx),
});

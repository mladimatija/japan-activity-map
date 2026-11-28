/**
 * Turns answers into config files. Both front ends go through here: an answer is coerced to its
 * kind, mapped to patches, applied to the file text in memory and the whole file is checked
 * against its schema; nothing is written until `writeDraft`.
 */
import { CONFIG_FILES, type Config, type ConfigKey } from '@jam/core';

import {
  checkText,
  type ConfigText,
  diffText,
  type Patch,
  parseText,
  patchText,
  readConfigText,
  sameValue,
  valueAt,
  writeConfigText,
} from './jsonc.ts';
import { type Ctx, type Step, str } from './types.ts';
import { JamError } from '../errors.ts';

export class SetupError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

const KEYS = Object.keys(CONFIG_FILES) as ConfigKey[];

/** The config files as text, with edits applied in memory only. */
export interface Draft {
  original: Record<ConfigKey, ConfigText>;
  text: Record<ConfigKey, string>;
}

/** Reads every config file. The wizard only edits files that are valid to begin with. */
export const openDraft = (configDir: string): { draft: Draft; config: Config } => {
  const original = {} as Record<ConfigKey, ConfigText>;
  const text = {} as Record<ConfigKey, string>;
  const config: Partial<Record<ConfigKey, unknown>> = {};
  const problems: string[] = [];
  for (const key of KEYS) {
    const file = readConfigText(configDir, key);
    original[key] = file;
    text[key] = file.text;
    const checked = checkText(key, file.text);
    if (checked.ok) config[key] = checked.value;
    else
      for (const issue of checked.issues)
        problems.push(
          `${CONFIG_FILES[key].fileName}.jsonc ${issue.path.join('.') || '(top level)'}: ${issue.message}`,
        );
  }
  if (problems.length > 0)
    throw new SetupError(
      `The config files have problems, so setup cannot edit them safely:\n  ${problems.join('\n  ')}\nFix them (or move the file away to start from the example), then run setup again.`,
    );
  return { draft: { original, text }, config: config as Config };
};

/** The config as the draft now has it, defaults filled in. */
export const draftConfig = (draft: Draft): Config =>
  Object.fromEntries(
    KEYS.map((key) => {
      const checked = checkText(key, draft.text[key]);
      return [key, checked.ok ? checked.value : {}];
    }),
  ) as Config;

/** Whether a secret step's value is in secrets.jsonc already (never the value itself). */
export const secretStored = (step: Step, ctx: Ctx): boolean => {
  // The two Strava values are needed together, so they count together.
  if (!step.optional) return ctx.facts.stravaCredentials;
  const value = step.setting ? valueAt(ctx.config.secrets, step.setting.path) : undefined;
  return typeof value === 'string' && value !== '';
};

/** The answer a step starts from: what the config says now, else the step's default. */
export const currentAnswer = (step: Step, ctx: Ctx): unknown => {
  if (step.read) return step.read(ctx);
  // A secret is never read back, not even to show as a default.
  if (step.kind === 'secret' || step.setting?.sensitive === 'secret') return undefined;
  if (step.setting) {
    const value = valueAt(ctx.config[step.setting.file], step.setting.path);
    if (value !== undefined) return value;
  }
  if (step.default !== undefined) return step.default;
  return step.optional ? '' : undefined;
};

type Coerced = { ok: true; value: unknown } | { ok: false; error: string };
const bad = (error: string): Coerced => ({ ok: false, error });

/** An answer as typed, read from a file or sent by the page, as the value its kind holds. */
export const coerce = (step: Step, raw: unknown): Coerced => {
  const allowed = (value: unknown) =>
    step.options?.find((option) => str(option.value) === str(value));
  switch (step.kind) {
    case 'date': {
      if (typeof raw !== 'string') return bad('A date as YYYY-MM-DD.');
      const day = raw.trim();
      // Date.parse lets "2026-02-31" through as March: the day has to come back the same.
      const real =
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
        new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
      return day === '' || real ? { ok: true, value: day } : bad('A date as YYYY-MM-DD.');
    }
    case 'text':
    case 'secret': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return bad('Expected text.');
      // Whether an empty value is allowed is the schema's to say.
      return { ok: true, value: str(raw).trim() };
    }
    case 'number': {
      if (raw === '' || raw === null || raw === undefined)
        return step.optional ? { ok: true, value: '' } : bad('Expected a number.');
      const value = typeof raw === 'number' ? raw : Number(str(raw).trim());
      return Number.isFinite(value) ? { ok: true, value } : bad('Expected a number.');
    }
    case 'confirm': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      const word = str(raw).trim().toLowerCase();
      if (['y', 'yes', 'true', 'on'].includes(word)) return { ok: true, value: true };
      if (['n', 'no', 'false', 'off'].includes(word)) return { ok: true, value: false };
      return bad('Answer yes or no.');
    }
    case 'choice': {
      const option = allowed(raw);
      return option
        ? { ok: true, value: option.value }
        : bad(`Choose one of: ${step.options?.map((item) => item.value).join(', ')}.`);
    }
    case 'multi': {
      const items = Array.isArray(raw)
        ? raw
        : str(raw ?? '')
            .split(/[\s,]+/)
            .filter(Boolean);
      const values: unknown[] = [];
      for (const item of items) {
        const option = allowed(item);
        if (!option)
          return bad(
            `"${str(item)}" is not one of: ${step.options?.map((entry) => entry.value).join(', ')}.`,
          );
        if (!values.includes(option.value)) values.push(option.value);
      }
      return { ok: true, value: values };
    }
    case 'json': {
      if (typeof raw !== 'string') return { ok: true, value: raw };
      if (raw.trim() === 'default') return { ok: true, value: 'default' };
      const parsed = parseText(raw);
      return parsed.errors.length > 0
        ? bad(`Not valid JSON (${parsed.errors[0]}).`)
        : { ok: true, value: parsed.value };
    }
    case 'zones':
      if (typeof raw === 'string') {
        const parsed = parseText(raw);
        return parsed.errors.length > 0
          ? bad('Not valid JSON.')
          : { ok: true, value: parsed.value };
      }
      return { ok: true, value: raw };
    case 'location':
    case 'info':
      return { ok: true, value: raw ?? '' };
  }
};

const patchesFor = (step: Step, answer: unknown, ctx: Ctx): Patch[] => {
  if (step.map) return step.map(answer, ctx);
  if (!step.setting) return [];
  const value = step.optional && (answer === '' || answer === null) ? undefined : answer;
  return [{ file: step.setting.file, path: step.setting.path, value }];
};

/**
 * Takes one answer into the draft. Returns what is wrong with it, or undefined when it was taken
 * (and recorded in `ctx.answers`). A value equal to what the file already amounts to is not
 * written, so untouched settings leave their file byte for byte as it was.
 */
export const takeAnswer = (
  draft: Draft,
  step: Step,
  raw: unknown,
  ctx: Ctx,
): string | undefined => {
  const coerced = coerce(step, raw);
  if (!coerced.ok) return coerced.error;
  const answer = coerced.value;
  const complaint = step.check?.(answer, ctx);
  if (complaint) return complaint;
  const patches = patchesFor(step, answer, {
    ...ctx,
    answers: { ...ctx.answers, [step.id]: answer },
  });
  const next: Partial<Record<ConfigKey, string>> = {};
  for (const patch of patches) {
    const text = next[patch.file] ?? draft.text[patch.file];
    const rawNow = valueAt(parseText(text).value, patch.path);
    const checked = checkText(patch.file, text);
    const effective = checked.ok ? valueAt(checked.value, patch.path) : undefined;
    const unchanged =
      patch.value === undefined
        ? rawNow === undefined
        : sameValue(rawNow, patch.value) ||
          (rawNow === undefined && sameValue(effective, patch.value));
    if (!unchanged) next[patch.file] = patchText(text, [patch]);
  }
  for (const [key, text] of Object.entries(next) as [ConfigKey, string][]) {
    const checked = checkText(key, text);
    if (!checked.ok) {
      const issue = checked.issues[0];
      const where = issue && issue.path.length > 0 ? ` (${issue.path.join('.')})` : '';
      return `${issue?.message ?? 'Not accepted'}${where}.`;
    }
  }
  Object.assign(draft.text, next);
  ctx.answers[step.id] = answer;
  return undefined;
};

export interface Change {
  key: ConfigKey;
  /** The file name inside the config folder. */
  name: string;
  path: string;
  /** True when the real file does not exist yet. */
  created: boolean;
  /** Changed lines; secrets masked. */
  diff: string[];
}

export const draftChanges = (draft: Draft): Change[] =>
  KEYS.filter((key) => draft.text[key] !== draft.original[key].text).map((key) => ({
    key,
    name: `${CONFIG_FILES[key].fileName}.jsonc`,
    path: draft.original[key].path,
    created: draft.original[key].source !== 'file',
    diff: diffText(key, draft.original[key].text, draft.text[key]),
  }));

/** Writes every changed file: temp then rename, secrets and zones readable by the owner only. */
export const writeDraft = (draft: Draft): Change[] => {
  const changes = draftChanges(draft);
  for (const change of changes) {
    const checked = checkText(change.key, draft.text[change.key]);
    if (!checked.ok)
      throw new SetupError(`${change.name} would not be valid; nothing was written.`);
  }
  for (const change of changes) {
    writeConfigText(draft.original[change.key], draft.text[change.key]);
    draft.original[change.key] = {
      ...draft.original[change.key],
      source: 'file',
      text: draft.text[change.key],
    };
  }
  return changes;
};

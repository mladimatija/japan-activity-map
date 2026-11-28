/** Answers from a file instead of a person: `--answers`, `--yes`, and the dev checks. */
import { readFileSync } from 'node:fs';

import { SetupError } from './engine.ts';
import { parseText } from './jsonc.ts';
import { type Prompter, type Question, say } from './prompt.ts';

/** Reads an answers file: JSONC, an object keyed by step id. Secrets in it are refused. */
export const readAnswers = (path: string): Record<string, unknown> => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new SetupError(`Cannot read the answers file ${path}.`);
  }
  const { value, errors } = parseText(text);
  if (errors.length > 0 || value === null || typeof value !== 'object' || Array.isArray(value))
    throw new SetupError(
      `${path} is not a JSON object of answers${errors[0] ? ` (${errors[0]})` : ''}.`,
    );
  const answers = value as Record<string, unknown>;
  const secret = Object.keys(answers).find((key) => /secret|clientid|token|apikey/i.test(key));
  if (secret)
    throw new SetupError(
      `The answers file must not hold secrets ("${secret}"). Give them in the environment (JAM_STRAVA_CLIENT_ID, JAM_STRAVA_CLIENT_SECRET, JAM_GARMIN_API_KEY and the like), or with --secrets-stdin.`,
    );
  return answers;
};

export const scriptedPrompter = (answers: Record<string, unknown>): Prompter => ({
  interactive: false,
  say,
  // A secret never comes from here; the wizard takes it from the environment or stdin.
  ask: (question: Question) =>
    Promise.resolve(question.kind === 'secret' ? undefined : answers[question.id]),
});

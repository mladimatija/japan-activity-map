/** How the wizard asks: one interface, a terminal and a scripted implementation. */
import type { Kind, Option } from './types.ts';

export interface Question {
  id: string;
  kind: Kind;
  title: string;
  help?: string;
  options?: Option[];
  /** What an empty answer means. Never set for a secret. */
  default?: unknown;
  optional?: boolean;
  /** For a secret: one is stored already, so an empty answer keeps it. */
  stored?: boolean;
}

export interface Prompter {
  /** False when nobody is there to ask again: a wrong answer then ends the run. */
  readonly interactive: boolean;
  /** Wizard output. Goes to the terminal only, never to the log file. */
  say(text: string): void;
  /** The answer as given; undefined means "keep what is there". */
  ask(question: Question): Promise<unknown>;
}

export const say = (text: string): void => {
  process.stdout.write(`${text}\n`);
};

/** An answer in the form someone can read back: on/off, a list, compact JSON. */
export const shown = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item !== 'object'))
    return value.join(', ');
  return JSON.stringify(value);
};

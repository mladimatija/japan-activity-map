/** Questions in a terminal, with node:readline only. Secrets are read without being shown. */
import { createInterface } from 'node:readline/promises';

import { SetupError } from './engine.ts';
import { type Prompter, type Question, say, shown } from './prompt.ts';

const INTERRUPTED = 'Stopped. Your answers so far are kept; run `pnpm jam setup` to continue.';

/** One line from the terminal. A fresh interface each time, so hidden input can use raw mode between. */
const line = async (prompt: string): Promise<string> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise<string>((resolve, reject) => {
      rl.on('SIGINT', () => reject(new SetupError(INTERRUPTED)));
      rl.on('close', () => reject(new SetupError(INTERRUPTED)));
      rl.question(prompt).then(resolve, reject);
    });
  } finally {
    rl.close();
  }
};

/** A line typed without being shown: nothing is echoed, not even stars. */
const hidden = (prompt: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const finish = (outcome: () => void) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      outcome();
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n' || char === '\u0004') {
          finish(() => resolve(value));
          return;
        }
        if (char === '\u0003') {
          finish(() => reject(new SetupError(INTERRUPTED)));
          return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });

const numbered = (question: Question): void => {
  (question.options ?? []).forEach((option, index) => {
    say(`  ${index + 1}. ${option.label}${option.help ? `: ${option.help}` : ''}`);
  });
};

/** "2" or "2, 3" as option values; anything else is passed on for the wizard to judge. */
const picked = (question: Question, typed: string): unknown[] =>
  typed
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => {
      const option = /^\d+$/.test(part) ? question.options?.[Number(part) - 1] : undefined;
      return option ? option.value : part;
    });

export const ttyPrompter = (): Prompter => ({
  interactive: true,
  say,
  ask: async (question: Question): Promise<unknown> => {
    say('');
    if (question.help) say(question.help);
    const current = shown(question.default);
    switch (question.kind) {
      case 'info':
        say(question.title);
        return undefined;
      case 'secret': {
        const typed = await hidden(
          `${question.title}${question.stored ? ' (Enter keeps the stored one)' : ''}: `,
        );
        return typed === '' ? undefined : typed;
      }
      case 'confirm': {
        const typed = await line(
          `${question.title} [${question.default === false ? 'y/N' : 'Y/n'}]: `,
        );
        return typed.trim() === '' ? undefined : typed;
      }
      case 'choice': {
        say(question.title);
        numbered(question);
        const at = (question.options ?? []).findIndex(
          (option) => option.value === question.default,
        );
        const typed = await line(`Choose${at >= 0 ? ` [${at + 1}]` : ''}: `);
        return typed.trim() === '' ? undefined : picked(question, typed)[0];
      }
      case 'multi': {
        say(question.title);
        numbered(question);
        const typed = await line(
          `Numbers, separated by commas; "none" for none${current ? ` [${current}]` : ''}: `,
        );
        if (typed.trim() === '') return undefined;
        return typed.trim().toLowerCase() === 'none' ? [] : picked(question, typed);
      }
      default: {
        const keep = question.stored ? ' (Enter keeps the stored one)' : '';
        const typed = await line(`${question.title}${keep}${current ? ` [${current}]` : ''}: `);
        if (typed.trim() !== '') return typed;
        // Enter alone keeps the value; the wizard reads "-" as emptying an optional one.
        return undefined;
      }
    }
  },
});

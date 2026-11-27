/** Running another program and reading what it prints, line by line: one place for all of it. */
import { type ChildProcess, spawn } from 'node:child_process';

import { errorText } from './errors.ts';
import { ROOT_DIR } from './paths.ts';

export interface RunOptions {
  /** Where it runs (default: the repository). */
  cwd?: string;
  /** Its whole environment (default: this process's). */
  env?: NodeJS.ProcessEnv;
  /** Values replaced by [hidden] in every line before anyone sees it. */
  secrets?: readonly string[];
  /** Called with each line it prints, on either stream, secrets already replaced. */
  onLine?: (line: string) => void;
  /** Called once it is running, for a caller that may want to stop it. */
  onStart?: (child: ChildProcess) => void;
}

export interface RunResult {
  code: number;
  /** Everything it printed, secrets replaced. */
  text: string;
  /** The program itself was not found. */
  missing: boolean;
}

/** Runs a program to its end. Never rejects: a program that cannot start is a result too. */
export const runLines = (
  file: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> =>
  new Promise((resolve) => {
    const secrets = (options.secrets ?? []).filter((secret) => secret.length >= 4);
    const hide = (text: string): string =>
      secrets.reduce((shown, secret) => shown.replaceAll(secret, '[hidden]'), text);
    let text = '';
    let settled = false;
    const finish = (result: Omit<RunResult, 'text'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...result, text });
    };
    let child: ChildProcess;
    try {
      child = spawn(file, args, {
        cwd: options.cwd ?? ROOT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env ?? process.env,
      });
    } catch (error) {
      text = `${hide(errorText(error))}\n`;
      finish({ code: 1, missing: false });
      return;
    }
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      let rest = '';
      const write = (line: string) => {
        const shown = hide(line).trimEnd();
        text += `${shown}\n`;
        options.onLine?.(shown);
      };
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        const parts = (rest + chunk).split('\n');
        rest = parts.pop() ?? '';
        for (const line of parts) write(line);
      });
      stream.on('end', () => {
        if (rest) write(rest);
      });
    }
    options.onStart?.(child);
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') text += `${hide(error.message)}\n`;
      finish({ code: 1, missing: error.code === 'ENOENT' });
    });
    child.on('close', (code) => finish({ code: code ?? 1, missing: false }));
  });

/** pnpm as this platform starts it. */
export const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

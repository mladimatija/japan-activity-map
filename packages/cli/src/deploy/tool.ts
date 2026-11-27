/**
 * Runs a host's own uploader (Cloudflare's wrangler, Netlify's CLI) as a separate program. A
 * token reaches it in its environment only: never as an argument (other programs on the machine
 * can read those) and never in a line this command prints or logs.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Logger } from '../logger.ts';
import { PNPM, type RunResult, runLines } from '../process.ts';

export interface Tool {
  /** The npm package and release line, for example wrangler@4. */
  package: string;
}

/** The release lines the commands in hosts.ts were written against. */
export const WRANGLER: Tool = { package: 'wrangler@4' };
export const NETLIFY: Tool = { package: 'netlify-cli@27' };

/**
 * Stand-ins for the dev checks, which run the command as a program of its own and so can only
 * reach it through its environment: JAM_DEPLOY_STAND_INS names a JSON file of
 * { "<package>": "<script to run instead>", "github": "<a repository folder to push to>" }.
 * A stand-in is announced every time it is used, and the GitHub one must be a folder on this
 * computer: a stray variable can never send a real upload somewhere else unnoticed.
 */
export const standIn = (key: string, log: Logger): string | undefined => {
  const file = process.env.JAM_DEPLOY_STAND_INS;
  if (!file) return undefined;
  let value: unknown;
  try {
    value = (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
  if (typeof value !== 'string' || !existsSync(value)) return undefined;
  log.warn(`Using a stand-in for ${key} (${value}): nothing is really uploaded.`);
  return value;
};

export interface ToolRun {
  args: string[];
  /** Added to the environment: the credentials. */
  env: Record<string, string>;
  /** Values replaced in everything shown or logged. */
  secrets: string[];
  /** Where it runs (default: the repository). */
  cwd?: string;
}

/** Runs the tool, passing its lines on, and returns its exit code and output. */
export const runTool = async (tool: Tool, run: ToolRun, log: Logger): Promise<RunResult> => {
  const stub = standIn(tool.package, log);
  const programs = stub
    ? [{ file: process.execPath, args: [stub] }]
    : [
        { file: PNPM, args: ['dlx', tool.package] },
        // npm comes with Node, so this one is there even where pnpm is not on the PATH (a
        // scheduled run).
        {
          file: join(dirname(process.execPath), process.platform === 'win32' ? 'npx.cmd' : 'npx'),
          args: ['--yes', tool.package],
        },
      ];
  const env = {
    ...process.env,
    ...run.env,
    // Nobody is there to answer a question.
    CI: '1',
    WRANGLER_SEND_METRICS: 'false',
    NETLIFY_CLI_DISABLE_VERSION_CHECK: 'true',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
  for (const program of programs) {
    const result = await runLines(program.file, [...program.args, ...run.args], {
      ...(run.cwd ? { cwd: run.cwd } : {}),
      env,
      secrets: run.secrets,
      onLine: (line) => {
        if (line.trim()) log.info(`  ${line}`);
      },
    });
    if (!result.missing) return result;
  }
  return {
    code: 1,
    missing: true,
    text: `Neither pnpm nor npx was found to run ${tool.package} with. Run this from a terminal where \`pnpm\` works.\n`,
  };
};

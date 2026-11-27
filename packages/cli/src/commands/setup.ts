import { SetupError } from '../setup/engine.ts';
import { readAnswers, scriptedPrompter } from '../setup/prompt-script.ts';
import { ttyPrompter } from '../setup/prompt-tty.ts';
import { groupNamed } from '../setup/steps.ts';
import { runWizard, type WizardOptions } from '../setup/wizard.ts';
import type { Command, CommandContext } from './types.ts';

/** Where a secret may come from when nobody types it: the environment, or stdin as NAME=value lines. */
const SECRET_NAMES: Record<string, string> = {
  JAM_STRAVA_CLIENT_ID: 'strava.clientId',
  JAM_STRAVA_CLIENT_SECRET: 'strava.clientSecret',
  JAM_CLOUDFLARE_API_TOKEN: 'deploy.apiToken',
  JAM_CLOUDFLARE_ACCOUNT_ID: 'deploy.accountId',
  JAM_NETLIFY_TOKEN: 'deploy.netlifyToken',
};

const readStdin = async (): Promise<string> => {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
};

const secretsFrom = async (fromStdin: boolean): Promise<Record<string, string>> => {
  const secrets: Record<string, string> = {};
  for (const [name, id] of Object.entries(SECRET_NAMES)) {
    const value = process.env[name];
    if (value) secrets[id] = value;
  }
  if (fromStdin) {
    if (process.stdin.isTTY)
      throw new SetupError(
        '--secrets-stdin reads NAME=value lines from a pipe, for example from a password manager.',
      );
    for (const row of (await readStdin()).split('\n')) {
      const at = row.indexOf('=');
      const id = at > 0 ? SECRET_NAMES[row.slice(0, at).trim()] : undefined;
      if (id && row.slice(at + 1).trim()) secrets[id] = row.slice(at + 1).trim();
    }
  }
  return secrets;
};

const setup = async (context: CommandContext): Promise<number> => {
  const { log, options, args } = context;
  try {
    if (options.web === true) {
      const { serveSetup } = await import('../setup/server.ts');
      return await serveSetup(context);
    }
    if (args.length > 1 || (args.length === 1 && options.change !== true))
      throw new SetupError('`setup` takes one argument at most: the group after --change.');
    const modes = ['change', 'full', 'quick'].filter((name) => options[name] === true);
    if (modes.length > 1) throw new SetupError(`Choose one of --${modes.join(', --')}.`);
    const only =
      typeof options.only === 'string'
        ? options.only
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
        : undefined;
    const unknown = only?.find((name) => !groupNamed(name));
    if (unknown) throw new SetupError(`--only: no group "${unknown}".`);

    const answers = typeof options.answers === 'string' ? readAnswers(options.answers) : undefined;
    const scripted = answers !== undefined || options.yes === true;
    if (!scripted && (!process.stdin.isTTY || !process.stdout.isTTY))
      throw new SetupError(
        'Setup asks questions, and this is not a terminal. Give the answers in a file (--answers <file>), accept every default (--yes), or open the page (--web). See docs/setup.md.',
      );
    const start = answers?.start;
    const wizard: WizardOptions = {
      yes: options.yes === true,
      noRun: options['no-run'] === true,
      secrets: await secretsFrom(options['secrets-stdin'] === true),
      ...(modes[0]
        ? { start: modes[0] as 'change' | 'full' | 'quick' }
        : start === 'demo' || start === 'quick' || start === 'full' || start === 'change'
          ? { start }
          : scripted
            ? { start: 'quick' as const }
            : {}),
      ...(args[0] ? { changeGroup: args[0] } : {}),
      ...(only ? { only: only.map((name) => groupNamed(name) ?? name) } : {}),
      ...(scripted ? { answers: answers ?? {} } : {}),
    };
    return await runWizard(
      wizard,
      scripted ? scriptedPrompter(answers ?? {}) : ttyPrompter(),
      context,
    );
  } catch (error) {
    if (error instanceof SetupError) {
      log.error(error.message);
      return 1;
    }
    throw error;
  }
};

export const setupCommand: Command = {
  name: 'setup',
  summary: 'Set the project up step by step, or change its settings',
  args: {
    usage: '[group]',
    help: [
      'Asks a few questions, writes the config files and runs the first sync and build.',
      'Without flags it offers demo data, a quick setup, a full setup or changing one group.',
      'With --change, the group to change may follow: site, map, views, publish, output, strava,',
      'sheet, privacy, matching, routeGrouping, routes, deploy. Secrets are typed hidden or come',
      'from JAM_STRAVA_CLIENT_ID and JAM_STRAVA_CLIENT_SECRET; they are never flags. See docs/setup.md.',
    ].join('\n'),
  },
  options: {
    quick: { type: 'boolean', description: 'Quick setup: about nine questions' },
    full: { type: 'boolean', description: 'Full setup: every setting' },
    change: { type: 'boolean', description: 'Change one group of settings' },
    only: { type: 'string', value: 'groups', description: 'Only these groups, comma-separated' },
    answers: {
      type: 'string',
      value: 'file',
      description: 'Take answers from a JSONC file instead of asking',
    },
    yes: { type: 'boolean', description: 'Do not ask: defaults for anything unanswered, and run' },
    'no-run': { type: 'boolean', description: 'Write the config only; run nothing' },
    'secrets-stdin': { type: 'boolean', description: 'Read NAME=value secret lines from stdin' },
    web: { type: 'boolean', description: 'Open the setup page in a browser instead' },
  },
  run: setup,
};

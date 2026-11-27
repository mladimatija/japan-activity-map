#!/usr/bin/env node
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { COMMANDS, findCommand } from './commands/index.ts';
import type { Command } from './commands/types.ts';
import { JamError, errorText } from './errors.ts';
import { createLogger } from './logger.ts';
import { DEFAULT_CONFIG_DIR, LOG_DIR } from './paths.ts';

const OPTIONS = {
  'dry-run': { type: 'boolean', default: false },
  verbose: { type: 'boolean', short: 'v', default: false },
  config: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} as const;

const FLAGS_HELP = `Flags:
  --dry-run         Report what would change without writing anything
  -v, --verbose     Show debug output (always written to the log file)
  --config <dir>    Folder with the config files (default: config/)
  -h, --help        Show help`;

const usage = (): string => {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  const lines = COMMANDS.map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
  return `Usage: jam <command> [flags]\n\nCommands:\n${lines.join('\n')}\n\n${FLAGS_HELP}\n`;
};

const commandHelp = (command: Command): string => {
  const args = command.args ? ` ${command.args.usage}` : '';
  const details = command.args ? `\n\n${command.args.help}` : '';
  const own = Object.entries(command.options ?? {}).map(([name, option]) => {
    const flag = `--${name}${option.value ? ` <${option.value}>` : ''}`;
    return `  ${flag.padEnd(16)}  ${option.description}`;
  });
  const options = own.length > 0 ? `\n\nOptions:\n${own.join('\n')}` : '';
  return `Usage: jam ${command.name}${args} [flags]\n\n${command.summary}.${details}${options}\n\n${FLAGS_HELP}\n`;
};

const main = async (argv: string[]): Promise<number> => {
  // A first, lenient pass finds the command, so its own options can join the strict pass.
  const loose = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: false });
  const found = findCommand(loose.positionals);
  const own = Object.fromEntries(
    Object.entries(found?.command.options ?? {}).map(([name, option]) => [
      name,
      { type: option.type },
    ]),
  );
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ...OPTIONS, ...own },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    process.stderr.write(`error: ${errorText(error)}\n\n${usage()}`);
    return 1;
  }
  const { values, positionals } = parsed;

  if (positionals.length === 0) {
    (values.help ? process.stdout : process.stderr).write(usage());
    return values.help ? 0 : 1;
  }

  const match = findCommand(positionals);
  if (!match) {
    process.stderr.write(`error: unknown command "${positionals.join(' ')}"\n\n${usage()}`);
    return 1;
  }
  if (match.rest.length > 0 && !match.command.args) {
    process.stderr.write(
      `error: unexpected argument "${match.rest.join(' ')}"\n\n${commandHelp(match.command)}`,
    );
    return 1;
  }
  if (values.help) {
    process.stdout.write(commandHelp(match.command));
    return 0;
  }

  const log = createLogger({
    verbose: values.verbose,
    logDir: LOG_DIR,
    command: match.command.name,
  });
  const flags = {
    dryRun: values['dry-run'],
    verbose: values.verbose,
    configDir: resolve(values.config ?? DEFAULT_CONFIG_DIR),
  };
  // Which options were given, never their values or the arguments: those hold file paths and
  // activity ids, and one day could hold a secret. The log is personal data as it is.
  const given = argv.filter((arg) => arg.startsWith('-')).map((arg) => arg.split('=')[0]);
  log.debug(`options: ${given.length > 0 ? given.join(' ') : 'none'}`);
  log.debug(`log file: ${log.logFile}`);

  try {
    const options = Object.fromEntries(
      Object.keys(match.command.options ?? {}).map((name) => [
        name,
        (values as Record<string, string | boolean | undefined>)[name],
      ]),
    );
    return await match.command.run({ flags, log, args: match.rest, options });
  } catch (error) {
    // Errors the user can act on print as a sentence; anything else keeps its stack.
    if (error instanceof JamError) {
      log.error(error.message);
      if (error.stack) log.debug(error.stack);
    } else {
      log.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
    return 1;
  }
};

// Output piped into `head` or similar closes early; that is not an error.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw error;
  });
}

process.exitCode = await main(process.argv.slice(2));

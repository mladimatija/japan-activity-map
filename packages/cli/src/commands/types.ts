import type { Logger } from '../logger.ts';

export interface GlobalFlags {
  /** Report what would change without writing anything. */
  dryRun: boolean;
  verbose: boolean;
  /** Absolute path of the folder holding the config files. */
  configDir: string;
}

export interface CommandContext {
  flags: GlobalFlags;
  log: Logger;
  /** Positional arguments after the command name, for commands that take them. */
  args: string[];
  /** Values of the command's own options (see Command.options). */
  options: Record<string, string | boolean | undefined>;
}

/** A command's own flag, for example --if-stale 7d. */
export interface CommandOption {
  type: 'string' | 'boolean';
  description: string;
  /** Shown in help after the flag name, for string options. */
  value?: string;
}

export interface Command {
  /** One or two words, for example "status" or "sync strava". */
  name: string;
  summary: string;
  /** Set for commands that take positional arguments. */
  args?: { usage: string; help: string };
  /** Flags only this command understands. */
  options?: Record<string, CommandOption>;
  /** Returns the process exit code. */
  run(context: CommandContext): number | Promise<number>;
}

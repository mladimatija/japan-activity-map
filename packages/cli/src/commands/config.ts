import { ConfigError, loadConfig } from '../config.ts';
import type { CommandContext } from './types.ts';

/**
 * The config for a command, or undefined after saying what is wrong with it (the command then exits
 * with 1). Errors other than a broken config file are not this function's to explain.
 */
export const configFor = ({ flags, log }: Pick<CommandContext, 'flags' | 'log'>) => {
  try {
    return loadConfig(flags.configDir).config;
  } catch (error) {
    if (error instanceof ConfigError) {
      log.error(`${error.message}. Run \`pnpm jam status\` for details.`);
      return undefined;
    }
    throw error;
  }
};

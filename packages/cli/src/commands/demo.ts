import { clearDemo, demoOptions, runDemo } from '../demo/index.ts';
import type { CommandContext } from './types.ts';

/** Today in Japan, where the made-up athlete lives: the default last day of the history. */
const todayInJapan = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

/** `jam demo`: a made-up history in its own folder, built into a site; `--clear` removes it. */
export const demoCommand = async ({ flags, log, options }: CommandContext): Promise<number> => {
  if (options.clear === true) return clearDemo(log, { dryRun: flags.dryRun });
  const parsed = demoOptions(options, todayInJapan());
  if (typeof parsed === 'string') {
    log.error(parsed);
    return 1;
  }
  return runDemo(parsed, log, { dryRun: flags.dryRun });
};

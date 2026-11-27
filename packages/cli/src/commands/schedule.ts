/**
 * `jam schedule`: writes what runs `jam update` once a week, for the user to install: a launchd
 * job on a Mac, a crontab line elsewhere. Installing it is theirs to do; nothing outside data/
 * is touched.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { DATA_DIR, ROOT_DIR, shownPath } from '../paths.ts';
import type { CommandContext } from './types.ts';

const MAIN = join(ROOT_DIR, 'packages/cli/src/main.ts');
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LABEL = 'com.japan-activity-map.update';
const xml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const scheduleCommand = (context: CommandContext): number => {
  const { log, flags, options } = context;
  const dayName = typeof options.day === 'string' ? options.day.toLowerCase().slice(0, 3) : 'sun';
  const day = DAYS.indexOf(dayName);
  const at = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(
    typeof options.at === 'string' ? options.at : '06:30',
  );
  if (day < 0 || !at) {
    log.error('--day takes sun, mon, tue, wed, thu, fri or sat, and --at a time such as 06:30.');
    return 1;
  }
  const [hour, minute] = [Number(at[1]), Number(at[2])];
  const node = process.execPath;
  // A scheduled job starts with almost no PATH: Node's own folder for npx, and today's for pnpm.
  const path = [...new Set([dirname(node), ...(process.env.PATH ?? '').split(delimiter)])]
    .filter(Boolean)
    .join(delimiter);
  const logFile = join(DATA_DIR, 'logs', 'update.log');
  const config = ['--config', flags.configDir];
  const when = `every ${DAYS[day]} at ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  if (options.cron === true || process.platform !== 'darwin') {
    // In a crontab a bare % ends the command, so it is escaped as well as quoted.
    const quote = (text: string) => `'${text.replaceAll("'", "'\\''").replaceAll('%', '\\%')}'`;
    const line = `${minute} ${hour} * * ${day} PATH=${quote(path)} ${quote(node)} ${quote(MAIN)} ${config.map(quote).join(' ')} update >> ${quote(logFile)} 2>&1`;
    log.info(`A crontab line that runs \`jam update\` ${when} (this computer's time):`);
    log.info('');
    log.info(line);
    log.info('');
    log.info(
      'Add it with `crontab -e`. Remove the line to stop. The computer has to be on at that time.',
    );
    return 0;
  }

  const strings = (values: string[]) =>
    values.map((value) => `    <string>${xml(value)}</string>`).join('\n');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings([node, MAIN, ...config, 'update'])}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(ROOT_DIR)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(path)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>${day}</integer>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
  const file = join(DATA_DIR, 'schedule', `${LABEL}.plist`);
  if (flags.dryRun) {
    log.info(
      `Dry run: would write ${shownPath(file)}, a launchd job running \`jam update\` ${when}.`,
    );
    return 0;
  }
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
  writeFileSync(file, plist);
  log.info(`Wrote ${shownPath(file)}: a launchd job that runs \`jam update\` ${when}.`);
  log.info('If the Mac is asleep then, it runs when the Mac next wakes. To install it:');
  log.info(`  cp "${file}" ~/Library/LaunchAgents/`);
  log.info(`  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${LABEL}.plist`);
  log.info('To run it once now, and to see what it did:');
  log.info(`  launchctl kickstart gui/$(id -u)/${LABEL}`);
  log.info(`  tail -n 40 "${logFile}"`);
  log.info('To stop it:');
  log.info(`  launchctl bootout gui/$(id -u)/${LABEL} && rm ~/Library/LaunchAgents/${LABEL}.plist`);
  log.info('After moving the repository or changing Node, run this command and install again.');
  return 0;
};

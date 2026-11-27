import { shownPath, STORE_FILE } from '../paths.ts';
import { backupDatabase, listBackups } from '../store/backups.ts';
import { openStore } from '../store/store.ts';
import type { CommandContext } from './types.ts';

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const backup = async ({ flags, log }: CommandContext): Promise<number> => {
  if (flags.dryRun) {
    log.info(`Would copy ${shownPath(STORE_FILE)} to data/backups/.`);
    return 0;
  }
  const store = await openStore(log);
  try {
    const path = await backupDatabase(store.db, 'manual');
    const file = listBackups().find((entry) => entry.path === path);
    log.info(`Copied the store to ${shownPath(path)}${file ? ` (${size(file.bytes)})` : ''}.`);
  } finally {
    store.close();
  }
  const all = listBackups();
  log.info(
    `${all.length} backups in data/backups (${all.filter((file) => !file.automatic).length} manual; automatic ones are pruned to the newest 20).`,
  );
  log.info('To restore one, stop any running jam command and copy it over data/jam.sqlite.');
  return 0;
};

import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { BACKUP_DIR } from '../paths.ts';
import type { Database } from './sqlite.ts';

/** Automatic copies kept per reason; manual ones are never removed. */
const KEEP_AUTOMATIC = 20;

type BackupReason = 'manual' | `before-migration-${string}` | `before-wipe-${string}`;

const stamp = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
};

interface BackupFile {
  name: string;
  path: string;
  bytes: number;
  automatic: boolean;
}

export const listBackups = (): BackupFile[] => {
  let names: string[];
  try {
    names = readdirSync(BACKUP_DIR);
  } catch {
    return [];
  }
  return (
    names
      .filter((name) => /^jam-\d{8}-\d{6}-.+\.sqlite$/.test(name))
      .map((name) => {
        const path = join(BACKUP_DIR, name);
        const stat = statSync(path);
        return {
          name,
          path,
          bytes: stat.size,
          automatic: !/-manual(-\d+)?\.sqlite$/.test(name),
          time: stat.mtimeMs,
        };
      })
      // Oldest first, by when the copy was written; names alone sort "-2" copies wrongly.
      .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name))
      .map(({ time: _time, ...file }) => file)
  );
};

/** Copies the open database to data/backups and returns the copy's path. */
export const backupDatabase = async (db: Database, reason: BackupReason): Promise<string> => {
  mkdirSync(BACKUP_DIR, { recursive: true });
  let path = join(BACKUP_DIR, `jam-${stamp()}-${reason}.sqlite`);
  // Two copies in the same second get a counter rather than overwrite each other.
  for (let n = 2; listBackups().some((file) => file.path === path); n++) {
    path = join(BACKUP_DIR, `jam-${stamp()}-${reason}-${n}.sqlite`);
  }
  await db.copyTo(path);
  pruneAutomatic();
  return path;
};

const pruneAutomatic = (): void => {
  const automatic = listBackups().filter((file) => file.automatic);
  for (const file of automatic.slice(0, Math.max(0, automatic.length - KEEP_AUTOMATIC))) {
    rmSync(file.path, { force: true });
  }
};

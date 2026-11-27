import { isAbsolute, relative, resolve } from 'node:path';

/** Repository root, found from this file's location so commands work from any directory. */
export const ROOT_DIR = resolve(import.meta.dirname, '../../..');
export const DEFAULT_CONFIG_DIR = resolve(ROOT_DIR, 'config');
/**
 * Local store, logs and backups. Git-ignored; nothing here is ever published.
 * JAM_DATA_DIR points it elsewhere, for trying commands against the fake Strava server.
 */
export const DATA_DIR = process.env.JAM_DATA_DIR
  ? resolve(process.env.JAM_DATA_DIR)
  : resolve(ROOT_DIR, 'data');
export const LOG_DIR = resolve(DATA_DIR, 'logs');
/** The local SQLite store. */
export const STORE_FILE = resolve(DATA_DIR, 'jam.sqlite');
/** Copies of the store, automatic (before a migration or wipe) and manual (`jam backup`). */
export const BACKUP_DIR = resolve(DATA_DIR, 'backups');
/**
 * Everything of the demo (`jam demo`): its own store, config, generated sheet and tracks, and its
 * build. Inside the git-ignored data/ whatever JAM_DATA_DIR says; JAM_DEMO_DIR points it
 * elsewhere, for the dev checks.
 */
export const DEMO_DIR = process.env.JAM_DEMO_DIR
  ? resolve(process.env.JAM_DEMO_DIR)
  : resolve(ROOT_DIR, 'data/demo');

/** A path for messages: relative to the repository when inside it, absolute otherwise. */
export const shownPath = (path: string): string => {
  const inside = relative(ROOT_DIR, path);
  return inside === '' ? '.' : inside.startsWith('..') || isAbsolute(inside) ? path : inside;
};

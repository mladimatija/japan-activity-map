/**
 * How demo data is told from real data. The demo store carries a row in its `meta` table; the
 * build copies it into meta.json as `demo: true`; the demo folder carries a file of its own, so
 * `jam demo --clear` can tell a demo folder even when its store was never made.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { STORE_FILE } from '../paths.ts';
import { Database } from '../store/sqlite.ts';

export interface DemoMarker {
  demo: true;
  /** Version of the generator that wrote the history. */
  generator: number;
  seed: number;
  until: string;
  years: number;
  lang: string;
}

const META_KEY = 'demo';
/** The marker file at the top of a demo folder. */
export const MARKER_FILE = 'demo.json';

const parse = (text: string | undefined): DemoMarker | undefined => {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as Partial<DemoMarker>;
    return value.demo === true ? (value as DemoMarker) : undefined;
  } catch {
    return undefined;
  }
};

/** Whether a meta.json (its text) says the build is of demo data. Anything unreadable is not. */
export const saysDemo = (metaText: string): boolean => {
  try {
    return (JSON.parse(metaText) as { demo?: unknown }).demo === true;
  } catch {
    return false;
  }
};

/** Whether the build in a data folder is of demo data; false when there is no build there. */
export const isDemoBuild = (dataDir: string): boolean => {
  const file = join(dataDir, 'meta.json');
  return existsSync(file) && saysDemo(readFileSync(file, 'utf8'));
};

/** The marker of an open store, if it is a demo store. */
export const storeMarker = (db: Database): DemoMarker | undefined =>
  parse(db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [META_KEY])?.value);

export const writeStoreMarker = (db: Database, marker: DemoMarker): void => {
  db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
    META_KEY,
    JSON.stringify(marker),
  ]);
};

/** The marker of the store a command would open, without creating or changing the store. */
export const currentStoreMarker = (path = STORE_FILE): DemoMarker | undefined => {
  if (!existsSync(path)) return undefined;
  let db: Database | undefined;
  try {
    db = new Database(path, { readOnly: true });
    return storeMarker(db);
  } catch {
    // Not a store this version can read: then it is not a demo store either.
    return undefined;
  } finally {
    db?.close();
  }
};

/** The marker file of a folder, if the folder is a demo folder. */
export const folderMarker = (dir: string): DemoMarker | undefined => {
  const file = join(dir, MARKER_FILE);
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : undefined;
};

/** One sentence for commands that must not run against made-up data. */
export const demoRefusal = (what: string): string =>
  `This is the demo store (made-up data), so ${what}. Run the command without JAM_DATA_DIR to use your own data; \`pnpm jam demo --clear\` removes the demo.`;

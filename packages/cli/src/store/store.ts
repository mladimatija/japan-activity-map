import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, relative } from 'node:path';

import type { Logger } from '../logger.ts';
import { ROOT_DIR, STORE_FILE } from '../paths.ts';
import { newSalt } from './ids.ts';
import { type MigrationState, loadMigrations, migrate, migrationState } from './migrate.ts';
import { Database } from './sqlite.ts';

export { Database } from './sqlite.ts';

export interface Store {
  db: Database;
  path: string;
  /** True when this call created the database file. */
  created: boolean;
  /** Migrations applied while opening. */
  applied: string[];
  /** Copy taken before those migrations, if any. */
  backup?: string;
  /** The secret used for public ids. */
  salt: string;
  close(): void;
}

const label = (version: number, name: string) => `${String(version).padStart(4, '0')}-${name}`;

/** Opens the store, creating it and applying pending migrations first. */
export const openStore = async (log: Logger, path = STORE_FILE): Promise<Store> => {
  const created = !existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    const result = await migrate(db);
    if (created) log.info(`Created the local store at ${relative(ROOT_DIR, path)}`);
    // The copy is taken before the first migration runs, so it is reported first.
    if (result.backup)
      log.info(`Copied the store to ${relative(ROOT_DIR, result.backup)} before migrating`);
    for (const migration of result.applied)
      log.info(`Applied migration ${label(migration.version, migration.name)}`);

    let salt = db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'id_salt'`)?.value;
    if (!salt) {
      salt = newSalt();
      db.run(`INSERT INTO meta (key, value) VALUES ('id_salt', ?)`, [salt]);
      log.debug('Generated the secret for public ids');
    }
    return {
      db,
      path,
      created,
      applied: result.applied.map((migration) => label(migration.version, migration.name)),
      ...(result.backup ? { backup: result.backup } : {}),
      salt,
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
};

interface StoreInspection {
  exists: boolean;
  path: string;
  bytes?: number;
  state?: MigrationState;
  known: number;
}

/** Looks at the store without changing it, for --dry-run. */
export const inspectStore = (path = STORE_FILE): StoreInspection => {
  const migrations = loadMigrations();
  if (!existsSync(path)) return { exists: false, path, known: migrations.length };
  const db = new Database(path, { readOnly: true });
  try {
    return {
      exists: true,
      path,
      bytes: statSync(path).size,
      state: migrationState(db, migrations, true),
      known: migrations.length,
    };
  } finally {
    db.close();
  }
};

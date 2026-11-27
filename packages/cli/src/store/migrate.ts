import { createHash } from 'node:crypto';
import { copyFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import { ROOT_DIR } from '../paths.ts';

import { backupDatabase } from './backups.ts';
import type { Database } from './sqlite.ts';
import { JamError, errorText } from '../errors.ts';

const MIGRATIONS_DIR = join(import.meta.dirname, 'migrations');

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Of its statements (statementsOf). */
  checksum: string;
  /** Other checksums a store may hold for the same statements. */
  accepted: string[];
}

class MigrationError extends JamError {
  readonly backup: string | undefined;
  constructor(message: string, backup?: string) {
    super(message);
    this.name = 'MigrationError';
    this.backup = backup;
  }
}

/**
 * A migration's checksum covers its statements, not its comments: rewording a comment changes
 * nothing a store applied. Stores made before that rule hold a checksum of the whole file, so a
 * file's whole-text checksum is accepted too, and so are these, the whole-text checksums of the
 * three files whose comments were reworded since.
 */
const WHOLE_TEXT_BEFORE: Record<string, string[]> = {
  matching: ['eefcdefe3441eaa003d15a2d944fdad68bc52c1230f2f64347500acb2c91315c'],
  'route-groups': ['5e9b805db3d9d6c9066355c52c764b106978f0d293bbd8df68da1d63a6704a53'],
  'privacy-offsets': ['6dab47cd5f2a29d8759b9c4961b0d782d39bb872efa76b265c28b085f941dc1d'],
};

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The SQL without comment lines, trailing comments, blank lines and indentation. */
export const statementsOf = (sql: string): string =>
  sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, '').trim())
    .filter(Boolean)
    .join('\n');

/** Migration files, named 0001-initial.sql and so on, in order. */
export const loadMigrations = (dir = MIGRATIONS_DIR): Migration[] => {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const match = /^(\d{4})-([a-z0-9-]+)\.sql$/.exec(file);
      if (!match?.[1] || !match[2]) throw new MigrationError(`Badly named migration file: ${file}`);
      const sql = readFileSync(join(dir, file), 'utf8');
      return {
        version: Number(match[1]),
        name: match[2],
        sql,
        checksum: sha(statementsOf(sql)),
        accepted: [sha(sql), ...(WHOLE_TEXT_BEFORE[match[2]] ?? [])],
      };
    });
  migrations.forEach((migration, i) => {
    if (migration.version !== i + 1) {
      throw new MigrationError(
        `Migrations must be numbered 0001, 0002, … without gaps; found ${String(migration.version).padStart(4, '0')} at position ${i + 1}`,
      );
    }
  });
  return migrations;
};

const BOOKKEEPING = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
) STRICT;`;

export interface MigrationState {
  applied: { version: number; name: string; checksum: string }[];
  pending: Migration[];
}

export const migrationState = (
  db: Database,
  migrations = loadMigrations(),
  readOnly = false,
): MigrationState => {
  const hasTable = db.get(
    `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`,
  );
  if (!hasTable && !readOnly) db.exec(BOOKKEEPING);
  const applied =
    hasTable || !readOnly
      ? db.all<{ version: number; name: string; checksum: string }>(
          'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
        )
      : [];
  for (const row of applied) {
    const file = migrations.find((migration) => migration.version === row.version);
    if (!file)
      throw new MigrationError(
        `The database has migration ${row.version} (${row.name}), which this code does not know. Is the code older than the database?`,
      );
    if (file.checksum !== row.checksum && !file.accepted.includes(row.checksum)) {
      throw new MigrationError(
        `Migration ${String(row.version).padStart(4, '0')}-${row.name}.sql was changed after it was applied. Add a new migration instead.`,
      );
    }
  }
  const done = new Set(applied.map((row) => row.version));
  return { applied, pending: migrations.filter((migration) => !done.has(migration.version)) };
};

interface MigrateResult {
  applied: Migration[];
  backup?: string;
}

/**
 * Applies pending migrations, each in its own transaction. A database that already holds data is
 * copied first; if a migration fails, its transaction is rolled back and the copy is put back, so
 * the file is exactly as it was before the run.
 */
export const migrate = async (
  db: Database,
  migrations = loadMigrations(),
): Promise<MigrateResult> => {
  const { applied, pending } = migrationState(db, migrations);
  if (pending.length === 0) return { applied: [] };
  const first = pending[0];
  const backup =
    applied.length > 0 && first
      ? await backupDatabase(db, `before-migration-${String(first.version).padStart(4, '0')}`)
      : undefined;

  const done: Migration[] = [];
  for (const migration of pending) {
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        db.run(
          'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
          [migration.version, migration.name, migration.checksum, new Date().toISOString()],
        );
        db.run(
          `INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
          [String(migration.version)],
        );
      });
      done.push(migration);
    } catch (error) {
      const label = `${String(migration.version).padStart(4, '0')}-${migration.name}.sql`;
      const reason = errorText(error);
      if (backup) {
        restore(db, backup);
        throw new MigrationError(
          `Migration ${label} failed: ${reason}. The database was restored from ${relative(ROOT_DIR, backup)}.`,
          backup,
        );
      }
      if (applied.length === 0) {
        // A brand-new database: nothing worth keeping, so remove the half-made file.
        db.close();
        rmSync(db.path, { force: true });
        throw new MigrationError(
          `Migration ${label} failed on a new database: ${reason}. The new database file was removed.`,
        );
      }
      throw new MigrationError(
        `Migration ${label} failed: ${reason}. Its changes were rolled back.`,
      );
    }
  }
  return { applied: done, ...(backup ? { backup } : {}) };
};

/** Puts the pre-migration copy back in place of the database file. */
const restore = (db: Database, backup: string): void => {
  db.close();
  for (const suffix of ['-wal', '-shm', '-journal']) rmSync(`${db.path}${suffix}`, { force: true });
  copyFileSync(backup, db.path);
};

// The only module that imports node:sqlite. Everything else goes through `Database`, so a
// switch to better-sqlite3 (the fallback if the built-in module changes) stays in this file.
import { DatabaseSync, type StatementSync, backup } from 'node:sqlite';

export type SqlValue = null | number | bigint | string | Uint8Array;
type Params = Record<string, SqlValue> | SqlValue[];
type Row = Record<string, SqlValue>;

interface OpenOptions {
  /** Open without write access; the file must exist. */
  readOnly?: boolean;
}

export class Database {
  readonly path: string;
  readonly #db: DatabaseSync;
  /** Prepared statements by their text: sync and match run the same few thousands of times. */
  readonly #statements = new Map<string, StatementSync>();

  constructor(path: string, { readOnly = false }: OpenOptions = {}) {
    this.path = path;
    this.#db = new DatabaseSync(path, {
      readOnly,
      enableForeignKeyConstraints: true,
      timeout: 5000,
    });
    if (!readOnly) this.#db.exec('PRAGMA journal_mode = DELETE;');
  }

  #prepare(sql: string): StatementSync {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.#db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return statement;
  }

  /** Runs one or more statements that return nothing. */
  exec(sql: string): void {
    this.#db.exec(sql);
  }

  all<T extends Row = Row>(sql: string, params: Params = []): T[] {
    const statement = this.#prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params)) as T[];
  }

  get<T extends Row = Row>(sql: string, params: Params = []): T | undefined {
    const statement = this.#prepare(sql);
    return (Array.isArray(params) ? statement.get(...params) : statement.get(params)) as
      | T
      | undefined;
  }

  run(sql: string, params: Params = []): { changes: number; lastId: number } {
    const statement = this.#prepare(sql);
    const result = Array.isArray(params) ? statement.run(...params) : statement.run(params);
    return { changes: Number(result.changes), lastId: Number(result.lastInsertRowid) };
  }

  /** Runs `work` in a transaction: committed if it returns, rolled back if it throws. */
  transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /** A consistent copy of the open database, safe while it is in use. */
  async copyTo(path: string): Promise<void> {
    await backup(this.#db, path);
  }

  close(): void {
    this.#statements.clear();
    if (this.#db.isOpen) this.#db.close();
  }
}

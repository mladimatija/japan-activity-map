import { ACTIVITY_TYPE_LABELS, type ActivityType } from '@jam/core';

import type { Database } from './sqlite.ts';

interface StoreSummary {
  schemaVersion: string;
  activities: { source: string; type: string; count: number }[];
  total: number;
  tracks: number;
  sheetRows: number;
  routes: number;
  lastPulls: {
    source: string;
    startedAt: string;
    outcome: string;
    rangeTo: string | null;
    added: number;
    updated: number;
    removed: number;
    error: string | null;
    /** The last pull of this source that finished cleanly, when the latest one did not. */
    lastOkAt: string | null;
  }[];
}

export const summarise = (db: Database): StoreSummary => {
  const activities = db
    .all<{ source: string; type: string; count: number }>(
      'SELECT source, activity_type AS type, COUNT(*) AS count FROM activities GROUP BY source, activity_type ORDER BY source, activity_type',
    )
    .map((row) => ({ ...row, count: Number(row.count) }));
  const count = (sql: string) => Number(db.get<{ n: number }>(sql)?.n ?? 0);
  const lastPulls = db.all<{
    source: string;
    startedAt: string;
    outcome: string;
    rangeTo: string | null;
    added: number;
    updated: number;
    removed: number;
    error: string | null;
    lastOkAt: string | null;
  }>(
    `SELECT p.source, p.started_at AS startedAt, p.outcome, p.range_to AS rangeTo, p.added, p.updated, p.removed, p.error,
            (SELECT MAX(started_at) FROM pulls r WHERE r.source = p.source AND r.outcome = 'ok') AS lastOkAt
       FROM pulls p
      WHERE p.started_at = (SELECT MAX(started_at) FROM pulls q WHERE q.source = p.source)
      ORDER BY p.source`,
  );
  return {
    schemaVersion:
      db.get<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`)?.value ??
      '0',
    activities,
    total: activities.reduce((sum, row) => sum + row.count, 0),
    tracks: count('SELECT COUNT(*) AS n FROM tracks'),
    sheetRows: count('SELECT COUNT(*) AS n FROM sheet_rows'),
    routes: count('SELECT COUNT(*) AS n FROM routes'),
    lastPulls: lastPulls.map((row) => ({
      ...row,
      added: Number(row.added),
      updated: Number(row.updated),
    })),
  };
};

export const typeLabel = (type: string) => ACTIVITY_TYPE_LABELS[type as ActivityType] ?? type;

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { missingListsWarning, readListIndex } from '../lists/index-file.ts';
import { LISTS_DIR } from '../lists/sources.ts';
import { loadCatalog } from '../match/catalog.ts';
import { buildReview, logReview, MATCH_REVIEW_FILE, writeReview } from '../match/review.ts';
import { runMatching } from '../match/run.ts';
import { resolveProgress } from '../match/status.ts';
import { shownPath } from '../paths.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import type { CommandContext } from './types.ts';

const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`;

export const match = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context)?.thresholds;
  if (!config) return 1;
  if (!existsSync(join(LISTS_DIR, 'index.json'))) {
    log.error('The reference lists are not built. Run `pnpm jam lists build` first.');
    return 1;
  }
  const leftOut = missingListsWarning(readListIndex().missing);
  if (leftOut) log.warn(leftOut);
  const store = await openStore(log);
  try {
    const run = runMatching(
      store,
      config,
      { force: options.force === true, dryRun: flags.dryRun },
      log,
    );
    log.info(
      `${run.activities} activities: ${run.computed} ${flags.dryRun ? 'would be matched' : 'matched'}, ${run.reused} unchanged since the last run (${run.durationMs} ms).`,
    );
    if (flags.dryRun) return 0;
    const catalog = loadCatalog(config);
    const progress = resolveProgress(store.db, catalog, config);
    const review = buildReview(store.db, catalog, config, run.startedAt);
    writeReview(progress, review, run.startedAt);

    const { japan, outside, none } = review.locations;
    log.info(
      `In Japan ${japan}, outside Japan ${outside}, no location ${none}. Prefectures with distance: ${review.prefecturesVisited} of 47.`,
    );
    const started = progress.filter((list) => list.items.some((item) => item.status !== 'none'));
    if (started.length > 0) log.info('Lists:');
    for (const list of started) {
      const { done, partial, dns, want } = list.counts;
      const extra = [
        partial ? `${partial} partly` : '',
        dns ? `${dns} DNS` : '',
        want ? `${want} want` : '',
      ]
        .filter(Boolean)
        .join(', ');
      const route =
        list.kind === 'route' ? `, ${km(list.coveredM ?? 0)} of ${km(list.lengthM ?? 0)}` : '';
      log.info(
        `  ${list.title.ja}: ${done} of ${list.items.length} done${extra ? ` (${extra})` : ''}${route}`,
      );
    }
    log.info(
      `New matches: ${review.newMatches.length}. Uncertain: ${review.uncertain.length}. Details in ${shownPath(MATCH_REVIEW_FILE)}.`,
    );
    if (options.report === true) {
      logReview(log, review);
      if (review.recentOutside.length > 0) {
        log.info('Most recent outside Japan:');
        for (const row of review.recentOutside)
          log.info(`  ${row.day} ${row.name} (${row.source})`);
      }
    }
    return 0;
  } finally {
    store.close();
  }
};

/** `jam match ignore <activity> <place or route item>`: marks an automatic match as false. */
export const matchIgnore = async (context: CommandContext): Promise<number> => {
  const { log, flags, options, args } = context;
  const [activityRef, targetId] = args;
  if (!activityRef || !targetId || args.length > 2) {
    log.error(
      'Usage: jam match ignore <activity> <place or route item id>. The activity is its Strava id or its act_ id.',
    );
    return 1;
  }
  const store = await openStore(log);
  try {
    const { db } = store;
    const activity = /^\d+$/.test(activityRef)
      ? db.get<{ id: string; strava_id: number | null; name: string | null }>(
          'SELECT id, strava_id, name FROM activities WHERE strava_id = ?',
          [Number(activityRef)],
        )
      : db.get<{ id: string; strava_id: number | null; name: string | null }>(
          'SELECT id, strava_id, name FROM activities WHERE id = ?',
          [activityRef],
        );
    if (!activity) {
      log.error(`No activity ${activityRef} in the store.`);
      return 1;
    }
    // Strava activities are keyed by their Strava id, so the override survives a wipe and refetch.
    const target = activity.strava_id !== null ? `strava:${activity.strava_id}` : activity.id;
    const current = db.get<{ value: string }>(
      `SELECT value FROM overrides WHERE target_kind = 'activity' AND target_id = ? AND field = 'ignore_matches'`,
      [target],
    );
    const ignored = new Set(current ? (JSON.parse(current.value) as string[]) : []);
    const undo = options.undo === true;
    if (undo ? !ignored.has(targetId) : ignored.has(targetId)) {
      log.info(
        `${targetId} is ${undo ? 'not' : 'already'} ignored for ${activity.name ?? activityRef}.`,
      );
      return 0;
    }
    if (undo) ignored.delete(targetId);
    else {
      const known = db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM matches WHERE activity_id = ? AND target_id = ?',
        [activity.id, targetId],
      );
      if (!known || Number(known.n) === 0)
        log.warn(
          `${activity.name ?? activityRef} has no automatic match with ${targetId} right now; ignoring it anyway.`,
        );
      ignored.add(targetId);
    }
    if (flags.dryRun) {
      log.info(
        `Would ${undo ? 'stop ignoring' : 'ignore'} ${targetId} for ${activity.name ?? activityRef}.`,
      );
      return 0;
    }
    if (ignored.size === 0) {
      db.run(
        `DELETE FROM overrides WHERE target_kind = 'activity' AND target_id = ? AND field = 'ignore_matches'`,
        [target],
      );
    } else {
      db.run(
        `INSERT INTO overrides (target_kind, target_id, field, value, source, created_at) VALUES ('activity', ?, 'ignore_matches', ?, 'cli', ?)
         ON CONFLICT (target_kind, target_id, field) DO UPDATE SET value = excluded.value`,
        [target, JSON.stringify([...ignored].sort()), new Date().toISOString()],
      );
    }
    log.info(
      `${undo ? 'No longer ignoring' : 'Ignoring'} ${targetId} for ${activity.name ?? activityRef}. Run \`pnpm jam match\` to update the lists.`,
    );
    return 0;
  } finally {
    store.close();
  }
};

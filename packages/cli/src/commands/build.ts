import { resolve } from 'node:path';

import { build } from '../build/run.ts';
import { isDemoBuild, storeMarker } from '../demo/marker.ts';
import { loadCatalog } from '../match/catalog.ts';
import { buildReview, logReview } from '../match/review.ts';
import { ROOT_DIR, shownPath } from '../paths.ts';
import { openStore } from '../store/store.ts';
import { printAudit } from './privacy.ts';
import { configFor } from './config.ts';
import type { CommandContext } from './types.ts';

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

/** `jam build`: everything from the store to validated, audited data files in dist/data. */
export const buildCommand = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context);
  if (!config) return 1;
  const outDir = resolve(ROOT_DIR, typeof options.out === 'string' ? options.out : 'dist/data');
  const store = await openStore(log);
  try {
    // Made-up data and real data never share an output folder: dist/data is what gets published.
    const demo = storeMarker(store.db) !== undefined;
    if (demo && outDir === resolve(ROOT_DIR, 'dist/data')) {
      log.error(
        'This is the demo store (made-up data), and dist/data is for your own data. `pnpm jam demo` builds the demo into its own folder; or give one with --out.',
      );
      return 1;
    }
    if (!demo && isDemoBuild(outDir)) {
      log.error(
        `${shownPath(outDir)} holds demo data (its meta.json says so), so it is not replaced with your own. Give another folder with --out, or remove the demo with \`pnpm jam demo --clear\`.`,
      );
      return 1;
    }
    if (demo) log.info('Demo store: the activities are made up (`pnpm jam demo`).');
    const report = build(
      store,
      config,
      { outDir, force: options.force === true, dryRun: flags.dryRun },
      log,
    );
    const { match } = report;
    log.info(
      `Matched ${match.activities} activities (${match.computed} recomputed, ${match.reused} from cache, ${match.newMatches} new matches).`,
    );
    log.info(
      `Published ${report.published} activities: ${report.withTrack} with a track, ${report.clipped} cut at a privacy zone, ${report.trackHidden} entirely inside one (statistics only).`,
    );
    if (report.excluded.size) log.info('Left out:');
    for (const [reason, count] of [...report.excluded].sort((a, b) => b[1] - a[1]))
      log.info(`  ${count}: ${reason}`);
    log.info(
      `Routes: ${report.routes} with two or more published activities (of ${report.routesGrouped} grouped).`,
    );
    log.info('Files:');
    for (const file of report.files)
      log.info(
        `  ${file.path.padEnd(48)} ${kb(file.bytes).padStart(10)} ${kb(file.gzipBytes).padStart(10)} gzip${file.atStart ? '  (loaded at start)' : ''}`,
      );
    const within = report.startGzipBytes <= report.budgetBytes;
    const budgetLine = `Loaded at start: ${kb(report.startGzipBytes)} compressed, budget ${kb(report.budgetBytes)}${within ? '' : ': over budget'}.`;
    if (within) log.info(budgetLine);
    else log.error(budgetLine);
    printAudit(log, report.audit);
    if (options.report === true) {
      const catalog = loadCatalog(config.thresholds);
      const review = buildReview(store.db, catalog, config.thresholds, match.startedAt);
      logReview(log, review);
    }
    if (flags.dryRun) {
      log.info(
        `Dry run: nothing replaced. The files are in ${shownPath(report.writtenTo)} (local, not published).`,
      );
      return report.ok ? 0 : 1;
    }
    if (!report.ok) {
      log.error(
        `Build failed, so ${shownPath(outDir)} was left as it was. The failed files are in ${shownPath(report.writtenTo)} (local, not published).`,
      );
      return 1;
    }
    log.info(`Built into ${shownPath(outDir)}.`);
    if (demo) log.info('Demo data: made-up activities, not for publishing.');
    return 0;
  } finally {
    store.close();
  }
};

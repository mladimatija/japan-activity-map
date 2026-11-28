import { resolve } from 'node:path';

import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import { JamError } from '../errors.ts';
import { collectGpx, gpxFolder, hasGpxFolder } from '../gpx-import/files.ts';
import { planGpxSync, readActivities, wipeGpx } from '../gpx-import/sync.ts';
import { ROOT_DIR, shownPath } from '../paths.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import { previewStore } from './sheet.ts';
import type { CommandContext } from './types.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `jam sync gpx [path]`: every GPX file of a folder or archive as one activity each. */
export const syncGpx = async ({ flags, log, args, options }: CommandContext): Promise<number> => {
  if (args.length > 1) {
    log.error('Give at most one folder or .zip archive.');
    return 1;
  }
  const config = configFor({ flags, log });
  if (!config) return 1;
  // Real tracks stay out of made-up data.
  if (currentStoreMarker()) {
    log.error(demoRefusal('GPX files are not imported into it'));
    return 1;
  }
  const replace = options.replace === true;
  const given = args[0];
  const path = given ? resolve(ROOT_DIR, given) : gpxFolder(config);
  if (!given && !hasGpxFolder(config))
    throw new JamError(
      `No folder at ${shownPath(path)}. Put .gpx files or a .zip of them there, or give a folder or archive: pnpm jam sync gpx <path>. See docs/gpx.md.`,
    );
  const collected = collectGpx(path);
  const shown = shownPath(path);
  const from = collected.archives > 0 ? `, ${plural(collected.archives, 'archive')} read` : '';
  log.info(`GPX ${shown}: ${plural(collected.sources.length, 'file')}${from}.`);
  if (collected.sources.length === 0) {
    log.info(
      replace
        ? 'Nothing to import, so nothing was removed either. `pnpm jam gpx wipe` deletes every GPX activity.'
        : 'Nothing to import.',
    );
    return 0;
  }
  const { activities, skipped } = readActivities(
    collected.sources,
    { defaultType: config.site.activities.gpx.defaultType, timeZone: config.sheet.timeZone },
    log,
  );
  const preview = flags.dryRun ? await previewStore(log) : undefined;
  const store = preview?.store ?? (await openStore(log));
  try {
    // With no file read as an activity, --replace would empty the store of them: more likely a
    // wrong path than a wish, and `gpx wipe` says it outright.
    if (replace && activities.length === 0) {
      for (const file of skipped) log.warn(`  ! ${file.file}: skipped, ${file.reason}`);
      log.error(
        'No file could be read as an activity, so --replace removed nothing. `pnpm jam gpx wipe` deletes every GPX activity.',
      );
      return 1;
    }
    const plan = planGpxSync(
      store,
      activities,
      replace,
      new Set(skipped.filter((file) => file.unreadable).map((file) => file.file)),
    );
    const symbol = { added: '+', updated: '~', removed: '-' } as const;
    for (const change of plan.changes) {
      const where = change.file ? `${change.file}  ` : '';
      const why =
        change.kind === 'removed'
          ? ' (not in this import)'
          : change.details.length > 0
            ? ` (${change.details.join(', ')})`
            : '';
      log.info(`  ${symbol[change.kind]} ${where}${change.name}${why}`);
    }
    for (const file of skipped) log.warn(`  ! ${file.file}: skipped, ${file.reason}`);
    for (const kept of plan.held)
      log.warn(
        `  = ${kept.file}  ${kept.name} (kept: its file could not be read this time, so --replace left it)`,
      );
    const of = (kind: 'added' | 'updated' | 'removed') =>
      plan.changes.filter((change) => change.kind === kind).length;
    const summary = `${of('added')} added, ${of('updated')} updated, ${of('removed')} removed, ${plan.unchanged} unchanged, ${skipped.length} skipped`;
    if (flags.dryRun) {
      log.info(`Dry run, nothing written. Would be: ${summary}.`);
      return 0;
    }
    const { backup } = await plan.apply({
      path: shown,
      files: collected.sources.length,
      skipped: skipped.length,
    });
    if (backup) log.info(`Copied the store to ${shownPath(backup)} before removing.`);
    log.info(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
    if (config.site.activities.source !== 'gpx')
      log.info(
        `The site is built from "${config.site.activities.source}". To build it from these, set activities.source to "gpx" in config/site.jsonc.`,
      );
    return 0;
  } finally {
    if (preview) preview.dispose();
    else store.close();
  }
};

/** `jam gpx wipe`: every GPX activity out of the store, after a copy. */
export const gpxWipe = async ({ flags, log, options }: CommandContext): Promise<number> => {
  const store = await openStore(log);
  try {
    const preview = await wipeGpx(store, true);
    if (flags.dryRun || options.yes !== true) {
      log.info(
        `Would delete ${preview.activities} GPX activities and ${preview.tracks} tracks. Strava activities, sheet rows, overrides and route names stay.`,
      );
      if (!flags.dryRun)
        log.info(
          'Run `pnpm jam gpx wipe --yes` to do it. The store is copied to data/backups first.',
        );
      return 0;
    }
    const result = await wipeGpx(store, false);
    log.info(
      `Deleted ${result.activities} GPX activities and ${result.tracks} tracks. Copy first: ${result.backup ? shownPath(result.backup) : 'none'}.`,
    );
    log.info('The files themselves are untouched: `pnpm jam sync gpx` imports them again.');
    return 0;
  } finally {
    store.close();
  }
};

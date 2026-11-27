import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Config } from '@jam/core';

import { writeFileAtomic } from '../files.ts';
import type { Logger } from '../logger.ts';
import { DATA_DIR, ROOT_DIR, shownPath } from '../paths.ts';
import { audit, REFERENCE_POINTS_FILE } from '../privacy/audit.ts';
import { fragmentFeatures } from '../privacy/clip.ts';
import { forbiddenFor, publishSelection } from '../privacy/selection.ts';
import type { Store } from '../store/store.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import type { CommandContext } from './types.ts';

const PRIVACY_PREVIEW_FILE = join(DATA_DIR, 'privacy-preview.geojson');

const printAudit = (log: Logger, report: ReturnType<typeof audit>): void => {
  log.info(`Audited ${report.files} files (${Math.round(report.bytes / 1024)} KB):`);
  for (const check of report.checks) {
    if (check.failures.length === 0) log.info(`  pass  ${check.name} (${check.checked})`);
    else {
      log.error(
        `  FAIL  ${check.name}: ${check.failures.length} ${check.failures.length === 1 ? 'problem' : 'problems'}`,
      );
      for (const failure of check.failures.slice(0, 10)) log.error(`        ${failure}`);
      if (check.failures.length > 10) log.error(`        … and ${check.failures.length - 10} more`);
    }
  }
  for (const warning of report.warnings) log.warn(`  WARN  ${warning}`);
  if (report.ok) log.info('Nothing private found.');
  else log.error('The output contains private data. Do not publish it.');
};

/** Audits a folder against the store and config, prints the result, and says whether it passed. */
export const auditFolder = (store: Store, config: Config, dir: string, log: Logger): boolean => {
  const { selection, zones } = publishSelection(store, config, true);
  // The last build's public geometry (list places, reference routes, borders): not a leak
  // where it crosses a zone. Without a build here there is none, and such points are reported.
  const referenceFile = join(DATA_DIR, REFERENCE_POINTS_FILE);
  const referencePoints = existsSync(referenceFile)
    ? new Set(readFileSync(referenceFile, 'utf8').split('\n'))
    : undefined;
  const report = audit(dir, {
    ...forbiddenFor(store, config, selection, zones),
    ...(referencePoints ? { referencePoints } : {}),
  });
  printAudit(log, report);
  return report.ok;
};

/** `jam audit [dir]`: checks a folder of output files, by default the build output in dist/. */
export const auditCommand = async (context: CommandContext): Promise<number> => {
  const { log, args } = context;
  const config = configFor(context);
  if (!config) return 1;
  const dir = resolve(ROOT_DIR, args[0] ?? 'dist');
  if (!existsSync(dir)) {
    log.error(
      `Nothing to audit: ${shownPath(dir)} does not exist. Build the site first with "pnpm jam build", or give a folder.`,
    );
    return 1;
  }
  const store = await openStore(log);
  try {
    return auditFolder(store, config, dir, log) ? 0 : 1;
  } finally {
    store.close();
  }
};

export { printAudit };

/** `jam zones`: what each privacy zone does to the published tracks, without showing where it is. */
export const zonesCommand = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context);
  if (!config) return 1;
  const store = await openStore(log);
  try {
    const { selection, zones, settings } = publishSelection(store, config, flags.dryRun);
    const unmatched = selection.excluded.filter((activity) =>
      activity.reason.startsWith('not matched'),
    ).length;
    if (unmatched > 0) {
      log.warn(
        `${unmatched} activities are not matched yet, so they cannot be published or cut. Run \`pnpm jam match\` first, then this again.`,
      );
    }
    if (zones.length === 0) {
      log.warn(
        'No privacy zones are set, so published tracks would not be clipped anywhere. Add them in config/privacy-zones.jsonc.',
      );
    }
    for (const [i, zone] of zones.entries()) {
      const applied = settings.zones[i];
      log.info(
        `  ${zone.label}: radius ${zone.radiusM} m; clipping uses ${Math.round(applied?.baseRadiusM ?? zone.radiusM)}–${Math.round((applied?.baseRadiusM ?? zone.radiusM) + (applied?.jitterM ?? 0))} m around a centre moved ${Math.round((applied?.baseRadiusM ?? zone.radiusM) - zone.radiusM)} m`,
      );
    }
    const published = selection.activities;
    const clipped = published.filter((activity) => activity.clipped);
    const hidden = published.filter((activity) => activity.trackHidden && activity.hasGps);
    log.info(
      `Publishable activities: ${published.length}. Tracks cut at a zone: ${clipped.length}. Tracks entirely inside one (statistics only): ${hidden.length}.`,
    );
    const reasons = new Map<string, number>();
    for (const activity of selection.excluded)
      reasons.set(activity.reason, (reasons.get(activity.reason) ?? 0) + 1);
    if (reasons.size) log.info('Not published:');
    for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]))
      log.info(`  ${count}: ${reason}`);
    const links = published.filter((activity) => activity.link).length;
    log.info(
      `Strava links: ${links ? `${links} activities` : 'none'} (publish.stravaLinks is ${config.site.publish.stravaLinks ? 'on' : 'off'}). Names: ${config.site.publish.activityNames ? 'as in Strava or the sheet' : 'generic labels'}. Time of day: ${config.site.publish.timeOfDay ? 'published' : 'dates only'}. Seconds along tracks: ${config.site.publish.paceAlongTracks ? "published, from each stretch's start" : 'off'}.`,
    );
    if (options.preview === true) {
      // A local file to look at the cuts in any GeoJSON viewer. It stays in data/, never published.
      const preview = fragmentFeatures(clipped, (activity) => ({
        name: activity.name,
        date: activity.date,
      }));
      writeFileAtomic(PRIVACY_PREVIEW_FILE, JSON.stringify(preview));
      log.info(
        `Wrote the ${clipped.length} cut tracks to ${shownPath(PRIVACY_PREVIEW_FILE)}, to check in a GeoJSON viewer. It stays local.`,
      );
    }
    return 0;
  } finally {
    store.close();
  }
};

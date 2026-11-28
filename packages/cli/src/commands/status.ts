import { ConfigError, loadConfig, type ConfigFileStatus } from '../config.ts';
import { folderMarker, storeMarker } from '../demo/marker.ts';
import { gpxFolder, hasGpxFolder } from '../gpx-import/files.ts';
import { DATA_DIR, DEMO_DIR, shownPath } from '../paths.ts';
import { canReadActivities, hasReadAll, loadToken } from '../strava/auth.ts';
import { listBackups } from '../store/backups.ts';
import { inspectStore, openStore } from '../store/store.ts';
import { summarise, typeLabel } from '../store/summary.ts';
import type { CommandContext } from './types.ts';
import { errorText } from '../errors.ts';

const SOURCE_LABELS: Record<ConfigFileStatus['source'], string> = {
  file: 'own file',
  example: 'example file (copy it to customise)',
  none: 'not set',
};

const printFiles = (context: CommandContext, files: ConfigFileStatus[]) => {
  for (const file of files) {
    const where = file.path ? `  ${file.path}` : '';
    context.log.info(`  ${file.key.padEnd(13)} ${SOURCE_LABELS[file.source]}${where}`);
  }
};

const storeStatus = async ({ flags, log }: CommandContext): Promise<boolean> => {
  log.info('');
  log.info('Local store:');
  if (flags.dryRun) {
    const inspection = inspectStore();
    if (!inspection.exists) {
      log.info(
        `  ${shownPath(inspection.path)} does not exist yet; it is created on the first real run.`,
      );
      return true;
    }
    const pending = inspection.state?.pending ?? [];
    log.info(
      `  ${shownPath(inspection.path)}, schema ${inspection.state?.applied.length ?? 0} of ${inspection.known}`,
    );
    log.info(
      pending.length === 0
        ? '  No pending migrations.'
        : `  Pending migrations: ${pending.map((migration) => `${String(migration.version).padStart(4, '0')}-${migration.name}`).join(', ')}`,
    );
    return true;
  }
  const store = await openStore(log);
  try {
    const demo = storeMarker(store.db);
    if (demo)
      log.info(
        `  Demo store: made-up data from \`pnpm jam demo\` (seed ${demo.seed}, up to ${demo.until}). Not your own activities.`,
      );
    const summary = summarise(store.db);
    log.info(
      `  ${shownPath(store.path)}, schema version ${summary.schemaVersion}, no pending migrations`,
    );
    log.info(
      `  Activities: ${summary.total}${summary.total === 0 ? '' : `, ${summary.tracks} with tracks`}`,
    );
    for (const row of summary.activities) {
      log.info(
        `    ${row.source.padEnd(7)} ${typeLabel(row.type).padEnd(10)} ${String(row.count).padStart(5)}`,
      );
    }
    const bySource = new Map<string, number>();
    for (const row of summary.activities)
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.count);
    if (bySource.size > 0)
      log.info(
        `  By source: ${[...bySource].map(([source, count]) => `${source} ${count}`).join(', ')}`,
      );
    log.info(`  Sheet rows: ${summary.sheetRows}. Grouped routes: ${summary.routes}.`);
    const lastMatch = store.db.get<{
      started_at: string;
      computed: number;
      reused: number;
      new_matches: number;
    }>(
      'SELECT started_at, computed, reused, new_matches FROM match_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1',
    );
    const unmatched = Number(
      store.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM activities a LEFT JOIN build_cache c ON c.activity_id = a.id WHERE c.activity_id IS NULL',
      )?.n ?? 0,
    );
    log.info(
      lastMatch
        ? `  Last match: ${lastMatch.started_at.slice(0, 16).replace('T', ' ')} UTC, ${lastMatch.computed} matched, ${lastMatch.reused} from cache, ${lastMatch.new_matches} new matches${unmatched ? `; ${unmatched} activities not matched yet (run \`pnpm jam match\`)` : ''}`
        : '  Not matched yet (run `pnpm jam match`).',
    );
    if (summary.lastPulls.length === 0) log.info('  No pulls yet.');
    for (const pull of summary.lastPulls) {
      log.info(
        `  Last ${pull.source} pull: ${pull.startedAt.slice(0, 16).replace('T', ' ')} UTC, ${pull.outcome}, ${pull.added} added, ${pull.updated} updated, ${pull.removed} removed${pull.rangeTo ? `, up to ${pull.rangeTo.slice(0, 10)}` : ''}`,
      );
      if (pull.error)
        log.info(`    ${pull.error.length > 160 ? `${pull.error.slice(0, 160)}…` : pull.error}`);
      if (pull.outcome !== 'ok' && pull.outcome !== 'wiped') {
        log.info(
          `    Last successful ${pull.source} pull: ${pull.lastOkAt ? `${pull.lastOkAt.slice(0, 16).replace('T', ' ')} UTC` : 'none'}`,
        );
      }
    }
  } finally {
    store.close();
  }
  const backups = listBackups();
  const latest = backups.at(-1);
  log.info(`  Backups: ${backups.length}${latest ? `, newest ${latest.name}` : ''}`);
  return true;
};

/** Config files and validation, then the local store and its sync history. */
export const status = async (context: CommandContext): Promise<number> => {
  const { flags, log } = context;
  log.info(`Config folder: ${shownPath(flags.configDir)}`);

  try {
    const { config, files } = loadConfig(flags.configDir);
    printFiles(context, files);
    log.info('');
    log.info('Config is valid.');

    const zoneCount = config.privacyZones.zones.length;
    if (zoneCount === 0) {
      log.warn('No privacy zones are set, so published tracks would not be clipped anywhere.');
    } else {
      log.info(`Privacy zones: ${zoneCount}`);
    }
    const fromGpx = config.site.activities.source === 'gpx';
    log.info(
      `Site activities: built from ${fromGpx ? 'GPX files' : 'Strava'} plus the sheet (activities.source is "${config.site.activities.source}")`,
    );
    log.info(
      `GPX folder: ${shownPath(gpxFolder(config))}${hasGpxFolder(config) ? '' : ' (not there yet)'}; default type ${config.site.activities.gpx.defaultType}`,
    );
    log.info(
      `Strava import: ${config.strava.import.activityTypes.join(', ')}; ` +
        `private activities ${config.strava.import.includePrivate ? 'included' : 'not included'}`,
    );
    log.info(`Strava app credentials: ${config.secrets.strava ? 'set' : 'not set'}`);
    try {
      const token = loadToken();
      if (!token) {
        log.info('Strava sign-in: none yet (run `pnpm jam strava auth`)');
      } else {
        log.info(
          `Strava sign-in: ${token.athlete.name || 'athlete'} (${token.athlete.id}), granted ${token.scope || 'nothing'}`,
        );
        if (!canReadActivities(token.scope))
          log.warn(
            'The Strava sign-in has no access to activities; run `pnpm jam strava auth` again.',
          );
        else if (config.strava.import.includePrivate && !hasReadAll(token.scope)) {
          log.warn(
            'Private activities are on, but the sign-in does not cover them; run `pnpm jam strava auth` again.',
          );
        }
      }
    } catch (error) {
      log.warn(errorText(error));
    }
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    printFiles(context, error.files);
    log.info('');
    log.error(`${error.message}:`);
    for (const problem of error.problems) {
      log.error(`  ${problem.file} > ${problem.where}: ${problem.message}`);
    }
    return 1;
  }

  await storeStatus(context);
  // On the real store, say when a demo is lying beside it.
  const beside = DATA_DIR === DEMO_DIR ? undefined : folderMarker(DEMO_DIR);
  if (beside)
    log.info(
      `Demo data: ${shownPath(DEMO_DIR)} (made up, up to ${beside.until}). See it with \`pnpm demo:web\`; remove it with \`pnpm jam demo --clear\`.`,
    );
  return 0;
};

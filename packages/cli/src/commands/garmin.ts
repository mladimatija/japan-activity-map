import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import { JamError } from '../errors.ts';
import { GarminApi, GarminKeyError } from '../garmin/http.ts';
import { isSummary, pullGarmin, summaryColumns, wipeGarmin } from '../garmin/sync.ts';
import { shownPath } from '../paths.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import { pullRange, rangeText } from './range.ts';
import { previewStore } from './sheet.ts';
import type { CommandContext } from './types.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The personal API key: the environment first (for a scheduled run), then config/secrets.jsonc. */
const apiKey = (configured: string | undefined): string => {
  const key = process.env.JAM_GARMIN_API_KEY?.trim() || configured;
  if (!key)
    throw new GarminKeyError(
      'No Garmin personal API key. Create one on Garmin Connect (Settings, Personal API Key) and put it in config/secrets.jsonc as "garmin": { "apiKey": "…" }. See docs/garmin.md.',
    );
  return key;
};

/** `jam sync garmin`: the list of activities since the last pull, then their files. */
export const syncGarmin = async ({ flags, log, options }: CommandContext): Promise<number> => {
  const config = configFor({ flags, log });
  if (!config) return 1;
  // Real activities stay out of made-up data.
  if (currentStoreMarker()) {
    log.error(demoRefusal('Garmin activities are not fetched into it'));
    return 1;
  }
  const settings = config.site.activities.garmin;
  let files: number | undefined;
  if (typeof options.files === 'string') {
    files = options.files === 'all' ? Number.MAX_SAFE_INTEGER : Number(options.files);
    if (!Number.isInteger(files) || files < 0)
      throw new JamError('--files takes a whole number, or "all".');
  }
  const range = pullRange(options, config.sheet.timeZone);
  const api = new GarminApi(
    apiKey(config.secrets.garmin?.apiKey),
    settings.api.baseUrl,
    log,
    settings.api.pauseMs,
  );
  await api.signIn();
  const preview = flags.dryRun ? await previewStore(log) : undefined;
  const store = preview?.store ?? (await openStore(log));
  try {
    const result = await pullGarmin(
      store,
      api,
      config,
      {
        full: options.full === true,
        dryRun: flags.dryRun,
        ...(files !== undefined ? { files } : {}),
        ...(range ? { range } : {}),
      },
      log,
    );
    const summary = `${result.added} added, ${result.updated} updated, ${result.removed} removed, ${result.unchanged} unchanged`;
    log.info(
      `Garmin: ${plural(result.listed, 'activity', 'activities')} listed${range ? `, ${rangeText(range)} only` : ''}${options.full === true ? ' (full pull)' : ''}.`,
    );
    if (result.skippedTypes.size > 0)
      log.info(
        `  Skipped types: ${[...result.skippedTypes].map(([type, n]) => `${type} ${n}`).join(', ')} (map them in activities.garmin.typeMap to keep them)`,
      );
    if (result.skippedPrivate > 0)
      log.info(
        `  Skipped ${plural(result.skippedPrivate, 'activity', 'activities')} set to Only Me (activities.garmin.includePrivate keeps them)`,
      );
    if (flags.dryRun) {
      log.info(
        `Dry run, nothing written. Would be: ${summary}; ${plural(result.files.left, 'file')} to fetch.`,
      );
      return 0;
    }
    if (result.backup) log.info(`Copied the store to ${shownPath(result.backup)} before removing.`);
    log.info(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
    log.info(
      `Files: ${result.files.fetched} fetched (${result.files.withTrack} with a track, ${result.files.withoutTrack} without)${result.files.unanswered > 0 ? `, ${result.files.unanswered} Garmin did not answer for` : ''}, ${result.files.left + result.files.unanswered} still to fetch. ${api.requests} requests.`,
    );
    if (api.longestGapMs > settings.api.pauseMs)
      log.info(
        `Garmin was slow to answer, so the wait between requests went up to ${Math.round(api.longestGapMs / 1000)} s. A higher activities.garmin.api.pauseMs (now ${settings.api.pauseMs}) starts slower.`,
      );
    if (result.limited) log.warn(result.limited);
    else if (result.files.left + result.files.unanswered > 0)
      log.info(
        'Run it again for more, or `pnpm jam sync garmin --files all`. Until its file is fetched an activity has no track, and counts as one without GPS.',
      );
    if (config.site.activities.source !== 'garmin')
      log.info(
        `The site is built from "${config.site.activities.source}". To build it from these, set activities.source to "garmin" in config/site.jsonc.`,
      );
    return 0;
  } finally {
    if (preview) preview.dispose();
    else store.close();
  }
};

/** `jam garmin check`: whether the key works, without fetching anything into the store. */
export const garminCheck = async ({ flags, log }: CommandContext): Promise<number> => {
  const config = configFor({ flags, log });
  if (!config) return 1;
  const settings = config.site.activities.garmin;
  const api = new GarminApi(
    apiKey(config.secrets.garmin?.apiKey),
    settings.api.baseUrl,
    log,
    settings.api.pauseMs,
  );
  await api.signIn();
  const page = await api.list({ start: 0 });
  log.info(
    `The Garmin personal API key works: Garmin Connect answered with ${page.length === 0 ? 'no activities' : `a first page of ${plural(page.length, 'activity', 'activities')}`}.`,
  );
  // What the first page is made of, so a type that would be skipped shows before a pull.
  const types = new Map<string, number>();
  for (const entry of page) {
    if (!isSummary(entry)) continue;
    const verdict = summaryColumns(entry, settings, config.sheet.timeZone);
    const label = verdict.keep
      ? String(verdict.columns.activity_type)
      : verdict.reason === 'type'
        ? `${verdict.type} (skipped)`
        : verdict.reason === 'private'
          ? 'Only Me (skipped)'
          : 'no date (skipped)';
    types.set(label, (types.get(label) ?? 0) + 1);
  }
  if (types.size > 0)
    log.info(`  Of those: ${[...types].map(([type, n]) => `${type} ${n}`).join(', ')}.`);
  log.info(
    'A key lasts at most a year; Garmin Connect (Settings, Personal API Key) shows its date and emails you a week before.',
  );
  return 0;
};

/** `jam garmin wipe`: every Garmin activity out of the store, after a copy. */
export const garminWipe = async ({ flags, log, options }: CommandContext): Promise<number> => {
  const store = await openStore(log);
  try {
    const preview = await wipeGarmin(store, true);
    if (flags.dryRun || options.yes !== true) {
      log.info(
        `Would delete ${preview.activities} Garmin activities and ${preview.tracks} tracks. Strava activities, GPX activities, sheet rows, overrides and route names stay.`,
      );
      if (!flags.dryRun)
        log.info(
          'Run `pnpm jam garmin wipe --yes` to do it. The store is copied to data/backups first.',
        );
      return 0;
    }
    const result = await wipeGarmin(store, false);
    log.info(
      `Deleted ${result.activities} Garmin activities and ${result.tracks} tracks. Copy first: ${result.backup ? shownPath(result.backup) : 'none'}.`,
    );
    log.info('`pnpm jam sync garmin` fetches them again, with the same ids.');
    return 0;
  } finally {
    store.close();
  }
};

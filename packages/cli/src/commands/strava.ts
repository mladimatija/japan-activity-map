import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import type { Logger } from '../logger.ts';
import { utcToLocal } from '../sheet/time.ts';
import { shownPath } from '../paths.ts';
import {
  authorize,
  canReadActivities,
  hasReadAll,
  loadToken,
  refreshToken,
  type StravaToken,
} from '../strava/auth.ts';
import { StravaHttp } from '../strava/http.ts';
import { StravaApiSource } from '../strava/source.ts';
import {
  fetchStreams,
  pullStrava,
  recordFailedPull,
  staleness,
  wipeStrava,
} from '../strava/sync.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import type { CommandContext } from './types.ts';
import { errorText } from '../errors.ts';

const SETUP = 'See docs/strava-setup.md.';

const credentials = (
  context: CommandContext,
  secrets: NonNullable<ReturnType<typeof configFor>>['secrets'],
) => {
  if (!secrets.strava) {
    context.log.error(
      `No Strava app credentials. Add strava.clientId and strava.clientSecret to config/secrets.jsonc. ${SETUP}`,
    );
    return undefined;
  }
  return secrets.strava;
};

/** True, after saying why, when the store is the demo's: nothing real goes into made-up data. */
const onDemoStore = (context: CommandContext, what: string): boolean => {
  if (!currentStoreMarker()) return false;
  context.log.error(demoRefusal(what));
  return true;
};

export const stravaAuth = async (context: CommandContext): Promise<number> => {
  if (onDemoStore(context, 'there is no signing in to Strava from it')) return 1;
  const loaded = configFor(context);
  if (!loaded) return 1;
  const app = credentials(context, loaded.secrets);
  if (!app) return 1;
  const includePrivate = loaded.strava.import.includePrivate;
  if (context.flags.dryRun) {
    context.log.info(
      `Would open Strava's sign-in page asking for ${includePrivate ? 'all activities, including "Only You"' : 'your Everyone and Followers activities'}.`,
    );
    return 0;
  }
  const token = await authorize(loaded.strava.api, app, includePrivate, context.log);
  context.log.info(
    `Signed in as ${token.athlete.name || 'your athlete'} (${token.athlete.id}). Granted: ${token.scope || 'nothing'}.`,
  );
  if (!canReadActivities(token.scope)) {
    context.log.error(
      'Strava did not grant access to activities: the "View data about your activities" box was unticked. Run `pnpm jam strava auth` again and leave it ticked.',
    );
    return 1;
  }
  if (includePrivate && !hasReadAll(token.scope)) {
    context.log.warn(
      'Private activities are on, but Strava did not grant access to "Only You" activities (the box was unticked). Run `pnpm jam strava auth` again and tick it, or turn includePrivate off.',
    );
    return 1;
  }
  return 0;
};

const parseAge = (text: string): number | undefined => {
  const match = /^(\d+(?:\.\d+)?)\s*([dh]?)$/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(match[1]);
  return match[2] === 'h' ? value / 24 : value;
};

/** A valid access token for this run: refreshed at the start, and again if it nears expiry. */
const tokenProvider = (
  api: Parameters<typeof refreshToken>[0],
  app: Parameters<typeof refreshToken>[1],
  initial: StravaToken,
): (() => Promise<string>) => {
  let token = initial;
  return async () => {
    if (token.expiresAt - Date.now() / 1000 < 120) token = await refreshToken(api, app, token);
    return token.accessToken;
  };
};

const signedIn = async (
  context: CommandContext,
  loaded: NonNullable<ReturnType<typeof configFor>>,
  log: Logger,
): Promise<{ http: StravaHttp; token: StravaToken } | undefined> => {
  const app = credentials(context, loaded.secrets);
  if (!app) return undefined;
  const stored = loadToken();
  if (!stored) {
    log.error(`Not signed in to Strava. Run \`pnpm jam strava auth\` first. ${SETUP}`);
    return undefined;
  }
  if (!canReadActivities(stored.scope)) {
    log.error(
      'The Strava sign-in has no access to activities. Run `pnpm jam strava auth` again and leave "View data about your activities" ticked.',
    );
    return undefined;
  }
  if (loaded.strava.import.includePrivate && !hasReadAll(stored.scope)) {
    log.error(
      `Private activities are on in config/strava.jsonc, but the Strava sign-in only covers Everyone and Followers activities (granted: ${stored.scope}). Run \`pnpm jam strava auth\` again and tick "View data about your private activities", or turn includePrivate off.`,
    );
    return undefined;
  }
  const token = await refreshToken(loaded.strava.api, app, stored);
  return {
    http: new StravaHttp(
      loaded.strava.api.baseUrl,
      tokenProvider(loaded.strava.api, app, token),
      log,
    ),
    token,
  };
};

export const syncStrava = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  if (onDemoStore(context, 'Strava activities are not pulled into it')) return 1;
  const loaded = configFor(context);
  if (!loaded) return 1;

  if (typeof options['if-stale'] === 'string') {
    const days = parseAge(options['if-stale']);
    if (days === undefined) {
      log.error(`--if-stale takes an age such as 7d or 12h, not "${options['if-stale']}".`);
      return 1;
    }
    const store = await openStore(log);
    try {
      const check = staleness(store.db, days);
      if (!check.stale) {
        log.info(
          `The last Strava pull (${check.lastOk?.slice(0, 16).replace('T', ' ')} UTC) is newer than ${options['if-stale']}; nothing to do.`,
        );
        return 0;
      }
    } finally {
      store.close();
    }
  }

  let session: Awaited<ReturnType<typeof signedIn>>;
  let failure: string | undefined;
  try {
    session = await signedIn(context, loaded, log);
    if (!session) failure = 'not signed in, or the sign-in does not cover the import settings';
  } catch (error) {
    failure = errorText(error);
    throw error;
  } finally {
    // Every run leaves a pull record, including one that never got past signing in.
    if (failure !== undefined && !flags.dryRun && options.streams === undefined) {
      const store = await openStore(log);
      try {
        recordFailedPull(store.db, loaded.strava, failure);
      } finally {
        store.close();
      }
    }
  }
  if (!session) return 1;
  const source = new StravaApiSource(session.http);
  const store = await openStore(log);
  try {
    if (options.streams !== undefined) {
      const value = typeof options.streams === 'string' ? options.streams : 'missing';
      const ids =
        value === 'missing' ? undefined : value.split(',').map((part) => Number(part.trim()));
      if (ids?.some((id) => !Number.isInteger(id) || id <= 0)) {
        log.error('--streams takes "missing" or comma-separated Strava activity ids.');
        return 1;
      }
      const limit = typeof options.limit === 'string' ? Number(options.limit) : 25;
      if (!Number.isInteger(limit) || limit <= 0) {
        log.error('--limit takes a positive whole number.');
        return 1;
      }
      const report = await fetchStreams(
        store,
        source,
        { ...(ids ? { ids } : {}), limit },
        flags.dryRun,
        log,
      );
      log.info(
        flags.dryRun
          ? `${report.remaining} activities would get full tracks.`
          : `Full tracks fetched for ${report.fetched} activities${report.missing ? `, ${report.missing} had no GPS samples` : ''}. ${report.remaining > 0 ? `${report.remaining} still to do; run again to continue.` : 'None left to do.'}`,
      );
      log.info(`Strava requests this run: ${session.http.requests}.`);
      return 0;
    }

    const report = await pullStrava(
      store,
      source,
      {
        config: loaded.strava,
        timeZone: loaded.sheet.timeZone,
        scope: session.token.scope,
        dryRun: flags.dryRun,
      },
      log,
    );
    const zone = loaded.sheet.timeZone;
    // Dates in the sheet's zone; the stored end is exclusive, so show the day before it.
    const day = (iso: string, shift = 0) =>
      utcToLocal(new Date(new Date(iso).getTime() + shift), zone).slice(0, 10);
    const range = `${report.from ? day(report.from) : 'the beginning'} to ${report.to ? day(report.to, -1) : 'now'}`;
    log.info(
      `${report.kind === 'full' ? 'Full' : report.kind === 'resumed' ? 'Resumed' : 'Incremental'} pull, ${range}, ${report.pages} ${report.pages === 1 ? 'page' : 'pages'}.`,
    );
    log.info(
      `${flags.dryRun ? 'Would be: ' : ''}${report.added} added, ${report.updated} updated, ${report.unchanged} unchanged.`,
    );
    for (const [reason, count] of Object.entries(report.skipped).sort(([a], [b]) =>
      a.localeCompare(b),
    ))
      log.info(`  skipped ${count}: ${reason}`);
    if (Object.keys(report.skipped).some((reason) => reason.startsWith('unmapped'))) {
      log.info('  Map a sport type in config/strava.jsonc (sportTypeMap) to import it.');
    }
    if (report.removedPrivate > 0 && flags.dryRun)
      log.info(
        `Would remove ${report.removedPrivate} stored "Only You" activities, since private activities are off.`,
      );
    if (report.notReturned > 0)
      log.warn(
        `${report.notReturned} stored Strava activities in this range were not returned; they may have been deleted on Strava. They are kept.`,
      );
    if (report.orphanedOverrides.length > 0) {
      log.warn(
        `Sheet rows override ${report.orphanedOverrides.length} Strava ${report.orphanedOverrides.length === 1 ? 'activity that does' : 'activities that do'} not exist: ${report.orphanedOverrides.join(', ')}.`,
      );
    }
    // Then full samples for a batch of activities that only have the simplified track: heights and
    // times for the profiles and the analysis. Later syncs carry on where this one stopped.
    if (report.outcome === 'ok' && !flags.dryRun && loaded.strava.fullTracksPerSync > 0) {
      const tracks = await fetchStreams(
        store,
        source,
        { limit: loaded.strava.fullTracksPerSync, japanOnly: true },
        false,
        log,
      ).catch((error: unknown) => {
        // The pull itself succeeded; what was fetched is kept, and the next sync carries on.
        log.warn(`Full tracks stopped part way: ${errorText(error)}`);
        return undefined;
      });
      if (tracks && (tracks.fetched + tracks.missing > 0 || tracks.remaining > 0))
        log.info(
          `Full tracks: ${tracks.fetched} fetched${tracks.missing ? `, ${tracks.missing} without GPS samples` : ''}${tracks.remaining > 0 ? `, ${tracks.remaining} still to do (the next sync continues, or \`--streams missing --limit 400\` does them now)` : ''}.`,
        );
    }
    log.info(
      `Strava requests this run: ${session.http.requests}${session.http.rate ? ` (15 min: ${session.http.rate.shortUsage}/${session.http.rate.shortLimit}, today: ${session.http.rate.dailyUsage}/${session.http.rate.dailyLimit})` : ''}.`,
    );
    if (report.outcome !== 'ok') {
      const reason = (report.error ?? 'unknown error').replace(/\.$/, '');
      log.error(
        reason.includes('resumes')
          ? `The pull stopped: ${reason}.`
          : `The pull stopped: ${reason}. Run \`pnpm jam sync strava\` again to resume where it stopped.`,
      );
      return 1;
    }
    return 0;
  } finally {
    store.close();
  }
};

export const stravaWipe = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  const store = await openStore(log);
  try {
    const preview = await wipeStrava(store, true);
    if (flags.dryRun || options.yes !== true) {
      log.info(
        `Would delete ${preview.activities} Strava activities and ${preview.tracks} tracks. Sheet rows, overrides and route names stay.`,
      );
      if (!flags.dryRun)
        log.info(
          'Run `pnpm jam strava wipe --yes` to do it. The store is copied to data/backups first.',
        );
      return 0;
    }
    const result = await wipeStrava(store, false);
    log.info(
      `Deleted ${result.activities} Strava activities and ${result.tracks} tracks. Copy first: ${result.backup ? shownPath(result.backup) : 'none'}.`,
    );
    log.info(
      'The next `pnpm jam sync strava` is a full pull with the range and types in config/strava.jsonc.',
    );
    return 0;
  } finally {
    store.close();
  }
};

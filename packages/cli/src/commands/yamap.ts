import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import { JamError } from '../errors.ts';
import { shownPath } from '../paths.ts';
import { openDraft, SetupError, takeAnswer, writeDraft } from '../setup/engine.ts';
import { ttyPrompter } from '../setup/prompt-tty.ts';
import { findFacts } from '../setup/state.ts';
import { stepById } from '../setup/steps.ts';
import { openStore } from '../store/store.ts';
import { TOKEN_HELP, YamapApi, YamapTokenError } from '../yamap/http.ts';
import { isSummary, pullYamap, wipeYamap } from '../yamap/sync.ts';
import {
  cleanToken,
  noteTokenFresh,
  noteTokenRefused,
  tokenFrom,
  tokenRefusedAt,
} from '../yamap/token.ts';
import { configFor } from './config.ts';
import { pullRange, rangeText } from './range.ts';
import { previewStore } from './sheet.ts';
import type { CommandContext } from './types.ts';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The exit code of a sync that did all it could without a working token: the list is in, tracks
 * are waiting. `jam update` goes on to build with what there is, then fails with the reminder.
 */
export const TOKEN_EXIT = 3;

/** What to do about a refused token, the same words everywhere. */
const RENEW =
  'To renew it: `pnpm jam yamap token` (paste the new one; it is not shown), or the setup page (`pnpm jam setup --web`, Change, YAMAP).';

/** `jam sync yamap`: the list of activities, then their tracks. */
export const syncYamap = async ({ flags, log, options }: CommandContext): Promise<number> => {
  const config = configFor({ flags, log });
  if (!config) return 1;
  // Real activities stay out of made-up data.
  if (currentStoreMarker()) {
    log.error(demoRefusal('YAMAP activities are not fetched into it'));
    return 1;
  }
  const settings = config.site.activities.yamap;
  let tracks: number | undefined;
  if (typeof options.tracks === 'string') {
    tracks = options.tracks === 'all' ? Number.MAX_SAFE_INTEGER : Number(options.tracks);
    if (!Number.isInteger(tracks) || tracks < 0)
      throw new JamError('--tracks takes a whole number, or "all".');
  }
  const range = pullRange(options, config.sheet.timeZone);
  const token = tokenFrom(config.secrets.yamap?.token);
  const api = new YamapApi(token, settings.api.baseUrl, log, settings.api.pauseMs);
  const preview = flags.dryRun ? await previewStore(log) : undefined;
  const store = preview?.store ?? (await openStore(log));
  try {
    const result = await pullYamap(
      store,
      api,
      config,
      {
        full: options.full === true,
        dryRun: flags.dryRun,
        ...(tracks !== undefined ? { tracks } : {}),
        ...(range ? { range } : {}),
      },
      log,
    );
    const summary = `${result.added} added, ${result.updated} updated, ${result.removed} removed, ${result.unchanged} unchanged`;
    log.info(
      `YAMAP: ${plural(result.listed, 'activity', 'activities')} listed${range ? `, ${rangeText(range)} only` : ''}${options.full === true ? ' (full pull)' : ''}.`,
    );
    if (result.undated > 0)
      log.info(
        `  Skipped ${plural(result.undated, 'activity', 'activities')} whose start YAMAP did not give.`,
      );
    if (flags.dryRun) {
      log.info(
        `Dry run, nothing written. Would be: ${summary}; ${plural(result.tracks.left, 'track')} to fetch.`,
      );
      if (!token) log.warn(`There is no YAMAP sign-in token, and tracks need one. ${TOKEN_HELP}`);
      return 0;
    }
    if (result.backup) log.info(`Copied the store to ${shownPath(result.backup)} before removing.`);
    log.info(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
    const left = result.tracks.left + result.tracks.unanswered;
    log.info(
      `Tracks: ${result.tracks.fetched} fetched (${result.tracks.withTrack} with a track, ${result.tracks.withoutTrack} without)${result.tracks.unanswered > 0 ? `, ${result.tracks.unanswered} YAMAP did not answer for` : ''}, ${left} still to fetch. ${api.requests} requests.`,
    );
    if (api.longestGapMs > settings.api.pauseMs)
      log.info(
        `YAMAP was slow to answer, so the wait between requests went up to ${Math.round(api.longestGapMs / 1000)} s.`,
      );
    if (config.site.activities.source !== 'yamap')
      log.info(
        `The site is built from "${config.site.activities.source}". To build it from these, set activities.source to "yamap" in config/site.jsonc.`,
      );
    // The token: said last and as an error, so that a scheduled run fails where it is seen.
    if (result.tokenMissing) {
      log.error(`There is no YAMAP sign-in token, and tracks need one. ${TOKEN_HELP}`);
      log.error(
        `The list is in; ${plural(left, 'track')} will be fetched once a token is stored: \`pnpm jam yamap token\`, or the setup page.`,
      );
      return TOKEN_EXIT;
    }
    if (result.tokenRefused || api.tokenRefused) {
      noteTokenRefused();
      log.error(
        result.tokenRefused ??
          `YAMAP refused the sign-in token: it has expired, or it is not this account's. ${TOKEN_HELP}`,
      );
      log.error(
        `The list is in; ${plural(left, 'track')} could not be fetched and will be once the token is renewed. ${RENEW}`,
      );
      return TOKEN_EXIT;
    }
    if (result.tracks.fetched > 0) noteTokenFresh();
    if (result.limited) log.warn(result.limited);
    else if (left > 0)
      log.info(
        'Run it again for more, or `pnpm jam sync yamap --tracks all`. Until its track is fetched an activity counts as one without GPS.',
      );
    return 0;
  } finally {
    if (preview) preview.dispose();
    else store.close();
  }
};

/** Asks YAMAP for the newest activity with a track, which only a working token gets. */
const tokenWorks = async (
  api: YamapApi,
  userId: string,
): Promise<{ listed: number; total?: number; checked: boolean }> => {
  const page = await api.list(userId, 1);
  const withTrack = page.activities
    .filter(isSummary)
    .find((activity) => activity.has_points !== false);
  if (withTrack) await api.track(withTrack.id);
  return {
    listed: page.activities.length,
    ...(page.total !== undefined ? { total: page.total } : {}),
    checked: withTrack !== undefined,
  };
};

/** `jam yamap check`: whether the user id and the token work, without storing anything. */
export const yamapCheck = async ({ flags, log }: CommandContext): Promise<number> => {
  const config = configFor({ flags, log });
  if (!config) return 1;
  const settings = config.site.activities.yamap;
  if (!settings.userId)
    throw new JamError(
      'No YAMAP user id. Put the number from your profile address (yamap.com/users/<number>) in config/site.jsonc as activities.yamap.userId, or run `pnpm jam setup`.',
    );
  const token = tokenFrom(config.secrets.yamap?.token);
  const api = new YamapApi(token, settings.api.baseUrl, log, settings.api.pauseMs);
  try {
    const found = await tokenWorks(api, settings.userId);
    log.info(
      `YAMAP user ${settings.userId}: ${found.total !== undefined ? plural(found.total, 'activity', 'activities') : `a first page of ${found.listed}`}.`,
    );
    if (api.tokenRefused) throw new YamapTokenError('YAMAP refused the sign-in token on the list.');
    if (!found.checked)
      log.info('No activity with a track on the first page, so the token could not be tried.');
    else {
      noteTokenFresh();
      log.info('The YAMAP sign-in token works: YAMAP gave the track of the newest activity.');
    }
    log.info(
      'The token lasts until YAMAP signs that browser out. When it stops working, every command says so and how to renew it.',
    );
    return 0;
  } catch (failure) {
    if (!(failure instanceof YamapTokenError)) throw failure;
    if (token) noteTokenRefused();
    log.error(failure.message);
    log.error(RENEW);
    return 1;
  }
};

const readStdin = async (): Promise<string> => {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
};

/**
 * `jam yamap token`: stores a new sign-in token, pasted without being shown or piped in, then
 * tries it. The token goes to config/secrets.jsonc and nowhere else.
 */
export const yamapToken = async ({ flags, log }: CommandContext): Promise<number> => {
  const step = stepById('yamap.token');
  if (!step) throw new JamError('This version has no YAMAP token setting.');
  let pasted: string;
  if (process.stdin.isTTY) {
    const prompter = ttyPrompter();
    prompter.say(
      TOKEN_HELP.replace(' and give it to `pnpm jam yamap token` or the setup page', ''),
    );
    const typed = await prompter.ask({
      id: step.id,
      kind: 'secret',
      title: 'Paste the yamap_token value (it is not shown), then Enter',
    });
    pasted = typeof typed === 'string' ? typed : '';
  } else pasted = await readStdin();
  const token = cleanToken(pasted);
  if (token === '') {
    log.error('No token given; nothing was changed.');
    return 1;
  }
  if (/\s/.test(token) || token.length < 8)
    throw new JamError(
      'That does not look like a yamap_token value: it should be one run of letters and digits, with no spaces.',
    );
  if (flags.dryRun) {
    log.info('Dry run: the token would be stored in config/secrets.jsonc.');
    return 0;
  }
  const { draft, config } = openDraft(flags.configDir);
  const problem = takeAnswer(draft, step, token, {
    mode: 'change',
    answers: { sources: ['yamap'] },
    config,
    facts: findFacts(flags.configDir, config.sheet.path),
  });
  if (problem) throw new SetupError(problem);
  const written = writeDraft(draft);
  noteTokenFresh();
  if (process.env.JAM_YAMAP_TOKEN)
    log.warn(
      'JAM_YAMAP_TOKEN is set in the environment and is used before the stored token: change or unset it too.',
    );
  log.info(
    written.length > 0
      ? 'Stored the new YAMAP sign-in token in config/secrets.jsonc (readable only by you).'
      : 'That is the token already stored.',
  );
  // Tried straight away, so a wrong paste is known now and not at the next sync.
  const settings = config.site.activities.yamap;
  if (!settings.userId) {
    log.info(
      'Set activities.yamap.userId (or run `pnpm jam setup`) and `pnpm jam yamap check` tries it.',
    );
    return 0;
  }
  const api = new YamapApi(token, settings.api.baseUrl, log, settings.api.pauseMs);
  try {
    const found = await tokenWorks(api, settings.userId);
    if (api.tokenRefused) throw new YamapTokenError('YAMAP refused the token on the list.');
    log.info(
      found.checked
        ? 'It works: YAMAP gave the track of the newest activity. `pnpm jam sync yamap` carries on.'
        : 'Stored. No activity with a track on the first page, so it could not be tried.',
    );
    return 0;
  } catch (failure) {
    if (!(failure instanceof YamapTokenError)) {
      log.warn(
        `Stored, but it could not be tried: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      return 0;
    }
    noteTokenRefused();
    log.error(
      `YAMAP refused that token. Copy it again while signed in at yamap.com: it is the whole value of the yamap_token cookie. ${RENEW}`,
    );
    return 1;
  }
};

/** `jam yamap wipe`: every YAMAP activity out of the store, after a copy. */
export const yamapWipe = async ({ flags, log, options }: CommandContext): Promise<number> => {
  const store = await openStore(log);
  try {
    const preview = await wipeYamap(store, true);
    if (flags.dryRun || options.yes !== true) {
      log.info(
        `Would delete ${preview.activities} YAMAP activities and ${preview.tracks} tracks. Activities from the other sources, sheet rows, overrides and route names stay.`,
      );
      if (!flags.dryRun)
        log.info(
          'Run `pnpm jam yamap wipe --yes` to do it. The store is copied to data/backups first.',
        );
      return 0;
    }
    const result = await wipeYamap(store, false);
    log.info(
      `Deleted ${result.activities} YAMAP activities and ${result.tracks} tracks. Copy first: ${result.backup ? shownPath(result.backup) : 'none'}.`,
    );
    log.info('`pnpm jam sync yamap` fetches them again, with the same ids.');
    return 0;
  } finally {
    store.close();
  }
};

export { tokenRefusedAt };

/**
 * The Garmin Connect Personal API: a personal key is exchanged for a token (valid a day, no
 * refresh), and the token reads the key owner's own activities.
 *
 * Garmin throttles: it answers a client that asks too fast with gateway timeouts (504), not with
 * a plain "slow down". So there is never more than one request under way, every request waits a
 * while after the one before it, and the wait grows each time Garmin fails to answer and shrinks
 * back slowly once it answers again.
 */
import { setTimeout as sleepFor } from 'node:timers/promises';

import { errorText, JamError } from '../errors.ts';
import type { Logger } from '../logger.ts';

/** The key is missing, wrong, deleted or past its date: fixed on Garmin Connect, not by waiting. */
export class GarminKeyError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'GarminKeyError';
  }
}

/** Garmin said to slow down; what was fetched is kept and the next run carries on. */
export class GarminLimitError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'GarminLimitError';
  }
}

/** Garmin will not give this one activity's file; the others are still worth asking for. */
export class GarminFileError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'GarminFileError';
  }
}

/** Garmin could not be reached, or kept failing. */
export class GarminRequestError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'GarminRequestError';
  }
}

const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const LIST_PATH = '/activitylist-service/activities/search/activities';
const FILE_PATH = '/download-service/files/activity/';
/** Garmin's own default page; a larger one is not documented. */
export const PAGE_SIZE = 99;
/** Waits before a second, third and fourth try, on top of the wait between any two requests. */
const WAITS_MS = [5000, 15_000, 30_000];
/** The wait between two requests never grows past this. */
const LONGEST_GAP_MS = 30_000;

/** For the checks: JAM_SLEEP_SCALE=0 skips real waiting. */
const scale = Number(process.env.JAM_SLEEP_SCALE ?? '1');
export const pause = (ms: number) =>
  sleepFor(Math.max(0, ms * (Number.isFinite(scale) ? scale : 1)));

const KEY_HELP =
  'Create a new one on Garmin Connect (Settings, Personal API Key) and put it in config/secrets.jsonc as garmin.apiKey. See docs/garmin.md.';

export interface ListQuery {
  /** Zero-based offset. */
  start: number;
  /** How many to ask for; PAGE_SIZE when left out. */
  limit?: number;
  /** Inclusive, YYYY-MM-DD, by the activity's local start. */
  startDate?: string;
  endDate?: string;
}

export class GarminApi {
  readonly #key: string;
  readonly #base: string;
  readonly #log: Logger;
  #token: string | undefined;
  /** The wait between two requests asked for in the settings, and the one in force now. */
  readonly #baseGap: number;
  #gap: number;
  /** The one request under way, or the last one: the next waits for it, then for the gap. */
  #turn: Promise<void> = Promise.resolve();
  /** Requests made, for the summary. */
  requests = 0;
  /** The longest the wait between two requests got this run, in milliseconds. */
  longestGapMs = 0;

  constructor(key: string, baseUrl: string, log: Logger, pauseMs: number) {
    this.#key = key;
    this.#base = baseUrl.replace(/\/+$/, '');
    this.#log = log;
    this.#baseGap = pauseMs;
    this.#gap = pauseMs;
  }

  /** The wait in force between two requests, in milliseconds. */
  get gapMs(): number {
    return Math.round(this.#gap);
  }

  /**
   * One request, in its turn: after the request before it has ended and the gap has passed. The
   * gap is a little uneven on purpose, so the requests do not arrive like a clock.
   */
  async #send(url: string, init: RequestInit): Promise<Response> {
    const before = this.#turn;
    let done: () => void = () => {};
    this.#turn = new Promise<void>((resolve) => {
      done = resolve;
    });
    await before;
    try {
      if (this.requests > 0) await pause(this.#gap * (0.8 + Math.random() * 0.4));
      this.requests++;
      const response = await fetch(url, init);
      const throttled = response.status === 429 || response.status >= 500;
      // Twice as slow after an answer that says "too much"; back towards the setting, a tenth at
      // a time, with each answer that does not.
      this.#gap = throttled
        ? Math.min(LONGEST_GAP_MS, Math.max(this.#gap, 1000) * 2)
        : Math.max(this.#baseGap, this.#gap * 0.9);
      return response;
    } catch (error) {
      this.#gap = Math.min(LONGEST_GAP_MS, Math.max(this.#gap, 1000) * 2);
      throw error;
    } finally {
      this.longestGapMs = Math.max(this.longestGapMs, this.#gap);
      done();
    }
  }

  async #fetch(path: string, init: RequestInit): Promise<Response> {
    let lastError = '';
    for (let attempt = 0; attempt <= WAITS_MS.length; attempt++) {
      if (attempt > 0) await pause(WAITS_MS[attempt - 1] ?? 0);
      let response: Response;
      try {
        response = await this.#send(`${this.#base}${path}`, init);
      } catch (error) {
        lastError = errorText(error);
        this.#log.debug(`Garmin: ${path} failed (${lastError}), attempt ${attempt + 1}`);
        continue;
      }
      if (response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        this.#log.debug(
          `Garmin: ${path} answered ${lastError}, attempt ${attempt + 1}; now ${this.gapMs} ms between requests`,
        );
        continue;
      }
      // "Not acceptable": Garmin answers in a form other than the one asked for. Ask for any.
      const headers = new Headers(init.headers);
      if (response.status === 406 && headers.get('Accept') !== '*/*') {
        headers.set('Accept', '*/*');
        return this.#send(`${this.#base}${path}`, { ...init, headers });
      }
      return response;
    }
    throw new GarminRequestError(
      `Could not reach Garmin Connect (${lastError}). Run the command again; it carries on where it stopped.`,
    );
  }

  /** Exchanges the key for a token. Throws a GarminKeyError when Garmin does not take the key. */
  async signIn(): Promise<void> {
    const response = await this.#fetch(TOKEN_PATH, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${this.#key}`, Accept: '*/*' },
    });
    if (response.status === 401 || response.status === 403)
      throw new GarminKeyError(
        `Garmin Connect did not accept the personal API key (HTTP ${response.status}): it is wrong, deleted or expired. ${KEY_HELP}`,
      );
    if (response.status === 429)
      throw new GarminLimitError('Garmin Connect is limiting requests. Try again later.');
    if (!response.ok)
      throw new GarminRequestError(`Garmin Connect answered HTTP ${response.status} to the key.`);
    const text = (await response.text()).trim();
    let token: unknown = text;
    let fields = '';
    try {
      const body: unknown = JSON.parse(text);
      if (typeof body === 'string') token = body;
      else if (typeof body === 'object' && body !== null) {
        const record = body as Record<string, unknown>;
        // The field's name is not documented: the usual ones, then the only text that looks like one.
        token =
          record.access_token ??
          record.accessToken ??
          record.token ??
          Object.entries(record).find(
            ([name, value]) => /token/i.test(name) && typeof value === 'string',
          )?.[1];
        // Names only, never values: enough to say what Garmin sent when none of them is the token.
        fields = ` Its fields: ${Object.keys(record).join(', ') || 'none'}.`;
      }
    } catch {
      // Not JSON: the body is the token itself.
    }
    if (typeof token !== 'string' || token === '' || /\s/.test(token))
      throw new GarminRequestError(`Garmin Connect answered the key without a token.${fields}`);
    this.#token = token;
  }

  async #get(path: string, accept: string, own403 = false): Promise<Response> {
    if (!this.#token) await this.signIn();
    const call = () =>
      this.#fetch(path, {
        headers: { Authorization: `Bearer ${this.#token ?? ''}`, Accept: accept },
      });
    let response = await call();
    // A token lasts a day: a long first pull can outlive one.
    if (response.status === 401) {
      await this.signIn();
      response = await call();
    }
    if (response.status === 401 || (response.status === 403 && !own403))
      throw new GarminKeyError(
        `Garmin Connect refused the request (HTTP ${response.status}). ${KEY_HELP}`,
      );
    if (response.status === 429)
      throw new GarminLimitError(
        'Garmin Connect is limiting requests. What was fetched is kept; run the command again later and it carries on.',
      );
    return response;
  }

  /** One page of activity summaries, oldest first. */
  async list(query: ListQuery): Promise<unknown[]> {
    const params = new URLSearchParams({
      start: String(query.start),
      limit: String(query.limit ?? PAGE_SIZE),
      sortBy: 'startLocal',
      sortOrder: 'asc',
    });
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);
    const response = await this.#get(`${LIST_PATH}?${params.toString()}`, 'application/json');
    if (!response.ok)
      throw new GarminRequestError(
        `Garmin Connect answered HTTP ${response.status} to the activity list.`,
      );
    const body: unknown = await response.json();
    if (!Array.isArray(body))
      throw new GarminRequestError('Garmin Connect answered the activity list with no list.');
    return body;
  }

  /** An activity's original file as Garmin sends it (a zip); undefined when it has none. */
  async file(activityId: number): Promise<Uint8Array | undefined> {
    // The list already worked with this token, so a refusal here is about this one activity.
    const response = await this.#get(`${FILE_PATH}${activityId}`, '*/*', true);
    if (response.status === 404) return undefined;
    if (response.status >= 400 && response.status < 500)
      throw new GarminFileError(`Garmin Connect answered HTTP ${response.status} to its file`);
    if (!response.ok)
      throw new GarminRequestError(
        `Garmin Connect answered HTTP ${response.status} to the file of activity ${activityId}.`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }
}

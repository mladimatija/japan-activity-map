/**
 * YAMAP's web API, as yamap.com itself uses it: the list of a user's activities, one activity's
 * details, and its recorded track as GPX. The track is only given to its owner, signed in: the
 * request carries the `yamap_token` cookie's value. There is no key to create and no refresh; the
 * token stops working when YAMAP signs the browser out, and then a new one has to be pasted.
 *
 * Nothing here is a documented, public API. Requests go one at a time, slowly (net/pacer.ts).
 */
import { errorText, JamError } from '../errors.ts';
import type { Logger } from '../logger.ts';
import { Pacer, pause, retryAfterMs } from '../net/pacer.ts';

/** YAMAP refuses the token: wrong, or expired because the browser it came from was signed out. */
export class YamapTokenError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'YamapTokenError';
  }
}

/** YAMAP said to slow down; what was fetched is kept and the next run carries on. */
export class YamapLimitError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'YamapLimitError';
  }
}

/** YAMAP could not be reached, or kept failing. */
export class YamapRequestError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'YamapRequestError';
  }
}

/** How to get a new token, said wherever one is missing or refused. */
export const TOKEN_HELP =
  'Sign in at https://yamap.com in your browser, open the developer tools (Application or Storage, then Cookies, then https://yamap.com), copy the value of the cookie named yamap_token, and give it to `pnpm jam yamap token` or the setup page. See docs/yamap.md.';

/**
 * YAMAP answers 490 ("update the app") to a caller whose name starts with "yamap": it takes it
 * for an old phone app. This says plainly what is calling, as a web client.
 */
const USER_AGENT =
  'Mozilla/5.0 (compatible) japan-activity-map (+https://github.com/mladimatija/japan-activity-map)';
/** Waits before a second, third and fourth try, on top of the wait between any two requests. */
const WAITS_MS = [5000, 15_000, 30_000];
const LONGEST_RETRY_AFTER_MS = 120_000;

export interface ListPage {
  activities: unknown[];
  /** The page after this one, or undefined on the last. */
  next?: number;
  /** How many activities the user has in all, when YAMAP says. */
  total?: number;
}

export class YamapApi {
  readonly #token: string | undefined;
  readonly #base: string;
  readonly #log: Logger;
  readonly #pacer: Pacer;
  /** Set once YAMAP has refused the token on a call that works without one. */
  tokenRefused = false;

  constructor(token: string | undefined, baseUrl: string, log: Logger, pauseMs: number) {
    this.#token = token;
    this.#base = baseUrl.replace(/\/+$/, '');
    this.#log = log;
    this.#pacer = new Pacer(pauseMs);
  }

  get requests(): number {
    return this.#pacer.requests;
  }

  get longestGapMs(): number {
    return this.#pacer.longestGapMs;
  }

  get hasToken(): boolean {
    return this.#token !== undefined;
  }

  async #fetch(path: string, accept: string, signed: boolean): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: accept,
      // Without this, place names come back in English.
      'Accept-Language': 'ja',
      ...(signed && this.#token ? { Authorization: `Bearer token=${this.#token}` } : {}),
    };
    let lastError = '';
    let waited = false;
    for (let attempt = 0; attempt <= WAITS_MS.length; attempt++) {
      if (attempt > 0 && !waited) await pause(WAITS_MS[attempt - 1] ?? 0);
      waited = false;
      let response: Response;
      try {
        response = await this.#pacer.send(`${this.#base}${path}`, { headers });
      } catch (error) {
        lastError = errorText(error);
        this.#log.debug(`YAMAP: ${path} failed (${lastError}), attempt ${attempt + 1}`);
        continue;
      }
      const asked = retryAfterMs(response.headers);
      if ((response.status === 429 || response.status === 503) && asked !== undefined) {
        if (asked > LONGEST_RETRY_AFTER_MS)
          throw new YamapLimitError(
            `YAMAP asks for a pause of ${Math.ceil(asked / 60_000)} minutes. What was fetched is kept; run the command again then and it carries on.`,
          );
        if (attempt < WAITS_MS.length) {
          await pause(asked);
          waited = true;
          lastError = `HTTP ${response.status}`;
          continue;
        }
      }
      if (response.status === 429) {
        if (attempt < WAITS_MS.length) {
          lastError = 'HTTP 429';
          continue;
        }
        throw new YamapLimitError(
          'YAMAP is limiting requests. What was fetched is kept; run the command again later and it carries on.',
        );
      }
      if (response.status >= 500) {
        lastError = `HTTP ${response.status}`;
        this.#log.debug(`YAMAP: ${path} answered ${lastError}, attempt ${attempt + 1}`);
        continue;
      }
      if (response.status === 490)
        throw new YamapRequestError(
          'YAMAP answered 490: it took this for an outdated app. Its web API has changed; this needs a fix in the code.',
        );
      return response;
    }
    throw new YamapRequestError(
      `Could not reach YAMAP (${lastError}). Run the command again; it carries on where it stopped.`,
    );
  }

  /**
   * JSON that YAMAP gives to anyone. The token is sent along when there is one, since a signed-in
   * owner may see more of their own; if YAMAP refuses it there, the call is made again without,
   * and `tokenRefused` says so.
   */
  async #json(path: string, what: string): Promise<Record<string, unknown>> {
    let response = await this.#fetch(path, 'application/json', !this.tokenRefused);
    if (response.status === 401 && this.#token && !this.tokenRefused) {
      this.tokenRefused = true;
      response = await this.#fetch(path, 'application/json', false);
    }
    if (response.status === 404)
      throw new YamapRequestError(
        `YAMAP has no ${what} (HTTP 404).${what === 'the activity list' ? ' Check activities.yamap.userId.' : ''}`,
      );
    if (!response.ok)
      throw new YamapRequestError(`YAMAP answered HTTP ${response.status} to ${what}.`);
    const body: unknown = await response.json().catch(() => undefined);
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw new YamapRequestError(`YAMAP answered ${what} with something that is not a record.`);
    return body as Record<string, unknown>;
  }

  /** One page of a user's activities, as YAMAP orders them. Pages start at 1. */
  async list(userId: string, page: number): Promise<ListPage> {
    const body = await this.#json(`/users/${userId}/activities?page=${page}`, 'the activity list');
    const meta = (typeof body.meta === 'object' && body.meta !== null ? body.meta : {}) as Record<
      string,
      unknown
    >;
    const next = typeof meta.next_page === 'number' ? meta.next_page : undefined;
    return {
      activities: Array.isArray(body.activities) ? body.activities : [],
      ...(next !== undefined && next > page ? { next } : {}),
      ...(typeof meta.total_count === 'number' ? { total: meta.total_count } : {}),
    };
  }

  /** One activity's details. */
  async activity(id: number): Promise<unknown> {
    const body = await this.#json(`/activities/${id}`, `activity ${id}`);
    return body.activity ?? body;
  }

  /**
   * An activity's recorded track, as the GPX file YAMAP's own "export" gives; undefined when it
   * has none. Throws a YamapTokenError when YAMAP does not take the token.
   */
  async track(id: number): Promise<Uint8Array | undefined> {
    if (!this.#token)
      throw new YamapTokenError(
        `There is no YAMAP sign-in token, and tracks need one. ${TOKEN_HELP}`,
      );
    const response = await this.#fetch(`/activities/${id}/points.xml`, 'application/gpx+xml', true);
    if (response.status === 401 || response.status === 403)
      throw new YamapTokenError(
        `YAMAP refused the sign-in token (HTTP ${response.status}): it has expired, or it is not the token of the account whose activities these are. ${TOKEN_HELP}`,
      );
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new YamapRequestError(
        `YAMAP answered HTTP ${response.status} to the track of activity ${id}.`,
      );
    return new Uint8Array(await response.arrayBuffer());
  }
}

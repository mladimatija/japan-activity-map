import { setTimeout as sleepFor } from 'node:timers/promises';

import type { Logger } from '../logger.ts';
import { JamError, errorText } from '../errors.ts';

/** Sign-in problems the user fixes with `jam strava auth`. */
export class StravaAuthError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'StravaAuthError';
  }
}

/** Strava could not be reached, or kept failing; running the command again resumes. */
export class StravaRequestError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'StravaRequestError';
  }
}

/** The daily limit is used up; the pull can resume tomorrow (UTC). */
export class StravaDailyLimitError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'StravaDailyLimitError';
  }
}

interface RateState {
  /** 15-minute and daily usage and limits, from the last response. */
  shortUsage: number;
  shortLimit: number;
  dailyUsage: number;
  dailyLimit: number;
}

/** Requests kept in reserve below each limit, so other tools using the same app are not cut off. */
const MARGIN = 5;
const RETRIES = 5;

/** For the development server: JAM_SLEEP_SCALE=0 skips real waiting. */
const scale = Number(process.env.JAM_SLEEP_SCALE ?? '1');
const sleep = (ms: number) => sleepFor(Math.max(0, ms * (Number.isFinite(scale) ? scale : 1)));

/** Milliseconds until the next 15-minute boundary (:00, :15, :30, :45), plus a little. */
const untilNextQuarter = (now = Date.now()): number => {
  const quarter = 15 * 60_000;
  return quarter - (now % quarter) + 5_000;
};

const parsePair = (value: string | null): [number, number] | undefined => {
  if (!value) return undefined;
  const [a, b] = value.split(',').map((part) => Number(part.trim()));
  return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)
    ? [a, b]
    : undefined;
};

export class StravaHttp {
  readonly #baseUrl: string;
  readonly #log: Logger;
  #token: () => Promise<string>;
  rate: RateState | undefined;
  requests = 0;

  constructor(baseUrl: string, token: () => Promise<string>, log: Logger) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#token = token;
    this.#log = log;
  }

  /** GET a JSON resource under the API base, for example /athlete/activities. */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));

    let limited = 0;
    for (let attempt = 1; ; attempt++) {
      await this.#waitForBudget();
      let response: Response;
      try {
        response = await fetch(url, {
          // The token always goes in the header, as Strava requires from 2027.
          headers: { Authorization: `Bearer ${await this.#token()}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt >= RETRIES)
          throw new StravaRequestError(
            `Strava did not answer after ${RETRIES} tries: ${errorText(error)}`,
          );
        await this.#backoff(attempt, 'network error');
        continue;
      }
      this.requests++;
      this.#readRate(response.headers);
      if (response.ok) return (await response.json()) as T;

      const body = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new StravaAuthError(
          'Strava rejected the sign-in (401). Run `pnpm jam strava auth` to sign in again.',
        );
      }
      if (response.status === 403) {
        throw new StravaAuthError(
          `Strava refused access (403): ${body.slice(0, 200)}. Check that the app is at the "up to 10 athletes" level and that your Strava subscription is active (docs/strava-setup.md).`,
        );
      }
      if (response.status === 429) {
        if (this.rate && this.rate.dailyUsage >= this.rate.dailyLimit) {
          throw new StravaDailyLimitError(
            'Strava daily request limit reached. Run the sync again after midnight UTC; it resumes where it stopped.',
          );
        }
        // Strava's own counters said there was room, twice over: something else is wrong.
        if (++limited > 3)
          throw new StravaRequestError(
            'Strava keeps answering "rate limit reached" although its own counters show room. Try again later.',
          );
        const wait = untilNextQuarter();
        this.#log.warn(
          `Strava rate limit reached; waiting ${Math.round(wait / 1000)} s for the next 15-minute window.`,
        );
        await sleep(wait);
        continue;
      }
      if (response.status >= 500 && attempt < RETRIES) {
        await this.#backoff(attempt, `HTTP ${response.status}`);
        continue;
      }
      throw new StravaRequestError(
        `Strava ${response.status} for ${url.pathname}: ${body.slice(0, 300)}`,
      );
    }
  }

  #readRate(headers: Headers): void {
    // Reads count against the read limit when Strava sends it; otherwise the overall one.
    const usage =
      parsePair(headers.get('x-readratelimit-usage')) ??
      parsePair(headers.get('x-ratelimit-usage'));
    const limit =
      parsePair(headers.get('x-readratelimit-limit')) ??
      parsePair(headers.get('x-ratelimit-limit'));
    if (usage && limit)
      this.rate = {
        shortUsage: usage[0],
        dailyUsage: usage[1],
        shortLimit: limit[0],
        dailyLimit: limit[1],
      };
  }

  async #waitForBudget(): Promise<void> {
    const rate = this.rate;
    if (!rate || rate.shortLimit <= 0 || rate.dailyLimit <= 0) return;
    if (rate.dailyUsage >= rate.dailyLimit - MARGIN) {
      throw new StravaDailyLimitError(
        `Close to Strava's daily request limit (${rate.dailyUsage} of ${rate.dailyLimit}). Run the sync again after midnight UTC; it resumes where it stopped.`,
      );
    }
    if (rate.shortUsage >= rate.shortLimit - MARGIN) {
      const wait = untilNextQuarter();
      this.#log.info(
        `Pausing ${Math.round(wait / 1000)} s: ${rate.shortUsage} of ${rate.shortLimit} requests used in this 15-minute window.`,
      );
      await sleep(wait);
      this.rate = { ...rate, shortUsage: 0 };
    }
  }

  async #backoff(attempt: number, reason: string): Promise<void> {
    const wait = 2 ** attempt * 1000;
    this.#log.warn(
      `Strava: ${reason}; retrying in ${wait / 1000} s (try ${attempt + 1} of ${RETRIES}).`,
    );
    await sleep(wait);
  }
}

/**
 * Polite requests to a service that throttles: never more than one under way, each waiting a
 * while after the one before it, and the wait growing each time the service fails to answer
 * (a 429, a 5xx, a dropped connection) and shrinking back slowly once it answers again.
 */
import { setTimeout as sleepFor } from 'node:timers/promises';

/** The wait between two requests never grows past this. */
const LONGEST_GAP_MS = 30_000;

/** For the checks: JAM_SLEEP_SCALE=0 skips real waiting. */
const scale = Number(process.env.JAM_SLEEP_SCALE ?? '1');
export const pause = (ms: number) =>
  sleepFor(Math.max(0, ms * (Number.isFinite(scale) ? scale : 1)));

/**
 * What a Retry-After header asks for, in milliseconds: a number of seconds, or an HTTP date.
 * Undefined when there is none or it cannot be read.
 */
export const retryAfterMs = (headers: Headers, now = Date.now()): number | undefined => {
  const value = headers.get('Retry-After');
  if (!value) return undefined;
  const seconds = /^\s*\d+\s*$/.test(value) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, seconds) * 1000 : undefined;
};

export class Pacer {
  /** The wait between two requests asked for in the settings, and the one in force now. */
  readonly #baseGap: number;
  #gap: number;
  /** The one request under way, or the last one: the next waits for it, then for the gap. */
  #turn: Promise<void> = Promise.resolve();
  /** Requests made, for the summary. */
  requests = 0;
  /** The longest the wait between two requests got, in milliseconds. */
  longestGapMs = 0;

  constructor(pauseMs: number) {
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
  async send(url: string, init: RequestInit): Promise<Response> {
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
}

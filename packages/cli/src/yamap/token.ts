/**
 * The YAMAP sign-in token: where it comes from, how a pasted one is tidied, and a small note on
 * disk of when YAMAP last refused it, so `jam status` and the setup page can say that it needs
 * renewing without asking YAMAP. The note holds a date, never the token.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR } from '../paths.ts';

const STATE_FILE = join(DATA_DIR, 'yamap-token.json');

/**
 * A token as pasted: the cookie's value, however it was copied. Takes "yamap_token=…", a whole
 * "Cookie:" line, quotes and stray spaces; gives the bare value.
 */
export const cleanToken = (pasted: string): string => {
  let text = pasted.trim().replace(/^cookie:\s*/i, '');
  const named = /(?:^|;\s*)yamap_token=([^;]*)/i.exec(text);
  if (named?.[1] !== undefined) text = named[1];
  return text
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
};

/** The token for this run: the environment first (for a scheduled run), then config/secrets.jsonc. */
export const tokenFrom = (configured: string | undefined): string | undefined => {
  const token = cleanToken(process.env.JAM_YAMAP_TOKEN ?? '') || cleanToken(configured ?? '');
  return token === '' ? undefined : token;
};

/** When YAMAP last refused the token (an ISO time), or undefined when it has not since it last worked. */
export const tokenRefusedAt = (): string | undefined => {
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { refusedAt?: unknown };
    return typeof state.refusedAt === 'string' ? state.refusedAt : undefined;
  } catch {
    return undefined;
  }
};

export const noteTokenRefused = (): void => {
  try {
    writeFileSync(STATE_FILE, `${JSON.stringify({ refusedAt: new Date().toISOString() })}\n`);
  } catch {
    // The note is a convenience: the run itself already says what happened.
  }
};

/** The token worked, or a new one was saved: the note goes. */
export const noteTokenFresh = (): void => {
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE, { force: true });
};

/**
 * What the wizard knows between runs. Most of it is found from files each time (facts); the state
 * file only keeps what cannot be found: answers not yet written, and how far a run got. It never
 * holds a secret or a location.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { findCommand } from '../commands/index.ts';
import { readListIndex } from '../lists/index-file.ts';
import { LISTS_DIR } from '../lists/sources.ts';
import { DATA_DIR, ROOT_DIR } from '../paths.ts';
import { loadToken } from '../strava/auth.ts';
import { parseText, readConfigText, valueAt, writeAtomic } from './jsonc.ts';
import { stepById } from './steps.ts';
import type { Facts, Mode } from './types.ts';

export const STATE_FILE = join(DATA_DIR, 'setup-state.json');

export interface SetupState {
  version: 1;
  mode?: Mode;
  /** Answers given but not yet written to the config files. Never secrets or locations. */
  answers: Record<string, unknown>;
  /** A run that did not finish: its actions in order, and those that ended well. */
  run?: { plan: string[]; done: string[] };
  /** Review files the owner said they have read. */
  reviewed: string[];
  updatedAt?: string;
}

const EMPTY: SetupState = { version: 1, answers: {}, reviewed: [] };

export const loadState = (): SetupState => {
  if (!existsSync(STATE_FILE)) return { ...EMPTY };
  try {
    const value = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<SetupState>;
    if (value.version !== 1) return { ...EMPTY };
    return { ...EMPTY, ...value, answers: value.answers ?? {}, reviewed: value.reviewed ?? [] };
  } catch {
    // An unreadable state file only costs the answers it remembered.
    return { ...EMPTY };
  }
};

/** Only answers that may be kept on disk outside the config files. */
export const keepable = (answers: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(answers).filter(([id]) => {
      const step = stepById(id);
      return (
        step !== undefined &&
        !step.setting?.sensitive &&
        !['secret', 'location', 'zones'].includes(step.kind)
      );
    }),
  );

export const saveState = (state: SetupState): void =>
  writeAtomic(
    STATE_FILE,
    `${JSON.stringify(
      { ...state, answers: keepable(state.answers), updatedAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    0o600,
  );

export const clearState = (): void => rmSync(STATE_FILE, { force: true });

/** What is true on this machine right now. Reads whether credentials exist, never their values. */
export const findFacts = (configDir: string, sheetPath: string): Facts => {
  const secrets = parseText(readConfigText(configDir, 'secrets').text).value;
  const filled = (key: string) => {
    const value = valueAt(secrets, ['strava', key]);
    return typeof value === 'string' && value.length > 0;
  };
  let stravaScope: string | null = null;
  try {
    stravaScope = loadToken()?.scope ?? null;
  } catch {
    // A broken sign-in file counts as not signed in; `strava auth` replaces it.
  }
  let listsMissing: string[] = [];
  const listsBuilt = existsSync(join(LISTS_DIR, 'index.json'));
  if (listsBuilt) {
    try {
      listsMissing = readListIndex().missing.map((list) => list.id);
    } catch {
      listsMissing = [];
    }
  }
  // The folder as the site file names it now, read here so that no caller has to pass it.
  const named = valueAt(parseText(readConfigText(configDir, 'site').text).value, [
    'activities',
    'gpx',
    'folder',
  ]);
  const gpxDir =
    typeof named === 'string' && named !== ''
      ? resolve(ROOT_DIR, named)
      : join(DATA_DIR, 'activities');
  return {
    stravaCredentials: filled('clientId') && filled('clientSecret'),
    stravaScope,
    listsMissing,
    listsBuilt,
    sheetExists: existsSync(resolve(ROOT_DIR, sheetPath)),
    gpxFolderExists: existsSync(gpxDir),
    siteBuilt: existsSync(join(ROOT_DIR, 'dist/data/meta.json')),
    demoAvailable: findCommand(['demo']) !== undefined,
  };
};

/**
 * Routes that look like one route, offered one by one: `jam routes` leaves its merge candidates in
 * data/routes-candidates.json, and saying yes to one adds it to `merge` in config/routes.jsonc.
 * Both wizards use this; the page names a candidate by its position only, never by an id.
 */
import { existsSync, readFileSync } from 'node:fs';

import { ROUTES_CANDIDATES_FILE } from '../commands/routes.ts';
import { checkText, parseText, patchText, readConfigText, writeConfigText } from './jsonc.ts';

export interface MergeCandidate {
  /** Its place in the candidates file: what the page sends back. */
  index: number;
  routes: { name: string; count: number }[];
  reason: string;
  /** Already in routes.jsonc. */
  merged: boolean;
}

interface Stored {
  reason: string;
  routes: { name: string; count: number; ref: string }[];
}

const stored = (): Stored[] => {
  if (!existsSync(ROUTES_CANDIDATES_FILE)) return [];
  try {
    const value = JSON.parse(readFileSync(ROUTES_CANDIDATES_FILE, 'utf8')) as { merge?: Stored[] };
    return (value.merge ?? []).filter((candidate) => candidate.routes.length >= 2);
  } catch {
    return [];
  }
};

const mergesIn = (text: string): string[][] => {
  const value = parseText(text).value as { merge?: unknown[][] };
  return (value.merge ?? []).map((entry) => entry.map(String));
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((ref) => b.includes(ref));

/** The candidates of the last `jam routes`, the most alike first, and which are merged already. */
export const mergeCandidates = (configDir: string): MergeCandidate[] => {
  const merges = mergesIn(readConfigText(configDir, 'routes').text);
  return stored().map((candidate, index) => ({
    index,
    routes: candidate.routes.map(({ name, count }) => ({ name, count })),
    reason: candidate.reason,
    merged: merges.some((entry) =>
      sameSet(
        entry,
        candidate.routes.map((route) => route.ref),
      ),
    ),
  }));
};

/**
 * Adds one candidate to `merge` in routes.jsonc, keeping the rest of the file as it is. Returns
 * false when there is no such candidate; a candidate already merged is left alone.
 */
export const applyMerge = (configDir: string, index: number, dryRun: boolean): boolean => {
  const candidate = stored()[index];
  if (!candidate) return false;
  const file = readConfigText(configDir, 'routes');
  const refs = candidate.routes.map((route) => route.ref);
  const merges = mergesIn(file.text);
  if (merges.some((entry) => sameSet(entry, refs))) return true;
  // Ids are written as routes.jsonc has them: numbers for Strava ids, strings for act_ ids.
  const written = (ref: string) => (/^\d+$/.test(ref) ? Number(ref) : ref);
  const current = (parseText(file.text).value as { merge?: unknown[][] }).merge ?? [];
  const next = patchText(file.text, [{ path: ['merge'], value: [...current, refs.map(written)] }]);
  const checked = checkText('routes', next);
  if (!checked.ok)
    throw new Error(`routes.jsonc would not be valid: ${checked.issues[0]?.message}`);
  if (!dryRun) writeConfigText(file, next);
  return true;
};

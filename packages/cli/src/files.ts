import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Writes a file so that it is either the old one or the new one, never half of the new: the text
 * goes to a temporary file beside it, which then takes its place. An interrupted run leaves the
 * old file as it was.
 */
export const writeFileAtomic = (path: string, text: string): void => {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
};

/** A JSON file's contents. */
export const readJson = <T = unknown>(path: string): T =>
  JSON.parse(readFileSync(path, 'utf8')) as T;

/** Text as a regular expression that matches exactly that text. */
export const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

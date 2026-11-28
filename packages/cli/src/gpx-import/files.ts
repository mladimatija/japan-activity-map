/** Finds the GPX files of an import: a folder (with its subfolders and archives) or one archive. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { Config } from '@jam/core';

import { JamError } from '../errors.ts';
import { DATA_DIR, ROOT_DIR, shownPath } from '../paths.ts';
import { DEFAULT_ZIP_LIMITS, readGpxZip, type ZipLimits } from './zip.ts';

/** An archive is read into memory whole before its entries are unpacked one at a time. */
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

/** The folder `jam sync gpx` reads without a path: data/activities unless site.jsonc names another. */
export const gpxFolder = (config: Pick<Config, 'site'>): string => {
  const folder = config.site.activities.gpx.folder;
  return folder ? resolve(ROOT_DIR, folder) : join(DATA_DIR, 'activities');
};

/** Whether that folder holds anything to import; a missing folder holds nothing. */
export const hasGpxFolder = (config: Pick<Config, 'site'>): boolean => {
  try {
    return statSync(gpxFolder(config)).isDirectory();
  } catch {
    return false;
  }
};

export interface GpxSource {
  /** Path under the folder, or the archive's name and the path inside it. */
  label: string;
  /** File name without folder or extension. */
  name: string;
  /** The file's bytes. Throws a JamError when it cannot be read or is too large. */
  read(): Uint8Array;
}

export interface Collected {
  sources: GpxSource[];
  archives: number;
  /** Things left alone: hidden files, other kinds of file, folders inside archives. */
  ignored: number;
}

/** The same order on every machine, whatever its language. */
const byName = (a: { name: string }, b: { name: string }) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
const stem = (path: string) => basename(path).replace(/\.gpx$/i, '');
const hidden = (name: string) => name.startsWith('.') || name === '__MACOSX';

const readCapped = (path: string, limits: ZipLimits): Uint8Array => {
  const size = statSync(path).size;
  if (size > limits.entryBytes)
    throw new JamError(
      `${Math.ceil(size / 1024 / 1024)} MB, over the ${Math.ceil(limits.entryBytes / 1024 / 1024)} MB a GPX file may be`,
    );
  return readFileSync(path);
};

const fromArchive = (path: string, label: string, limits: ZipLimits, into: Collected): void => {
  const size = statSync(path).size;
  if (size > MAX_ARCHIVE_BYTES)
    throw new JamError(
      `${label}: the archive is ${Math.ceil(size / 1024 / 1024)} MB, over the 1024 MB that is read. Unpack it and import the folder, or split it.`,
    );
  const zip = readGpxZip(readFileSync(path), label, limits);
  into.archives++;
  into.ignored += zip.ignored;
  for (const entry of zip.entries.toSorted(byName))
    into.sources.push({
      label: `${label}/${entry.name}`,
      name: stem(entry.name),
      read: () => entry.read(),
    });
};

const fromFolder = (dir: string, prefix: string, limits: ZipLimits, into: Collected): void => {
  const entries = readdirSync(dir, { withFileTypes: true }).toSorted(byName);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const label = `${prefix}${entry.name}`;
    if (hidden(entry.name)) into.ignored++;
    else if (entry.isDirectory()) fromFolder(path, `${label}/`, limits, into);
    // Links are not followed: an import reads what is in the folder, nothing it points at.
    else if (!entry.isFile()) into.ignored++;
    else if (/\.zip$/i.test(entry.name)) fromArchive(path, label, limits, into);
    else if (/\.gpx$/i.test(entry.name))
      into.sources.push({ label, name: stem(entry.name), read: () => readCapped(path, limits) });
    else into.ignored++;
  }
};

/**
 * Every GPX file under `path`: a folder (subfolders and .zip archives included), one .zip, or one
 * .gpx. Throws a JamError when the path is none of those or an archive is one that is not read.
 */
export const collectGpx = (path: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Collected => {
  const into: Collected = { sources: [], archives: 0, ignored: 0 };
  if (!existsSync(path)) throw new JamError(`Nothing at ${shownPath(path)}.`);
  const stat = statSync(path);
  if (stat.isDirectory()) fromFolder(path, '', limits, into);
  else if (/\.zip$/i.test(path)) fromArchive(path, basename(path), limits, into);
  else if (/\.gpx$/i.test(path))
    into.sources.push({
      label: basename(path),
      name: stem(path),
      read: () => readCapped(path, limits),
    });
  else
    throw new JamError(`${shownPath(path)} is neither a folder, a .zip archive nor a .gpx file.`);
  return into;
};

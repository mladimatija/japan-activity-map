/**
 * Reads the GPX files out of a zip archive with Node's own modules: the central directory is
 * parsed here and each entry is inflated only when it is asked for, so only the packed archive
 * and one unpacked file are in memory at a time. Stored and deflated entries only; no zip64, no encryption, no archive in parts.
 */
import { crc32, inflateRawSync } from 'node:zlib';

import { JamError } from '../errors.ts';

export interface ZipLimits {
  /** The largest file an entry may unpack to, in bytes. */
  entryBytes: number;
  /** The most all GPX entries together may unpack to, in bytes. */
  totalBytes: number;
  /** The most entries an archive may list, of any kind. */
  entries: number;
}

const MB = 1024 * 1024;
/** A day's track with a point every second is a few megabytes; a whole history a few gigabytes. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  entryBytes: 64 * MB,
  totalBytes: 2048 * MB,
  entries: 100_000,
};

export interface GpxZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string;
  /** Unpacked size the archive states. */
  bytes: number;
  /** Unpacks the entry. Throws a JamError when its data is damaged or larger than stated. */
  read(): Uint8Array;
}

export interface GpxZip {
  entries: GpxZipEntry[];
  /** Entries left alone: folders, `__MACOSX`, dotfiles and everything that is not a .gpx file. */
  ignored: number;
}

const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const ENCRYPTED = 0x0001;
const STRONG_ENCRYPTION = 0x0040;
const UTF8_NAME = 0x0800;

const mb = (bytes: number) => `${Math.ceil(bytes / MB)} MB`;

/** Whether an entry's path is one to import: a .gpx or .fit file, not hidden, not macOS's resource copies. */
export const isGpxEntry = (name: string): boolean => {
  const parts = name.split('/').filter(Boolean);
  if (name.endsWith('/') || parts.length === 0) return false;
  if (parts.some((part) => part === '__MACOSX' || part.startsWith('.'))) return false;
  return /\.(gpx|fit)$/i.test(parts.at(-1) ?? '');
};

const decodeName = (raw: Uint8Array, utf8Flag: boolean): string => {
  if (!utf8Flag) {
    // Without the flag the name is in whatever the archiver's system used: UTF-8 on macOS and
    // Linux, Shift_JIS on a Japanese Windows.
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      return new TextDecoder('shift_jis').decode(raw);
    }
  }
  return new TextDecoder('utf-8').decode(raw);
};

/**
 * Lists the GPX entries of a zip archive. `label` names the archive in messages. Throws a JamError
 * for an archive this reader does not take (not a zip, zip64, encrypted, in parts, an unknown
 * compression) or one over the limits; nothing is unpacked before the whole directory passed.
 */
export const readGpxZip = (
  bytes: Uint8Array,
  label: string,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): GpxZip => {
  const refuse = (why: string): never => {
    throw new JamError(`${label}: ${why}`);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) refuse('not a zip archive (no end-of-directory record), or cut short');
  const disk = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const countHere = view.getUint16(end + 8, true);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  const directoryOffset = view.getUint32(end + 16, true);
  const zip64 =
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff ||
    (end >= 20 && view.getUint32(end - 20, true) === ZIP64_LOCATOR);
  if (zip64)
    refuse(
      'a zip64 archive (over 4 GB or 65,535 files), which is not read. Unpack it and import the folder, or split it into smaller archives',
    );
  if (disk !== 0 || directoryDisk !== 0 || countHere !== count)
    refuse('an archive split into parts, which is not read. Unpack it and import the folder');
  if (count > limits.entries)
    refuse(`lists ${count} files, more than the ${limits.entries} an archive may hold`);
  if (directoryOffset + directorySize > end) refuse('a damaged zip archive (bad directory)');

  const entries: GpxZipEntry[] = [];
  let ignored = 0;
  let total = 0;
  let offset = directoryOffset;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== DIRECTORY_ENTRY)
      refuse('a damaged zip archive (bad directory entry)');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const packed = view.getUint32(offset + 20, true);
    const unpacked = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (offset + 46 + nameLength > end) refuse('a damaged zip archive (bad file name)');
    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      (flags & UTF8_NAME) !== 0,
    ).replaceAll('\\', '/');
    offset += 46 + nameLength + extraLength + commentLength;
    if (!isGpxEntry(name)) {
      ignored++;
      continue;
    }
    if (flags & (ENCRYPTED | STRONG_ENCRYPTION))
      refuse(
        `${name} is encrypted (the archive has a password), which is not read. Unpack it and import the folder`,
      );
    if (packed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff)
      refuse(
        `${name} is a zip64 entry, which is not read. Unpack the archive and import the folder`,
      );
    if (method !== 0 && method !== 8)
      refuse(
        `${name} uses compression method ${method}; only stored and deflated files are read. Unpack the archive and import the folder`,
      );
    if (unpacked > limits.entryBytes)
      refuse(
        `${name} unpacks to ${mb(unpacked)}, over the ${mb(limits.entryBytes)} a GPX file may be`,
      );
    total += unpacked;
    if (total > limits.totalBytes)
      refuse(
        `its GPX files unpack to more than ${mb(limits.totalBytes)} in all. Split it into smaller archives`,
      );
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL_HEADER)
      refuse(`a damaged zip archive (bad header for ${name})`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > bytes.length) refuse(`a damaged zip archive (${name} is cut short)`);
    entries.push({
      name,
      bytes: unpacked,
      read: () => {
        const raw = bytes.subarray(start, start + packed);
        let data: Uint8Array;
        if (method === 0) data = raw;
        else {
          try {
            // The stated size is a claim; the ceiling here is what holds against a zip bomb.
            data = new Uint8Array(inflateRawSync(raw, { maxOutputLength: unpacked }));
          } catch {
            throw new JamError(
              `${label}: ${name} is damaged, or unpacks to more than the ${unpacked} bytes it states`,
            );
          }
        }
        if (data.length !== unpacked || crc32(data) !== crc)
          throw new JamError(`${label}: ${name} is damaged (its size or checksum is wrong)`);
        return data;
      },
    });
  }
  return { entries, ignored };
};

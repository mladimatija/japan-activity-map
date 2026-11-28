/**
 * Takes a .zip or .gpx file sent by the setup page into the folder `jam sync gpx` reads. The page
 * names the file but never where it goes: the folder is the server's, and the name is cut down to
 * a plain file name here.
 */
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

import { errorText, JamError } from '../errors.ts';
import { readGpxZip } from '../gpx-import/zip.ts';

/** The largest file the page may send. Larger exports go into the folder by hand. */
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

/** A refusal with the HTTP status that says why. */
export class UploadRefused extends JamError {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'UploadRefused';
    this.status = status;
  }
}

/**
 * The file name an upload is saved under, from the name the page sent (percent-encoded): its last
 * part only, letters, digits and a few marks, never hidden, at most 100 characters, and ending in
 * .zip or .gpx. Undefined when nothing acceptable is left.
 */
export const uploadName = (sent: string): string | undefined => {
  let name: string;
  try {
    name = decodeURIComponent(sent);
  } catch {
    return undefined;
  }
  name = (name.normalize('NFC').split(/[/\\]/).at(-1) ?? '')
    .replace(/[^\p{L}\p{N} ._()+-]/gu, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. _]+/, '')
    .trim();
  const match = /^(.*)\.(zip|gpx)$/i.exec(name);
  const stem = match?.[1]?.replace(/[. ]+$/, '');
  const extension = match?.[2]?.toLowerCase();
  if (!stem || !extension) return undefined;
  return `${stem.slice(0, 100 - extension.length - 1)}.${extension}`;
};

const receive = (request: IncomingMessage, file: string, maxBytes: number): Promise<number> =>
  new Promise((resolve, reject) => {
    const out = createWriteStream(file, { mode: 0o600 });
    let size = 0;
    const fail = (error: Error) => {
      out.destroy();
      request.destroy();
      reject(error);
    };
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) fail(new UploadRefused(413, 'The file is too large.'));
    });
    request.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => resolve(size));
    request.pipe(out);
  });

/**
 * Saves the request's body as `name` in `folder`, after checking that it is what its name says: a
 * zip archive the import can read, with a GPX file in it, or a GPX file. Written under a hidden
 * temporary name first, which the import never reads, and renamed only once it passed. With
 * `keep` false (a dry run) everything is checked and nothing stays.
 */
export const saveUpload = async (
  request: IncomingMessage,
  folder: string,
  name: string,
  options: { maxBytes?: number; keep?: boolean } = {},
): Promise<{ saved: string; files: number; bytes: number }> => {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  if (Number(request.headers['content-length'] ?? 0) > maxBytes)
    throw new UploadRefused(413, 'The file is too large.');
  mkdirSync(folder, { recursive: true });
  const temporary = join(folder, `.upload-${randomBytes(8).toString('hex')}.part`);
  try {
    const bytes = await receive(request, temporary, maxBytes);
    let files = 1;
    if (name.endsWith('.zip')) {
      try {
        files = readGpxZip(readFileSync(temporary), name).entries.length;
      } catch (error) {
        throw new UploadRefused(400, errorText(error));
      }
      if (files === 0) throw new UploadRefused(400, 'The archive holds no GPX file.');
    } else if (!/<gpx\b/.test(readFileSync(temporary).subarray(0, 4096).toString('utf8')))
      throw new UploadRefused(400, 'This is not a GPX file.');
    if (options.keep !== false) renameSync(temporary, join(folder, name));
    return { saved: name, files, bytes };
  } finally {
    rmSync(temporary, { force: true });
  }
};

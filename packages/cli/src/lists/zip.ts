import { inflateRawSync } from 'node:zlib';

/** One file in a zip archive. */
interface ZipEntry {
  /** Path inside the archive, decoded from UTF-8 or, without the UTF-8 flag, Shift_JIS. */
  name: string;
  data: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
/** General purpose flag: the name is UTF-8. */
const UTF8_NAME = 0x0800;

/**
 * Reads the files of a zip archive (stored or deflated; no zip64, no encryption). Enough for the
 * small archives government sites publish, without a dependency.
 */
export const readZip = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('zip: no end-of-directory record');
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder('utf-8');
  const sjis = new TextDecoder('shift_jis');
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== DIRECTORY_ENTRY) throw new Error('zip: bad directory');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = (flags & UTF8_NAME ? utf8 : sjis).decode(rawName);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/')) continue;
    if (view.getUint32(local, true) !== LOCAL_HEADER)
      throw new Error(`zip: bad header for ${name}`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressedSize);
    if (method === 0) entries.push({ name, data: raw });
    else if (method === 8) entries.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
    else throw new Error(`zip: ${name} uses compression method ${method}`);
  }
  return entries;
};

/** XML text from bytes, honouring a Shift_JIS declaration and rewriting it to UTF-8. */
export const xmlText = (data: Uint8Array): string => {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 200));
  const declared = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)?.[1]?.toLowerCase();
  const sjis = declared !== undefined && /shift_jis|sjis|cp932|windows-31j/.test(declared);
  const text = new TextDecoder(sjis ? 'shift_jis' : 'utf-8').decode(data).replace(/^﻿/, '');
  return sjis ? text.replace(/encoding\s*=\s*["'][^"']+["']/i, 'encoding="UTF-8"') : text;
};

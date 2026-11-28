// A tiny zip writer for the checks and unit tests: enough to make the archives an import reads,
// and the odd ones it must refuse. Not for anything a person keeps.
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFile {
  name: string;
  data: Uint8Array | string;
  /** Store without compressing (default: deflate). */
  store?: boolean;
  /** Set the "encrypted" flag, as a password-protected archive has. */
  encrypted?: boolean;
  /** Write another compression method number than the data really uses. */
  method?: number;
  /** State another unpacked size than the data really has. */
  claimBytes?: number;
  /** Leave the UTF-8 flag off and write the name in these bytes (a Shift_JIS name, say). */
  rawName?: Uint8Array;
}

const u16 = (value: number) => {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
};
const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
};

/** The bytes of a zip archive holding `files`, in order. */
export const makeZip = (files: ZipFile[]): Buffer => {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = typeof file.data === 'string' ? Buffer.from(file.data) : Buffer.from(file.data);
    const name = file.rawName ? Buffer.from(file.rawName) : Buffer.from(file.name);
    const packed = file.store ? data : deflateRawSync(data);
    const flags = (file.rawName ? 0 : 0x0800) | (file.encrypted ? 1 : 0);
    const method = file.method ?? (file.store ? 0 : 8);
    const fields = Buffer.concat([
      u16(20),
      u16(flags),
      u16(method),
      u16(0),
      u16(0x21),
      u32(crc32(data)),
      u32(packed.length),
      u32(file.claimBytes ?? data.length),
      u16(name.length),
      u16(0),
    ]);
    const local = Buffer.concat([u32(0x04034b50), fields, name, packed]);
    directory.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        fields,
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    parts.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...parts, central, end]);
};

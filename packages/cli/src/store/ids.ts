import { createHmac, randomBytes } from 'node:crypto';

// Crockford base32: no I, L, O or U, so ids read and type without confusion.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

type IdKind = 'act' | 'route';

/**
 * A new internal id, for example act_01jd3m5k8q0000a1b2c3d4e5f6. It starts with the time, so ids
 * sort by creation, followed by 80 random bits. Never changes once given.
 */
export const newId = (kind: IdKind, now = Date.now()): string => {
  const time = new Uint8Array(6);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    time[i] = t % 256;
    t = Math.floor(t / 256);
  }
  return `${kind}_${base32(time)}${base32(randomBytes(10))}`;
};

/** A fresh secret for public ids, stored only in the local database. */
export const newSalt = (): string => randomBytes(32).toString('hex');

/**
 * The id published for an internal id. It is an HMAC with the local secret, so the published id
 * reveals nothing about the internal id or the Strava id, and cannot be reversed without the salt.
 */
export const publicId = (salt: string, internalId: string): string => {
  const digest = createHmac('sha256', Buffer.from(salt, 'hex')).update(internalId).digest();
  return base32(digest.subarray(0, 10));
};

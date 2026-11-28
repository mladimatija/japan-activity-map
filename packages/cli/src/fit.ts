/**
 * Reads a FIT activity file (what Garmin, Wahoo, Coros and Suunto devices record) into the same
 * shape as a GPX file: its points, and what it says about itself. The decoding is Garmin's FIT SDK.
 */
import { Decoder, Stream } from '@garmin/fitsdk';

import type { Gpx, GpxInfo, GpxPoint } from './gpx.ts';

/** FIT stores angles as "semicircles": 2^31 of them make 180 degrees. */
const DEGREES_PER_SEMICIRCLE = 180 / 2 ** 31;

/** Whether the bytes start like a FIT file: the ".FIT" mark at byte 8 of the header. */
export const looksLikeFit = (bytes: Uint8Array): boolean =>
  bytes.length >= 12 &&
  bytes[8] === 0x2e &&
  bytes[9] === 0x46 &&
  bytes[10] === 0x49 &&
  bytes[11] === 0x54;

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const iso = (value: unknown): string | undefined =>
  value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
const word = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/**
 * The track and the description of a FIT activity. Points without a position (a watch still
 * looking for satellites, an indoor session) are left out; a timer stop and start between two
 * points begins a new segment, as a pause does in a GPX file. Throws an Error when the bytes are
 * not a FIT file.
 */
export const parseFit = (bytes: Uint8Array): Gpx & { info: GpxInfo } => {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT()) throw new Error('not a FIT file');
  // A file cut short still holds the points before the cut: errors are not fatal on their own.
  const { messages } = decoder.read({ applyScaleAndOffset: true, convertDateTimesToDates: true });
  const stops = (messages.eventMesgs ?? [])
    .filter(
      (event) =>
        event.event === 'timer' &&
        (event.eventType === 'stop' || event.eventType === 'stopAll') &&
        event.timestamp instanceof Date,
    )
    .map((event) => (event.timestamp as Date).getTime());
  const segments: GpxPoint[][] = [[]];
  let last = Number.NEGATIVE_INFINITY;
  for (const record of messages.recordMesgs ?? []) {
    const lat = number(record.positionLat);
    const lon = number(record.positionLong);
    if (lat === undefined || lon === undefined) continue;
    const at = record.timestamp instanceof Date ? record.timestamp.getTime() : Number.NaN;
    if (stops.some((stop) => stop >= last && stop < at) && (segments.at(-1)?.length ?? 0) > 0)
      segments.push([]);
    if (Number.isFinite(at)) last = at;
    const ele = number(record.enhancedAltitude) ?? number(record.altitude);
    const time = iso(record.timestamp);
    segments.at(-1)?.push({
      lon: lon * DEGREES_PER_SEMICIRCLE,
      lat: lat * DEGREES_PER_SEMICIRCLE,
      ...(ele !== undefined ? { ele } : {}),
      ...(time ? { time } : {}),
    });
  }
  const session = messages.sessionMesgs?.[0];
  const sport = word(session?.sport);
  const subSport = word(session?.subSport);
  const type = sport && subSport && subSport !== 'generic' ? `${subSport} ${sport}` : sport;
  const name = word(messages.sportMesgs?.[0]?.name) ?? word(session?.sportProfileName);
  const time = iso(session?.startTime) ?? iso(messages.fileIdMesgs?.[0]?.timeCreated);
  return {
    segments: segments.filter((segment) => segment.length >= 2),
    info: {
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
      ...(time ? { time } : {}),
    },
  };
};

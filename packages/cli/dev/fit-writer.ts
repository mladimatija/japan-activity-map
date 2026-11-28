/** Writes small FIT activity files for the checks and tests, with Garmin's FIT SDK. */
import { Encoder, Profile } from '@garmin/fitsdk';

export interface FitPoint {
  lon: number;
  lat: number;
  ele?: number;
  /** ISO 8601. */
  time: string;
}

/** The SDK types its table of message numbers loosely; every name used here is in it. */
const mesgNum = (name: string): number => Profile.MesgNum[name] as number;

const SEMICIRCLES_PER_DEGREE = 2 ** 31 / 180;
const semicircles = (degrees: number) => Math.round(degrees * SEMICIRCLES_PER_DEGREE);

/**
 * A FIT activity of these points. `pauseAfter` puts a timer stop and start after the point at that
 * index, as a watch does when it is paused.
 */
export const fitFile = (
  points: FitPoint[],
  options: { sport?: string; subSport?: string; pauseAfter?: number } = {},
): Uint8Array => {
  const encoder = new Encoder();
  // The SDK's message type is the union of every message; a plain record of fields is what it reads.
  const write = (name: string, fields: Record<string, unknown>) =>
    encoder.onMesg(mesgNum(name), fields as Parameters<Encoder['onMesg']>[1]);
  const start = new Date(points[0]?.time ?? '2025-01-01T00:00:00Z');
  const end = new Date(points.at(-1)?.time ?? start);
  write('FILE_ID', {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    timeCreated: start,
    serialNumber: 1234,
  });
  write('EVENT', {
    timestamp: start,
    event: 'timer',
    eventType: 'start',
  });
  for (const [index, point] of points.entries()) {
    write('RECORD', {
      timestamp: new Date(point.time),
      positionLat: semicircles(point.lat),
      positionLong: semicircles(point.lon),
      ...(point.ele !== undefined ? { enhancedAltitude: point.ele } : {}),
    });
    if (index === options.pauseAfter) {
      const at = new Date(new Date(point.time).getTime() + 1000);
      write('EVENT', { timestamp: at, event: 'timer', eventType: 'stop' });
      write('EVENT', { timestamp: at, event: 'timer', eventType: 'start' });
    }
  }
  write('EVENT', { timestamp: end, event: 'timer', eventType: 'stopAll' });
  write('SESSION', {
    timestamp: end,
    startTime: start,
    sport: options.sport ?? 'hiking',
    subSport: options.subSport ?? 'generic',
    totalElapsedTime: (end.getTime() - start.getTime()) / 1000,
    totalTimerTime: (end.getTime() - start.getTime()) / 1000,
  });
  write('ACTIVITY', {
    timestamp: end,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  });
  return encoder.close();
};

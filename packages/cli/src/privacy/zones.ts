import { createHash, createHmac, randomInt } from 'node:crypto';

import type { Position, PrivacyZones, Thresholds } from '@jam/core';

import type { Database } from '../store/sqlite.ts';
import { JamError } from '../errors.ts';

export interface Zone {
  key: string;
  label: string;
  /** The real place. Never published, never written outside config and memory. */
  centre: Position;
  radiusM: number;
  address?: string;
}

/** A zone as clipping applies it: moved centre, and a radius that still covers the real one. */
export interface AppliedZone {
  key: string;
  label: string;
  centre: Position;
  /** The real radius plus the shift, so the real circle is always fully inside. */
  baseRadiusM: number;
  jitterM: number;
}

class ZoneError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'ZoneError';
  }
}

const zoneKey = (label: string, centre: Position) =>
  createHash('sha256')
    .update(`${label}\u0000${centre[0].toFixed(6)}\u0000${centre[1].toFixed(6)}`)
    .digest('hex')
    .slice(0, 24);

export const loadZones = (config: PrivacyZones): Zone[] =>
  config.zones.map((zone) => {
    if (zone.lat === undefined || zone.lon === undefined) {
      throw new ZoneError(
        `Privacy zone "${zone.label}" has only an address. Addresses are not looked up, so add its "lat" and "lon" in config/privacy-zones.jsonc (right-click the place in a map app to copy them).`,
      );
    }
    const centre: Position = [zone.lon, zone.lat];
    return {
      key: zoneKey(zone.label, centre),
      label: zone.label,
      centre,
      radiusM: zone.radiusM,
      ...(zone.address ? { address: zone.address } : {}),
    };
  });

const RAD = Math.PI / 180;
const EARTH_M = 6_371_008.8;

const move = (point: Position, bearing: number, metres: number): Position => {
  const dLat = (metres * Math.cos(bearing)) / EARTH_M / RAD;
  const dLon = (metres * Math.sin(bearing)) / (EARTH_M * Math.cos(point[1] * RAD)) / RAD;
  return [point[0] + dLon, point[1] + dLat];
};

/**
 * The zones as clipping uses them. Each gets a random shift the first time it is seen, stored in
 * the store so it is the same on every build. `dryRun` uses the shifts without storing new ones.
 */
export const applyZones = (
  db: Database,
  zones: Zone[],
  thresholds: Thresholds,
  dryRun = false,
): AppliedZone[] =>
  zones.map((zone) => {
    let row = db.get<{ bearing_rad: number; offset_share: number }>(
      'SELECT bearing_rad, offset_share FROM privacy_zone_offsets WHERE zone_key = ?',
      [zone.key],
    );
    if (!row) {
      row = {
        bearing_rad: (randomInt(0, 1_000_000) / 1_000_000) * 2 * Math.PI,
        offset_share: 0.25 + randomInt(0, 750_001) / 1_000_000,
      };
      if (!dryRun)
        db.run(
          'INSERT INTO privacy_zone_offsets (zone_key, bearing_rad, offset_share, created_at) VALUES (?, ?, ?, ?)',
          [zone.key, row.bearing_rad, row.offset_share, new Date().toISOString()],
        );
    }
    const shift = row.offset_share * thresholds.privacy.centreShiftShare * zone.radiusM;
    return {
      key: zone.key,
      label: zone.label,
      centre: move(zone.centre, row.bearing_rad, shift),
      baseRadiusM: zone.radiusM + shift,
      jitterM: thresholds.privacy.radiusJitterM,
    };
  });

/**
 * Added to every cut: published coordinates are rounded (to 4 decimals at the coarsest, a step of
 * about 11 m), and where the moved zone touches the real one a cut point could otherwise round to
 * just inside it.
 */
const ROUNDING_MARGIN_M = 10;

/** The zone's radius for one activity: a little larger by an amount fixed by the activity and the salt. */
export const radiusFor = (zone: AppliedZone, activityRef: string, salt: string): number => {
  if (zone.jitterM <= 0) return zone.baseRadiusM + ROUNDING_MARGIN_M;
  const digest = createHmac('sha256', Buffer.from(salt, 'hex'))
    .update(`${zone.key}\u0000${activityRef}`)
    .digest();
  return (
    zone.baseRadiusM + ROUNDING_MARGIN_M + (digest.readUInt32BE(0) / 0xffffffff) * zone.jitterM
  );
};

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import type { Position } from '@jam/core';

import { distanceM } from '../match/geometry.ts';
import type { Zone } from './zones.ts';
import { saysDemo } from '../demo/marker.ts';
import { escapeRegExp } from '../files.ts';

/** What must never appear in the published output. Built from the store and config. */
export interface Forbidden {
  zones: Zone[];
  /** Strava ids of activities whose link is not published, or that are not published at all. */
  hiddenStravaIds: number[];
  /** Public ids of excluded activities. */
  excludedPublicIds: string[];
  salt: string;
  /** Client secret, deploy token, Strava access and refresh tokens. */
  credentials: string[];
  /**
   * Coordinates of public reference data (list places, reference routes, prefecture outlines) as
   * "lon,lat", exactly as written. A temple or a prefecture border inside a zone is not a leak.
   */
  referencePoints?: Set<string>;
}

export interface AuditCheck {
  name: string;
  /** How much was looked at, for a pass that says something. */
  checked: string;
  failures: string[];
}

export interface AuditReport {
  files: number;
  bytes: number;
  checks: AuditCheck[];
  /** Things to know that do not fail the audit: the folder holds demo data. */
  warnings: string[];
  ok: boolean;
}

/** Written into the setup page's HTML and script (packages/web/setup.html, src/setup/api.ts). */
const SETUP_MARKER = 'jam-setup';

const filesIn = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesIn(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
};

/** Every [a, b] pair of numbers in a JSON value: GeoJSON positions and anything shaped like one. */
// oxlint-disable-next-line func-style -- a generator has no arrow form.
function* pairs(value: unknown): Generator<[number, number]> {
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number')
      yield [value[0], value[1]];
    for (const item of value) if (typeof item === 'object' && item !== null) yield* pairs(item);
  } else if (typeof value === 'object' && value !== null) {
    // A bounding box is four numbers worked out from points that are checked themselves, not a
    // place: its corner is where no point is (and for a loop that leaves a zone to the north and
    // comes back from the east, that corner lies inside the zone).
    for (const [key, item] of Object.entries(value)) if (key !== 'bbox') yield* pairs(item);
  }
}

/** Where a build keeps the public geometry it wrote, for a later `jam audit` of the same output. */
export const REFERENCE_POINTS_FILE = 'audit-reference.txt';

/** Ways a zone coordinate could be written: 4 to 6 decimals, rounded or cut, with or without trailing zeros. */
const coordinateForms = (value: number): string[] => {
  const forms = new Set<string>();
  for (const decimals of [4, 5, 6]) {
    const factor = 10 ** decimals;
    for (const rounded of [Number(value.toFixed(decimals)), Math.trunc(value * factor) / factor]) {
      forms.add(rounded.toFixed(decimals));
      // JSON and JavaScript drop trailing zeros: 35.6810 is written 35.681.
      forms.add(String(rounded));
    }
  }
  return [...forms];
};

/**
 * Checks a folder of output files and fails on anything that could reveal a protected place, a
 * Strava id or a secret. Text is searched as text; JSON is also read, and every coordinate pair in
 * it is tested against the real privacy zones (not the shifted ones clipping uses).
 */
export const audit = (dir: string, forbidden: Forbidden): AuditReport => {
  const files = filesIn(dir);
  const texts = files.map((file) => ({
    file: relative(dir, file),
    text: readFileSync(file, 'latin1'),
    path: file,
  }));
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  /** Finds every token shaped like the values, then looks each up: one pass for thousands of ids. */
  const lookup = (
    name: string,
    shape: RegExp,
    values: Set<string>,
    label: (value: string) => string,
    checked: string,
  ): AuditCheck => {
    const failures: string[] = [];
    for (const { file, text } of texts) {
      const found = new Set<string>();
      for (const match of text.matchAll(shape)) if (values.has(match[0])) found.add(match[0]);
      for (const value of [...found].sort()) failures.push(`${file}: ${label(value)}`);
    }
    return { name, checked, failures };
  };
  const search = (
    name: string,
    needles: { label: string; pattern: RegExp }[],
    checked: string,
  ): AuditCheck => {
    const failures: string[] = [];
    for (const { file, text } of texts)
      for (const needle of needles)
        if (needle.pattern.test(text)) failures.push(`${file}: ${needle.label}`);
    return { name, checked, failures };
  };

  // A zone's latitude and longitude written next to each other, in either order. One number alone
  // matches too many ordinary track points (any point on the same parallel) to be a useful test.
  const coordinateNeedles = forbidden.zones.map((zone) => {
    const lat = `(?<![0-9.])(?:${coordinateForms(zone.centre[1]).map(escapeRegExp).join('|')})(?![0-9])`;
    const lon = `(?<![0-9.])(?:${coordinateForms(zone.centre[0]).map(escapeRegExp).join('|')})(?![0-9])`;
    return {
      label: `the coordinates of zone "${zone.label}"`,
      pattern: new RegExp(`${lon}[^0-9]{1,12}${lat}|${lat}[^0-9]{1,12}${lon}`),
    };
  });
  const addressNeedles = forbidden.zones
    .filter((zone) => zone.address)
    .map((zone) => ({
      label: `the address of zone "${zone.label}"`,
      pattern: new RegExp(escapeRegExp(zone.address ?? ''), 'i'),
    }));

  // Coordinates inside a real zone, from every JSON file.
  const pointFailures: string[] = [];
  let points = 0;
  for (const { file, path } of texts) {
    if (!['.json', '.geojson'].includes(extname(path))) continue;
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      pointFailures.push(`${file}: not valid JSON, so its coordinates could not be checked`);
      continue;
    }
    for (const [a, b] of pairs(value)) {
      if (forbidden.referencePoints?.has(`${a},${b}`)) continue;
      // Positions are [lon, lat]; a [lat, lon] pair is tested too, in case one slips in.
      const candidates: Position[] = [
        [a, b],
        [b, a],
      ].filter(
        ([lon, lat]) => Math.abs(lat ?? 99) <= 90 && Math.abs(lon ?? 999) <= 180,
      ) as Position[];
      if (candidates.length === 0) continue;
      points++;
      for (const zone of forbidden.zones) {
        if (candidates.some((point) => distanceM(point, zone.centre) < zone.radiusM)) {
          pointFailures.push(`${file}: a point inside zone "${zone.label}"`);
          break;
        }
      }
    }
  }

  const checks: AuditCheck[] = [
    search(
      'Privacy zone coordinates',
      coordinateNeedles,
      `${forbidden.zones.length} zones, as pairs with 4 to 6 decimals`,
    ),
    search('Privacy zone addresses', addressNeedles, `${addressNeedles.length} addresses`),
    {
      name: 'Points inside privacy zones',
      checked: `${points} coordinate pairs against ${forbidden.zones.length} zones`,
      failures: [...new Set(pointFailures)],
    },
    lookup(
      'Strava ids not chosen for publishing',
      /(?<![0-9])[0-9]{6,20}(?![0-9])/g,
      new Set(forbidden.hiddenStravaIds.map(String)),
      (id) => `Strava id ${id}`,
      `${forbidden.hiddenStravaIds.length} ids`,
    ),
    lookup(
      'Excluded activities',
      /(?<![0-9a-z])[0-9a-z]{16}(?![0-9a-z])/g,
      new Set(forbidden.excludedPublicIds),
      (id) => `public id ${id} of an excluded activity`,
      `${forbidden.excludedPublicIds.length} activities`,
    ),
    // act_ ids carry their creation time, so they stay local.
    search(
      'Internal ids',
      [
        {
          label: 'an internal act_ or route_ id',
          pattern: /\b(act|route)_[0-9a-hjkmnp-tv-z]{26}\b/,
        },
      ],
      'act_ and route_ ids',
    ),
    search(
      'The secret salt',
      [{ label: 'the salt', pattern: new RegExp(escapeRegExp(forbidden.salt), 'i') }],
      '1 value',
    ),
    search(
      'Credentials',
      forbidden.credentials
        .filter((value) => value.length >= 8)
        .map((value) => ({ label: 'a credential', pattern: new RegExp(escapeRegExp(value)) })),
      `${forbidden.credentials.filter((value) => value.length >= 8).length} values`,
    ),
    // The setup page (`jam setup --web`) can write config and run commands on the machine it is
    // served from; it is built apart from the site and must never be published with it.
    {
      name: 'The setup page',
      checked: `${SETUP_MARKER} in every file, and file names`,
      failures: texts
        .filter(
          ({ file, text }) =>
            /(^|[\\/])(setup\.html|dist-setup)([\\/]|$)/.test(file) || text.includes(SETUP_MARKER),
        )
        .map(({ file }) => `${file}: part of the setup page (${SETUP_MARKER})`),
    },
  ];
  // Made-up data from `jam demo` is not private, so it does not fail; but it is not for publishing.
  const warnings: string[] = [];
  for (const { file, text } of texts) {
    if (file !== 'meta.json' && !file.endsWith('/meta.json') && !file.endsWith('\\meta.json'))
      continue;
    if (saysDemo(text))
      warnings.push(
        `${file} says this is demo data (made up by \`jam demo\`): do not publish it as your own`,
      );
  }
  return {
    files: files.length,
    bytes,
    checks,
    warnings,
    ok: checks.every((check) => check.failures.length === 0),
  };
};

/**
 * `jam demo`: writes a made-up history into the demo folder and builds a site from it with the
 * ordinary pipeline. The pipeline steps run as child processes with JAM_DATA_DIR set to the demo
 * folder, because a process's data folder is fixed when it starts: this process never opens the
 * real store, and the children never see it.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { parse } from 'jsonc-parser';

import { LISTS_DIR } from '../lists/sources.ts';
import type { Logger } from '../logger.ts';
import { DEMO_DIR, ROOT_DIR, shownPath } from '../paths.ts';
import { loadZones } from '../privacy/zones.ts';
import { openStore } from '../store/store.ts';
import { type DemoOptions, GENERATOR_VERSION, generateDemo, sheetCsv } from './generate.ts';
import { loadDemoLists } from './lists.ts';
import { type DemoMarker, folderMarker, MARKER_FILE, writeStoreMarker } from './marker.ts';
import { DEMO_LANGS, demoName, type DemoLang } from './names.ts';
import { DEMO_ZONES } from './story.ts';

export const DEFAULT_SEED = 20_261_127;
export const DEFAULT_YEARS = 5;

/** Where the demo's build goes: never dist/data, which is what gets published. */
export const demoOutDir = (dir = DEMO_DIR) => join(dir, 'dist/data');

const folderBytes = (dir: string): number => {
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bytes += folderBytes(path);
    else if (entry.isFile()) bytes += statSync(path).size;
  }
  return bytes;
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Why a folder may not be replaced or deleted as a demo folder, or undefined when it may. */
const notOurs = (dir: string): string | undefined => {
  if (!existsSync(dir)) return undefined;
  if (!statSync(dir).isDirectory()) return `${shownPath(dir)} is not a folder`;
  if (readdirSync(dir).length === 0) return undefined;
  return folderMarker(dir)
    ? undefined
    : `${shownPath(dir)} has files but no ${MARKER_FILE} saying it is demo data, so it is left alone`;
};

/** Reads --seed, --until, --years and --lang; a string is what is wrong with them. */
export const demoOptions = (
  options: Record<string, string | boolean | undefined>,
  today: string,
): DemoOptions | string => {
  const seedText = typeof options.seed === 'string' ? options.seed : String(DEFAULT_SEED);
  if (!/^\d{1,10}$/.test(seedText) || Number(seedText) > 4_294_967_295)
    return `--seed takes a whole number from 0 to 4294967295, not "${seedText}".`;
  const until = typeof options.until === 'string' ? options.until : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(`${until}T00:00:00Z`)))
    return `--until takes a date such as 2026-06-30, not "${until}".`;
  const yearsText = typeof options.years === 'string' ? options.years : String(DEFAULT_YEARS);
  if (!/^\d+$/.test(yearsText) || Number(yearsText) < 1 || Number(yearsText) > 10)
    return `--years takes a number from 1 to 10, not "${yearsText}".`;
  const lang = typeof options.lang === 'string' ? options.lang : 'en';
  if (!(DEMO_LANGS as readonly string[]).includes(lang))
    return `--lang takes en or ja, not "${lang}".`;
  return { seed: Number(seedText), until, years: Number(yearsText), lang: lang as DemoLang };
};

/** The demo's own config folder: the example files, a made-up home and work zone, a demo title. */
const writeConfig = (dir: string, options: DemoOptions, sheet: string): string => {
  const configDir = join(dir, 'config');
  mkdirSync(configDir, { recursive: true });
  const examples = join(ROOT_DIR, 'config');
  const note =
    '// Written by `pnpm jam demo`. Made-up settings for the demo data; not your own config.\n';
  for (const file of readdirSync(examples)) {
    // No secrets file: the demo never signs in anywhere.
    if (!file.endsWith('.example.jsonc') || file.startsWith('secrets.')) continue;
    copyFileSync(join(examples, file), join(configDir, file.replace('.example', '')));
  }
  const site = parse(readFileSync(join(examples, 'site.example.jsonc'), 'utf8'), [], {
    allowTrailingComma: true,
  }) as { site: Record<string, unknown>; publish: Record<string, unknown> };
  site.site.title = demoName('siteTitle', options.lang);
  site.site.description = demoName('siteDescription', options.lang);
  // The treadmill rows are part of what the demo shows.
  site.publish.activitiesWithoutGps = true;
  writeFileSync(join(configDir, 'site.jsonc'), `${note}${JSON.stringify(site, null, 2)}\n`);
  writeFileSync(
    join(configDir, 'privacy-zones.jsonc'),
    `${note}// Tokyo Station and a point by the bay: nobody's home or workplace.\n${JSON.stringify({ zones: DEMO_ZONES }, null, 2)}\n`,
  );
  const inside = relative(ROOT_DIR, sheet);
  writeFileSync(
    join(configDir, 'sheet.jsonc'),
    `${note}${JSON.stringify({ path: inside.startsWith('..') || isAbsolute(inside) ? sheet : inside, timeZone: 'Asia/Tokyo' }, null, 2)}\n`,
  );
  return configDir;
};

/** Runs one `jam` command against the demo folder and returns what it printed. */
const runJam = (dir: string, configDir: string, args: string[]): string =>
  execFileSync(
    'node',
    [join(ROOT_DIR, 'packages/cli/src/main.ts'), '--config', configDir, ...args],
    {
      env: { ...process.env, JAM_DATA_DIR: dir, NODE_NO_WARNINGS: '1' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    },
  );

const failureText = (error: unknown): string => {
  const failure = error as { stdout?: string; stderr?: string; message?: string };
  return (
    `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() || (failure.message ?? String(error))
  );
};

export const runDemo = async (
  options: DemoOptions,
  log: Logger,
  { dryRun = false, dir = DEMO_DIR }: { dryRun?: boolean; dir?: string } = {},
): Promise<number> => {
  const refusal = notOurs(dir);
  if (refusal) {
    log.error(`${refusal}. Nothing was written.`);
    return 1;
  }
  const out = demoOutDir(dir);
  if (dryRun) {
    log.info(
      `Would write ${options.years} years of made-up activities up to ${options.until} (seed ${options.seed}, names in ${options.lang}) into ${shownPath(dir)}${existsSync(dir) ? ', replacing the demo there,' : ''} and build them into ${shownPath(out)}. Your own data is not touched.`,
    );
    return 0;
  }
  const marker: DemoMarker = { demo: true, generator: GENERATOR_VERSION, ...options };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'source/tracks'), { recursive: true });
  // The marker goes in first, so a run that stops half way still leaves a folder --clear accepts.
  writeFileSync(join(dir, MARKER_FILE), `${JSON.stringify(marker, null, 2)}\n`);

  const started = Date.now();
  const sheet = join(dir, 'source/sheet.csv');
  let tracks = 0;
  const history = generateDemo(options, loadDemoLists(LISTS_DIR), (file, text) => {
    writeFileSync(join(dir, 'source', file), text);
    tracks++;
  });
  writeFileSync(sheet, sheetCsv(history.rows));
  const configDir = writeConfig(dir, options, sheet);
  log.info(
    `Wrote ${history.rows.length} made-up activities (${tracks} with a track) to ${shownPath(join(dir, 'source'))}: ${options.years} years up to ${options.until}, seed ${options.seed}.`,
  );
  for (const line of history.skipped) log.warn(`  Left out: ${line}`);

  const quiet: Logger = { ...log, info: (message) => log.debug(message) };
  const store = await openStore(quiet, join(dir, 'jam.sqlite'));
  try {
    writeStoreMarker(store.db, marker);
    // A zone's centre is normally moved in a random direction, once per store. The demo fixes it
    // instead, so every run cuts its tracks at the same points, and so the side where the cut
    // comes closest to the real circle (opposite the move) faces north-north-east, a way no demo
    // course leaves home: a cut point is then never within rounding distance of the circle.
    for (const zone of loadZones({ zones: DEMO_ZONES.map((entry) => ({ ...entry })) }))
      store.db.run(
        'INSERT OR REPLACE INTO privacy_zone_offsets (zone_key, bearing_rad, offset_share, created_at) VALUES (?, ?, ?, ?)',
        [zone.key, (195 * Math.PI) / 180, 0.625, `${options.until}T00:00:00.000Z`],
      );
  } finally {
    store.close();
  }

  try {
    log.info('Importing the sheet into the demo store…');
    const imported = runJam(dir, configDir, ['sync', 'sheet', sheet]);
    for (const line of imported.trimEnd().split('\n').slice(-2)) log.info(`  ${line.trim()}`);
    log.info('Building the demo site data (matching, routes, privacy zones, audit)…');
    const built = runJam(dir, configDir, ['build', '--out', out]);
    for (const line of built.trimEnd().split('\n'))
      if (
        /^(Matched|Published|Routes:|Loaded at start|Nothing private|WARN|Demo data)/.test(
          line.trim(),
        )
      )
        log.info(`  ${line.trim()}`);
  } catch (error) {
    log.error(`The demo could not be built:\n${failureText(error)}`);
    log.error(`What was written is in ${shownPath(dir)}; \`pnpm jam demo --clear\` removes it.`);
    return 1;
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log.info(
    `Demo ready in ${seconds} s: ${shownPath(dir)} (${mb(folderBytes(dir))}), site data in ${shownPath(out)} (${mb(folderBytes(out))}).`,
  );
  log.info('Look at it with `pnpm demo:web`. Your own data and dist/ are untouched.');
  log.info('Remove it with `pnpm jam demo --clear`.');
  return 0;
};

/** `jam demo --clear`: deletes the demo folder, and only a folder that says it is one. */
export const clearDemo = (log: Logger, { dryRun = false, dir = DEMO_DIR } = {}): number => {
  if (!existsSync(dir)) {
    log.info(`No demo data at ${shownPath(dir)}; nothing to remove.`);
    return 0;
  }
  const refusal = notOurs(dir);
  if (refusal) {
    log.error(`${refusal}. Nothing was deleted.`);
    return 1;
  }
  // Never the repository, the data folder itself or anything above them, whatever a marker says.
  const data = resolve(ROOT_DIR, 'data');
  if ([ROOT_DIR, data].some((keep) => keep === dir || keep.startsWith(`${dir}/`))) {
    log.error(`${shownPath(dir)} holds more than demo data. Nothing was deleted.`);
    return 1;
  }
  if (dryRun) {
    log.info(`Would delete ${shownPath(dir)} (${mb(folderBytes(dir))} of demo data).`);
    return 0;
  }
  const bytes = folderBytes(dir);
  rmSync(dir, { recursive: true, force: true });
  log.info(
    `Deleted the demo data at ${shownPath(dir)} (${mb(bytes)}). Your own data is untouched.`,
  );
  return 0;
};

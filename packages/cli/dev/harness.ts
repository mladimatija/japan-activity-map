// What every CLI check shares: a sandbox with the example configs, `jam` run inside it, and
// PASS/FAIL lines with one exit code at the end.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The 東海道's file is not committed (its source's licence does not allow it), so a fresh clone has
 * none, and the fixtures walk along it. Then the checks read the lists from a folder of links to
 * the real ones plus a stand-in 東海道: a hand-drawn line from 日本橋 through 品川, 川崎 and 横浜
 * towards 小田原, as one item. With the real file present nothing is replaced.
 */
const standInLists = (root: string, temp: string): string | null => {
  const real = join(root, 'lists');
  if (existsSync(join(real, 'routes/tokaido.geojson'))) return null;
  const dir = join(temp, 'lists');
  mkdirSync(join(dir, 'routes'), { recursive: true });
  for (const entry of readdirSync(real))
    if (entry !== 'routes') symlinkSync(join(real, entry), join(dir, entry));
  for (const entry of readdirSync(join(real, 'routes')))
    symlinkSync(join(real, 'routes', entry), join(dir, 'routes', entry));
  const waypoints = [
    [139.7745, 35.6841],
    [139.73, 35.62],
    [139.67, 35.585],
    [139.66, 35.53],
    [139.622, 35.466],
    [139.53, 35.4],
    [139.45, 35.335],
    [139.3, 35.315],
    [139.155, 35.2565],
  ];
  // Not through 東京駅 itself: the checks put a privacy zone there, and the audit looks for it.
  // A point about every 125 m, as the built route has.
  const line: number[][] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const [a, b] = [waypoints[i - 1] as number[], waypoints[i] as number[]];
    const metres = Math.hypot(
      ((b[0] ?? 0) - (a[0] ?? 0)) * 91_000,
      ((b[1] ?? 0) - (a[1] ?? 0)) * 111_000,
    );
    const n = Math.max(1, Math.round(metres / 125));
    for (let k = i === 1 ? 0 : 1; k <= n; k++)
      line.push([
        Number(((a[0] ?? 0) + (((b[0] ?? 0) - (a[0] ?? 0)) * k) / n).toFixed(5)),
        Number(((a[1] ?? 0) + (((b[1] ?? 0) - (a[1] ?? 0)) * k) / n).toFixed(5)),
      ]);
  }
  writeFileSync(
    join(dir, 'routes/tokaido.geojson'),
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            id: 'tokaido-001',
            order: 1,
            name: { ja: '東海道（チェック用の代役）', en: 'Tōkaidō (stand-in for the checks)' },
            lengthKm: 80,
            prefectures: ['13', '14'],
            source: 'stand-in',
          },
          geometry: { type: 'LineString', coordinates: line },
        },
      ],
    }),
  );
  return dir;
};

export const sandbox = (name: string) => {
  const root = resolve(import.meta.dirname, '../../..');
  const temp = mkdtempSync(join(tmpdir(), `jam-${name}-`));
  const data = join(temp, 'data');
  const configDir = join(temp, 'config');
  mkdirSync(data, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  for (const file of readdirSync(join(root, 'config')).filter((entry) =>
    entry.endsWith('.example.jsonc'),
  ))
    copyFileSync(join(root, 'config', file), join(configDir, file.replace('.example', '')));
  const env: NodeJS.ProcessEnv = { ...process.env, JAM_DATA_DIR: data, NODE_NO_WARNINGS: '1' };
  const lists = standInLists(root, temp);
  if (lists) env.JAM_LISTS_DIR = lists;
  const command = (args: string[]) => [
    join(root, 'packages/cli/src/main.ts'),
    '--config',
    configDir,
    ...args,
  ];

  /** Runs `jam` and returns what it printed; throws if it fails. */
  const jam = (...args: string[]) => execFileSync('node', command(args), { env, encoding: 'utf8' });

  /** Runs `jam` and returns its exit code with everything it printed, failing or not. */
  const jamResult = (...args: string[]) => {
    try {
      return {
        code: 0,
        text: execFileSync('node', command(args), {
          env,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, text: `${failure.stdout}${failure.stderr}` };
    }
  };

  /**
   * Runs `jam` with more set in its environment (a stand-in's switches, say) and returns its exit
   * code with everything it printed on either stream, failing or not.
   */
  const jamWith = (extra: Record<string, string>, ...args: string[]) => {
    const result = spawnSync('node', command(args), {
      env: { ...env, ...extra },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { code: result.status ?? 1, text: `${result.stdout}${result.stderr}` };
  };

  /** Writes a fixture sheet and its GPX files into `dir`, by one of the fixture scripts. */
  const fixtures = (script: 'match-fixtures.ts' | 'route-fixtures.ts', dir: string) => {
    execFileSync('node', [join(import.meta.dirname, script), dir], { env });
    return dir;
  };

  let failed = false;
  const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `: ${detail}`}`);
    if (!ok) failed = true;
  };

  /** Ends the run: exit 1 and keep the sandbox to look at if anything failed, else tidy up. */
  const finish = () => {
    if (failed) {
      console.log(`Some checks failed; the data is kept in ${temp}.`);
      process.exit(1);
    }
    rmSync(temp, { recursive: true, force: true });
    console.log('All checks passed.');
  };

  /** Where the lists are read from: the repository's, or the stand-in folder on a fresh clone. */
  const listsDir = lists ?? join(root, 'lists');
  return {
    root,
    temp,
    data,
    configDir,
    env,
    listsDir,
    jam,
    jamResult,
    jamWith,
    fixtures,
    check,
    finish,
  };
};

/** Every file under a folder, sorted. */
export const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)],
    )
    .sort();

/** One hash over every file under a folder, names included; `text` may change a file's text first. */
export const fingerprint = (
  dir: string,
  text: (content: string) => string = (same) => same,
): string => {
  const hash = createHash('sha256');
  for (const file of filesIn(dir))
    hash.update(`${file.slice(dir.length)}\n`).update(text(readFileSync(file, 'utf8')));
  return hash.digest('hex');
};

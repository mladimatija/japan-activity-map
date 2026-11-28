/**
 * `pnpm check:bundle`: fails when the web app's own code outgrows its budget. Run after
 * `pnpm web:build`. The data files have their budget in the build (docs/build.md); this is the
 * same guard for the code, so that a heavy dependency, or a lazy one that became eager, is seen
 * in the pull request that brings it and not by a visitor on a slow connection.
 *
 * Three things are measured, compressed as a server would send them:
 *  - First load: what index.html asks for before anything shows (its script, the chunks it
 *    preloads and its stylesheet).
 *  - All code: every script in the build, lazy chunks and the map's worker included.
 *  - The largest chunk: one file, eager or lazy.
 *
 * The budgets are what was measured plus headroom, so routine work does not trip them. Raise one
 * here, with the new measurement, when an increase is meant.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

/** Measured 2026-11-28: first load 285 KB, all code 729 KB, largest chunk 292 KB (MapLibre). */
const BUDGETS_KB = { first: 330, total: 840, largest: 335 };

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: resolve(import.meta.dirname, '../../../dist') },
    // To see the check fail without changing the budgets: --first 1
    first: { type: 'string' },
    total: { type: 'string' },
    largest: { type: 'string' },
  },
});
const budget = (name: keyof typeof BUDGETS_KB): number => {
  const given = values[name];
  return given !== undefined && Number.isFinite(Number(given)) ? Number(given) : BUDGETS_KB[name];
};

const dir = values.dir;
let html: string;
try {
  html = readFileSync(join(dir, 'index.html'), 'utf8');
} catch {
  console.error(`No build at ${dir}. Run \`pnpm web:build\` first.`);
  process.exit(1);
}
const kb = (bytes: number) => bytes / 1024;
const gzipped = (file: string): number =>
  gzipSync(readFileSync(join(dir, file)), { level: 9 }).length;

// What the page asks for at once: scripts, preloaded modules and stylesheets named in index.html.
const firstFiles = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:m?js|css))"/g)].map(
  (match) => match[1] as string,
);
const scripts = readdirSync(join(dir, 'assets'))
  .filter((name) => /\.m?js$/.test(name))
  .map((name) => ({ name, gzip: gzipped(join('assets', name)) }))
  .sort((a, b) => b.gzip - a.gzip);
const first = firstFiles.reduce((sum, file) => sum + gzipped(file), 0);
const total = scripts.reduce((sum, script) => sum + script.gzip, 0);
const largest = scripts[0];

let failed = false;
const line = (label: string, bytes: number, limitKb: number, what = '') => {
  const over = kb(bytes) > limitKb;
  failed ||= over;
  console.log(
    `${over ? 'FAIL' : 'PASS'}  ${label}: ${kb(bytes).toFixed(0)} KB compressed, budget ${limitKb} KB${what ? ` (${what})` : ''}`,
  );
};
if (firstFiles.length === 0) {
  console.error(`index.html in ${dir} names no script: the build is not what this check reads.`);
  process.exit(1);
}
line('first load', first, budget('first'), `${firstFiles.length} files`);
line('all code', total, budget('total'), `${scripts.length} scripts`);
if (largest) line('largest chunk', largest.gzip, budget('largest'), largest.name);
if (failed) {
  console.log('\nThe largest scripts:');
  for (const script of scripts.slice(0, 6))
    console.log(`  ${kb(script.gzip).toFixed(0).padStart(5)} KB  ${script.name}`);
  console.log(
    '\nSomething grew past its budget. If it is meant, raise the budget in packages/web/dev/check-bundle.ts with the new measurement; if not, look for a new dependency or an import that pulls a lazy chunk into the first load.',
  );
  process.exit(1);
}
console.log('The web app is within its size budget.');

/**
 * `pnpm demo:site`: the whole site over made-up demo data, as one folder (dist-demo/) that any
 * static host can serve. This is what the repository's own GitHub Pages shows
 * (.github/workflows/demo-site.yml). It is not `jam deploy`, which never publishes demo data:
 * nothing here reads your own activities, and the pages say "Demo data".
 *
 *   pnpm demo:site                  make the demo, build the app, put them together
 *   pnpm demo:site --until 2026-06-30 --lang ja     (options of `jam demo`)
 *   pnpm demo:site --keep           use the demo and app builds already there
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { siteOptionsSchema } from '@jam/core';

import { withPolicy } from '../../cli/src/deploy/github.ts';
import { contentPolicy, mapOrigins } from '../../cli/src/deploy/headers.ts';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const demoArgs = args.filter((arg) => arg !== '--keep');
const demoData = join(
  process.env.JAM_DEMO_DIR ? resolve(process.env.JAM_DEMO_DIR) : join(root, 'data/demo'),
  'dist/data',
);
const app = join(root, 'dist');
const out = resolve(root, process.env.JAM_DEMO_SITE_DIR ?? 'dist-demo');

const run = (file: string, fileArgs: string[]) => {
  const result = spawnSync(file, fileArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (!keep) {
  run('node', [join(root, 'packages/cli/src/main.ts'), 'demo', ...demoArgs]);
  run('vp', ['build', 'packages/web']);
}
const meta = join(demoData, 'meta.json');
if (!existsSync(meta) || !existsSync(join(app, 'index.html'))) {
  console.error('The demo data or the web app is not built. Run `pnpm demo:site` without --keep.');
  process.exit(1);
}
// Only ever made-up data: a folder that is not marked as the demo's is not put on show.
if ((JSON.parse(readFileSync(meta, 'utf8')) as { demo?: unknown }).demo !== true) {
  console.error(
    `${demoData} is not a demo build (its meta.json does not say so). Nothing written.`,
  );
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(app, 'assets'), join(out, 'assets'), { recursive: true });
cpSync(demoData, join(out, 'data'), { recursive: true });
// GitHub Pages sends no headers of the site's choosing: the policy goes into the page. The demo
// uses the default map styles, so their addresses are known without looking them up.
const { origins } = await mapOrigins(siteOptionsSchema.parse({}), undefined);
writeFileSync(
  join(out, 'index.html'),
  withPolicy(readFileSync(join(app, 'index.html'), 'utf8'), contentPolicy(origins, true)),
);
// Without this GitHub's branch publishing would run the folder through Jekyll.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Demo site in ${out} (made-up activities). Serve it with any static file server.`);

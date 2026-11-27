/**
 * `pnpm demo:web`: the dev server showing the demo's build instead of dist/data. The demo is only
 * ever shown when asked for like this; `pnpm web:dev` keeps showing your own build.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const data = join(
  process.env.JAM_DEMO_DIR ? resolve(process.env.JAM_DEMO_DIR) : join(root, 'data/demo'),
  'dist/data',
);
if (!existsSync(join(data, 'meta.json'))) {
  console.error('There is no demo data yet. Run `pnpm jam demo` first.');
  process.exit(1);
}
console.log(`Showing the demo data in ${data} (made-up activities).`);
// Its own port: another origin, so the demo's saved views and choices in the browser stay apart
// from the real site's (and the two can run side by side).
const port = process.argv.includes('--port') ? [] : ['--port', '5183'];
const child = spawn('vp', ['dev', 'packages/web', ...port, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, JAM_WEB_DATA: data },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));

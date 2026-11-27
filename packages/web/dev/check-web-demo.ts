/**
 * `pnpm check:web:demo`: the web check against a demo build made in a temporary folder, so it runs
 * on a fresh clone with no build of one's own. Nothing under data/ or dist/ is read or written.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const temp = mkdtempSync(join(tmpdir(), 'jam-web-demo-'));
const demo = join(temp, 'demo');
let code = 1;
try {
  execFileSync('node', [join(root, 'packages/cli/src/main.ts'), 'demo', '--until', '2026-06-30'], {
    cwd: root,
    env: {
      ...process.env,
      JAM_DEMO_DIR: demo,
      JAM_DATA_DIR: join(temp, 'own-data'),
      NODE_NO_WARNINGS: '1',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const result = spawnSync('sh', [join(root, 'packages/web/dev/check-web.sh')], {
    cwd: root,
    // The check's bundle stays where check-web.sh puts it (under node_modules, where it finds React).
    env: { ...process.env, JAM_WEB_DATA: join(demo, 'dist/data') },
    stdio: 'inherit',
  });
  code = result.status ?? 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
process.exit(code);

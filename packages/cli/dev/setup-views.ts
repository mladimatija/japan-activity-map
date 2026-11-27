// Writes what the setup server would send for each mode (steps, changes, plan) as one JSON file,
// from the example configs in a temporary folder. The web render check (packages/web/dev/
// check-setup-ui.sh) reads it, so the page is rendered with the real steps.
//   JAM_DATA_DIR=<temp> node packages/cli/dev/setup-views.ts <out.json>
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ACTION_IDS, type PlanItem } from '../src/setup/actions.ts';
import { changeGroups, planView, stage, viewOf } from '../src/setup/stage.ts';
import { GROUPS } from '../src/setup/steps.ts';
import { REVIEW_FILES } from '../src/setup/wizard.ts';

if (!process.env.JAM_DATA_DIR) throw new Error('Set JAM_DATA_DIR to a temporary folder.');
const out = process.argv[2];
if (!out) throw new Error('Give the file to write.');

const root = resolve(import.meta.dirname, '../../..');
const configDir = join(mkdtempSync(join(tmpdir(), 'jam-setup-views-')), 'config');
mkdirSync(configDir);
for (const file of readdirSync(join(root, 'config')).filter((name) =>
  name.endsWith('.example.jsonc'),
))
  copyFileSync(join(root, 'config', file), join(configDir, file));

const sources = ['strava', 'sheet'];
const quick = stage(configDir, 'quick', { sources, 'privacy.home': '1, 2' });
const views = {
  quick: viewOf(quick),
  // Every terrain part shows with "tiles", and the saved change makes a diff to render.
  full: viewOf(
    stage(configDir, 'full', { sources, 'map.terrain': 'tiles', 'site.title': 'Render check' }),
  ),
  fullTilejson: viewOf(stage(configDir, 'full', { sources, 'map.terrain': 'tilejson' })),
  demo: viewOf(stage(configDir, 'demo', {})),
  ...Object.fromEntries(
    changeGroups().map((group) => [
      `change:${group.id}`,
      viewOf(stage(configDir, 'change', {}, [group.id])),
    ]),
  ),
};
const everyAction: PlanItem[] = ACTION_IDS.map((id, index) =>
  index === 0 ? { id, skip: 'not available in this version' } : { id },
);
writeFileSync(
  out,
  JSON.stringify({
    views,
    actions: planView(everyAction, quick.ctx),
    groups: changeGroups(),
    titles: Object.fromEntries(GROUPS.map((group) => [group.id, group.title])),
    reviews: REVIEW_FILES.map(({ name, what }) => ({ name, what })),
    facts: quick.ctx.facts,
  }),
);

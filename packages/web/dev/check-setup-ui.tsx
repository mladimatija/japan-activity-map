// Renders every screen of the setup page in both languages with the real steps, and checks the
// rules the page must keep: every string translated, tokens only, nothing kept in the browser,
// and nothing of it reachable from the public site's entry. Run with dev/check-setup-ui.sh.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';

import { registerTranslations, setTranslationLang, untranslated } from '../src/i18n.ts';
import type { PlanAction, SetupApi, SetupState, Start, View } from '../src/setup/api.ts';
import { SETUP_JA } from '../src/setup/i18n-ja-setup.ts';
import { Review } from '../src/setup/Review.tsx';
import { RunPanel, type RunStatus } from '../src/setup/RunPanel.tsx';
import { Done, Steps, Welcome } from '../src/setup/screens.tsx';

let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures++;
};

const fixture = JSON.parse(readFileSync(process.env.JAM_SETUP_VIEWS ?? '', 'utf8')) as {
  views: Record<string, View>;
  actions: PlanAction[];
  groups: SetupState['groups'];
  titles: SetupState['titles'];
  reviews: SetupState['reviews'];
  facts: SetupState['facts'];
};
const state: SetupState = {
  facts: fixture.facts,
  demo: { available: false, reason: 'not available in this version' },
  groups: fixture.groups,
  titles: fixture.titles,
  zones: 0,
  mapStyle: 'https://tiles.openfreemap.org/styles/positron',
  running: null,
  reviews: fixture.reviews,
};
const never = () => new Promise<never>(() => undefined);
const api: SetupApi = {
  state: never,
  answers: never,
  apply: never,
  run: never,
  events: () => () => undefined,
  review: never,
  stop: never,
  merges: never,
  merge: never,
  preview: never,
  upload: never,
  shutdown: never,
};
const nothing = () => undefined;

registerTranslations(SETUP_JA);

/** Every screen once: the first screen, each view page by page, the run, the review, the end. */
const screens = (): [string, ReactElement][] => {
  const all: [string, ReactElement][] = [
    ['welcome', <Welcome state={state} onStart={nothing} />],
    [
      'welcome, with changes saved and commands waiting',
      <Welcome
        state={state}
        onStart={nothing}
        saved={state.groups.slice(0, 2).map((group) => group.title)}
        pending={fixture.actions}
        onRun={nothing}
      />,
    ],
    [
      'welcome, with a change saved and nothing to run',
      <Welcome
        state={state}
        onStart={nothing}
        saved={state.groups.slice(0, 1).map((group) => group.title)}
        onRun={nothing}
      />,
    ],
    [
      'welcome, signed in',
      <Welcome
        state={{
          ...state,
          zones: 2,
          demo: { available: true },
          facts: {
            ...state.facts,
            stravaCredentials: true,
            stravaScope: 'read,activity:read',
            siteBuilt: true,
          },
        }}
        onStart={nothing}
      />,
    ],
  ];
  for (const [name, view] of Object.entries(fixture.views)) {
    const start = (
      name.startsWith('change')
        ? 'change'
        : name.startsWith('full')
          ? 'full'
          : name.startsWith('quick')
            ? 'quick'
            : name
    ) as Start;
    const pages = start === 'full' ? new Set(view.steps.map((step) => step.group)).size : 1;
    const answers = {
      'privacy.home': { lat: 35.68, lon: 139.76 },
      'privacy.zones': [{ label: 'home', radiusM: 500, keep: true }],
    };
    for (let page = 0; page < pages; page++)
      all.push([
        `${name} page ${page + 1}`,
        <Steps
          start={start}
          view={view}
          state={state}
          answers={answers}
          page={page}
          saving={false}
          onAnswer={nothing}
          onPage={nothing}
          onSave={nothing}
          onBack={nothing}
          onUpload={never}
        />,
      ]);
  }
  const statuses: RunStatus[] = ['done', 'running', 'failed', 'waiting'];
  const status = Object.fromEntries(
    fixture.actions.map((action, index) => [
      action.id,
      statuses[index % statuses.length] ?? 'waiting',
    ]),
  );
  all.push(
    [
      'run, before',
      <RunPanel api={api} plan={fixture.actions} scope={null} onFinished={nothing} />,
    ],
    [
      'run, under way',
      <RunPanel
        api={api}
        plan={fixture.actions}
        scope="read,activity:read"
        initial={{
          status: { ...status, 'strava-auth': 'running' },
          lines: ['Fetched 200 activities.'],
          authorizeUrl: 'https://www.strava.com/oauth/authorize',
        }}
        onFinished={nothing}
      />,
    ],
    [
      'review',
      <Review
        api={api}
        reviews={fixture.reviews}
        initial={{ name: 'match', text: '# Match review' }}
        onNext={nothing}
      />,
    ],
    ['review, empty', <Review api={api} reviews={[]} onNext={nothing} />],
    [
      'review, with routes to merge',
      <Review
        api={api}
        reviews={[]}
        initialMerges={[
          {
            index: 0,
            routes: [
              { name: 'Riverside loop', count: 12 },
              { name: 'Riverside loop, long', count: 3 },
            ],
            reason: '78% of the same streets',
            merged: false,
          },
          {
            index: 1,
            routes: [
              { name: 'Park run', count: 5 },
              { name: 'Park run', count: 2 },
            ],
            reason: '75% of the same streets',
            merged: true,
          },
        ]}
        onNext={nothing}
      />,
    ],
    ['done', <Done closed={false} demo={false} onFinish={nothing} />],
    ['done, demo, closed', <Done closed demo onFinish={nothing} />],
  );
  return all;
};

const html: Record<string, string> = {};
for (const lang of ['en', 'ja'] as const) {
  setTranslationLang(lang);
  let broken = '';
  let count = 0;
  for (const [name, element] of screens()) {
    try {
      html[`${lang} ${name}`] = renderToString(element);
      count++;
    } catch (error) {
      broken += `${name}: ${error instanceof Error ? error.message : String(error)}; `;
    }
  }
  check(broken === '', `${lang}: all ${count} screens render${broken ? ` (${broken})` : ''}`);
}
const missing = [...untranslated].sort();
check(
  missing.length === 0,
  `every string has Japanese${missing.length ? `; missing:\n    ${missing.join('\n    ')}` : ''}`,
);

const en = (name: string) => html[`en ${name}`] ?? '';
const ja = (name: string) => html[`ja ${name}`] ?? '';
check(
  en('welcome').indexOf('Try with demo data') < en('welcome').indexOf('Quick setup') &&
    en('welcome').includes('Try with demo data'),
  'demo data is the first choice on the first screen',
);
check(
  en('welcome').includes('Not available in this version.'),
  '  ...and says so when this version lacks the command',
);
check(
  !en('welcome, signed in').includes('Not available in this version.'),
  '  ...and is offered when it has it',
);
check(
  ja('welcome').includes('デモデータで試す') && ja('welcome').includes('かんたんセットアップ'),
  'the first screen reads in Japanese',
);
check(
  en('quick page 1').includes('Strava Client Secret') &&
    en('quick page 1').includes('type="password"'),
  'the client secret is a password field',
);
check(
  !/value="[^"]*secret/i.test(en('change:source:strava page 1')),
  '  ...and no stored secret is put in a field',
);
check(
  en('quick page 1').includes('Before the Strava questions'),
  'the Strava checklist stands before the Strava questions',
);
check(
  en('quick page 1').includes('Home location to hide') &&
    ja('quick page 1').includes('隠す自宅の位置'),
  'quick setup shows the zone picker, in both languages',
);
check(en('change:privacy page 1').includes('Add a zone'), 'change mode shows the zone list');
check(
  en('quick page 1').includes('GPX files') && ja('quick page 1').includes('GPXファイル'),
  'GPX files are among the sources, in both languages',
);
check(
  en('quickGpx page 1').includes('Drop a .zip or .gpx file here') &&
    en('quickGpx page 1').includes('type="file"') &&
    en('quickGpx page 1').includes('accept=".zip,.gpx"') &&
    ja('quickGpx page 1').includes('ここにドロップ') &&
    !en('quickGpx page 1').includes('Strava Client Secret'),
  'with GPX files chosen the page offers a file drop, and no Strava questions',
);
check(
  en('change:source:gpx page 1').includes('Which is the site built from?') &&
    !en('change:source:gpx page 1').includes('type="file"'),
  'change mode has the switch between Strava and GPX files',
);
check(en('full page 1').includes('aria-current="step"'), 'full setup goes group by group');
check(
  en('full page 2').includes('Tile address'),
  '  ...with the terrain parts when a tile address is chosen',
);
check(
  en('change:deploy page 1').includes('Where to publish the site') &&
    en('change:deploy page 1').includes('GitHub Pages') &&
    en('change:deploy page 1').includes('Cloudflare API token') &&
    en('change:deploy page 1').includes('config/secrets.jsonc'),
  "the deploy group offers the three hosts and asks for the chosen host's token",
);
check(
  en('run, under way').includes('Open the Strava sign-in page') &&
    en('run, under way').includes('Fetched 200 activities.'),
  'the run screen shows the sign-in link and the output',
);
check(
  ja('run, before').includes('今すぐ実行') && ja('run, before').includes('Stravaにサインイン'),
  '  ...and reads in Japanese',
);
check(
  en('review').includes('# Match review') && en('review').includes('I have read this'),
  'the review screen shows a file and its tick box',
);
check(
  en('done').includes('pnpm web:preview') &&
    en('done, demo, closed').includes('pnpm jam demo --clear'),
  'the last screen says what to run next',
);

// The rules, read from the source.
const src = join(process.cwd(), 'packages/web/src');
const setupFiles = readdirSync(join(src, 'setup')).map((name) => ({
  name,
  text: readFileSync(join(src, 'setup', name), 'utf8'),
}));
const code = setupFiles.filter((file) => file.name !== 'i18n-ja-setup.ts');
const hex = code.filter((file) => /#[0-9a-fA-F]{3,8}\b/.test(file.text)).map((file) => file.name);
check(
  hex.length === 0,
  `no colour is written in a setup component${hex.length ? ` (${hex.join(', ')})` : ''}`,
);
const stored = code
  .filter((file) =>
    /localStorage|sessionStorage|indexedDB|document\.cookie|usePref\(/.test(file.text),
  )
  .map((file) => file.name);
check(
  stored.length === 0,
  `nothing is kept in the browser${stored.length ? ` (${stored.join(', ')})` : ''}`,
);
const storeUsers = code
  .filter((file) => /from '\.\.\/(store|prefs)\.ts'/.test(file.text))
  .map((file) => file.name);
check(
  storeUsers.length === 0,
  "the page does not load the public site's store or its saved choices",
);
check(
  readFileSync(join(process.cwd(), 'packages/web/setup.html'), 'utf8').includes('jam-setup') &&
    code.some((file) => file.text.includes("MARKER = 'jam-setup'")),
  'the page and its script carry the marker the audit looks for',
);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? entry.name === 'setup'
        ? []
        : walk(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
const reaching = walk(src).filter((file) =>
  /from '[^']*\/setup\//.test(readFileSync(file, 'utf8')),
);
check(
  reaching.length === 0,
  `the public site imports nothing from src/setup${reaching.length ? ` (${reaching.join(', ')})` : ''}`,
);
// The site's stylesheet stops the page scrolling (the map fills the window); the setup page, a long
// form, has to undo that or its lower half and its Back button are out of reach.
check(
  /body\s*\{[^}]*overflow:\s*auto/.test(readFileSync(join(src, 'setup', 'setup.css'), 'utf8')),
  "the setup page scrolls (setup.css undoes the site's overflow: hidden)",
);

check(
  !readFileSync(join(src, 'i18n-ja.ts'), 'utf8').includes('セットアップ'),
  "the setup page's Japanese stays out of i18n-ja.ts",
);

if (failures > 0) {
  console.log(`${failures} checks failed.`);
  process.exit(1);
}
console.log('All checks passed.');

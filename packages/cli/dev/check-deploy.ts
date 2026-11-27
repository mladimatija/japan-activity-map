/**
 * Runs the deploy checks in a throwaway folder, with a stand-in for wrangler (fake-wrangler.ts):
 * nothing is uploaded and data/ and dist/ are not touched. Deploy refuses until it is set up and
 * until both builds are there, audits the folder first, writes `_headers`, hands the token over in
 * the environment only, and says what to do when Cloudflare refuses. `update` runs the steps in
 * order and stops at the first that fails; `schedule` writes a job for the user to install.
 *
 *   node packages/cli/dev/check-deploy.ts      (or: pnpm check:deploy)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { headersFile, mapOrigins } from '../src/deploy/headers.ts';
import { sandbox } from './harness.ts';
import { siteOptionsSchema } from '@jam/core';

const { temp, data, configDir, jamResult, jamWith, fixtures, check, finish } = sandbox('deploy');
const dist = join(temp, 'dist');
const wranglerLog = join(temp, 'wrangler.log');
const netlifyLog = join(temp, 'netlify.log');
const remote = join(temp, 'pages.git');
const TOKEN = 'cf-token-ABCDEFGHIJKLMNOP-0123456789';
const ACCOUNT = '0123456789abcdef0123456789abcdef';
const NETLIFY_TOKEN = 'nfp_NetlifyTokenABCDEFGH12345678';
// The stand-ins deploy uses instead of the real uploaders and GitHub, named in one file.
const standIns = join(temp, 'stand-ins.json');
spawnSync('git', ['init', '--bare', '--quiet', remote]);
writeFileSync(
  standIns,
  JSON.stringify({
    'wrangler@4': join(import.meta.dirname, 'fake-wrangler.ts'),
    'netlify-cli@27': join(import.meta.dirname, 'fake-netlify.ts'),
    github: remote,
  }),
);
const shared = {
  JAM_DEPLOY_STAND_INS: standIns,
  JAM_DEPLOY_NO_LOOKUP: '1',
  JAM_UPDATE_DIST: dist,
  FAKE_WRANGLER_LOG: wranglerLog,
  FAKE_NETLIFY_LOG: netlifyLog,
};
/** Runs `jam` with the wrangler stand-in answering as `mode` says. */
const jam = (mode: string, ...args: string[]) =>
  jamWith({ ...shared, FAKE_WRANGLER_MODE: mode }, ...args);
const calls = (): {
  args: string[];
  token: string;
  account: string;
  ci: string;
  files: string[];
}[] =>
  existsSync(wranglerLog)
    ? readFileSync(wranglerLog, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ReturnType<typeof calls>[number])
    : [];
const site = (deploy: object, extra: object = {}) =>
  writeFileSync(join(configDir, 'site.jsonc'), JSON.stringify({ deploy, ...extra }));
const secrets = (deploy: object | undefined) =>
  writeFileSync(join(configDir, 'secrets.jsonc'), JSON.stringify(deploy ? { deploy } : {}));
const logs = () => {
  const dir = join(data, 'logs');
  return existsSync(dir)
    ? execFileSync('sh', ['-c', `cat "${dir}"/* 2>/dev/null || true`], { encoding: 'utf8' })
    : '';
};

// The headers file, on its own.
{
  const options = siteOptionsSchema.parse({
    map: {
      terrain: {
        enabled: true,
        tiles: 'https://dem.example.org/{z}/{x}/{y}.png',
        attribution: 'x',
      },
    },
    deploy: { extraHosts: ['https://extra.example.net/tiles'] },
  });
  const style = {
    glyphs: 'https://fonts.example.com/{fontstack}/{range}.pbf',
    sprite: 'https://tiles.openfreemap.org/sprites/x',
    sources: {
      a: { url: 'https://tiles.openfreemap.org/planet' },
      b: { tiles: ['https://b.example.com/{z}.pbf'] },
    },
  };
  const found = await mapOrigins(options, async (url) =>
    url.endsWith('/planet') ? { tiles: ['https://cdn.example.io/{z}/{x}/{y}.pbf'] } : style,
  );
  check(
    "the allowed addresses are the config's, the styles' and their tile sources'",
    [
      'https://b.example.com',
      'https://cdn.example.io',
      'https://dem.example.org',
      'https://extra.example.net',
      'https://fonts.example.com',
      'https://tiles.openfreemap.org',
    ].every((origin) => found.origins.includes(origin)) && found.unread.length === 0,
    JSON.stringify(found),
  );
  const offline = await mapOrigins(options, async () => {
    throw new Error('offline');
  });
  check(
    'a style that cannot be read is named, and its own address still allowed',
    offline.unread.length === 2 && offline.origins.includes('https://tiles.openfreemap.org'),
    JSON.stringify(offline),
  );
  const text = headersFile(found.origins, 'https://map.example.com');
  check(
    'the policy allows the page itself and those addresses, and no inline script',
    /Content-Security-Policy: default-src 'self'; script-src 'self';/.test(text) &&
      /connect-src 'self' [^;]*https:\/\/cdn\.example\.io/.test(text) &&
      text.includes("worker-src 'self' blob:") &&
      !/script-src[^;]*unsafe/.test(text),
    text,
  );
  check(
    'with an address of its own, the pages.dev copies are kept out of search engines',
    text.includes('https://:project.pages.dev/*\n  X-Robots-Tag: noindex') &&
      !headersFile(found.origins, undefined).includes('noindex') &&
      !headersFile(found.origins, 'https://my-map.pages.dev').includes('noindex'),
  );
  let tooLong = '';
  try {
    headersFile(
      Array.from({ length: 120 }, (_, i) => `https://host-number-${i}.example.com`),
      undefined,
    );
  } catch (error) {
    tooLong = (error as Error).message;
  }
  check("a policy over Cloudflare's line limit is refused", tooLong.includes('2000'), tooLong);
}

// Not set up. The sheet is pointed at nothing, whatever is in data/ beside the repository.
writeFileSync(join(configDir, 'sheet.jsonc'), JSON.stringify({ path: join(temp, 'no-sheet.csv') }));
site({});
secrets(undefined);
{
  const result = jam('ok', 'deploy', '--dir', dist);
  check(
    'deploy refuses until the project, token and account are set, naming each',
    result.code === 1 &&
      result.text.includes('projectName') &&
      result.text.includes('apiToken') &&
      result.text.includes('accountId') &&
      calls().length === 0,
    result.text,
  );
}
site({ projectName: 'Not A Name' });
check('a project name Cloudflare would refuse is a config error', jam('ok', 'deploy').code === 1);

site({ projectName: 'my-map' }, { site: { baseUrl: 'https://map.example.com' } });
secrets({ apiToken: TOKEN, accountId: ACCOUNT });
{
  const result = jam('ok', 'deploy', '--dir', dist);
  check(
    'deploy refuses a folder that is not there',
    result.code === 1 && calls().length === 0,
    result.text,
  );
}

// A build, without the web app.
fixtures('match-fixtures.ts', join(temp, 'sheet'));
jamResult('sync', 'sheet', join(temp, 'sheet', 'sheet.csv'));
writeFileSync(
  join(configDir, 'privacy-zones.jsonc'),
  JSON.stringify({ zones: [{ label: 'start', lat: 35.6812, lon: 139.7671, radiusM: 300 }] }),
);
check('the data builds', jam('ok', 'build', '--out', join(dist, 'data')).code === 0);
{
  const result = jam('ok', 'deploy', '--dir', dist);
  check(
    'deploy refuses without the web app, and says how to build it',
    result.code === 1 && result.text.includes('pnpm web:build') && calls().length === 0,
    result.text,
  );
}
mkdirSync(join(dist, 'assets'), { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');

// A dry run.
{
  const result = jam('ok', '--dry-run', 'deploy', '--dir', dist);
  check(
    'a dry run audits, uploads nothing and writes nothing',
    result.code === 0 &&
      result.text.includes('Nothing private found') &&
      calls().length === 0 &&
      !existsSync(join(dist, '_headers')),
    result.text,
  );
}

// The real thing, against the stand-in.
{
  const result = jam('echo-token', 'deploy', '--dir', dist);
  const [call] = calls();
  check('deploy succeeds', result.code === 0, result.text);
  check(
    "wrangler is asked to upload the folder to the project's production branch",
    call !== undefined &&
      call.args.slice(0, 3).join(' ') === `pages deploy ${dist}` &&
      call.args.join(' ').includes('--project-name my-map --branch main'),
    JSON.stringify(call?.args),
  );
  check(
    'the token and account reach it in the environment, never as arguments',
    call !== undefined &&
      call.token === TOKEN &&
      call.account === ACCOUNT &&
      call.ci === '1' &&
      !call.args.join(' ').includes(TOKEN) &&
      !call.args.join(' ').includes(ACCOUNT),
  );
  check(
    'a token the tool prints is not shown or logged',
    !result.text.includes(TOKEN) && result.text.includes('[hidden]') && !logs().includes(TOKEN),
    result.text,
  );
  check(
    'the folder was uploaded with its _headers file',
    call !== undefined &&
      ['_headers', 'assets', 'data', 'index.html'].every((name) => call.files.includes(name)) &&
      readFileSync(join(dist, '_headers'), 'utf8').includes('https://tiles.openfreemap.org'),
    JSON.stringify(call?.files),
  );
  check(
    'it reports this upload and the public address',
    result.text.includes('https://0a1b2c3d.my-map.pages.dev') &&
      result.text.includes('Deployed: https://map.example.com'),
    result.text,
  );
}
rmSync(wranglerLog);
{
  const result = jam('ok', 'deploy', '--dir', dist, '--branch', 'try-out');
  check(
    'another branch is a preview and says so',
    result.code === 0 &&
      calls()[0]?.args.join(' ').includes('--branch try-out') === true &&
      result.text.includes('the public site is unchanged'),
    result.text,
  );
}
rmSync(wranglerLog);
{
  const result = jam('ok', 'deploy', '--dir', dist, '--create');
  const made = calls();
  check(
    '--create makes the project first, with its production branch',
    result.code === 0 &&
      made.length === 2 &&
      made[0]?.args.join(' ') === 'pages project create my-map --production-branch main',
    JSON.stringify(made.map((call) => call.args)),
  );
}
{
  const missing = jam('no-project', 'deploy', '--dir', dist);
  check(
    'a project Cloudflare does not have: says how to create it',
    missing.code === 1 && missing.text.includes('pnpm jam deploy --create'),
    missing.text,
  );
  const refused = jam('bad-token', 'deploy', '--dir', dist);
  check(
    'a refused token: says which permission it needs',
    refused.code === 1 && refused.text.includes('Cloudflare Pages > Edit'),
    refused.text,
  );
}

// The audit stands between the folder and the upload.
rmSync(wranglerLog);
writeFileSync(join(dist, 'assets', 'leak.js'), `const t = "${TOKEN}";`);
{
  const result = jam('ok', 'deploy', '--dir', dist);
  check(
    'a folder holding a credential is not uploaded',
    result.code === 1 && result.text.includes('Not deployed') && calls().length === 0,
    result.text,
  );
}
rmSync(join(dist, 'assets', 'leak.js'));
writeFileSync(join(dist, 'notes.txt'), 'hello');
{
  const result = jam('ok', '--dry-run', 'deploy', '--dir', dist);
  check(
    'a file neither build made is pointed out',
    result.code === 0 && result.text.includes('notes.txt'),
    result.text,
  );
}
rmSync(join(dist, 'notes.txt'));

// Netlify: the same folder, the other uploader.
{
  const netlifyCalls = (): { args: string[]; token: string; cwd: string; files: string[] }[] =>
    existsSync(netlifyLog)
      ? readFileSync(netlifyLog, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as ReturnType<typeof netlifyCalls>[number])
      : [];
  const netlify = (mode: string, ...args: string[]) =>
    jamWith({ ...shared, FAKE_NETLIFY_MODE: mode }, ...args);
  site(
    { host: 'netlify', projectName: 'my-map', team: 'my-team' },
    { site: { baseUrl: 'https://map.example.com' } },
  );
  secrets({ apiToken: TOKEN, accountId: ACCOUNT });
  const unset = netlify('ok', 'deploy', '--dir', dist);
  check(
    'Netlify: refuses without its own token, naming it',
    unset.code === 1 && unset.text.includes('netlifyToken') && netlifyCalls().length === 0,
    unset.text,
  );
  secrets({ netlifyToken: NETLIFY_TOKEN });
  rmSync(wranglerLog, { force: true });
  const result = netlify('echo-token', 'deploy', '--dir', dist);
  const [call] = netlifyCalls();
  check('Netlify: deploy succeeds', result.code === 0, result.text);
  check(
    'Netlify: the folder goes to production of the named project, without a build',
    call !== undefined &&
      call.args.join(' ').startsWith(`deploy --dir ${dist} --no-build --site my-map --prod`) &&
      calls().length === 0,
    JSON.stringify(call?.args),
  );
  check(
    'Netlify: the token is in the environment only, and hidden when printed',
    call !== undefined &&
      call.token === NETLIFY_TOKEN &&
      !call.args.join(' ').includes(NETLIFY_TOKEN) &&
      !result.text.includes(NETLIFY_TOKEN) &&
      !logs().includes(NETLIFY_TOKEN),
    result.text,
  );
  check(
    'Netlify: it runs away from the repository, and the folder holds _headers without Cloudflare rules',
    call !== undefined &&
      !call.cwd.startsWith(resolve(import.meta.dirname, '../../..')) &&
      call.files.includes('_headers') &&
      readFileSync(join(dist, '_headers'), 'utf8').includes('Content-Security-Policy') &&
      !readFileSync(join(dist, '_headers'), 'utf8').includes('pages.dev'),
    JSON.stringify(call),
  );
  check(
    'Netlify: reports this upload and the public address',
    result.text.includes('https://0a1b2c3d4e5f--my-map.netlify.app') &&
      result.text.includes('Deployed: https://map.example.com'),
    result.text,
  );
  rmSync(netlifyLog);
  const draft = netlify('ok', 'deploy', '--dir', dist, '--branch', 'try-out', '--create');
  const args = netlifyCalls()[0]?.args.join(' ') ?? '';
  check(
    'Netlify: --branch is a draft under that name, --create names the project and team',
    draft.code === 0 &&
      args.includes('--alias try-out') &&
      !args.includes('--prod') &&
      args.includes('--site-name my-map --team my-team') &&
      draft.text.includes('the public site is unchanged'),
    args,
  );
  const none = netlify('no-site', 'deploy', '--dir', dist);
  check(
    'Netlify: a project it does not have: says how to create it',
    none.code === 1 && none.text.includes('pnpm jam deploy --create'),
    none.text,
  );
}

// GitHub Pages: a branch of a repository (here a bare one in the sandbox).
{
  const git = (...args: string[]) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();
  secrets(undefined);
  site({ host: 'github' });
  const unset = jam('ok', 'deploy', '--dir', dist);
  check(
    'GitHub Pages: refuses without a repository, and needs no token',
    unset.code === 1 && unset.text.includes('repository') && !unset.text.includes('Token'),
    unset.text,
  );
  site({ host: 'github', repository: 'someone/my-map', pagesBranch: 'main' });
  const code = jam('ok', 'deploy', '--dir', dist);
  check(
    'GitHub Pages: never pushes over a branch that holds code',
    code.code === 1 &&
      code.text.includes('holds code') &&
      git('-C', remote, 'branch', '--list') === '',
    code.text,
  );
  site({ host: 'github', repository: 'someone/my-map' });
  const dry = jam('ok', '--dry-run', 'deploy', '--dir', dist);
  check(
    'GitHub Pages: a dry run pushes nothing',
    dry.code === 0 && git('-C', remote, 'branch', '--list') === '',
    dry.text,
  );
  const before = readFileSync(join(dist, 'index.html'), 'utf8');
  const result = jam('ok', 'deploy', '--dir', dist);
  const files = git('-C', remote, 'ls-tree', '--name-only', 'gh-pages').split('\n');
  check('GitHub Pages: deploy succeeds', result.code === 0, result.text);
  check(
    'GitHub Pages: the branch holds the site and .nojekyll, and no _headers',
    ['.nojekyll', 'assets', 'data', 'index.html'].every((name) => files.includes(name)) &&
      !files.includes('_headers'),
    files.join(' '),
  );
  const page = git('-C', remote, 'show', 'gh-pages:index.html');
  check(
    'GitHub Pages: the policy is in the pushed page, and dist is left as it was',
    page.includes('http-equiv="Content-Security-Policy"') &&
      page.includes('https://tiles.openfreemap.org') &&
      !page.includes('frame-ancestors') &&
      readFileSync(join(dist, 'index.html'), 'utf8') === before,
    page,
  );
  check(
    'GitHub Pages: it says the address and how to turn Pages on',
    result.text.includes('Deployed: https://someone.github.io/my-map/') &&
      result.text.includes('Settings > Pages'),
    result.text,
  );
  jam('ok', 'deploy', '--dir', dist);
  check(
    'GitHub Pages: a second deploy replaces the branch, which stays one commit',
    git('-C', remote, 'rev-list', '--count', 'gh-pages') === '1',
  );
  const preview = jam('ok', 'deploy', '--dir', dist, '--branch', 'x');
  check('GitHub Pages: --branch is refused', preview.code === 1, preview.text);
  // The repository's own default branch, whatever it is called, is never pushed over.
  spawnSync('git', ['-C', remote, 'branch', 'site-code', 'gh-pages']);
  spawnSync('git', ['-C', remote, 'symbolic-ref', 'HEAD', 'refs/heads/site-code']);
  site({ host: 'github', repository: 'someone/my-map', pagesBranch: 'site-code' });
  const codeBefore = git('-C', remote, 'rev-parse', 'site-code');
  const overCode = jam('ok', 'deploy', '--dir', dist);
  check(
    'GitHub Pages: the branch the repository names as its default is refused, and left alone',
    overCode.code === 1 &&
      overCode.text.includes('default branch') &&
      git('-C', remote, 'rev-parse', 'site-code') === codeBefore,
    overCode.text,
  );
  check(
    'a stand-in is announced every time it is used',
    result.text.includes('Using a stand-in for github'),
    result.text,
  );
  check(
    "none of it touched this repository's own git",
    !existsSync(join(dist, '.git')) && calls().length === 0,
  );
  // Back to Cloudflare for what follows.
  site({ projectName: 'my-map' }, { site: { baseUrl: 'https://map.example.com' } });
  secrets({ apiToken: TOKEN, accountId: ACCOUNT });
}

// An address the https page could not load from is pointed out.
{
  site(
    { projectName: 'my-map', extraHosts: ['http://tiles.example.org/{z}/{x}/{y}.png'] },
    { site: { baseUrl: 'https://map.example.com' } },
  );
  const insecure = jam('ok', '--dry-run', 'deploy', '--dir', dist);
  check(
    'an http address is named as one the published page cannot load from',
    insecure.code === 0 && insecure.text.includes('is not an https address'),
    insecure.text,
  );
  site({ projectName: 'my-map' }, { site: { baseUrl: 'https://map.example.com' } });
}

// Demo data is never published.
{
  const meta = join(dist, 'data', 'meta.json');
  const original = readFileSync(meta, 'utf8');
  writeFileSync(meta, JSON.stringify({ ...(JSON.parse(original) as object), demo: true }));
  const result = jam('ok', 'deploy', '--dir', dist);
  check(
    'a folder built from demo data is refused',
    result.code === 1 && result.text.includes('demo data') && calls().length === 0,
    result.text,
  );
  writeFileSync(meta, original);
}

// update: in order, skipping what is not there, stopping at a failure.
{
  const dry = jam('ok', '--dry-run', 'update');
  const order = [
    'Fetch new Strava',
    'Import the activity sheet',
    'build the site data',
    'Build the web app',
    'Deploy',
  ];
  const at = order.map((title) => dry.text.indexOf(title));
  check(
    'update goes through the steps in order',
    at.every((position, i) => position >= 0 && (i === 0 || position > (at[i - 1] ?? 0))),
    dry.text,
  );
  check(
    'it skips Strava when not signed in and the sheet when there is none',
    /Fetch new Strava activities: skipped \(not signed in/.test(dry.text) &&
      /Import the activity sheet: skipped \(no sheet/.test(dry.text),
    dry.text,
  );
  // A sign-in file that cannot be read stops a sync, not a run that was told not to sync.
  writeFileSync(
    join(configDir, 'secrets.jsonc'),
    JSON.stringify({
      strava: { clientId: '1', clientSecret: 'x' },
      deploy: { apiToken: TOKEN, accountId: ACCOUNT },
    }),
  );
  writeFileSync(join(data, 'strava-token.json'), '{ cut short');
  const noSync = jam('ok', '--dry-run', 'update', '--no-sync', '--no-deploy');
  const withSync = jam('ok', '--dry-run', 'update', '--no-deploy');
  check(
    'a broken sign-in file does not stop update --no-sync, and is a plain message otherwise',
    noSync.code === 0 &&
      withSync.code === 1 &&
      withSync.text.includes('pnpm jam strava auth') &&
      !withSync.text.includes('SyntaxError'),
    `${noSync.text}\n---\n${withSync.text}`,
  );
  rmSync(join(data, 'strava-token.json'));
  secrets({ apiToken: TOKEN, accountId: ACCOUNT });
  const off = jam('ok', '--dry-run', 'update', '--no-deploy');
  check(
    '--no-deploy leaves the upload out',
    off.text.includes('Deploy: skipped (--no-deploy)'),
    off.text,
  );
  // A zone file that cannot be read stops the build, and with it everything after.
  writeFileSync(join(configDir, 'privacy-zones.jsonc'), '{ "zones": [ { "label": 1 } ] }');
  rmSync(wranglerLog, { force: true });
  const broken = jam('ok', 'update');
  check(
    'a failing step stops the run before anything is uploaded',
    broken.code !== 0 && calls().length === 0,
    broken.text,
  );
}

// schedule.
{
  const cron = jam('ok', 'schedule', '--cron', '--day', 'wed', '--at', '21:15');
  check(
    'schedule --cron prints a weekly crontab line for jam update',
    cron.code === 0 && /15 21 \* \* 3 PATH=.* update >> /.test(cron.text),
    cron.text,
  );
  check('a time that is not one is refused', jam('ok', 'schedule', '--at', '25:00').code === 1);
  if (process.platform === 'darwin') {
    const made = jam('ok', 'schedule');
    const file = join(data, 'schedule', 'com.japan-activity-map.update.plist');
    check(
      'on a Mac it writes a launchd job into data/ and says how to install it',
      made.code === 0 &&
        existsSync(file) &&
        readFileSync(file, 'utf8').includes('<string>update</string>') &&
        made.text.includes('launchctl bootstrap'),
      made.text,
    );
  }
}

finish();

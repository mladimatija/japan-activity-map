// Runs the setup wizard from an answers file against the fake Strava server, in a temporary folder
// that starts with only the example configs. Nothing in data/ or config/ is touched.
// Run with `pnpm check:setup`.
import { type ChildProcess, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { sandbox } from './harness.ts';

const box = sandbox('setup');
const { root, temp, data, check } = box;
const PORT = Number(process.env.FAKE_PORT ?? 8726);
const SECRET = 'fake-secret';
const FAKE = `http://127.0.0.1:${PORT}`;

// A config folder as a fresh clone has it: examples only, no real file.
const configDir = join(temp, 'fresh-config');
mkdirSync(configDir);
for (const file of readdirSync(join(root, 'config')).filter((name) =>
  name.endsWith('.example.jsonc'),
))
  copyFileSync(join(root, 'config', file), join(configDir, file));
// The example's sheet path is in the repository's own data/ folder, where a sheet may well exist
// on the machine running this: point it into the sandbox, so the checks see no sheet either way.
{
  const sheet = join(configDir, 'sheet.example.jsonc');
  writeFileSync(
    sheet,
    readFileSync(sheet, 'utf8').replace(
      '"data/activities.csv"',
      JSON.stringify(join(temp, 'data/activities.csv')),
    ),
  );
}
const realFiles = () =>
  readdirSync(configDir)
    .filter((name) => !name.includes('.example.'))
    .sort();
const config = (name: string) => readFileSync(join(configDir, `${name}.jsonc`), 'utf8');
const mode = (name: string) => statSync(join(configDir, `${name}.jsonc`)).mode & 0o777;

const env: NodeJS.ProcessEnv = {
  ...box.env,
  JAM_NO_BROWSER: '1',
  JAM_SLEEP_SCALE: '0',
  JAM_SETUP_BUILD_OUT: join(temp, 'out/data'),
};
const withSecrets = { ...env, JAM_STRAVA_CLIENT_ID: '1', JAM_STRAVA_CLIENT_SECRET: SECRET };

const answersFile = (name: string, answers: Record<string, unknown>): string => {
  const path = join(temp, `${name}.jsonc`);
  writeFileSync(path, `// Answers for the check.\n${JSON.stringify(answers, null, 2)}\n`);
  return path;
};

interface Result {
  code: number;
  text: string;
}
const everything: string[] = [];

/** Runs `jam setup …`; when the Strava sign-in address appears, opens it as a browser would. */
const setup = (args: string[], runEnv = env, stdin?: string): Promise<Result> =>
  new Promise((resolve) => {
    const child = spawn(
      'node',
      [join(root, 'packages/cli/src/main.ts'), '--config', configDir, 'setup', ...args],
      { env: runEnv, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let text = '';
    let visited = false;
    const take = (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const address = new RegExp(`${FAKE}/oauth/authorize\\S*`).exec(text)?.[0];
      if (address && !visited) {
        visited = true;
        void fetch(address).then(
          (response) => response.text(),
          () => undefined,
        );
      }
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.stdin.end(stdin ?? '');
    child.on('close', (code) => {
      everything.push(text);
      resolve({ code: code ?? 1, text });
    });
  });

const control = (body: Record<string, unknown>) =>
  fetch(`${FAKE}/__control`, { method: 'POST', body: JSON.stringify(body) });

let fake: ChildProcess | undefined;
const startFake = async () => {
  fake = spawn('node', [join(root, 'packages/cli/dev/fake-strava.ts'), '--port', String(PORT)], {
    env,
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fetch(`${FAKE}/__state`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
};

const main = async () => {
  await startFake();

  // Nobody to ask.
  const noTerminal = await setup([]);
  check(
    'without a terminal or answers it stops with a sentence',
    noTerminal.code === 1 && noTerminal.text.includes('not a terminal'),
    noTerminal.text,
  );
  const noSecrets = await setup(['--yes', '--no-run']);
  check(
    'without the Strava credentials it stops and says where they come from',
    noSecrets.code === 1 && noSecrets.text.includes('JAM_STRAVA_CLIENT_ID'),
    noSecrets.text,
  );
  check('  ...and writes no config file', realFiles().length === 0, realFiles().join(', '));
  const flagSecret = await setup(['--client-secret', SECRET, '--yes']);
  check('a secret cannot be given as a flag', flagSecret.code === 1 && realFiles().length === 0);
  const inFile = await setup(['--answers', answersFile('bad', { 'strava.clientSecret': 'x' })]);
  check(
    'a secret in the answers file is refused',
    inFile.code === 1 && inFile.text.includes('must not hold secrets'),
    inFile.text,
  );

  // Change mode on a file that does not exist yet: it starts from the example, comments and all.
  const api = await setup([
    '--change',
    'strava',
    '--answers',
    answersFile('api', {
      'strava.api.baseUrl': `${FAKE}/api/v3`,
      'strava.api.oauthUrl': `${FAKE}/oauth`,
      'strava.api.pageSize': 50,
      'strava.api.redirectPort': 8733,
    }),
  ]);
  check(
    'change mode writes strava.jsonc',
    api.code === 0 && existsSync(join(configDir, 'strava.jsonc')),
    api.text,
  );
  check(
    '  ...keeping the comments of the example',
    api.code === 0 &&
      config('strava').includes("// Strava's addresses.") &&
      config('strava').includes('// "EBikeRide": "ride",'),
  );
  check('  ...and nothing else', realFiles().join() === 'strava.jsonc', realFiles().join(', '));

  const quick = answersFile('quick', {
    start: 'quick',
    'site.title': 'Check Map',
    sources: ['strava'],
    'strava.includePrivate': false,
    'privacy.home': '35.6812, 139.7671',
    'privacy.radius': 450,
    'publish.preset': 'private',
    // No network here, and the web app's build is not this check's business.
    skip: ['lists-fetch', 'lists-build', 'web-build'],
  });

  // A dry run shows the plan and writes nothing.
  const before = realFiles().join();
  const stateFile = () =>
    existsSync(join(data, 'setup-state.json'))
      ? readFileSync(join(data, 'setup-state.json'), 'utf8')
      : '';
  const stateBefore = stateFile();
  const dry = await setup(['--answers', quick, '--yes', '--dry-run'], withSecrets);
  check('a dry run ends well', dry.code === 0 && dry.text.includes('Dry run'), dry.text);
  check(
    '  ...shows the diff with the secret masked',
    dry.text.includes('"clientSecret": "********"') && !dry.text.includes(SECRET),
  );
  check(
    '  ...and writes no file and no state',
    realFiles().join() === before && stateFile() === stateBefore,
  );

  // The real run, interrupted: the fake server fails the second page of activities.
  await control({ failPage: 2, failTimes: 99 });
  const first = await setup(['--answers', quick, '--yes'], withSecrets);
  check('a run whose pull fails ends with 1', first.code === 1, first.text.slice(-600));
  check('  ...and says how to continue', first.text.includes('continues from this step'));
  check(
    '  ...after writing the config files',
    realFiles().join() === 'privacy-zones.jsonc,secrets.jsonc,site.jsonc,strava.jsonc',
    realFiles().join(', '),
  );
  const stateText = existsSync(join(data, 'setup-state.json'))
    ? readFileSync(join(data, 'setup-state.json'), 'utf8')
    : '';
  check('  ...and noting the finished steps', stateText.includes('"strava-auth"'), stateText);
  check(
    '  ...without the secret or the home location in the state file',
    !stateText.includes(SECRET) && !stateText.includes('35.68'),
  );

  await control({ failTimes: 0 });
  const second = await setup(['--answers', quick, '--yes'], withSecrets);
  check(
    'the next run finishes',
    second.code === 0 && second.text.includes('Setup is complete'),
    second.text.slice(-800),
  );
  check('  ...without signing in again', !second.text.includes('/oauth/authorize'));
  check('  ...changing no config file', second.text.includes('No config file needs to change'));
  check('  ...and the site data is built', existsSync(join(temp, 'out/data/meta.json')));
  check('  ...and the state file is gone', !existsSync(join(data, 'setup-state.json')));

  // What was written.
  const status = spawnResult(['status']);
  check(
    'every written config file validates',
    status.code === 0 && status.text.includes('Config is valid'),
    status.text,
  );
  const site = config('site');
  check(
    'site.jsonc keeps the example comments',
    site.includes('// Any MapLibre style.') && site.includes('// Publish the time of day.'),
  );
  check(
    '  ...and holds the answers',
    site.includes('"title": "Check Map"') &&
      site.includes('"activityNames": false') &&
      site.includes('"paceAlongTracks": false'),
  );
  check(
    '  ...with untouched settings left alone',
    site.includes('"timeOfDay": false') && site.includes('"simplifyM": 5'),
  );
  check(
    'secrets.jsonc is readable by the owner only',
    mode('secrets') === 0o600,
    mode('secrets').toString(8),
  );
  check('privacy-zones.jsonc is readable by the owner only', mode('privacy-zones') === 0o600);
  check('the zone was written with its radius', config('privacy-zones').includes('"radiusM": 450'));
  check(
    '  ...and the example zones in the file are still there as comments',
    config('privacy-zones').includes('// { "label": "home"'),
    config('privacy-zones'),
  );

  // --change edits one key and leaves the rest byte for byte.
  const siteBefore = config('site');
  const describe = await setup([
    '--change',
    'site',
    '--answers',
    answersFile('describe', { 'site.description': 'Peaks and long walks' }),
  ]);
  check(
    '--change edits one key and leaves the rest of the file as it was',
    describe.code === 0 &&
      config('site') ===
        siteBefore.replace('"description": ""', '"description": "Peaks and long walks"'),
    describe.text,
  );
  check('  ...and says what to run next', describe.text.includes('pnpm jam build'));
  const dryChange = await setup([
    '--change',
    'site',
    '--dry-run',
    '--answers',
    answersFile('title', { 'site.title': 'Other' }),
  ]);
  check(
    '--change --dry-run writes nothing',
    dryChange.code === 0 &&
      config('site').includes('Peaks and long walks') &&
      !config('site').includes('Other'),
  );
  const wrong = await setup([
    '--change',
    'output',
    '--answers',
    answersFile('wrong', { 'output.decimals': 12 }),
  ]);
  check(
    'a value the schema refuses is not written',
    wrong.code === 1 && !config('site').includes('"decimals": 12'),
    wrong.text,
  );

  // A null is a value: "none" for the dark style writes null, and it validates.
  const dark = await setup([
    '--change',
    'map',
    '--answers',
    answersFile('dark', { 'map.darkStyleUrl': 'none', 'map.terrain': 'mapzen' }),
  ]);
  check(
    'a setting can be set to null, and a preset writes its several keys',
    dark.code === 0 &&
      config('site').includes('"darkStyleUrl": null') &&
      config('site').includes('"encoding": "terrarium"') &&
      spawnResult(['status']).code === 0,
    dark.text,
  );

  // Secrets from stdin, changing only the secret.
  const secretsBefore = statSync(join(configDir, 'secrets.jsonc')).mtimeMs;
  const piped = await setup(
    ['--change', 'strava', '--secrets-stdin', '--answers', answersFile('none', {})],
    env,
    `JAM_STRAVA_CLIENT_SECRET=${SECRET}\n`,
  );
  check(
    '--secrets-stdin with the same secret changes nothing',
    piped.code === 0 && statSync(join(configDir, 'secrets.jsonc')).mtimeMs === secretsBefore,
    piped.text,
  );

  // The deploy group: the host, then what that host needs, tokens included.
  const CF_TOKEN = 'cf-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const cloudflare = await setup(
    [
      '--change',
      'deploy',
      '--secrets-stdin',
      '--answers',
      answersFile('deploy-cf', { 'deploy.host': 'cloudflare', 'deploy.projectName': 'my-map' }),
    ],
    env,
    `JAM_CLOUDFLARE_API_TOKEN=${CF_TOKEN}\nJAM_CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef\n`,
  );
  const secretsText = () => readFileSync(join(configDir, 'secrets.jsonc'), 'utf8');
  check(
    'the deploy group stores the Cloudflare token and account id beside the Strava secret',
    cloudflare.code === 0 &&
      secretsText().includes(CF_TOKEN) &&
      secretsText().includes('0123456789abcdef0123456789abcdef') &&
      secretsText().includes(SECRET) &&
      readFileSync(join(configDir, 'site.jsonc'), 'utf8').includes('"my-map"'),
    cloudflare.text,
  );
  check(
    '  ...and never shows the token',
    !cloudflare.text.includes(CF_TOKEN) && spawnResult(['status']).code === 0,
    cloudflare.text,
  );
  const github = await setup(
    [
      '--change',
      'deploy',
      '--answers',
      answersFile('deploy-gh', { 'deploy.host': 'github', 'deploy.repository': 'me/my-map' }),
    ],
    env,
  );
  check(
    'GitHub Pages asks for a repository and no token, and keeps the stored ones',
    github.code === 0 &&
      readFileSync(join(configDir, 'site.jsonc'), 'utf8').includes('"me/my-map"') &&
      secretsText().includes(CF_TOKEN),
    github.text,
  );
  const badAccount = await setup(
    [
      '--change',
      'deploy',
      '--secrets-stdin',
      '--answers',
      answersFile('deploy-bad', { 'deploy.host': 'cloudflare' }),
    ],
    env,
    'JAM_CLOUDFLARE_ACCOUNT_ID=not-an-id\n',
  );
  check(
    'an account id that is not one is refused',
    badAccount.code === 1 && badAccount.text.includes('32 characters'),
    badAccount.text,
  );

  // Demo data: offered only when this version has the command.
  const hasDemo = spawnResult(['demo', '--help']).code === 0;
  // GPX files instead of Strava: one made-up track by 東京駅 in the folder `sync gpx` reads.
  {
    const folder = join(data, 'activities');
    mkdirSync(folder, { recursive: true });
    const points = Array.from(
      { length: 120 },
      (_, i) =>
        `<trkpt lat="${(35.69 + i * 0.0002).toFixed(6)}" lon="${(139.775 + i * 0.0002).toFixed(6)}"><time>${new Date(Date.UTC(2025, 4, 3, 0, 0, i * 10)).toISOString()}</time></trkpt>`,
    ).join('');
    writeFileSync(
      join(folder, 'walk.gpx'),
      `<?xml version="1.0"?><gpx version="1.1" creator="check-setup"><trk><name>Check walk</name><type>Walking</type><trkseg>${points}</trkseg></trk></gpx>`,
    );
    const gpx = answersFile('gpx', {
      start: 'quick',
      sources: ['gpx'],
      skip: ['lists-fetch', 'lists-build', 'web-build'],
    });
    const dry = await setup(['--answers', gpx, '--yes', '--dry-run']);
    check(
      'choosing GPX files sets the source the site is built from',
      dry.code === 0 &&
        dry.text.includes('-     "source": "strava"') &&
        dry.text.includes('+     "source": "gpx"'),
      dry.text,
    );
    check(
      '  ...and plans the GPX import instead of the Strava steps',
      dry.text.includes('pnpm jam sync gpx') &&
        !dry.text.includes('strava auth') &&
        !dry.text.includes('sync strava'),
      dry.text,
    );
    const run = await setup(['--answers', gpx, '--yes']);
    const built = join(temp, 'out/data/activities.json');
    const sources = existsSync(built)
      ? (
          JSON.parse(readFileSync(built, 'utf8')) as { activities: { source: string }[] }
        ).activities.map((activity) => activity.source)
      : [];
    check(
      '  ...which imports the folder and builds the site from it',
      run.code === 0 &&
        config('site').includes('"source": "gpx"') &&
        sources.includes('gpx') &&
        !sources.includes('strava'),
      run.text.slice(-600),
    );
    const both = await setup(
      [
        '--answers',
        answersFile('both', {
          start: 'quick',
          sources: ['strava', 'gpx'],
          'activities.source': 'strava',
          skip: ['web-build'],
        }),
        '--dry-run',
      ],
      withSecrets,
    );
    check(
      'with Strava and GPX files both chosen, the answer says which the site is built from',
      both.code === 0 &&
        both.text.includes('+     "source": "strava"') &&
        both.text.includes('pnpm jam sync strava') &&
        both.text.includes('pnpm jam sync gpx'),
      both.text.slice(0, 900),
    );
    const back = await setup([
      '--change',
      'gpx',
      '--answers',
      answersFile('back', { 'activities.source': 'strava' }),
    ]);
    check(
      'changing the GPX group switches the site back to Strava',
      back.code === 0 && config('site').includes('"source": "strava"'),
      back.text,
    );
  }

  if (hasDemo) {
    // By now this sandbox has what a real setup has: a store with synced activities and config
    // files of its own. Making demo data must leave every byte of them alone.
    const fingerprint = () =>
      [join(data, 'jam.sqlite'), ...realFiles().map((name) => join(configDir, name))]
        .map((path) => `${path}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`)
        .join('\n');
    const before = fingerprint();
    const demoDir = join(temp, 'demo-from-setup');
    const demo = await setup(['--answers', answersFile('demo', { start: 'demo' }), '--yes'], {
      ...env,
      JAM_DEMO_DIR: demoDir,
    });
    check('demo data is made from the wizard', demo.code === 0, demo.text.slice(-400));
    check(
      '  ...in a folder of its own, with its own store',
      existsSync(join(demoDir, 'demo.json')) && existsSync(join(demoDir, 'jam.sqlite')),
    );
    check(
      '  ...and the real store and config files are untouched, byte for byte',
      fingerprint() === before,
    );
  } else {
    const demo = await setup(['--answers', answersFile('demo', { start: 'demo' })]);
    check(
      'demo data says it is not available in this version',
      demo.code === 1 && demo.text.includes('not available in this version'),
      demo.text,
    );
  }

  // The secret appears nowhere but the secrets file.
  const leaks: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (readFileSync(path, 'latin1').includes(SECRET)) leaks.push(path);
    }
  };
  walk(data);
  check(
    'the secret is in no log and no file under the data folder',
    leaks.length === 0,
    leaks.join(', '),
  );
  check(
    '  ...and in nothing the wizard printed',
    !everything.some((text) => text.includes(SECRET)),
  );
  const logs = readdirSync(join(data, 'logs'))
    .map((name) => readFileSync(join(data, 'logs', name), 'utf8'))
    .join('');
  check(
    '  ...and the log holds no answer either',
    !logs.includes('Check Map') && !logs.includes('35.68'),
  );
};

/** `jam <args>` against the fresh config folder, synchronously. */
const spawnResult = (args: string[]): Result => {
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const result = spawnSync(
    'node',
    [join(root, 'packages/cli/src/main.ts'), '--config', configDir, ...args],
    {
      env,
      encoding: 'utf8',
    },
  );
  return { code: result.status ?? 1, text: `${result.stdout}${result.stderr}` };
};

try {
  await main();
} finally {
  fake?.kill();
}
box.finish();

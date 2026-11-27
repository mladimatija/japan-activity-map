// Starts `jam setup --web` in a temporary folder and checks the server's rules from outside:
// who is let in, what can be run, that no answer ever carries the secret back, and that the page
// writes the same files as the terminal wizard. Run with `pnpm check:setup-web`.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';

import { sandbox } from './harness.ts';

const box = sandbox('setup-web');
const { root, temp, check } = box;
const SECRET = 'web-check-secret-4f9a';
const MAIN = join(root, 'packages/cli/src/main.ts');

const freshConfig = (name: string): string => {
  const dir = join(temp, name);
  mkdirSync(dir);
  for (const file of readdirSync(join(root, 'config')).filter((entry) =>
    entry.endsWith('.example.jsonc'),
  ))
    copyFileSync(join(root, 'config', file), join(dir, file));
  return dir;
};
const viaPage = freshConfig('config-page');
const viaTerminal = freshConfig('config-terminal');
const real = (dir: string) =>
  readdirSync(dir)
    .filter((name) => !name.includes('.example.'))
    .sort();

// A stand-in for the built page, so this check does not need the web build.
const bundle = join(temp, 'bundle');
mkdirSync(bundle);
writeFileSync(join(bundle, 'index.html'), '<!doctype html><title>jam-setup</title>');
const env: NodeJS.ProcessEnv = { ...box.env, JAM_NO_BROWSER: '1', JAM_SETUP_BUNDLE: bundle };

const ANSWERS = {
  'site.title': 'Page Map',
  sources: ['strava'],
  'strava.includePrivate': false,
  'privacy.home': '35.6812, 139.7671',
  'privacy.radius': 450,
  'publish.preset': 'open',
};

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}
const replies: string[] = [];
let port = 0;
let cookie = '';

/** A raw request, so the check can send a wrong Host or leave the cookie out. */
const call = (
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    cookie?: boolean;
    until?: string;
  } = {},
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: {
          ...(options.cookie === false || !cookie ? {} : { Cookie: cookie }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Jam-Setup': '1' }),
          ...options.headers,
        },
      },
      (response) => {
        let text = '';
        const finish = () => {
          replies.push(text);
          resolve({ status: response.statusCode ?? 0, headers: response.headers, text });
        };
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
          // An event stream never ends by itself: stop once the awaited event has arrived.
          if (options.until && text.includes(options.until)) {
            finish();
            request.destroy();
          }
        });
        response.on('end', finish);
      },
    );
    request.on('error', (error) => (options.until ? undefined : reject(error)));
    request.end(body);
  });

let server: ChildProcess | undefined;
const start = (): Promise<string> =>
  new Promise((resolve, reject) => {
    server = spawn('node', [MAIN, '--config', viaPage, 'setup', '--web'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    const take = (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const address = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]+)/.exec(text);
      if (address) {
        port = Number(address[1]);
        resolve(address[2] ?? '');
      }
    };
    server.stdout?.on('data', take);
    server.stderr?.on('data', take);
    server.on('close', () => reject(new Error(`the server stopped early: ${text}`)));
  });

const main = async () => {
  const noBundle = spawnSync('node', [MAIN, '--config', viaPage, 'setup', '--web'], {
    env: { ...env, JAM_SETUP_BUNDLE: join(temp, 'nothing-here') },
    encoding: 'utf8',
  });
  check(
    'without the built page it says to run pnpm setup:build',
    noBundle.status === 1 && `${noBundle.stdout}${noBundle.stderr}`.includes('pnpm setup:build'),
  );

  // The stand-in page carries the marker, as the real one does: the audit refuses a folder with it.
  const audited = spawnSync('node', [MAIN, '--config', viaPage, 'audit', bundle], {
    env,
    encoding: 'utf8',
  });
  check(
    'jam audit fails on a folder that holds the setup page',
    audited.status === 1 && `${audited.stdout}${audited.stderr}`.includes('The setup page'),
    `${audited.stdout}${audited.stderr}`,
  );

  const token = await start();
  check(
    'the server listens on 127.0.0.1 with a token in its address',
    port > 0 && token.length === 64,
  );

  // Who is let in.
  check('no token, no cookie: the page is refused', (await call('GET', '/')).status === 403);
  check('  ...and so is the API', (await call('GET', '/api/state')).status === 403);
  check(
    'a wrong token is refused',
    (await call('GET', `/?token=${'0'.repeat(64)}`)).status === 403,
  );
  const rebind = await call('GET', `/?token=${token}`, {
    headers: { Host: `evil.example:${port}` },
  });
  check('the right token with a wrong Host is refused', rebind.status === 403);
  const entry = await call('GET', `/?token=${token}`);
  const setCookie = String(entry.headers['set-cookie'] ?? '');
  check(
    'the right token gives a redirect without the token',
    entry.status === 302 && entry.headers.location === '/',
  );
  check(
    '  ...and an HttpOnly, SameSite=Strict cookie',
    /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie),
  );
  cookie = setCookie.split(';')[0] ?? '';
  check(
    'the token works once',
    (await call('GET', `/?token=${token}`, { cookie: false })).status === 403,
  );
  const page = await call('GET', '/');
  check(
    'with the cookie the page is served',
    page.status === 200 && page.text.includes('jam-setup'),
  );
  check(
    '  ...never cached, with a content security policy',
    page.headers['cache-control'] === 'no-store' &&
      String(page.headers['content-security-policy']).includes("default-src 'self'"),
  );
  check('  ...and no CORS header', page.headers['access-control-allow-origin'] === undefined);
  check(
    'the cookie with a wrong Host is refused',
    (await call('GET', '/api/state', { headers: { Host: 'evil.example' } })).status === 403,
  );

  // What a request may do.
  const body = {
    start: 'quick',
    answers: { ...ANSWERS, 'strava.clientId': '4242', 'strava.clientSecret': SECRET },
  };
  const noHeader = await call('POST', '/api/answers', { body, headers: { 'X-Jam-Setup': '0' } });
  check('a POST without the page header is refused', noHeader.status === 403);
  const crossSite = await call('POST', '/api/answers', {
    body,
    headers: { Origin: 'https://evil.example' },
  });
  check('a POST from another origin is refused', crossSite.status === 403);
  for (const id of ['rm', 'strava-wipe', 'build;ls', '..%2F..%2Fbuild'])
    check(
      `action "${id}" is not on the list`,
      (await call('POST', `/api/actions/${id}`, { body: {} })).status === 404,
    );
  for (const path of [
    '/../../config/secrets.jsonc',
    '/%2e%2e/%2e%2e/config/secrets.example.jsonc',
    '/api/review/..%2F..%2Fconfig%2Fsecrets.jsonc',
    '/api/review/secrets',
  ])
    check(`GET ${path} finds nothing`, (await call('GET', path)).status === 404);
  check('PUT is not allowed', (await call('PUT', '/api/answers', { body })).status === 405);

  // Answers: checked, shown as a masked diff, nothing written yet.
  const wrong = await call('POST', '/api/answers', {
    body: { start: 'quick', answers: { ...ANSWERS, 'privacy.home': '1, 2' } },
  });
  check(
    'a wrong answer comes back as an error on its step',
    wrong.status === 200 && wrong.text.includes('outside Japan'),
  );
  const staged = await call('POST', '/api/answers', { body });
  const stagedJson = JSON.parse(staged.text) as {
    errors: object;
    changes: { name: string }[];
    plan: { id: string }[];
  };
  check(
    'good answers stage without errors',
    staged.status === 200 && Object.keys(stagedJson.errors).length === 0,
    staged.text.slice(0, 400),
  );
  check(
    '  ...with the diff of each file, the secret masked',
    stagedJson.changes.length === 3 &&
      staged.text.includes('********') &&
      !staged.text.includes(SECRET),
  );
  check(
    '  ...and the plan',
    stagedJson.plan.some((item) => item.id === 'sync-strava'),
  );
  check('  ...and nothing written yet', real(viaPage).length === 0);

  // Apply writes what the terminal wizard writes.
  const answersFile = join(temp, 'answers.jsonc');
  writeFileSync(answersFile, JSON.stringify(ANSWERS));
  const terminal = spawnSync(
    'node',
    [MAIN, '--config', viaTerminal, 'setup', '--quick', '--answers', answersFile, '--no-run'],
    {
      env: { ...env, JAM_STRAVA_CLIENT_ID: '4242', JAM_STRAVA_CLIENT_SECRET: SECRET },
      encoding: 'utf8',
    },
  );
  const applied = await call('POST', '/api/apply', { body });
  check(
    'apply writes the files',
    applied.status === 200 && real(viaPage).length === 3,
    `${applied.text} ${real(viaPage).join(',')}`,
  );
  const sameFiles =
    terminal.status === 0 &&
    real(viaPage).join() === real(viaTerminal).join() &&
    real(viaPage).every(
      (name) =>
        readFileSync(join(viaPage, name), 'utf8') === readFileSync(join(viaTerminal, name), 'utf8'),
    );
  check(
    '  ...the same files, byte for byte, as the terminal wizard',
    sameFiles,
    real(viaTerminal).join(','),
  );
  const again = await call('POST', '/api/answers', {
    body: { start: 'change', group: 'strava', answers: {} },
  });
  check(
    'afterwards the secret step says "stored" and holds no value',
    again.text.includes('"stored":true') &&
      !again.text.includes(SECRET) &&
      !again.text.includes('4242'),
  );
  const zones = await call('POST', '/api/answers', {
    body: { start: 'change', group: 'privacy', answers: {} },
  });
  check(
    'zones come back as labels and radii, without positions',
    zones.text.includes('"label":"home"') &&
      !zones.text.includes('35.68') &&
      !zones.text.includes('139.76'),
  );
  const bad = await call('POST', '/api/apply', {
    body: { start: 'change', group: 'output', answers: { 'output.decimals': 12 } },
  });
  check(
    'apply refuses a value the schema refuses',
    bad.status === 400 && bad.text.includes('output.decimals'),
  );

  // An action from the list runs, and its output arrives as events.
  const run = await call('POST', '/api/actions/lists-validate', { body: { args: ['--evil'] } });
  check('a listed action starts', run.status === 202, run.text);
  const stream = await call('GET', '/api/events', { until: 'event: end' });
  check(
    '  ...and its lines and exit code arrive as events',
    stream.text.includes('event: start') &&
      stream.text.includes('event: log') &&
      /"code":\d/.test(stream.text),
    stream.text.slice(-300),
  );
  check('  ...with arguments from the server only', !stream.text.includes('--evil'));

  // Stopping: nothing runs now, and the page is told so instead of being ignored.
  const idle = await call('POST', '/api/stop', { body: {} });
  check('stop with nothing running is refused with a reason', idle.status === 409, idle.text);

  // Routes that look like one route: offered by position, written to routes.jsonc on a yes.
  writeFileSync(
    join(box.data, 'routes-candidates.json'),
    JSON.stringify({
      merge: [
        {
          reason: '78% of the same streets',
          routes: [
            { name: 'Riverside loop', count: 12, ref: '11111111111' },
            { name: 'Riverside loop, long', count: 3, ref: 'act_abc123' },
          ],
        },
      ],
      split: [],
    }),
  );
  const offered = await call('GET', '/api/merges');
  check(
    'merge candidates are listed by name, without activity ids',
    offered.status === 200 &&
      offered.text.includes('Riverside loop') &&
      !offered.text.includes('11111111111') &&
      !offered.text.includes('act_abc123'),
    offered.text,
  );
  check(
    'a candidate that is not in the list is refused',
    (await call('POST', '/api/merges', { body: { index: 7 } })).status === 404,
  );
  const mergedNow = await call('POST', '/api/merges', { body: { index: 0, refs: ['999'] } });
  const routesText = existsSync(join(viaPage, 'routes.jsonc'))
    ? readFileSync(join(viaPage, 'routes.jsonc'), 'utf8')
    : '';
  check(
    "merging one writes it to routes.jsonc, from the server's own list",
    mergedNow.status === 200 &&
      mergedNow.text.includes('"merged":true') &&
      /11111111111,\s*"act_abc123"/.test(routesText) &&
      !routesText.includes('999'),
    routesText.slice(0, 400),
  );
  check("  ...keeping the file's comments", routesText.includes('//'), routesText.slice(0, 200));

  const state = await call('GET', '/api/state');
  check(
    'the state says credentials are stored, not what they are',
    state.text.includes('"stravaCredentials":true'),
  );

  // Leaving.
  const closed = new Promise<number>((resolve) =>
    server?.on('close', (code) => resolve(code ?? 1)),
  );
  const bye = await call('POST', '/api/shutdown', { body: {} });
  const code = await Promise.race([
    closed,
    new Promise<number>((resolve) => setTimeout(() => resolve(-1), 5000)),
  ]);
  check('shutdown stops the server', bye.status === 200 && code === 0, String(code));

  check('no response ever contained the secret', !replies.some((text) => text.includes(SECRET)));
  const logs = existsSync(join(box.data, 'logs'))
    ? readdirSync(join(box.data, 'logs'))
        .map((name) => readFileSync(join(box.data, 'logs', name), 'utf8'))
        .join('')
    : '';
  check(
    'the log holds neither the secret nor the token',
    !logs.includes(SECRET) && !logs.includes(token),
  );
};

try {
  await main();
} finally {
  server?.kill();
}
box.finish();

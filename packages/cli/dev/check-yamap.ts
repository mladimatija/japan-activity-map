/**
 * `pnpm check:yamap`: `jam sync yamap` against a stand-in for YAMAP's web API
 * (dev/fake-yamap.ts), in a temporary folder. Nothing here uses a real token or the network.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from '../src/store/sqlite.ts';
import { sandbox } from './harness.ts';

const { temp, data, configDir, jamResult, jamWith, check, finish } = sandbox('yamap');
const PORT = 8900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;

const server = spawn('node', [join(import.meta.dirname, 'fake-yamap.ts'), '--port', String(PORT)], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
});
await new Promise<void>((resolve, reject) => {
  server.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('fake YAMAP')) resolve();
  });
  server.on('exit', () => reject(new Error('the stand-in did not start')));
});
const control = (change: Record<string, unknown>) =>
  fetch(`${base}/__control`, { method: 'POST', body: JSON.stringify(change) });
const stats = async () =>
  (await (await fetch(`${base}/__stats`)).json()) as Record<
    'list' | 'detail' | 'track' | 'refused',
    number
  >;

const site = (activities: Record<string, unknown>) =>
  writeFileSync(
    join(configDir, 'site.jsonc'),
    JSON.stringify({
      activities: {
        ...activities,
        yamap: {
          userId: '424242',
          tracksPerSync: 3,
          api: { baseUrl: base, pauseMs: 0 },
          ...(activities.yamap as object),
        },
      },
    }),
  );
site({});
// The sheet is pointed at nothing, whatever is in data/ beside the repository.
writeFileSync(join(configDir, 'sheet.jsonc'), JSON.stringify({ path: join(temp, 'no-sheet.csv') }));
const QUIET = { JAM_SLEEP_SCALE: '0' };
const withToken = { ...QUIET, JAM_YAMAP_TOKEN: 'good-token' };
const sync = (...args: string[]) => jamWith(withToken, 'sync', 'yamap', ...args);

const query = <T>(sql: string): T[] => {
  const db = new Database(join(data, 'jam.sqlite'), { readOnly: true });
  try {
    return db.all(sql) as unknown as T[];
  } finally {
    db.close();
  }
};
interface Row {
  id: string;
  public_id: string;
  name: string;
  activity_type: string;
  has_track: number;
  start_local: string;
  distance_m: number | null;
  moving_time_s: number | null;
  raw: string;
}
const rows = () =>
  query<Row>(`SELECT * FROM activities WHERE source = 'yamap' ORDER BY start_time`);
const tracked = () => rows().filter((row) => row.has_track === 1).length;
const secrets = () => readFileSync(join(configDir, 'secrets.jsonc'), 'utf8');

try {
  // No token: the list still comes, the tracks do not, and it says how to get one.
  const dry = sync('--dry-run');
  check(
    'a dry run lists the activities and writes nothing',
    dry.code === 0 &&
      /10 activities listed/.test(dry.text) &&
      !existsSync(join(data, 'jam.sqlite')),
    dry.text,
  );
  const noToken = jamWith(QUIET, 'sync', 'yamap');
  check(
    'without a token the list is stored, no track is asked for, and it says how to get one',
    noToken.code === 3 &&
      rows().length === 10 &&
      tracked() === 0 &&
      /yamap_token/.test(noToken.text) &&
      /pnpm jam yamap token/.test(noToken.text) &&
      (await stats()).track === 0,
    noToken.text,
  );

  // The first real pull: three tracks, newest first.
  const first = sync();
  check(
    'a pull fetches tracksPerSync tracks, newest first, and says how many are left',
    first.code === 0 &&
      tracked() === 3 &&
      rows()
        .slice(-3)
        .every((row) => row.has_track === 1) &&
      /3 fetched \(3 with a track, 0 without\), 6 still to fetch/.test(first.text),
    first.text,
  );
  const one = rows().at(-1);
  check(
    "YAMAP's own name, start in Japan time and distance are kept; the track gives the moving time",
    one?.name === '塔ノ岳' &&
      one.start_local === '2025-05-30T07:00:00' &&
      one.distance_m === 7622 &&
      (one.moving_time_s ?? 0) > 0 &&
      one.activity_type === 'hike',
    JSON.stringify(one),
  );
  const rest = sync('--tracks', 'all');
  check(
    'with --tracks all the rest are fetched; an activity YAMAP says has no recording is not asked for',
    rest.code === 0 &&
      tracked() === 9 &&
      /"hasPoints":false/.test(rows().find((row) => row.name === '写真だけの記録')?.raw ?? '') &&
      /0 still to fetch/.test(rest.text),
    rest.text,
  );
  const before = await stats();
  const again = sync();
  const after = await stats();
  check(
    'a second pull reads one page of the list and asks for no track',
    again.code === 0 &&
      /0 added, 0 updated/.test(again.text) &&
      after.list === before.list + 1 &&
      after.track === before.track,
    `${again.text} ${JSON.stringify([before, after])}`,
  );
  await control({ add: '今日の散歩' });
  const fresh = sync();
  check(
    'a new activity comes in with its track',
    fresh.code === 0 && /1 added/.test(fresh.text) && tracked() === 10,
    fresh.text,
  );

  // The token expires. The run says so as an error, keeps what it has and marks nothing.
  await control({ token: 'new-token', add: '期限切れのあと' });
  const expired = sync();
  const waiting = rows().find((row) => row.name === '期限切れのあと');
  check(
    'an expired token: the new activity is listed, the run fails and says how to renew it',
    expired.code === 3 &&
      waiting !== undefined &&
      waiting.has_track === 0 &&
      !/trackProblem/.test(waiting.raw) &&
      /refused the sign-in token/.test(expired.text) &&
      /pnpm jam yamap token/.test(expired.text) &&
      /setup page/.test(expired.text),
    expired.text,
  );
  // The weekly run goes on with what there is, and still ends as a failure that says why.
  site({ source: 'yamap' });
  const weekly = jamWith(
    { ...withToken, JAM_UPDATE_DIST: join(temp, 'weekly') },
    'update',
    '--no-deploy',
  );
  site({});
  check(
    'jam update builds with what there is and ends by saying the token needs renewing',
    weekly.code === 1 &&
      /going on with what there is/.test(weekly.text) &&
      /Built into/.test(weekly.text) &&
      /The YAMAP sign-in token needs renewing/.test(
        weekly.text.split('Done what could be done')[1] ?? '',
      ),
    weekly.text.slice(-900),
  );
  const status = jamWith(withToken, 'status');
  check(
    'status says the token was refused and how to store a new one',
    /YAMAP refused it on \d{4}-\d{2}-\d{2}/.test(status.text) &&
      /pnpm jam yamap token/.test(status.text),
    status.text,
  );
  const checkOld = jamWith(withToken, 'yamap', 'check');
  check(
    'yamap check fails on the expired token',
    checkOld.code === 1 && /refused the sign-in token/.test(checkOld.text),
    checkOld.text,
  );

  // A new token, piped in as copied from the browser, cookie name and all.
  const piped = (input: string) => {
    try {
      return {
        code: 0,
        text: execFileSync(
          'node',
          [join(import.meta.dirname, '../src/main.ts'), '--config', configDir, 'yamap', 'token'],
          {
            input,
            encoding: 'utf8',
            env: { ...process.env, ...QUIET, JAM_DATA_DIR: data, NODE_NO_WARNINGS: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        ),
      };
    } catch (error) {
      const failure = error as { status: number; stdout: string; stderr: string };
      return { code: failure.status, text: `${failure.stdout}${failure.stderr}` };
    }
  };
  const wrong = piped('not-the-token\n');
  check(
    'yamap token stores what is pasted, tries it, and says when YAMAP refuses it',
    wrong.code === 1 &&
      /YAMAP refused that token/.test(wrong.text) &&
      !wrong.text.includes('not-the-token'),
    wrong.text,
  );
  const renewed = piped('  yamap_token=new-token; other=1\n');
  check(
    'a token pasted with its cookie name is stored bare, tried, and never printed',
    renewed.code === 0 &&
      /It works/.test(renewed.text) &&
      !renewed.text.includes('new-token') &&
      /"token": "new-token"/.test(secrets()),
    `${renewed.text}`,
  );
  const carried = jamWith(QUIET, 'sync', 'yamap');
  check(
    'with the new token the waiting track is fetched and status is quiet again',
    carried.code === 0 &&
      rows().find((row) => row.name === '期限切れのあと')?.has_track === 1 &&
      !/refused/.test(jamWith(QUIET, 'status').text),
    carried.text,
  );
  const never = `${first.text}${expired.text}${status.text}${carried.text}`;
  check('no token is ever printed', !/good-token|new-token/.test(never), '');

  // A list that leaves the start out, and one in the other order.
  jamWith(QUIET, 'yamap', 'wipe', '--yes');
  await control({ leanList: true });
  const lean = jamWith(QUIET, 'sync', 'yamap', '--tracks', '0');
  check(
    "a list without start times is completed from each activity's details",
    lean.code === 0 && rows().length === 12 && (await stats()).detail >= 12,
    lean.text,
  );
  await control({ leanList: false, oldestFirst: true, add: '順番が逆' });
  const reversed = jamWith(QUIET, 'sync', 'yamap', '--tracks', '0');
  check(
    'a list that runs oldest first is read to its end, so the new activity is still found',
    reversed.code === 0 && /1 added/.test(reversed.text),
    reversed.text,
  );
  await control({ oldestFirst: false });

  // A rename is outside what a plain pull reads; a full pull sees it and removes what is gone.
  await control({ rename: 9001, remove: 9002 });
  const full = jamWith(QUIET, 'sync', 'yamap', '--full', '--tracks', '0');
  check(
    'a full pull picks up a rename and removes what YAMAP no longer has, after a copy',
    full.code === 0 &&
      /1 updated, 1 removed/.test(full.text) &&
      rows().some((row) => row.name === '大菩薩嶺（改）') &&
      !rows().some((row) => row.name === '金時山') &&
      readdirSync(join(data, 'backups')).some((name) => name.includes('before-wipe-yamap-full')),
    full.text,
  );

  // Some days only.
  jamWith(QUIET, 'yamap', 'wipe', '--yes');
  const ranged = jamWith(
    QUIET,
    'sync',
    'yamap',
    '--from',
    '2025-03-15',
    '--to',
    '2025-04-15',
    '--tracks',
    'all',
  );
  check(
    'a pull of some days stores only those, with their tracks',
    ranged.code === 0 &&
      /2025-03-15 to 2025-04-15 only/.test(ranged.text) &&
      rows().length === 3 &&
      rows().every((row) => row.start_local >= '2025-03-15' && row.start_local < '2025-04-16'),
    `${ranged.text} ${JSON.stringify(rows().map((row) => row.start_local))}`,
  );
  const everything = jamWith(QUIET, 'sync', 'yamap', '--tracks', '0');
  check(
    'the next plain pull still brings in everything else',
    everything.code === 0 && rows().length === 12,
    everything.text,
  );

  // Timeouts on tracks.
  await control({ timeOutTracks: 4 });
  const shaky = jamWith(QUIET, 'sync', 'yamap', '--tracks', '3');
  check(
    'a track YAMAP times out on is left for the next run and the others go on',
    shaky.code === 0 && /1 YAMAP did not answer for/.test(shaky.text),
    shaky.text,
  );

  // Ids survive a wipe; the site is built from YAMAP only when asked.
  const ids = new Map(rows().map((row) => [row.name, row.public_id]));
  jamWith(QUIET, 'yamap', 'wipe', '--yes');
  jamWith(QUIET, 'sync', 'yamap', '--tracks', 'all');
  check(
    'fetched again after a wipe, every activity has the public id it had',
    rows().length === 12 && rows().every((row) => ids.get(row.name) === row.public_id),
    JSON.stringify(rows().map((row) => row.name)),
  );
  const out = join(temp, 'dist');
  const build = () => {
    const result = jamResult('build', '--out', out);
    const built =
      result.code === 0
        ? (
            JSON.parse(readFileSync(join(out, 'activities.json'), 'utf8')) as {
              activities: { source: string; name: string; link?: string | null }[];
            }
          ).activities
        : [];
    return { ...result, built };
  };
  const fromStrava = build();
  check(
    'built from Strava, no YAMAP activity is published',
    fromStrava.code === 0 && fromStrava.built.length === 0,
    fromStrava.text,
  );
  site({ source: 'yamap' });
  const fromYamap = build();
  check(
    'built from YAMAP, its activities with a track are published, without a link',
    fromYamap.code === 0 &&
      fromYamap.built.length === 11 &&
      fromYamap.built.every((activity) => activity.source === 'yamap' && !activity.link),
    `${fromYamap.text.slice(0, 600)} ${JSON.stringify(fromYamap.built.map((a) => [a.name, a.source]))}`,
  );
  site({ yamap: { userId: '1' } });
  const stranger = jamWith(QUIET, 'sync', 'yamap');
  check(
    'a user id YAMAP does not know is said plainly',
    stranger.code !== 0 && /Check activities\.yamap\.userId/.test(stranger.text),
    stranger.text,
  );
} finally {
  server.kill();
}
finish();

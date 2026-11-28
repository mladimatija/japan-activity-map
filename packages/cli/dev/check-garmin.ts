/**
 * `pnpm check:garmin`: `jam sync garmin` against a stand-in for the Garmin Connect Personal API
 * (dev/fake-garmin.ts), in a temporary folder. Nothing here uses a real key or the network.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from '../src/store/sqlite.ts';
import { sandbox } from './harness.ts';

const { temp, data, configDir, jamResult, jamWith, check, finish } = sandbox('garmin');
const PORT = 8700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${PORT}`;

const server = spawn(
  'node',
  [join(import.meta.dirname, 'fake-garmin.ts'), '--port', String(PORT)],
  {
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  },
);
await new Promise<void>((resolve, reject) => {
  server.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('fake Garmin')) resolve();
  });
  server.on('exit', () => reject(new Error('the stand-in did not start')));
});
const control = (change: Record<string, unknown>) =>
  fetch(`${base}/__control`, { method: 'POST', body: JSON.stringify(change) });
const stats = async () =>
  (await (await fetch(`${base}/__stats`)).json()) as Record<
    'token' | 'list' | 'file' | 'refused',
    number
  >;

const site = (activities: Record<string, unknown>) =>
  writeFileSync(
    join(configDir, 'site.jsonc'),
    JSON.stringify({
      activities: {
        ...activities,
        garmin: {
          filesPerSync: 2,
          api: { baseUrl: base, pauseMs: 0 },
          ...(activities.garmin as object),
        },
      },
    }),
  );
site({});
// The sheet is pointed at nothing, whatever is in data/ beside the repository.
writeFileSync(join(configDir, 'sheet.jsonc'), JSON.stringify({ path: join(temp, 'no-sheet.csv') }));
const QUIET = { JAM_SLEEP_SCALE: '0' };
const withKey = { ...QUIET, JAM_GARMIN_API_KEY: 'good-key' };
const sync = (...args: string[]) => jamWith(withKey, 'sync', 'garmin', ...args);

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
  visibility: string | null;
  event_tags: string;
  start_local: string;
}
const rows = () =>
  query<Row>(`SELECT * FROM activities WHERE source = 'garmin' ORDER BY start_time`);
const tracks = () =>
  query<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.source = 'garmin'`,
  )[0]?.n ?? 0;

try {
  // No key, a wrong key.
  const none = jamWith(QUIET, 'sync', 'garmin');
  check(
    'without a key it says where to get one',
    none.code !== 0 && /personal API key/.test(none.text),
    none.text,
  );
  const wrong = jamWith({ ...QUIET, JAM_GARMIN_API_KEY: 'bad' }, 'sync', 'garmin');
  check(
    'a key Garmin refuses is reported as the key, not as the network',
    wrong.code !== 0 && /did not accept the personal API key/.test(wrong.text),
    wrong.text,
  );
  const works = jamWith(withKey, 'garmin', 'check');
  check(
    'garmin check says the key works',
    works.code === 0 && /key works/.test(works.text),
    works.text,
  );

  // A dry run.
  const dry = sync('--dry-run');
  check(
    'a dry run lists and writes nothing',
    dry.code === 0 &&
      /Would be: 6 added, 0 updated, 0 removed, 0 unchanged; 5 files to fetch/.test(dry.text),
    dry.text,
  );

  // The first pull: 8 listed, yoga skipped by type, the private hike skipped, 6 kept; 2 files.
  const first = sync();
  const afterFirst = rows();
  check(
    'the first pull keeps the five types, skips the rest and the Only Me one',
    first.code === 0 &&
      /8 activities listed/.test(first.text) &&
      /6 added/.test(first.text) &&
      /Skipped types: yoga 1/.test(first.text) &&
      /Skipped 1 activity set to Only Me/.test(first.text) &&
      afterFirst.length === 6,
    first.text,
  );
  check(
    'types, the race tag and the local start come from the summary',
    afterFirst.map((row) => row.activity_type).join() === 'hike,trail_run,run,ride,run,walk' &&
      afterFirst[2]?.event_tags === '["race"]' &&
      afterFirst[0]?.start_local === '2025-03-01T09:00:00',
    JSON.stringify(
      afterFirst.map((row) => [row.name, row.activity_type, row.event_tags, row.start_local]),
    ),
  );
  check(
    'files are fetched newest first, as many as filesPerSync says',
    /Files: 2 fetched \(2 with a track, 0 without\), 3 still to fetch/.test(first.text) &&
      tracks() === 2 &&
      afterFirst
        .filter((row) => row.has_track === 1)
        .map((row) => row.name)
        .join() === 'Bay ride,Evening walk',
    first.text,
  );

  // The next run carries on with the files; nothing is added twice.
  const second = sync();
  check(
    'the next run fetches the next files and adds nothing twice',
    second.code === 0 &&
      /0 added/.test(second.text) &&
      /2 fetched/.test(second.text) &&
      tracks() === 4,
    second.text,
  );
  const third = sync('--files', 'all');
  check(
    'every activity with a position has its track; the treadmill one has none and is not asked for',
    third.code === 0 &&
      tracks() === 5 &&
      /0 still to fetch/.test(third.text) &&
      rows().find((row) => row.name === 'Treadmill')?.has_track === 0,
    third.text,
  );
  const track = query<{ point_count: number; elevations: string | null; times: string | null }>(
    `SELECT t.point_count, t.elevations, t.times FROM tracks t JOIN activities a ON a.id = t.activity_id WHERE a.name = 'Morning hike'`,
  )[0];
  check(
    'a track has its points, heights and times, read from the FIT file',
    track?.point_count === 40 && Boolean(track.elevations) && Boolean(track.times),
    JSON.stringify(track),
  );
  const before = await stats();
  const idle = sync();
  const after = await stats();
  check(
    'a run with nothing new asks for the list and no file',
    idle.code === 0 && /0 added, 0 updated/.test(idle.text) && after.file === before.file,
    idle.text,
  );

  // New, renamed and private activities.
  await control({ add: 'Evening run' });
  await control({ rename: 5008 });
  // A rename of an old activity is outside what a weekly pull asks for: a full pull sees it.
  const fresh = sync('--full');
  check(
    'a new activity is added with its track, and a rename is picked up',
    fresh.code === 0 &&
      /1 added, 1 updated/.test(fresh.text) &&
      rows().some((row) => row.name === 'Evening run' && row.has_track === 1) &&
      rows().some((row) => row.name === 'Evening walk (renamed)'),
    fresh.text,
  );
  site({ garmin: { includePrivate: true } });
  const withPrivate = sync();
  check(
    'with includePrivate the Only Me activity comes in, marked only_me',
    withPrivate.code === 0 &&
      rows().find((row) => row.name === 'Quiet hike')?.visibility === 'only_me',
    withPrivate.text,
  );
  site({});

  // Garmin says to slow down part of the way through.
  jamWith(withKey, 'garmin', 'wipe', '--yes');
  await control({ limitFilesAfter: 1 });
  const limited = sync('--full', '--files', 'all');
  check(
    'told to slow down, it keeps what it fetched and says to run again',
    limited.code === 0 &&
      /limiting requests/.test(limited.text) &&
      rows().length === 7 &&
      tracks() === 1,
    limited.text,
  );
  await control({ limitFilesAfter: null });
  const resumed = sync('--files', 'all');
  check(
    'the next run carries on where it stopped',
    resumed.code === 0 && tracks() === 6,
    resumed.text,
  );

  // A token that stops working is replaced without a word.
  await control({ expireTokens: true, add: 'Late run' });
  const renewed = sync();
  check(
    'a token that expired is replaced',
    renewed.code === 0 && /1 added/.test(renewed.text),
    renewed.text,
  );

  // Wipe and a fresh pull: the same ids.
  const ids = new Map(rows().map((row) => [row.name, row.public_id]));
  const wipeDry = jamWith(withKey, 'garmin', 'wipe');
  check(
    'garmin wipe without --yes deletes nothing',
    /Would delete 8 Garmin activities/.test(wipeDry.text) && rows().length === 8,
    wipeDry.text,
  );
  const wiped = jamWith(withKey, 'garmin', 'wipe', '--yes');
  check(
    'garmin wipe --yes deletes them after a copy of the store',
    wiped.code === 0 &&
      rows().length === 0 &&
      readdirSync(join(data, 'backups')).some((name) => name.includes('before-wipe-garmin')),
    wiped.text,
  );
  sync('--full', '--files', 'all');
  check(
    'fetched again after a wipe, every activity has the public id it had',
    rows().length === 8 && rows().every((row) => ids.get(row.name) === row.public_id),
    JSON.stringify(rows().map((row) => row.name)),
  );
  // A full pull removes what Garmin no longer lists.
  await control({ remove: 5001 });
  const pruned = sync('--full');
  check(
    'a full pull removes what Garmin no longer has, after a copy',
    pruned.code === 0 &&
      /1 removed/.test(pruned.text) &&
      !rows().some((row) => row.name === 'Morning hike'),
    pruned.text,
  );

  // The switch: the site is built from Garmin only when it is asked to be.
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
    'built from Strava, no Garmin activity is published',
    fromStrava.code === 0 && fromStrava.built.length === 0,
    fromStrava.text,
  );
  site({ source: 'garmin' });
  const fromGarmin = build();
  check(
    'built from Garmin, its activities with a track are published, without a link',
    fromGarmin.code === 0 &&
      fromGarmin.built.length === 6 &&
      fromGarmin.built.every((activity) => activity.source === 'garmin' && !activity.link),
    JSON.stringify(fromGarmin.built.map((a) => [a.name, a.source, a.link])),
  );
  const status = jamWith(withKey, 'status');
  check(
    'status names the source the site is built from and that a key is set',
    /built from Garmin/.test(status.text) &&
      /Garmin personal API key: set in the environment/.test(status.text),
    status.text,
  );
  // An activity set to Only Me after it was fetched leaves the store on the next pull.
  const garminId = (name: string): number =>
    (
      JSON.parse(
        query<{ raw: string }>(
          `SELECT raw FROM activities WHERE source = 'garmin' AND name = '${name}'`,
        )[0]?.raw ?? '{}',
      ) as { id: number }
    ).id;
  const named = (name: string) =>
    query<{ has_track: number; raw: string }>(
      `SELECT has_track, raw FROM activities WHERE source = 'garmin' AND name = '${name}'`,
    )[0];
  await control({ add: 'Lunch run' });
  sync();
  const lunch = garminId('Lunch run');
  await control({ hide: lunch });
  const hidden = sync();
  check(
    'an activity set to Only Me since it was fetched is removed on the next pull',
    Number.isInteger(lunch) &&
      hidden.code === 0 &&
      /1 removed/.test(hidden.text) &&
      !named('Lunch run'),
    hidden.text,
  );
  // Garmin answering in its other forms: a token as plain text, a recording that is not zipped.
  await control({ add: 'Refused run' });
  await control({ add: 'Plain run', plain: true });
  const listOnly = sync('--files', '0');
  await control({ refuseFile: garminId('Refused run') });
  const mixed = sync();
  check(
    'a token sent as plain text is taken, after Garmin refuses to answer in JSON',
    listOnly.code === 0 && mixed.code === 0,
    `${listOnly.text}${mixed.text}`,
  );
  check(
    'a recording sent unzipped is read',
    named('Plain run')?.has_track === 1,
    JSON.stringify(named('Plain run')),
  );
  // One file Garmin refuses does not stop the others, and is not asked for on every run.
  check(
    'a file Garmin refuses is noted on its activity and the others are still fetched',
    named('Refused run')?.has_track === 0 && /HTTP 403/.test(named('Refused run')?.raw ?? ''),
    JSON.stringify(named('Refused run')),
  );
  const filesSoFar = (await stats()).file;
  sync();
  check(
    'and it is not asked for again until a full pull',
    (await stats()).file === filesSoFar,
    String(filesSoFar),
  );
  // One range of days: only those are listed and fetched, and the next plain pull does not carry
  // on from it. Days are local (the stand-in's activities are in Japan).
  jamWith(withKey, 'garmin', 'wipe', '--yes');
  const ranged = sync('--from', '2025-03-10', '--to', '2025-03-22', '--files', 'all');
  check(
    'a pull of one range stores only the activities in it, with their tracks',
    ranged.code === 0 &&
      /2025-03-10 to 2025-03-22 only/.test(ranged.text) &&
      rows().length === 2 &&
      rows().every((row) => row.has_track === 1 && row.start_local.slice(0, 10) >= '2025-03-10'),
    `${ranged.text} ${JSON.stringify(rows().map((row) => row.start_local))}`,
  );
  const plain = sync('--files', '0');
  check(
    'the next plain pull lists everything: a range pull is not one to carry on from',
    plain.code === 0 && rows().length > 6,
    plain.text,
  );
  const total = rows().length;
  const waiting = sync('--from', '2025-04-01', '--to', '2025-04-30', '--files', 'all');
  const fetched = rows().filter((row) => row.has_track === 1);
  check(
    'with a range, only the recordings of that range are downloaded',
    waiting.code === 0 &&
      fetched.length > 2 &&
      fetched.every(
        (row) =>
          row.start_local.slice(0, 7) === '2025-04' || row.start_local.slice(0, 7) === '2025-03',
      ) &&
      fetched.length < total,
    `${waiting.text} ${JSON.stringify(rows().map((row) => [row.start_local, row.has_track]))}`,
  );
  await control({ remove: 5002 });
  const kept = sync('--from', '2025-03-10', '--to', '2025-03-22');
  const stillThere = rows().length === total;
  const prunedRange = sync('--full', '--from', '2025-03-10', '--to', '2025-03-22');
  check(
    'a full pull of a range removes what Garmin no longer has in it, and nothing outside it',
    kept.code === 0 && stillThere && prunedRange.code === 0 && rows().length === total - 1,
    `${kept.text}${prunedRange.text}`,
  );
  // 05:00 on the 11th in Japan is still the 10th by GMT. Whichever clock Garmin counts days by,
  // the activity is found, and a full pull of its day does not take it for gone.
  await control({ gmtDays: true, addAt: '2025-05-10T20:00:00Z' });
  const dawn = sync('--from', '2025-05-11', '--to', '2025-05-11');
  const dawnFull = sync('--full', '--from', '2025-05-11', '--to', '2025-05-11');
  check(
    'an activity early in the day is found and kept, whether Garmin counts days by local time or GMT',
    dawn.code === 0 &&
      /1 added/.test(dawn.text) &&
      dawnFull.code === 0 &&
      /0 removed/.test(dawnFull.text) &&
      rows().some((row) => row.name === 'Dawn hike'),
    `${dawn.text}${dawnFull.text}`,
  );
  await control({ gmtDays: false });
  site({ garmin: { from: '2025-04-01' } });
  const outside = sync('--to', '2025-03-15');
  check(
    'days outside the range in the settings are refused, not sent to Garmin',
    outside.code !== 0 && /Nothing to fetch/.test(outside.text),
    outside.text,
  );
  site({});
  // Garmin's gateway timing out: a file that gets no answer is left for the next run and the
  // others go on; a list page that gets none is asked for again in smaller pieces.
  jamWith(withKey, 'garmin', 'wipe', '--yes');
  // Four tries a file: the first file asked for never answers, the rest do.
  await control({ timeOutFiles: 4, largestPage: 30 });
  const shaky = sync('--files', 'all');
  const tracked = () => rows().filter((row) => row.has_track === 1).length;
  const afterShaky = tracked();
  check(
    'a file Garmin times out on does not stop the run, and the list is fetched in smaller pages',
    shaky.code === 0 &&
      /1 Garmin did not answer for/.test(shaky.text) &&
      afterShaky > 0 &&
      rows().length > afterShaky,
    shaky.text,
  );
  await control({ largestPage: 1000 });
  const steady = sync('--files', 'all');
  check(
    '  ...and the next run fetches it, listing only what is new',
    steady.code === 0 && tracked() === afterShaky + 1 && /1 fetched/.test(steady.text),
    steady.text,
  );
  await control({ timeOutFiles: 1000 });
  jamWith(withKey, 'garmin', 'wipe', '--yes');
  const down = sync('--files', 'all');
  await control({ timeOutFiles: 0 });
  check(
    'when Garmin stops answering altogether the run ends after a few files, keeping the list',
    down.code === 0 && /stopped answering/.test(down.text) && rows().length > 0 && tracked() === 0,
    down.text,
  );
  // Garmin saying when to come back: a short Retry-After is waited out and the file fetched; a
  // long one ends the run with the time, keeping what it has.
  jamWith(withKey, 'garmin', 'wipe', '--yes');
  await control({ retryAfter: 1 });
  const polite = sync('--files', '1');
  check(
    'a short Retry-After is waited out and the file is still fetched',
    polite.code === 0 && /1 fetched \(1 with a track/.test(polite.text),
    polite.text,
  );
  await control({ retryAfter: 3600 });
  const longWait = sync('--files', '1');
  check(
    'a Retry-After of an hour ends the run, saying how long Garmin asks for',
    longWait.code === 0 && /asks for a pause of 60 minutes/.test(longWait.text),
    longWait.text,
  );
  const badDay = sync('--from', '2025-02-31');
  check(
    'a day that is not in the calendar is refused',
    badDay.code !== 0 && /not a day in the calendar/.test(badDay.text),
    badDay.text,
  );
  const never = `${first.text}${limited.text}${status.text}${mixed.text}`;
  check('the key is never printed', !never.includes('good-key'), '');
} finally {
  server.kill();
}
finish();

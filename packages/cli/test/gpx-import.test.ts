import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makeZip } from '../dev/zip-writer.ts';
import { JamError } from '../src/errors.ts';
import {
  climbM,
  dateInName,
  gpxActivity,
  gpxActivityId,
  gpxKey,
} from '../src/gpx-import/activity.ts';
import { gpxActivityType } from '../src/gpx-import/type.ts';
import { isGpxEntry, readGpxZip } from '../src/gpx-import/zip.ts';
import { gpxInfo } from '../src/gpx.ts';
import { uploadName } from '../src/setup/upload.ts';

// Made-up points east of 東京駅.
const point = (i: number, time?: string, ele?: number) =>
  `<trkpt lat="${(35.6812 + i * 0.0002).toFixed(6)}" lon="${(139.7671 + i * 0.0003).toFixed(6)}">${ele === undefined ? '' : `<ele>${ele}</ele>`}${time ? `<time>${time}</time>` : ''}</trkpt>`;
const gpx = (body: string, head = '') =>
  `<?xml version="1.0"?><gpx version="1.1" creator="test">${head}${body}</gpx>`;
const timedTrack = (start: string, extra = '') => {
  const t0 = Date.parse(start);
  const points = Array.from({ length: 6 }, (_, i) =>
    point(i, new Date(t0 + i * 30_000).toISOString(), 10 + i * 4),
  ).join('');
  return gpx(`<trk>${extra}<trkseg>${points}</trkseg></trk>`);
};
const options = { defaultType: 'hike', timeZone: 'Asia/Tokyo' } as const;
const file = { label: 'walks/2025-04-12 morning.gpx', name: '2025-04-12 morning' };

test('gpx zip: stored and deflated files are read; folders, dotfiles and other kinds are not', () => {
  const zip = readGpxZip(
    makeZip([
      { name: 'a.gpx', data: 'stored', store: true },
      { name: 'sub/b.GPX', data: 'deflated '.repeat(100) },
      { name: 'sub/', data: '' },
      { name: '__MACOSX/sub/._b.gpx', data: 'x' },
      { name: '.hidden.gpx', data: 'x' },
      { name: 'notes.txt', data: 'x' },
      { name: 'inner.zip', data: 'x' },
    ]),
    'test.zip',
  );
  assert.deepEqual(
    zip.entries.map((entry) => entry.name),
    ['a.gpx', 'sub/b.GPX'],
  );
  assert.equal(zip.ignored, 5);
  assert.equal(Buffer.from(zip.entries[0]?.read() ?? []).toString(), 'stored');
  assert.equal(Buffer.from(zip.entries[1]?.read() ?? []).toString(), 'deflated '.repeat(100));
  assert.ok(isGpxEntry('年/山.gpx'));
  assert.ok(!isGpxEntry('a/.git/x.gpx'));
});

test('gpx zip: a name without the UTF-8 flag is read as UTF-8, else as Shift_JIS', () => {
  // 山.gpx in Shift_JIS.
  const sjis = new Uint8Array([0x8e, 0x52, 0x2e, 0x67, 0x70, 0x78]);
  const zip = readGpxZip(
    makeZip([
      { name: '', rawName: sjis, data: 'x' },
      { name: '', rawName: new TextEncoder().encode('川.gpx'), data: 'y' },
    ]),
    'names.zip',
  );
  assert.deepEqual(
    zip.entries.map((entry) => entry.name),
    ['山.gpx', '川.gpx'],
  );
});

test('gpx zip: archives it does not take are refused with a reason, before anything is unpacked', () => {
  const refused = (bytes: Uint8Array, pattern: RegExp, limits?: Parameters<typeof readGpxZip>[2]) =>
    assert.throws(
      () => readGpxZip(bytes, 'odd.zip', limits),
      (error) => error instanceof JamError && pattern.test(error.message),
    );
  refused(Buffer.from('this is not a zip archive at all'), /not a zip archive/);
  refused(makeZip([{ name: 'a.gpx', data: 'x', encrypted: true }]), /encrypted/);
  refused(makeZip([{ name: 'a.gpx', data: 'x', method: 12 }]), /compression method 12/);
  refused(makeZip([{ name: 'a.gpx', data: 'x', claimBytes: 0xffffffff }]), /zip64/);
  const limits = { entryBytes: 1000, totalBytes: 1500, entries: 3 };
  refused(makeZip([{ name: 'a.gpx', data: 'x'.repeat(1001) }]), /a GPX file may be/, limits);
  refused(
    makeZip([
      { name: 'a.gpx', data: 'x'.repeat(900) },
      { name: 'b.gpx', data: 'x'.repeat(900) },
    ]),
    /in all/,
    limits,
  );
  refused(
    makeZip(['a', 'b', 'c', 'd'].map((name) => ({ name: `${name}.txt`, data: 'x' }))),
    /more than the 3/,
    limits,
  );
  // An encrypted file that is not a GPX file is not this reader's business.
  assert.equal(
    readGpxZip(makeZip([{ name: 'a.txt', data: 'x', encrypted: true }]), 'odd.zip').ignored,
    1,
  );
  const cut = makeZip([{ name: 'a.gpx', data: 'x'.repeat(500), store: true }]);
  refused(cut.subarray(0, cut.length - 30), /not a zip archive/);
});

test('gpx zip: a file that unpacks to more than it states, or is damaged, fails when read', () => {
  const bomb = readGpxZip(
    makeZip([{ name: 'a.gpx', data: 'x'.repeat(100_000), claimBytes: 10 }]),
    'bomb.zip',
  );
  assert.throws(() => bomb.entries[0]?.read(), JamError);
  const bytes = makeZip([{ name: 'a.gpx', data: 'abcdefgh', store: true }]);
  // Change one byte of the stored data: the checksum no longer holds.
  bytes[30 + 'a.gpx'.length] = 0x7a;
  assert.throws(() => readGpxZip(bytes, 'bad.zip').entries[0]?.read(), /checksum/);
});

test('gpx type: common words in either language map to the five types, anything else to none', () => {
  const cases: [string, string | undefined][] = [
    ['Hike', 'hike'],
    ['hiking', 'hike'],
    ['Walk', 'walk'],
    ['WALKING', 'walk'],
    ['Run', 'run'],
    ['running', 'run'],
    ['Trail Run', 'trail_run'],
    ['trail_running', 'trail_run'],
    ['TrailRun', 'trail_run'],
    ['Ride', 'ride'],
    ['cycling', 'ride'],
    ['mountain_biking', 'ride'],
    ['登山', 'hike'],
    ['ハイキング', 'hike'],
    ['ランニング', 'run'],
    ['トレイルランニング', 'trail_run'],
    ['サイクリング', 'ride'],
    ['ウォーキング', 'walk'],
    ['ﾊｲｷﾝｸﾞ', 'hike'],
    ['9', 'run'],
    ['Kayaking', undefined],
    ['', undefined],
  ];
  for (const [text, type] of cases) assert.equal(gpxActivityType(text), type, text);
  assert.equal(gpxActivityType(undefined), undefined);
});

test('gpx info: the name from the metadata, else the track; never an author or link', () => {
  const meta =
    '<metadata><author><name>Someone</name></author><link href="x"><text>App</text></link><time>2025-04-12T00:00:00Z</time></metadata>';
  assert.deepEqual(
    gpxInfo(
      gpx('<trk><name>Around &amp; about</name><type>Hiking</type><trkseg></trkseg></trk>', meta),
    ),
    {
      name: 'Around & about',
      type: 'Hiking',
      time: '2025-04-12T00:00:00Z',
    },
  );
  assert.equal(
    gpxInfo(
      gpx(
        '<trk><name>Track</name></trk>',
        '<metadata><name><![CDATA[File <1>]]></name></metadata>',
      ),
    ).name,
    'File <1>',
  );
  assert.deepEqual(gpxInfo(gpx('<trk><trkseg></trkseg></trk>')), {});
});

test('gpx identity: the start second names a timed track, its points one without times', () => {
  const a = gpxActivity(
    timedTrack('2025-04-11T21:00:00.400Z', '<name>Morning</name><type>running</type>'),
    file,
    options,
  );
  assert.equal(a.key, 'time:2025-04-11T21:00:00Z');
  assert.equal(a.id, gpxActivityId('time:2025-04-11T21:00:00Z'));
  assert.match(a.id, /^act_[0-9a-z]{26}$/);
  // The same start in another file, renamed and retyped: the same activity.
  const again = gpxActivity(
    timedTrack('2025-04-11T21:00:00Z', '<name>Renamed</name>'),
    { label: 'x.gpx', name: 'x' },
    options,
  );
  assert.equal(again.id, a.id);
  assert.notEqual(gpxActivity(timedTrack('2025-04-11T21:00:01Z'), file, options).id, a.id);
  assert.equal(a.activity.activity_type, 'run');
  assert.equal(again.activity.activity_type, 'hike');
  assert.equal(a.activity.name, 'Morning');
  assert.equal(a.activity.start_local, '2025-04-12T06:00:00');
  assert.equal(a.activity.elapsed_time_s, 150);
  assert.equal(a.activity.moving_time_s, 150);
  // 4 m a point: counted in steps of at least 5 m, so the last 4 m are not in yet.
  assert.equal(a.activity.elevation_gain_m, 16);
  assert.equal(a.track.point_count, 6);

  const bare = (shift: number) =>
    gpx(`<trk><trkseg>${[0, 1, 2].map((i) => point(i + shift)).join('')}</trkseg></trk>`);
  const untimed = gpxActivity(bare(0), file, options);
  assert.match(untimed.key, /^hash:[0-9a-f]{32}$/);
  assert.equal(
    untimed.id,
    gpxActivity(bare(0), { label: 'copy.gpx', name: 'copy 2025-04-12' }, options).id,
  );
  assert.notEqual(untimed.id, gpxActivity(bare(1), file, options).id);
  // No times in it: the date comes from the file name, and the name is the file's.
  assert.equal(untimed.activity.start_local, '2025-04-12');
  assert.equal(untimed.activity.name, '2025-04-12 morning');
  assert.equal(untimed.activity.moving_time_s, null);
  assert.throws(
    () => gpxActivity(bare(0), { label: 'walk.gpx', name: 'walk' }, options),
    /no date/,
  );
  assert.throws(() => gpxActivity('<html></html>', file, options), /not a GPX file/);
  assert.equal(gpxKey(undefined, [[139.7671, 35.6812]]), gpxKey(undefined, [[139.7671, 35.6812]]));
});

test('gpx activity: several tracks and segments are one activity; a pause is not moving time', () => {
  const t0 = Date.parse('2025-05-01T00:00:00Z');
  const at = (i: number, seconds: number) => point(i, new Date(t0 + seconds * 1000).toISOString());
  const xml = gpx(
    `<trk><name>Two parts</name><trkseg>${at(0, 0)}${at(1, 30)}</trkseg><trkseg>${at(2, 60)}${at(2, 660)}${at(3, 690)}</trkseg></trk><trk><trkseg>${at(4, 720)}${at(5, 750)}</trkseg></trk>`,
  );
  const activity = gpxActivity(xml, file, options);
  assert.equal(activity.track.point_count, 7);
  assert.equal(activity.activity.elapsed_time_s, 750);
  // 30 s in each of the three moving steps: the ten minutes standing still are out, and so is
  // the time between one segment and the next.
  assert.equal(activity.activity.moving_time_s, 90);
});

test('gpx activity: small wobbles add no climb; a date is found in a file name', () => {
  assert.equal(climbM([100, 102, 99, 101, 100]), 0);
  assert.equal(climbM([100, 103, 106, 104, 110, 90, 96]), 18);
  assert.equal(dateInName('yamap_2025-04-12_08_30'), '2025-04-12');
  assert.equal(dateInName('20250412-walk'), '2025-04-12');
  assert.equal(dateInName('track 12345678901'), undefined);
  assert.equal(dateInName('walk'), undefined);
});

test('setup upload: the name the page sends becomes a plain .zip or .gpx file name, or nothing', () => {
  const name = (sent: string) => uploadName(encodeURIComponent(sent));
  assert.equal(name('export.zip'), 'export.zip');
  assert.equal(name('My Walk (2).GPX'), 'My Walk (2).gpx');
  assert.equal(name('../../config/secrets.zip'), 'secrets.zip');
  assert.equal(name('C:\\Users\\me\\track.gpx'), 'track.gpx');
  assert.equal(name('.hidden.gpx'), 'hidden.gpx');
  assert.equal(name('山歩き 2025.gpx'), '山歩き 2025.gpx');
  assert.equal(name('a\u0000b<c>|d.zip'), 'a_b_c__d.zip');
  assert.equal(name(`${'x'.repeat(300)}.zip`)?.length, 100);
  for (const refused of ['notes.txt', 'archive.zip.exe', '.zip', '..gpx', '', 'gpx', 'a.gpx/'])
    assert.equal(name(refused), undefined, refused);
  assert.equal(uploadName('%E0%A4%A'), undefined);
});

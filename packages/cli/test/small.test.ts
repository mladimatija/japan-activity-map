import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { saysDemo } from '../src/demo/marker.ts';
import { errorText, JamError } from '../src/errors.ts';
import { escapeRegExp, readJson, writeFileAtomic } from '../src/files.ts';
import { parseProgress, PROGRESS_MARK } from '../src/logger.ts';
import { runLines } from '../src/process.ts';
import { statementsOf } from '../src/store/migrate.ts';

test('errors: a readable error is told from a bug, and anything thrown becomes one line', () => {
  class Mine extends JamError {}
  assert.ok(new Mine('x') instanceof JamError);
  assert.ok(!(new TypeError('x') instanceof JamError));
  assert.equal(errorText(new Error('boom')), 'boom');
  assert.equal(errorText('text'), 'text');
  assert.equal(errorText(42), '42');
});

test('files: a regular expression made from text matches exactly that text', () => {
  const text = '35.6812 (a+b)* [x] $1 ^end\\';
  assert.ok(new RegExp(`^${escapeRegExp(text)}$`).test(text));
  assert.ok(!new RegExp(`^${escapeRegExp('1.5')}$`).test('125'));
});

test('files: an atomic write replaces the file whole and leaves nothing beside it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jam-test-'));
  const file = join(dir, 'a.json');
  writeFileSync(file, '{"old":true}');
  writeFileAtomic(file, '{"new":true}');
  assert.deepEqual(readJson(file), { new: true });
  assert.deepEqual(readdirSync(dir), ['a.json']);
  assert.equal(readFileSync(file, 'utf8'), '{"new":true}');
});

test('progress: a line the wizard reads back, and any other line left alone', () => {
  assert.deepEqual(parseProgress(`${PROGRESS_MARK}3 10 list sources`), {
    done: 3,
    total: 10,
    what: 'list sources',
  });
  assert.equal(parseProgress('3 10 tracks'), undefined);
});

test('migrations: comments and spacing do not change what a migration is; statements do', () => {
  const a = '-- one thing\nCREATE TABLE t (id INTEGER); -- trailing\n\n';
  const b = '-- reworded entirely\n  CREATE TABLE t (id INTEGER);\n';
  assert.equal(statementsOf(a), statementsOf(b));
  assert.notEqual(statementsOf(a), statementsOf(a.replace('INTEGER', 'TEXT')));
});

test('demo: only a meta.json that says so is a demo build', () => {
  assert.ok(saysDemo('{"demo":true}'));
  assert.ok(!saysDemo('{"demo":"true"}'));
  assert.ok(!saysDemo('{}'));
  assert.ok(!saysDemo('not json'));
});

test('process: lines from both streams, secrets hidden, the exit code passed on', async () => {
  const lines: string[] = [];
  const result = await runLines(
    process.execPath,
    ['-e', 'console.log("token=s3cret-value"); console.error("on stderr"); process.exit(3)'],
    { secrets: ['s3cret-value'], onLine: (line) => lines.push(line) },
  );
  assert.equal(result.code, 3);
  assert.ok(!result.missing);
  assert.ok(lines.includes('token=[hidden]') && lines.includes('on stderr'), lines.join('|'));
  assert.ok(!result.text.includes('s3cret-value'));
});

test('process: a program that is not there is a result, not an exception', async () => {
  const result = await runLines('jam-no-such-program-anywhere', []);
  assert.equal(result.code, 1);
  assert.ok(result.missing);
});

test('exported Strava files: the id in a name, and the ids a list gives', async () => {
  const { idInName, idsByFile } = await import('../src/strava/tracks-from.ts');
  assert.equal(idInName('strava_17421562394.gpx'), 17421562394);
  assert.equal(idInName('17421562394_Morning Run.gpx'), 17421562394);
  assert.equal(idInName('17421562394.fit'), 17421562394);
  assert.equal(idInName('2026-05-09_Morning Run.gpx'), undefined);
  assert.equal(idInName('Morning Run.gpx'), undefined);
  const list = idsByFile(
    'Activity ID,Activity Date,Activity Name,Filename\n123456789,"Jan 2, 2024","Run, easy",activities/7000001.fit.gz\n987654321,x,y,\nnot-an-id,x,y,activities/1.gpx\n',
  );
  assert.deepEqual([...list], [['7000001.fit.gz', 123456789]]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { siteOptionsSchema } from '@jam/core';

import { defaultBranchIn, githubPagesUrl, withPolicy } from '../src/deploy/github.ts';
import { contentPolicy, headersFile, HeadersError, mapOrigins } from '../src/deploy/headers.ts';
import { deployMissing, HOSTS } from '../src/deploy/hosts.ts';

const config = (deploy: object, secrets: object = {}) =>
  ({
    site: siteOptionsSchema.parse({ deploy }),
    secrets: { deploy: secrets },
  }) as Parameters<typeof deployMissing>[0];

test('policy: scripts and the worker from the site only, the map hosts for connections', () => {
  const policy = contentPolicy(['https://tiles.example.org']);
  assert.match(policy, /script-src 'self';/);
  assert.match(policy, /worker-src 'self' blob:/);
  assert.match(policy, /connect-src 'self' https:\/\/tiles\.example\.org/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe/);
});

test('policy: as a meta element it leaves out what only a header may say', () => {
  assert.doesNotMatch(contentPolicy([], true), /frame-ancestors/);
});

test('headers: pages.dev copies are noindex only on Cloudflare with an address of its own', () => {
  assert.match(headersFile([], 'https://map.example.com', 'cloudflare'), /X-Robots-Tag: noindex/);
  assert.doesNotMatch(headersFile([], 'https://x.pages.dev', 'cloudflare'), /noindex/);
  assert.doesNotMatch(headersFile([], undefined, 'cloudflare'), /noindex/);
  assert.doesNotMatch(headersFile([], 'https://map.example.com', 'netlify'), /noindex/);
});

test('headers: a line over the limit is refused', () => {
  const many = Array.from({ length: 120 }, (_, i) => `https://host-number-${i}.example.com`);
  assert.throws(() => headersFile(many, undefined), HeadersError);
});

test('origins: what the styles point at is followed one step; http is named, not allowed', async () => {
  const site = siteOptionsSchema.parse({
    deploy: { extraHosts: ['http://plain.example.org/{z}.png', 'https://extra.example.net/x'] },
  });
  const found = await mapOrigins(site, async (url) =>
    url.endsWith('/planet')
      ? { tiles: ['https://cdn.example.io/{z}/{x}/{y}.pbf'] }
      : {
          glyphs: 'https://fonts.example.com/{range}.pbf',
          sources: { a: { url: 'https://tiles.openfreemap.org/planet' } },
        },
  );
  for (const origin of [
    'https://cdn.example.io',
    'https://fonts.example.com',
    'https://extra.example.net',
  ])
    assert.ok(found.origins.includes(origin), origin);
  assert.deepEqual(found.insecure, ['http://plain.example.org/{z}.png']);
  assert.ok(!found.origins.some((origin) => origin.startsWith('http:')));
});

test('github: the default branch is read from ls-remote, when it says', () => {
  assert.equal(defaultBranchIn('ref: refs/heads/main\tHEAD\nabc123\tHEAD\n'), 'main');
  assert.equal(defaultBranchIn('ref: refs/heads/release/2026\tHEAD\n'), 'release/2026');
  assert.equal(defaultBranchIn(''), undefined);
});

test('github: the Pages address of a project and of a user site', () => {
  assert.equal(githubPagesUrl('Someone/my-map'), 'https://someone.github.io/my-map/');
  assert.equal(githubPagesUrl('someone/someone.github.io'), 'https://someone.github.io/');
});

test('github: the policy goes into the head once, however often it is added', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  const once = withPolicy(html, "default-src 'self'");
  const twice = withPolicy(once, "default-src 'none'");
  assert.equal(twice.match(/Content-Security-Policy/g)?.length, 1);
  assert.match(twice, /default-src 'none'/);
  assert.ok(twice.indexOf('Content-Security-Policy') < twice.indexOf('<title>'));
});

test('hosts: each says what it still needs, and nothing once it has it', () => {
  assert.equal(deployMissing(config({ host: 'cloudflare' })).length, 3);
  assert.equal(
    deployMissing(
      config(
        { host: 'cloudflare', projectName: 'p' },
        { apiToken: 't', accountId: 'a'.repeat(32) },
      ),
    ).length,
    0,
  );
  assert.match(
    deployMissing(config({ host: 'netlify', projectName: 'p' }))[0] ?? '',
    /netlifyToken/,
  );
  assert.match(deployMissing(config({ host: 'github' }))[0] ?? '', /repository/);
  assert.equal(deployMissing(config({ host: 'github', repository: 'me/site' })).length, 0);
});

test('hosts: a failure is explained only when the tool really said so', () => {
  const cf = config({ host: 'cloudflare', projectName: 'p' });
  assert.equal(HOSTS.cloudflare.explain(cf, 'Uploaded 10000 files (3 sec)'), undefined);
  assert.match(HOSTS.cloudflare.explain(cf, 'Authentication error [code: 10000]') ?? '', /token/);
  assert.match(
    HOSTS.cloudflare.explain(cf, 'Project not found. [code: 8000007]') ?? '',
    /--create/,
  );
  const nf = config({ host: 'netlify', projectName: 'p' });
  assert.equal(HOSTS.netlify.explain(nf, 'Deployed 401 files to the team site'), undefined);
  assert.match(HOSTS.netlify.explain(nf, 'Error: Project not found') ?? '', /--create/);
});

test('hosts: GitHub Pages refuses a code branch, previews and --create', () => {
  const none = { preview: undefined, create: false };
  assert.match(
    HOSTS.github.refuses(config({ host: 'github', pagesBranch: 'main' }), none) ?? '',
    /holds code/,
  );
  assert.equal(HOSTS.github.refuses(config({ host: 'github' }), none), undefined);
  assert.ok(HOSTS.github.refuses(config({ host: 'github' }), { preview: 'x', create: false }));
  assert.ok(HOSTS.github.refuses(config({ host: 'github' }), { preview: undefined, create: true }));
});

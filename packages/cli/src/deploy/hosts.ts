/**
 * The places a site can be published, each as the same few answers: what it still needs, where
 * the folder goes, how it gets there, and what to say when the host refuses. `jam deploy` knows
 * only this shape, so another host is one more entry here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Config } from '@jam/core';

import type { Logger } from '../logger.ts';
import type { RunResult } from '../process.ts';
import { CODE_BRANCHES, githubPagesUrl, pushPages } from './github.ts';
import { contentPolicy } from './headers.ts';
import { NETLIFY, runTool, WRANGLER } from './tool.ts';

export type HostId = Config['site']['deploy']['host'];

/** One upload, as the command asks for it. */
export interface Upload {
  dir: string;
  /** Set for a preview: its name. Unset: the public site. */
  preview: string | undefined;
  /** Make the project first. */
  create: boolean;
  /** The addresses the page may load from, for a host that cannot send headers. */
  origins: readonly string[];
  /** A one-line note for the host's own record of the upload. */
  message: string;
  log: Logger;
}

type Need = [file: 'site' | 'secrets', key: string, what: string, value: string | undefined];

export interface Host {
  name: string;
  /** Whether the host reads a `_headers` file from the folder. */
  headersFile: boolean;
  /** Every setting the host needs: where it lives, what to call it, and its value now. */
  needs(config: Config): Need[];
  /** A reason this request cannot be made of this host at all. */
  refuses(config: Config, upload: Pick<Upload, 'preview' | 'create'>): string | undefined;
  /** Where the folder is going, for one line of output. */
  target(config: Config): string;
  /** The public address after a production upload, unless the site has one of its own. */
  address(config: Config): string;
  upload(config: Config, upload: Upload): Promise<RunResult>;
  /** What to tell the user about a failure, from what the tool printed. */
  explain(config: Config, text: string): string | undefined;
  /** Finds this upload's own address in what the tool printed. */
  uploaded?: RegExp;
}

const deployOf = (config: Config) => config.site.deploy;
const secretsOf = (config: Config) => config.secrets.deploy ?? {};

const cloudflare: Host = {
  name: 'Cloudflare Pages',
  headersFile: true,
  needs: (config) => [
    ['site', 'projectName', 'the Pages project name', deployOf(config).projectName],
    ['secrets', 'apiToken', 'the Cloudflare API token', secretsOf(config).apiToken],
    ['secrets', 'accountId', 'the Cloudflare account id', secretsOf(config).accountId],
  ],
  refuses: () => undefined,
  target: (config) => `the Pages project ${deployOf(config).projectName}`,
  address: (config) => `https://${deployOf(config).projectName}.pages.dev`,
  uploaded: /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i,
  upload: async (config, upload) => {
    const { projectName = '', branch } = deployOf(config);
    const { apiToken = '', accountId = '' } = secretsOf(config);
    const run = {
      env: { CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId },
      secrets: [apiToken, accountId],
    };
    if (upload.create) {
      upload.log.info(`Creating the Pages project ${projectName}:`);
      const created = await runTool(
        WRANGLER,
        {
          ...run,
          args: ['pages', 'project', 'create', projectName, '--production-branch', branch],
        },
        upload.log,
      );
      if (created.code !== 0 && !/already exists/i.test(created.text)) return created;
    }
    return runTool(
      WRANGLER,
      {
        ...run,
        args: [
          'pages',
          'deploy',
          upload.dir,
          '--project-name',
          projectName,
          '--branch',
          upload.preview ?? branch,
          // The upload is the built folder, whatever the state of the repository beside it.
          '--commit-dirty=true',
          '--commit-message',
          upload.message,
        ],
      },
      upload.log,
    );
  },
  explain: (config, text) =>
    /project not found|\[code: 8000007\]/i.test(text)
      ? `Cloudflare has no Pages project named ${deployOf(config).projectName} in this account. Create it with \`pnpm jam deploy --create\`.`
      : /authentication error|\[code: 10000\]|invalid api token|unable to authenticate/i.test(text)
        ? 'Cloudflare refused the API token. It needs the permission Account > Cloudflare Pages > Edit, for the account whose id is in secrets.jsonc.'
        : undefined,
};

const netlify: Host = {
  name: 'Netlify',
  headersFile: true,
  needs: (config) => [
    ['site', 'projectName', 'the Netlify project name', deployOf(config).projectName],
    ['secrets', 'netlifyToken', 'the Netlify access token', secretsOf(config).netlifyToken],
  ],
  refuses: () => undefined,
  target: (config) => `the Netlify project ${deployOf(config).projectName}`,
  address: (config) => `https://${deployOf(config).projectName}.netlify.app`,
  uploaded: /https:\/\/[a-z0-9-]+--[a-z0-9-]+\.netlify\.app/i,
  upload: async (config, upload) => {
    const { projectName = '', team } = deployOf(config);
    const { netlifyToken = '' } = secretsOf(config);
    // Away from the repository: there the tool would look for a site to build, and ask which.
    const cwd = mkdtempSync(join(tmpdir(), 'jam-netlify-'));
    try {
      return await runTool(
        NETLIFY,
        {
          cwd,
          env: { NETLIFY_AUTH_TOKEN: netlifyToken },
          secrets: [netlifyToken],
          args: [
            'deploy',
            '--dir',
            upload.dir,
            '--no-build',
            // --site-name creates the project when the account has none of that name.
            ...(upload.create
              ? ['--site-name', projectName, ...(team ? ['--team', team] : [])]
              : ['--site', projectName]),
            ...(upload.preview === undefined ? ['--prod'] : ['--alias', upload.preview]),
            '--message',
            upload.message,
          ],
        },
        upload.log,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  },
  explain: (config, text) =>
    /project not found|site not found|no site id|could not find (the )?(site|project)/i.test(text)
      ? `Netlify has no project named ${deployOf(config).projectName} that this token can see. Create it with \`pnpm jam deploy --create\`.`
      : /unauthorized|not authorized|invalid access token|access denied/i.test(text)
        ? 'Netlify refused the access token. Make a new one under User settings > Applications > Personal access tokens.'
        : /multiple teams|specify (a )?team|--team/i.test(text)
          ? 'The account has several teams: set "deploy": { "team": "…" } in config/site.jsonc to the team\'s slug.'
          : undefined,
};

const github: Host = {
  name: 'GitHub Pages',
  headersFile: false,
  needs: (config) => [
    ['site', 'repository', 'the GitHub repository, as owner/name', deployOf(config).repository],
  ],
  refuses: (config, { preview, create }) =>
    CODE_BRANCHES.has(deployOf(config).pagesBranch)
      ? `deploy.pagesBranch is "${deployOf(config).pagesBranch}", a branch that holds code. The site replaces everything on its branch, so give it one of its own (gh-pages).`
      : preview !== undefined || create
        ? 'GitHub Pages has no previews and nothing to create from here: --branch and --create are for Cloudflare Pages and Netlify.'
        : undefined,
  target: (config) =>
    `the ${deployOf(config).pagesBranch} branch of github.com/${deployOf(config).repository}`,
  address: (config) => githubPagesUrl(deployOf(config).repository ?? ''),
  upload: (config, upload) =>
    pushPages(
      upload.dir,
      deployOf(config).repository ?? '',
      deployOf(config).pagesBranch,
      contentPolicy(upload.origins, true),
      upload.log,
    ),
  explain: (config, text) => {
    const name = deployOf(config).repository;
    return /is the default branch of/.test(text)
      ? `${text.trim()} The site replaces everything on its branch, so set deploy.pagesBranch in config/site.jsonc to one of its own (gh-pages).`
      : /could not read username|authentication failed|permission denied|returned error: 403/i.test(
            text,
          )
        ? `git could not sign in to github.com/${name}. Deploying uses the sign-in \`git push\` already has on this computer; check it with \`git ls-remote https://github.com/${name}.git\`.`
        : /repository not found|does not appear to be a git repository/i.test(text)
          ? `github.com/${name} was not found, or this computer's git sign-in may not see it.`
          : undefined;
  },
};

export const HOSTS: Record<HostId, Host> = { cloudflare, netlify, github };

/** What the chosen host still needs before anything can be uploaded, as lines for the user. */
export const deployMissing = (config: Config): string[] =>
  HOSTS[deployOf(config).host]
    .needs(config)
    .filter(([, , , value]) => !value)
    .map(([file, key, what]) => `${what}: "deploy": { "${key}": "…" } in config/${file}.jsonc`);

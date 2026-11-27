/** `jam deploy`: checks, audits and publishes dist/ on the chosen host. */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isDemoBuild } from '../demo/marker.ts';
import { type FetchJson, headersFile, HeadersError, mapOrigins } from '../deploy/headers.ts';
import { deployMissing, HOSTS } from '../deploy/hosts.ts';
import { ROOT_DIR, shownPath } from '../paths.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import { auditFolder } from './privacy.ts';
import type { CommandContext } from './types.ts';

/** What `jam build` and `pnpm web:build` put in the folder, and the file deploy adds. */
const EXPECTED = new Set(['index.html', 'assets', 'data', '_headers']);

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
};

/** What is wrong with a folder as a site to publish, or nothing. */
export const folderProblems = (dir: string): string[] => {
  if (!existsSync(dir)) return [`${shownPath(dir)} does not exist.`];
  const problems: string[] = [];
  const data = join(dir, 'data');
  if (!existsSync(join(data, 'meta.json')))
    problems.push(`${shownPath(dir)}/data has no build. Run \`pnpm jam build\`.`);
  else if (isDemoBuild(data))
    problems.push(
      `${shownPath(dir)}/data holds demo data (made-up activities), which is not published.`,
    );
  if (!existsSync(join(dir, 'index.html')) || !existsSync(join(dir, 'assets')))
    problems.push(`${shownPath(dir)} has no web app. Run \`pnpm web:build\`.`);
  return problems;
};

export const deployCommand = async (context: CommandContext): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context);
  if (!config) return 1;
  const dir = resolve(ROOT_DIR, typeof options.dir === 'string' ? options.dir : 'dist');
  const host = HOSTS[config.site.deploy.host];
  const preview = typeof options.branch === 'string' ? options.branch : undefined;
  const create = options.create === true;

  const missing = deployMissing(config);
  const problems = folderProblems(dir);
  if (missing.length > 0) {
    log.error(`Deploying to ${host.name} is not set up yet. Missing:`);
    for (const line of missing) log.error(`  ${line}`);
    log.error('docs/deploy.md says where each comes from.');
  }
  for (const problem of problems) log.error(problem);
  const refusal = host.refuses(config, { preview, create });
  if (refusal) log.error(refusal);
  if (missing.length > 0 || problems.length > 0 || refusal) return 1;

  const strays = readdirSync(dir).filter((name) => !EXPECTED.has(name));
  if (strays.length > 0)
    log.warn(
      `${shownPath(dir)} also holds ${strays.join(', ')}, which neither build put there. Everything in the folder is uploaded.`,
    );

  let origins: string[];
  try {
    const lookup = process.env.JAM_DEPLOY_NO_LOOKUP ? undefined : fetchJson;
    const found = await mapOrigins(config.site, lookup);
    origins = found.origins;
    for (const url of found.unread)
      log.warn(
        `Could not read ${url} to see where its tiles come from. If the map stays empty on the published site, add the tile address to deploy.extraHosts in site.jsonc.`,
      );
    for (const url of found.insecure)
      log.warn(
        `${url} is not an https address, so the published page (which is https) cannot load from it. Use its https address in site.jsonc.`,
      );
    log.info(
      `The page may load from itself${origins.length > 0 ? ` and ${origins.join(', ')}` : ''}.`,
    );
    // A host that cannot send headers gets the policy in the page instead (its upload sees to it).
    if (host.headersFile) {
      const headers = headersFile(origins, config.site.site.baseUrl, config.site.deploy.host);
      if (!flags.dryRun) writeFileSync(join(dir, '_headers'), headers);
    }
  } catch (error) {
    if (!(error instanceof HeadersError)) throw error;
    log.error(error.message);
    return 1;
  }

  const store = await openStore(log);
  try {
    if (!auditFolder(store, config, dir, log)) {
      log.error('Not deployed.');
      return 1;
    }
  } finally {
    store.close();
  }

  const where = preview === undefined ? 'production' : `a preview (${preview})`;
  if (flags.dryRun) {
    log.info(
      `Dry run: would upload ${shownPath(dir)} to ${host.target(config)} as ${where}. Nothing was written or sent.`,
    );
    return 0;
  }
  log.info(`Uploading ${shownPath(dir)} to ${host.target(config)} as ${where}:`);
  const result = await host.upload(config, {
    dir,
    preview,
    create,
    origins,
    message: `jam deploy ${new Date().toISOString().slice(0, 10)}`,
    log,
  });
  if (result.code !== 0) {
    const reason = host.explain(config, result.text);
    if (reason) log.error(reason);
    log.error('Not deployed.');
    return 1;
  }
  const uploaded = host.uploaded?.exec(result.text)?.[0];
  if (uploaded) log.info(`This upload: ${uploaded}`);
  if (preview !== undefined) {
    log.info('Deployed as a preview; the public site is unchanged.');
    return 0;
  }
  log.info(`Deployed: ${config.site.site.baseUrl ?? host.address(config)}`);
  if (config.site.deploy.host === 'github')
    log.info(
      `The first time, turn Pages on: the repository's Settings > Pages > "Deploy from a branch", branch ${config.site.deploy.pagesBranch}, folder / (root). GitHub takes a minute or two to show a new upload.`,
    );
  return 0;
};

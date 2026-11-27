/**
 * GitHub Pages: the site is a branch of a repository. The folder is committed in a throwaway
 * repository in the temporary folder and pushed over that branch, so the branch holds one commit
 * (the site as it is now) and this repository, its history and its git settings are not touched.
 * Signing in is git's own: whatever `git push` to that repository already uses on this computer.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from '../logger.ts';
import { type RunResult, runLines } from '../process.ts';
import { standIn } from './tool.ts';

/** Branches a site is never pushed over, whatever the repository says: they hold code. */
export const CODE_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);

/** The address GitHub serves a repository's Pages at, unless it has a domain of its own. */
export const githubPagesUrl = (repository: string): string => {
  const [owner = '', name = ''] = repository.split('/');
  const host = `${owner.toLowerCase()}.github.io`;
  return name.toLowerCase() === host ? `https://${host}/` : `https://${host}/${name}/`;
};

/**
 * The page with its content security policy as a meta element: GitHub Pages sends no headers of
 * the site's choosing, so this is the only place for it there.
 */
export const withPolicy = (html: string, policy: string): string => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy.replaceAll('"', '&quot;')}" />`;
  const without = html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
  return /<head[^>]*>/i.test(without)
    ? without.replace(/<head[^>]*>/i, (head) => `${head}\n    ${meta}`)
    : `${meta}\n${without}`;
};

/** The default branch a `git ls-remote --symref <remote> HEAD` answer names, if it names one. */
export const defaultBranchIn = (lsRemote: string): string | undefined =>
  /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(lsRemote)?.[1];

/** Commits a copy of `dir` and pushes it over `branch` of the repository. */
export const pushPages = async (
  dir: string,
  repository: string,
  branch: string,
  policy: string,
  log: Logger,
): Promise<RunResult> => {
  const remote = standIn('github', log) ?? `https://github.com/${repository}.git`;
  const work = mkdtempSync(join(tmpdir(), 'jam-pages-'));
  // A push that would ask for a password fails instead: nobody may be there to answer.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  const git = async (args: string[], show = true): Promise<RunResult> => {
    const result = await runLines('git', args, {
      cwd: work,
      env,
      ...(show ? { onLine: (line: string) => line.trim() && log.info(`  ${line}`) } : {}),
    });
    return result.missing
      ? { ...result, text: 'git was not found. GitHub Pages is deployed with git.\n' }
      : result;
  };
  try {
    // The branch the repository's code lives on is asked of the repository itself: pushing the
    // site over it would replace the code.
    const head = await git(['ls-remote', '--symref', remote, 'HEAD'], false);
    if (head.code !== 0) return head;
    if (defaultBranchIn(head.text) === branch)
      return {
        code: 1,
        missing: false,
        text: `"${branch}" is the default branch of ${repository}: it holds the code.\n`,
      };

    cpSync(dir, work, { recursive: true });
    // Without this GitHub runs the folder through Jekyll, which drops files starting with "_".
    writeFileSync(join(work, '.nojekyll'), '');
    rmSync(join(work, '_headers'), { force: true });
    const index = join(work, 'index.html');
    if (existsSync(index)) writeFileSync(index, withPolicy(readFileSync(index, 'utf8'), policy));

    const configured = async (key: string) => {
      const result = await git(['config', '--get', key], false);
      return result.code === 0 && result.text.trim() !== '';
    };
    // An identity for this one commit when git has none set; the user's own otherwise.
    const identity =
      (await configured('user.name')) && (await configured('user.email'))
        ? []
        : ['-c', 'user.name=jam deploy', '-c', 'user.email=jam-deploy@users.noreply.github.com'];
    const steps: string[][] = [
      ['init', '--quiet'],
      ['checkout', '--quiet', '-B', branch],
      // Everything in the folder, whatever this computer's own ignore rules say.
      ['add', '--all', '--force'],
      [
        ...identity,
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '--message',
        `jam deploy ${new Date().toISOString().slice(0, 10)}`,
      ],
      ['push', '--force', remote, `HEAD:refs/heads/${branch}`],
    ];
    let text = '';
    for (const step of steps) {
      const result = await git(step);
      text += result.text;
      if (result.code !== 0) return { ...result, text };
    }
    return { code: 0, missing: false, text };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
};

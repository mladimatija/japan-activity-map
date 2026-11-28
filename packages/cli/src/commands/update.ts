/**
 * `jam update`: everything a weekly run does, in order, stopping at the first step that fails so
 * a half-finished run never reaches the public site.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import { deployMissing } from '../deploy/hosts.ts';
import { gpxFolder, hasGpxFolder } from '../gpx-import/files.ts';
import { ROOT_DIR, shownPath } from '../paths.ts';
import { PNPM, runLines } from '../process.ts';
import { loadToken } from '../strava/auth.ts';
import { configFor } from './config.ts';
import { folderProblems } from './deploy.ts';
import type { Command, CommandContext } from './types.ts';

interface UpdateStep {
  title: string;
  /** Why it is left out of this run, when it is. */
  skip?: string | undefined;
  run: () => Promise<number> | number;
}

export const updateCommand = async (
  context: CommandContext,
  find: (name: string[]) => Command | undefined,
): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context);
  if (!config) return 1;
  if (currentStoreMarker()) {
    log.error(demoRefusal('"update" does not run on it'));
    return 1;
  }
  const own = (name: string[], commandOptions: CommandContext['options'] = {}) => {
    const command = find(name);
    if (!command) throw new Error(`no command "${name.join(' ')}"`);
    return () => command.run({ flags, log, args: [], options: commandOptions });
  };
  const noSync = options['no-sync'] === true;
  // The sign-in file is only read when it will be used: a broken one must not stop a run that
  // was asked to build from what is already here.
  const fromGpx = config.site.activities.source === 'gpx';
  const signedIn =
    !noSync && !fromGpx && config.secrets.strava !== undefined && loadToken() !== undefined;
  const sheet = existsSync(resolve(ROOT_DIR, config.sheet.path));
  // The dev checks point the run at a folder of their own, where no web app is built.
  const sandboxDist = process.env.JAM_UPDATE_DIST
    ? resolve(process.env.JAM_UPDATE_DIST)
    : undefined;
  const dist = sandboxDist ?? resolve(ROOT_DIR, 'dist');
  const vp = join(ROOT_DIR, 'node_modules/.bin', process.platform === 'win32' ? 'vp.cmd' : 'vp');
  const webBuild = async (): Promise<number> => {
    const [file, args] = existsSync(vp) ? [vp, ['build', 'packages/web']] : [PNPM, ['web:build']];
    const result = await runLines(file, args, {
      onLine: (line) => {
        if (line.trim()) log.info(`  ${line}`);
      },
    });
    if (result.missing) log.error(`Could not run ${file}.`);
    return result.code;
  };
  const steps: UpdateStep[] = [
    // One of the two, by activities.source: the other source's activities are not built from.
    fromGpx
      ? {
          title: 'Import GPX files',
          run: own(['sync', 'gpx']),
          skip: noSync
            ? '--no-sync'
            : hasGpxFolder(config)
              ? undefined
              : `no folder at ${shownPath(gpxFolder(config))}`,
        }
      : {
          title: 'Fetch new Strava activities',
          run: own(['sync', 'strava']),
          skip: noSync ? '--no-sync' : signedIn ? undefined : 'not signed in to Strava',
        },
    {
      title: 'Import the activity sheet',
      run: own(['sync', 'sheet']),
      skip: noSync ? '--no-sync' : sheet ? undefined : `no sheet at ${config.sheet.path}`,
    },
    {
      // The build matches new activities and groups routes itself, in that order.
      title: 'Match, group routes and build the site data',
      run: own(['build'], sandboxDist ? { out: join(sandboxDist, 'data') } : {}),
    },
    {
      title: 'Build the web app',
      run: webBuild,
      skip: flags.dryRun ? 'dry run' : sandboxDist ? 'JAM_UPDATE_DIST' : undefined,
    },
    {
      title: 'Deploy',
      run: own(['deploy'], sandboxDist ? { dir: sandboxDist } : {}),
      skip:
        options['no-deploy'] === true
          ? '--no-deploy'
          : deployMissing(config).length > 0
            ? 'deploying is not set up (docs/deploy.md)'
            : flags.dryRun && folderProblems(dist).length > 0
              ? 'dry run, and nothing is built yet to check'
              : undefined,
    },
  ];
  const started = Date.now();
  for (const [i, step] of steps.entries()) {
    const label = `[${i + 1}/${steps.length}] ${step.title}`;
    if (step.skip) {
      log.info(`${label}: skipped (${step.skip}).`);
      continue;
    }
    log.info(`${label}:`);
    const code = await step.run();
    if (code !== 0) {
      log.error(
        `Stopped at "${step.title}". The steps after it did not run, so the public site is as it was.`,
      );
      return code;
    }
  }
  log.info(`Up to date, in ${Math.round((Date.now() - started) / 1000)} s.`);
  return 0;
};

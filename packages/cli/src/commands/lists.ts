import { buildLists } from '../lists/build.ts';
import { FETCH_SOURCES, type FetchSource, fetchSources } from '../lists/fetch.ts';
import { validateLists } from '../lists/validate.ts';
import type { CommandContext } from './types.ts';

export const listsBuild = ({ flags, log }: CommandContext): number => {
  const { files, catalog, review } = buildLists({ dryRun: flags.dryRun });
  const verb = flags.dryRun ? 'would be ' : '';
  for (const file of files) {
    if (file.result === 'unchanged') log.debug(`${file.path}: unchanged`);
    else
      log.info(
        `${file.path}: ${verb}${file.result === 'new' ? 'created' : file.result === 'removed' ? 'removed (list no longer built)' : 'updated'}`,
      );
  }
  const changed = files.filter((file) => file.result !== 'unchanged').length;
  log.info(`${changed} of ${files.length} files ${flags.dryRun ? 'would change' : 'changed'}.`);
  log.info('');
  for (const entry of catalog.lists) {
    const counts =
      entry.itemCount === undefined
        ? ''
        : ` ${entry.itemCount} items${entry.withCoordinates === undefined ? '' : `, ${entry.withCoordinates} with coordinates`}`;
    log.info(`  ${entry.id.padEnd(36)} ${entry.status.padEnd(8)}${counts}`);
  }
  log.info('');
  log.info(
    `Review: ${review.otherPoint.length} list points away from the GSI summit, ${review.fallbacks.length} with no GSI match, ` +
      `${review.coordinates.length} coordinate notes, ${review.prefectureChecks.length} prefecture checks. See lists/review.md.`,
  );
  return 0;
};

export const listsValidate = ({ log }: CommandContext): number => {
  const report = validateLists();
  for (const line of report.summary) log.info(line);
  for (const warning of report.warnings) log.warn(warning);
  for (const error of report.errors) log.error(error);
  log.info('');
  log.info(`${report.errors.length} errors, ${report.warnings.length} warnings.`);
  return report.errors.length > 0 ? 1 : 0;
};

export const listsFetch = async ({ flags, log, args }: CommandContext): Promise<number> => {
  const unknown = args.filter((arg) => !(FETCH_SOURCES as readonly string[]).includes(arg));
  if (unknown.length > 0) {
    log.error(`Unknown source: ${unknown.join(', ')}. Choose from ${FETCH_SOURCES.join(', ')}.`);
    return 1;
  }
  const sources = args.length > 0 ? (args as FetchSource[]) : [...FETCH_SOURCES];
  return fetchSources(sources, { dryRun: flags.dryRun, log });
};

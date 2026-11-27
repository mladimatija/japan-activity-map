import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { configFor } from './config.ts';
import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import type { Logger } from '../logger.ts';
import { DATA_DIR, ROOT_DIR, shownPath, STORE_FILE } from '../paths.ts';
import { missingListsWarning } from '../lists/index-file.ts';
import { LinkIndex } from '../sheet/links.ts';
import { readSheet } from '../sheet/read.ts';
import { type LinkIssue, planSync } from '../sheet/sync.ts';
import { validateSheet } from '../sheet/validate.ts';
import { writeText } from '../lists/output.ts';
import { Database, openStore, type Store } from '../store/store.ts';
import type { CommandContext } from './types.ts';

const SHEET_REVIEW_FILE = join(DATA_DIR, 'sheet-review.md');

/** For --dry-run: a throwaway copy of the store, so the plan is exact and nothing real changes. */
const previewStore = async (log: Logger): Promise<{ store: Store; dispose(): void }> => {
  const dir = mkdtempSync(join(tmpdir(), 'jam-preview-'));
  const copy = join(dir, 'jam.sqlite');
  if (existsSync(STORE_FILE)) {
    const source = new Database(STORE_FILE, { readOnly: true });
    try {
      await source.copyTo(copy);
    } finally {
      source.close();
    }
  }
  const quiet: Logger = { ...log, info: (message) => log.debug(message) };
  const store = await openStore(quiet, copy);
  return {
    store,
    dispose: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
};

const reviewText = (file: string, issues: LinkIssue[]): string => {
  const lines = [
    '# Sheet links to check',
    '',
    `Written by \`jam sync sheet\` for ${file}. These references in the place column were skipped;`,
    'the rest of each row was imported. Use an id from the lists to make a reference exact.',
    '',
  ];
  if (issues.length === 0) lines.push('Nothing to review.');
  for (const issue of issues) {
    const where = `Row ${issue.line} (${issue.rowId}), "${issue.ref}"`;
    if (issue.reason === 'missing') {
      lines.push(
        `- ${where}: matches nothing in the lists. Check the spelling, use an id from lists/, or give lat and lon for a place in no list.`,
      );
    } else {
      lines.push(`- ${where}: matches ${issue.candidates.length} places. Use one of these ids:`);
      for (const candidate of issue.candidates)
        lines.push(`  - \`${candidate.id}\` ${candidate.label}`);
    }
  }
  return `${lines.join('\n')}\n`;
};

export const syncSheet = async ({ flags, log, args }: CommandContext): Promise<number> => {
  if (args.length > 1) {
    log.error('Give at most one sheet file.');
    return 1;
  }
  const config = configFor({ flags, log });
  if (!config) return 1;
  const sheetConfig = config.sheet;
  const path = resolve(ROOT_DIR, args[0] ?? sheetConfig.path);
  const shown = shownPath(path);
  if (!existsSync(path)) {
    log.error(
      `No sheet at ${shown}. Copy templates/activity-sheet.csv there and fill it in, or give a file: pnpm jam sync sheet <file>.`,
    );
    return 1;
  }

  // The demo store takes only the demo's own sheet: real rows stay out of made-up data.
  if (currentStoreMarker() && relative(DATA_DIR, path).startsWith('..')) {
    log.error(demoRefusal(`a sheet from outside ${shownPath(DATA_DIR)} is not imported into it`));
    return 1;
  }

  const raw = readSheet(path);
  const { rows, problems } = validateSheet(raw, path, sheetConfig.timeZone);
  if (problems.length > 0) {
    log.error(
      `${shown}: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}. Nothing was imported.`,
    );
    for (const problem of problems) {
      log.error(
        `  row ${problem.line}${problem.column ? `, ${problem.column}` : ''}: ${problem.message}`,
      );
    }
    return 1;
  }

  const links = new LinkIndex();
  const leftOut = missingListsWarning(links.missing);
  if (leftOut) log.warn(leftOut);
  const preview = flags.dryRun ? await previewStore(log) : undefined;
  const store = preview?.store ?? (await openStore(log));
  try {
    const plan = planSync(store, rows, path, links);
    log.info(`Sheet ${shown}: ${rows.length} rows.`);
    const symbol = { added: '+', updated: '~', removed: '-' } as const;
    for (const change of plan.changes) {
      log.info(
        `  ${symbol[change.kind]} ${change.rowId} ${change.name}${change.details.length > 0 ? ` (${change.details.join(', ')})` : ''}`,
      );
    }
    const count = (kind: 'added' | 'updated' | 'removed') =>
      plan.changes.filter((change) => change.kind === kind).length;
    const summary = `${count('added')} added, ${count('updated')} updated, ${count('removed')} removed, ${plan.unchanged} unchanged`;
    const linkSummary = `Links: ${plan.links} resolved${plan.linkIssues.length > 0 ? `, ${plan.linkIssues.length} skipped` : ''}.`;

    if (flags.dryRun) {
      log.info(`Dry run, nothing written. Would be: ${summary}.`);
      log.info(linkSummary);
      for (const issue of plan.linkIssues) {
        log.warn(
          `  row ${issue.line} (${issue.rowId}): "${issue.ref}" ${issue.reason === 'missing' ? 'matches nothing' : `matches ${issue.candidates.length} places (${issue.candidates.map((candidate) => candidate.id).join(', ')})`}`,
        );
      }
      return 0;
    }
    plan.apply();
    writeText(SHEET_REVIEW_FILE, reviewText(plan.file, plan.linkIssues));
    log.info(`${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`);
    log.info(
      `${linkSummary}${plan.linkIssues.length > 0 ? ` See ${shownPath(SHEET_REVIEW_FILE)}.` : ''}`,
    );
    return 0;
  } finally {
    if (preview) preview.dispose();
    else store.close();
  }
};

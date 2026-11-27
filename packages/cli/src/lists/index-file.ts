import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LISTS_DIR } from './sources.ts';

/** One list as `lists/index.json` names it; `file` is absent for a list that is not built. */
export interface IndexedList {
  id: string;
  kind: string;
  title: { ja: string; en: string };
  theme: string;
  status: string;
  file?: string;
  reason?: string;
}

export interface ListIndex {
  lists: IndexedList[];
  /** Lists the index names whose file is not on this machine (the 五街道 on a fresh clone). */
  missing: IndexedList[];
}

const NOT_HERE =
  'Its file is not on this machine. Run `pnpm jam lists fetch gokaido` and `pnpm jam lists build`.';

/**
 * The built lists, as far as their files exist. The index is committed but a few list files are
 * not (their source's licence does not allow it), so a fresh clone names lists it cannot read:
 * those are returned as not built, with the reason, instead of failing on the missing file.
 */
export const readListIndex = (listsDir = LISTS_DIR): ListIndex => {
  const index = JSON.parse(readFileSync(join(listsDir, 'index.json'), 'utf8')) as {
    lists: IndexedList[];
  };
  const missing: IndexedList[] = [];
  const lists = index.lists.map((list) => {
    if (!list.file || existsSync(join(listsDir, list.file))) return list;
    missing.push(list);
    const { file: _file, ...rest } = list;
    return { ...rest, status: 'blocked', reason: NOT_HERE };
  });
  return { lists, missing };
};

/** One line for a command to print when some lists are left out. */
export const missingListsWarning = (missing: readonly IndexedList[]): string | null =>
  missing.length === 0
    ? null
    : `${missing.length} ${missing.length === 1 ? 'list is' : 'lists are'} left out because ${missing.length === 1 ? 'its file is' : 'their files are'} not on this machine (${missing.map((list) => list.id).join(', ')}). Run \`pnpm jam lists fetch gokaido\`, then \`pnpm jam lists build\`.`;

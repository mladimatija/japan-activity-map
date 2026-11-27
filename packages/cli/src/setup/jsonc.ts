/**
 * Reading and changing the config files as text, so comments and layout survive: one value is
 * replaced where it stands, and the whole file is checked against its schema before it is written.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { CONFIG_FILES, type ConfigKey } from '@jam/core';
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  type Node,
  parse,
  parseTree,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';

export type JsonPath = (string | number)[];

/** One value to set at a path; `undefined` removes the key. */
export interface Patch {
  file: ConfigKey;
  path: JsonPath;
  value: unknown;
}

export interface Issue {
  path: JsonPath;
  message: string;
}

export interface ConfigText {
  key: ConfigKey;
  /** The real file, whether or not it exists yet. */
  path: string;
  /** Where the text came from: the real file, the example (copied so its comments come along), or neither. */
  source: 'file' | 'example' | 'none';
  text: string;
}

const FORMAT = { insertSpaces: true, tabSize: 2, eol: '\n' };

/** Files only the owner may read: credentials, and the places to hide. */
export const PRIVATE_FILES: readonly ConfigKey[] = ['secrets', 'privacyZones'];

/**
 * The text an edit starts from. A missing real file starts from its example, comments and all;
 * secrets start empty, because their example is only a commented-out template.
 */
export const readConfigText = (configDir: string, key: ConfigKey): ConfigText => {
  const { fileName } = CONFIG_FILES[key];
  const path = join(configDir, `${fileName}.jsonc`);
  if (existsSync(path)) return { key, path, source: 'file', text: readFileSync(path, 'utf8') };
  const example = join(configDir, `${fileName}.example.jsonc`);
  if (key !== 'secrets' && existsSync(example))
    return { key, path, source: 'example', text: readFileSync(example, 'utf8') };
  return { key, path, source: 'none', text: '{}\n' };
};

export const parseText = (text: string): { value: unknown; errors: string[] } => {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  return { value: value ?? {}, errors: errors.map((error) => printParseErrorCode(error.error)) };
};

/** Applies each patch in turn to the text; everything not named stays byte for byte. */
export const patchText = (text: string, patches: readonly Omit<Patch, 'file'>[]): string => {
  let next = text;
  for (const patch of patches) {
    const kept = Array.isArray(patch.value) ? commentsInside(next, patch.path) : [];
    next = applyEdits(next, modify(next, patch.path, patch.value, { formattingOptions: FORMAT }));
    if (kept.length > 0) next = withComments(next, patch.path, kept);
  }
  return next;
};

/**
 * Whole comment lines inside the array at `path` (the commented-out examples a file ships with).
 * Replacing an array replaces everything between its brackets, so these are carried over by hand.
 */
const commentsInside = (text: string, path: JsonPath): string[] => {
  const node = findNodeAtLocation(
    parseTree(text, [], { allowTrailingComma: true }) ?? emptyNode,
    path,
  );
  if (node?.type !== 'array') return [];
  return text
    .slice(node.offset + 1, node.offset + node.length - 1)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('//'));
};

/** Puts those comment lines back, first inside the new array, so its entries follow them. */
const withComments = (text: string, path: JsonPath, comments: readonly string[]): string => {
  const node = findNodeAtLocation(
    parseTree(text, [], { allowTrailingComma: true }) ?? emptyNode,
    path,
  );
  if (node?.type !== 'array') return text;
  const lineStart = text.lastIndexOf('\n', node.offset) + 1;
  const indent = `${/^\s*/.exec(text.slice(lineStart))?.[0] ?? ''}  `;
  const inner = text.slice(node.offset + 1, node.offset + node.length - 1);
  const block = comments.map((comment) => `\n${indent}${comment}`).join('');
  // An empty array is written as `[]`: it needs its closing bracket on a line of its own.
  const rest = inner.trim() === '' ? `\n${indent.slice(2)}` : inner;
  return `${text.slice(0, node.offset + 1)}${block}${rest}${text.slice(node.offset + node.length - 1)}`;
};

const emptyNode: Node = { type: 'null', offset: 0, length: 0 };

/** The whole file against its schema: the one copy of the validation rules. */
export const checkText = (
  key: ConfigKey,
  text: string,
): { ok: true; value: unknown } | { ok: false; issues: Issue[] } => {
  const { value, errors } = parseText(text);
  if (errors.length > 0)
    return {
      ok: false,
      issues: errors.map((message) => ({ path: [], message: `syntax error: ${message}` })),
    };
  const result = CONFIG_FILES[key].schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path as JsonPath,
      message: issue.message,
    })),
  };
};

/** Temp file then rename, so a crash never leaves half a file. */
export const writeAtomic = (path: string, text: string, mode: number): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, text, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
};

export const writeConfigText = (file: ConfigText, text: string): void =>
  writeAtomic(file.path, text, PRIVATE_FILES.includes(file.key) ? 0o600 : 0o644);

const MASK = '"********"';

/** Every string value hidden, keys and comments kept: how a secrets file may be shown. */
export const maskSecrets = (text: string): string =>
  text
    .split('\n')
    .map((line) =>
      /^\s*\/\//.test(line) ? line : line.replace(/(:\s*)"(?:[^"\\]|\\.)*"/g, `$1${MASK}`),
    )
    .join('\n');

/**
 * The changed lines of a file, with one line around each change. Secrets are masked before the
 * comparison, so a changed secret shows as a line that changed without showing either value.
 */
export const diffText = (key: ConfigKey, before: string, after: string): string[] => {
  const secret = key === 'secrets';
  const a = (secret ? maskSecrets(before) : before).split('\n');
  const b = (secret ? maskSecrets(after) : after).split('\n');
  const rawA = before.split('\n');
  const rawB = after.split('\n');
  // Longest common subsequence over the real lines, shown through the masked ones.
  const table: number[][] = Array.from({ length: rawA.length + 1 }, () =>
    Array.from({ length: rawB.length + 1 }, () => 0),
  );
  for (let i = rawA.length - 1; i >= 0; i--)
    for (let j = rawB.length - 1; j >= 0; j--)
      (table[i] as number[])[j] =
        rawA[i] === rawB[j]
          ? (table[i + 1]?.[j + 1] ?? 0) + 1
          : Math.max(table[i + 1]?.[j] ?? 0, table[i]?.[j + 1] ?? 0);
  const rows: { mark: ' ' | '-' | '+'; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < rawA.length || j < rawB.length) {
    if (i < rawA.length && j < rawB.length && rawA[i] === rawB[j]) {
      rows.push({ mark: ' ', line: a[i] ?? '' });
      i++;
      j++;
    } else if (
      i < rawA.length &&
      (j >= rawB.length || (table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0))
    ) {
      rows.push({ mark: '-', line: a[i] ?? '' });
      i++;
    } else {
      rows.push({ mark: '+', line: b[j] ?? '' });
      j++;
    }
  }
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.mark !== ' ') for (const near of [index - 1, index, index + 1]) keep.add(near);
  });
  const out: string[] = [];
  let last = -1;
  rows.forEach((row, index) => {
    if (!keep.has(index)) return;
    if (last !== -1 && index > last + 1) out.push('  …');
    out.push(`${row.mark} ${row.line}`);
    last = index;
  });
  return out;
};

/** A value read out of parsed JSON by path; undefined when any step is missing. */
export const valueAt = (value: unknown, path: JsonPath): unknown => {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
};

/** Equal as JSON. A missing value equals only a missing value: null is a value of its own. */
export const sameValue = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : JSON.stringify(a) === JSON.stringify(b);

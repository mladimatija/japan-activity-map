import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../files.ts';

/** A FeatureCollection with one feature per line, so diffs stay readable. */
export const collectionText = (features: readonly unknown[], metadata?: unknown): string => {
  const head =
    metadata === undefined
      ? '{"type":"FeatureCollection",'
      : `{"type":"FeatureCollection",\n"metadata":${JSON.stringify(metadata)},`;
  return `${head}\n"features":[\n${features.map((feature) => JSON.stringify(feature)).join(',\n')}\n]}\n`;
};

export const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export type WriteResult = 'new' | 'changed' | 'unchanged';

export const compareFile = (path: string, text: string): WriteResult => {
  if (!existsSync(path)) return 'new';
  return readFileSync(path, 'utf8') === text ? 'unchanged' : 'changed';
};

export const writeText = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomic(path, text);
};

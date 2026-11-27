import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { CONFIG_FILES, type Config, type ConfigFileDefinition, type ConfigKey } from '@jam/core';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import type { z } from 'zod';

import { ROOT_DIR } from './paths.ts';
import { JamError } from './errors.ts';

export type ConfigSource = 'file' | 'example' | 'none';

export interface ConfigFileStatus {
  key: ConfigKey;
  description: string;
  source: ConfigSource;
  /** The file that was read, relative to the repository root, if any. */
  path?: string;
}

interface ConfigProblem {
  /** File the problem was found in, relative to the repository root. */
  file: string;
  /** Dotted path inside the file, or a line and column for syntax errors. */
  where: string;
  message: string;
}

interface LoadedConfig {
  config: Config;
  files: ConfigFileStatus[];
}

export class ConfigError extends JamError {
  readonly problems: ConfigProblem[];
  readonly files: ConfigFileStatus[];

  constructor(problems: ConfigProblem[], files: ConfigFileStatus[]) {
    super(
      `Found ${problems.length} problem${problems.length === 1 ? '' : 's'} in the config files`,
    );
    this.name = 'ConfigError';
    this.problems = problems;
    this.files = files;
  }
}

const lineAndColumn = (text: string, offset: number): string => {
  const before = text.slice(0, offset).split('\n');
  return `line ${before.length}, column ${(before.at(-1)?.length ?? 0) + 1}`;
};

interface LoadResult<T> {
  value: T | undefined;
  status: ConfigFileStatus;
  problems: ConfigProblem[];
}

const loadOne = (
  key: ConfigKey,
  definition: ConfigFileDefinition<z.ZodType>,
  configDir: string,
): LoadResult<unknown> => {
  const realPath = join(configDir, `${definition.fileName}.jsonc`);
  const examplePath = join(configDir, `${definition.fileName}.example.jsonc`);

  let source: ConfigSource = 'none';
  let path: string | undefined;
  if (existsSync(realPath)) {
    source = 'file';
    path = realPath;
  } else if (definition.fallbackToExample && existsSync(examplePath)) {
    source = 'example';
    path = examplePath;
  }

  const shownPath = path ? relative(ROOT_DIR, path) : relative(ROOT_DIR, realPath);
  const status: ConfigFileStatus = {
    key,
    description: definition.description,
    source,
    ...(path ? { path: shownPath } : {}),
  };
  const problems: ConfigProblem[] = [];

  let raw: unknown = {};
  if (path) {
    const text = readFileSync(path, 'utf8');
    const syntaxErrors: ParseError[] = [];
    raw = parse(text, syntaxErrors, { allowTrailingComma: true, disallowComments: false });
    for (const error of syntaxErrors) {
      problems.push({
        file: shownPath,
        where: lineAndColumn(text, error.offset),
        message: `syntax error: ${printParseErrorCode(error.error)}`,
      });
    }
    if (syntaxErrors.length > 0) return { value: undefined, status, problems };
  }

  const result = definition.schema.safeParse(raw ?? {});
  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push({
        file: shownPath,
        where: issue.path.length > 0 ? issue.path.join('.') : '(top level)',
        message: issue.message,
      });
    }
    return { value: undefined, status, problems };
  }
  return { value: result.data, status, problems };
};

/**
 * Reads and validates every config file. Each real file falls back to its example where allowed.
 * Collects every problem across all files before failing, so they can be fixed in one pass.
 */
export const loadConfig = (configDir: string): LoadedConfig => {
  const files: ConfigFileStatus[] = [];
  const problems: ConfigProblem[] = [];
  const values: Partial<Record<ConfigKey, unknown>> = {};

  for (const key of Object.keys(CONFIG_FILES) as ConfigKey[]) {
    const result = loadOne(key, CONFIG_FILES[key], configDir);
    files.push(result.status);
    problems.push(...result.problems);
    values[key] = result.value;
  }

  if (problems.length > 0) throw new ConfigError(problems, files);
  return { config: values as Config, files };
};

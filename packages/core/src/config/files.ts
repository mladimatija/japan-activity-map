import type { z } from 'zod';

import {
  privacyZonesSchema,
  routesSchema,
  secretsSchema,
  sheetSchema,
  siteOptionsSchema,
  stravaSchema,
  thresholdsSchema,
} from './schemas.ts';

export interface ConfigFileDefinition<Schema extends z.ZodType> {
  /** Base file name inside the config folder, without extension. */
  readonly fileName: string;
  readonly description: string;
  readonly schema: Schema;
  /**
   * When the real file is missing, read `<fileName>.example.jsonc` instead.
   * Off for secrets, which must never come from an example.
   */
  readonly fallbackToExample: boolean;
}

const defineConfigFile = <Schema extends z.ZodType>(
  definition: ConfigFileDefinition<Schema>,
): ConfigFileDefinition<Schema> => definition;

/** Every config file the project reads, in the order they are reported. */
export const CONFIG_FILES = {
  site: defineConfigFile({
    fileName: 'site',
    description: 'Site options and publish settings',
    schema: siteOptionsSchema,
    fallbackToExample: true,
  }),
  thresholds: defineConfigFile({
    fileName: 'thresholds',
    description: 'Matching, route grouping and privacy tolerances',
    schema: thresholdsSchema,
    fallbackToExample: true,
  }),
  privacyZones: defineConfigFile({
    fileName: 'privacy-zones',
    description: 'Places hidden from published tracks',
    schema: privacyZonesSchema,
    fallbackToExample: true,
  }),
  routes: defineConfigFile({
    fileName: 'routes',
    description: 'Route names, merges and splits',
    schema: routesSchema,
    fallbackToExample: true,
  }),
  strava: defineConfigFile({
    fileName: 'strava',
    description: 'Strava import filters',
    schema: stravaSchema,
    fallbackToExample: true,
  }),
  sheet: defineConfigFile({
    fileName: 'sheet',
    description: 'Manual activity sheet location',
    schema: sheetSchema,
    fallbackToExample: true,
  }),
  secrets: defineConfigFile({
    fileName: 'secrets',
    description: 'Strava app credentials and deploy token',
    schema: secretsSchema,
    fallbackToExample: false,
  }),
} as const;

export type ConfigKey = keyof typeof CONFIG_FILES;
export type Config = { [Key in ConfigKey]: z.infer<(typeof CONFIG_FILES)[Key]['schema']> };

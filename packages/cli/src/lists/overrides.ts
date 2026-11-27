import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { z } from 'zod';

import { LISTS_DIR } from './sources.ts';

const OVERRIDES_FILE = join(LISTS_DIR, 'overrides.jsonc');

const highpointSchema = z.strictObject({
  /** English name, for high points that are not named summits. */
  en: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

const itemCoordinateSchema = z.strictObject({
  lat: z.number().min(20).max(46),
  lon: z.number().min(122).max(154),
  /** Replaces the list's elevation, where the list's figure belongs to another top. */
  elevationM: z.number().positive().optional(),
  /** Replace the item's name, where the source names it wrongly (Wikipedia lists only). */
  ja: z.string().min(1).optional(),
  en: z.string().min(1).optional(),
  /**
   * The row of GSI's mountain list this item is (Wikipedia peak lists only): the item becomes
   * that summit, shared with every other list it is on, instead of a place of its own.
   */
  gsi: z.number().int().positive().optional(),
  /** Where the position comes from, and anything a visitor should know. */
  note: z.string().min(1),
});

export const overridesSchema = z.strictObject({
  /** Keyed by prefecture code. */
  prefectureHighpoints: z.record(z.string().regex(/^\d{2}$/), highpointSchema).prefault({}),
  /** Corrected prefectures for GSI rows, keyed by GSI serial number, as prefecture codes. */
  gsiPrefectures: z
    .record(z.string().regex(/^\d+$/), z.array(z.string().regex(/^\d{2}$/)).min(1))
    .prefault({}),
  /** Notes added to single list items, keyed by item id. */
  itemNotes: z.record(z.string(), z.string().min(1)).prefault({}),
  /**
   * Hand-checked positions for list items no source places well, keyed by item id. Read by the
   * 山梨百名山 and Wikipedia list builders, before any source.
   */
  itemCoordinates: z.record(z.string(), itemCoordinateSchema).prefault({}),
  /**
   * Names for Wikipedia list items whose source has no English label (the position is left to
   * the sources), keyed by item id.
   */
  itemNames: z.record(z.string(), z.strictObject({ en: z.string().min(1) })).prefault({}),
  /**
   * Display names for OpenStreetMap route stages, keyed by relation id, where the cleaned
   * name is still wrong (a misspelt English name, a missing translation).
   */
  routeNames: z
    .record(
      z.string().regex(/^\d+$/),
      z.strictObject({ ja: z.string().min(1).optional(), en: z.string().min(1).optional() }),
    )
    .prefault({}),
});

export type Overrides = z.infer<typeof overridesSchema>;

export const loadOverrides = (): Overrides => {
  const errors: ParseError[] = [];
  const raw: unknown = parse(readFileSync(OVERRIDES_FILE, 'utf8'), errors, {
    allowTrailingComma: true,
  });
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `lists/overrides.jsonc is not valid JSONC: ${first ? printParseErrorCode(first.error) : ''} at offset ${first?.offset}`,
    );
  }
  return overridesSchema.parse(raw ?? {});
};

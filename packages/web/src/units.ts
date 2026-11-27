/**
 * Metric or imperial. Every figure is stored, linked and filtered in metres and kilometres; this
 * only decides how a figure is shown, and where round numbers fall (slider stops, splits, records).
 *
 * Like the language in i18n.ts, the choice is a module value so plain formatters can read it; the
 * store sets it and re-renders the interface. This module imports nothing from the app.
 */
export type Units = 'metric' | 'imperial';
export const UNITS: Units[] = ['metric', 'imperial'];

export const MILE_M = 1609.344;
export const FOOT_M = 0.3048;

let current: Units = 'metric';

export const setFormatUnits = (units: Units): void => {
  current = units;
};
export const formatUnits = (): Units => current;
export const isImperial = (): boolean => current === 'imperial';

/** Metres in one distance unit as shown: a kilometre or a mile. */
export const distanceM = (): number => (current === 'imperial' ? MILE_M : 1000);
/** Metres in one height unit as shown: a metre or a foot. */
export const heightM = (): number => (current === 'imperial' ? FOOT_M : 1);

// Unit symbols are the same in every language, so they stay out of the translations.
export const distanceUnit = (): string => (current === 'imperial' ? 'mi' : 'km');
export const heightUnit = (): string => (current === 'imperial' ? 'ft' : 'm');
export const speedUnit = (): string => (current === 'imperial' ? 'mph' : 'km/h');

/** The units a first-time visitor most likely reads: imperial for US English, Liberia, Myanmar. */
export const unitsFor = (language: string | undefined): Units =>
  /^en-(US|LR)\b|^my\b/i.test(language ?? '') ? 'imperial' : 'metric';

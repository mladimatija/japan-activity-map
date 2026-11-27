import { ACTIVITY_TYPE_LABELS, type ActivityType } from '@jam/core/domain';

import { isJa, localized, locale, t } from './i18n.ts';
import { distanceM, distanceUnit, heightM, heightUnit, isImperial, speedUnit } from './units.ts';

export const typeLabel = (type: string) => t(ACTIVITY_TYPE_LABELS[type as ActivityType] ?? type);

/** A plain number, grouped the same way everywhere. */
export const numberText = (value: number, digits = 0) =>
  value.toLocaleString('en', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A distance in the visitor's units, from metres: "12.3 km" or "7.6 mi". */
export const distanceText = (metres: number | null | undefined, digits = 1) =>
  metres === null || metres === undefined
    ? '–'
    : `${numberText(metres / distanceM(), digits)} ${distanceUnit()}`;

/** A height or a climb in the visitor's units, from metres: "1,500 m" or "4,921 ft". */
export const heightText = (metres: number | null | undefined) =>
  metres === null || metres === undefined
    ? '–'
    : `${numberText(Math.round(metres / heightM()))} ${heightUnit()}`;

/** A whole distance from kilometres, for slider stops and filter chips. */
export const wholeDistance = (kilometres: number) => distanceText(kilometres * 1000, 0);

/** A rough size in words-ready form: "2 km" or "1.2 mi", "500 m" or "1,600 ft". */
export const roughly = (metres: number): string => {
  if (metres < 1000) {
    const value = metres / heightM();
    const step = value >= 1000 ? 100 : value >= 100 ? 50 : 10;
    return `${numberText(Math.round(value / step) * step)} ${heightUnit()}`;
  }
  const value = metres / distanceM();
  return `${numberText(value, value < 10 && Math.abs(value - Math.round(value)) > 0.05 ? 1 : 0)} ${distanceUnit()}`;
};

/**
 * A name written with metric figures, read in the visitor's units: a saved view called
 * "Long runs (30 km+)" reads "Long runs (19 mi+)" in imperial. Metric leaves it as written.
 */
export const withUnits = (text: string): string =>
  isImperial()
    ? text.replace(/(\d[\d,]*(?:\.\d+)?) ?(km|m)\b/g, (_, value: string, unit: string) => {
        const figure = Number(value.replaceAll(',', ''));
        return unit === 'km' ? wholeDistance(figure) : heightText(figure);
      })
    : text;

/** A moving time in hours: "45 min", "1.5 h". */
export const hoursText = (hours: number) =>
  hours < 1
    ? t('{count} min', { count: Math.round(hours * 60) })
    : t('{count} h', { count: hours });

export const yearsText = (years: number) =>
  years === 1 ? t('1 year') : t('{count} years', { count: years });

/**
 * A range in words, for a slider's value and a filter chip alike: "5–10 km", "5 km or more",
 * "Up to 10 km", or "Any" when both ends are open. A noun goes first ("Climb up to 500 m").
 */
export const rangeText = (
  range: { min: number | null; max: number | null },
  format: (value: number) => string,
  noun?: string,
): string => {
  const { min, max } = range;
  const text =
    min === null && max === null
      ? t('Any')
      : min === null
        ? t(noun ? 'up to {value}' : 'Up to {value}', { value: format(max ?? 0) })
        : max === null
          ? t('{value} or more', { value: format(min) })
          : min === max
            ? format(min)
            : `${format(min)}–${format(max)}`;
  return noun ? `${t(noun)} ${text}` : text;
};

export const duration = (seconds: number | null | undefined): string => {
  if (!seconds) return '–';
  const h = Math.floor(seconds / 3600);
  const min = Math.round((seconds % 3600) / 60);
  if (isJa()) return h ? `${h}時間${min}分` : `${min}分`;
  return h ? `${h} h ${String(min).padStart(2, '0')} min` : `${min} min`;
};

/** A pace from seconds per distance unit as shown: "5:00/km" or "8:03/mi". */
export const paceText = (secondsPerUnit: number | null | undefined): string => {
  if (!secondsPerUnit) return '–';
  // Rounded to the second first, so 4:59.7 reads 5:00, not 4:60.
  const whole = Math.round(secondsPerUnit);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}/${distanceUnit()}`;
};

/** A speed from distance units per hour: "24.5 km/h" or "15.2 mph". */
export const speedText = (unitsPerHour: number): string =>
  `${unitsPerHour.toFixed(1)} ${speedUnit()}`;

export const date = (day: string | null | undefined) =>
  day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString(locale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '–';

export const STATUS_LABELS = localized({
  done: 'Done',
  partial: 'Partly done',
  dns: 'Tried, not reached',
  want: 'Want to go',
  none: 'Not yet',
} as const);

export const THEME_LABELS: Record<string, string> = localized({
  peaks: 'Peaks',
  pilgrimage: 'Pilgrimages',
  castles: 'Castles',
  'old-highways': 'Old highways',
  'cycle-routes': 'Cycle routes',
  'long-trails': 'Long trails',
  'trail-running': 'Trail running',
  waterfalls: 'Waterfalls',
  roads: 'Roads',
  areas: 'Areas',
});

export const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '0%';

/** Pace for walking, running and hiking; speed for riding. */
export const paceOrSpeed = (
  type: string,
  metres: number,
  seconds: number | null | undefined,
): string => {
  if (!seconds || metres <= 0) return '–';
  if (type === 'ride') return speedText(metres / distanceM() / (seconds / 3600));
  return paceText(seconds / (metres / distanceM()));
};

/** A time as a clock: 4:05, or 1:04:05 past an hour. */
export const clock = (seconds: number): string => {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const min = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h ? `${h}:${String(min).padStart(2, '0')}:${s}` : `${min}:${s}`;
};

/** A round step for a chart axis: about `count` of them over `span` (1, 2, 2.5 or 5 × 10ⁿ). */
export const niceStep = (span: number, count: number): number => {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10;
  return step * power;
};

/** Great-circle distance in metres. */
export { distanceM as metresBetween } from '@jam/core/geo';

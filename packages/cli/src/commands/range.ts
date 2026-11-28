/** `--from`, `--to` and `--last`: one stretch of days to pull, this run only. */
import { JamError } from '../errors.ts';
import { utcToLocal } from '../sheet/time.ts';
import type { CommandOption } from './types.ts';

/** Days by the activity's local start, both inclusive, as YYYY-MM-DD. */
export interface PullRange {
  from?: string;
  to?: string;
}

export const RANGE_OPTIONS: Record<'from' | 'to' | 'last', CommandOption> = {
  from: {
    type: 'string',
    value: 'date',
    description: 'This run only: nothing before this day (YYYY-MM-DD)',
  },
  to: {
    type: 'string',
    value: 'date',
    description: 'This run only: nothing after this day (YYYY-MM-DD)',
  },
  last: {
    type: 'string',
    value: 'age',
    description: 'This run only: the last 30d, 6w, 3m or 1y, instead of --from',
  },
};

const DAYS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };

const day = (flag: string, value: unknown): string | undefined => {
  if (value === undefined || value === false) return undefined;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`)))
    throw new JamError(`--${flag} takes a day as YYYY-MM-DD.`);
  // Date.parse lets "2026-02-31" through as March: the day has to come back the same.
  if (new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text)
    throw new JamError(`--${flag}: ${text} is not a day in the calendar.`);
  return text;
};

/** The range the flags ask for, or undefined when none of them was given. */
export const pullRange = (
  options: Record<string, unknown>,
  timeZone: string,
  now = new Date(),
): PullRange | undefined => {
  let from = day('from', options.from);
  const to = day('to', options.to);
  if (options.last !== undefined && options.last !== false) {
    if (from) throw new JamError('Give --from or --last, not both.');
    const match = /^(\d+)\s*([dwmy])$/.exec(
      typeof options.last === 'string' ? options.last.trim() : '',
    );
    const days = match ? Number(match[1]) * (DAYS[match[2] ?? 'd'] ?? 1) : 0;
    if (!match || days <= 0) throw new JamError('--last takes an age such as 30d, 6w, 3m or 1y.');
    from = utcToLocal(new Date(now.getTime() - days * 86_400_000), timeZone).slice(0, 10);
  }
  if (from && to && from > to) throw new JamError('--from must not be after --to.');
  return from || to ? { ...(from ? { from } : {}), ...(to ? { to } : {}) } : undefined;
};

/** "2026-10-01 to 2026-10-31", "from 2026-10-01", "up to 2026-10-31". */
export const rangeText = (range: PullRange): string =>
  range.from && range.to
    ? `${range.from} to ${range.to}`
    : range.from
      ? `from ${range.from}`
      : `up to ${range.to ?? ''}`;

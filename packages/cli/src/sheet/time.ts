/** Offset in minutes of `zone` from UTC at the instant `utcMs`. */
const offsetMinutes = (zone: string, utcMs: number): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
};

/** The UTC instant of a wall-clock time in an IANA zone. */
export const zonedToUtc = (
  local: { y: number; m: number; d: number; h: number; mi: number; s: number },
  zone: string,
): Date => {
  const naive = Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s);
  // Two passes settle the offset across daylight-saving changes (Japan has none, but other zones do).
  let utc = naive - offsetMinutes(zone, naive) * 60_000;
  utc = naive - offsetMinutes(zone, utc) * 60_000;
  return new Date(utc);
};

/** Wall-clock time of a UTC instant in a zone, as YYYY-MM-DDTHH:MM:SS. */
export const utcToLocal = (date: Date, zone: string): string => {
  const local = new Date(date.getTime() + offsetMinutes(zone, date.getTime()) * 60_000);
  return local.toISOString().slice(0, 19);
};

export interface ParsedDate {
  /** UTC instant. For a date without a time, local midnight. */
  utc: Date;
  /** Local date (YYYY-MM-DD) or date-time (YYYY-MM-DDTHH:MM:SS). */
  local: string;
  hasTime: boolean;
}

const DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** Parses YYYY-MM-DD, optionally with HH:MM[:SS] and an offset. Without an offset, `zone` applies. */
export const parseDate = (text: string, zone: string): ParsedDate | undefined => {
  const match = DATE.exec(text.trim());
  if (!match) return undefined;
  const [, y, m, d, h, mi, s, offset] = match;
  const local = {
    y: Number(y),
    m: Number(m),
    d: Number(d),
    h: Number(h ?? 0),
    mi: Number(mi ?? 0),
    s: Number(s ?? 0),
  };
  const check = new Date(Date.UTC(local.y, local.m - 1, local.d));
  if (
    check.getUTCFullYear() !== local.y ||
    check.getUTCMonth() !== local.m - 1 ||
    check.getUTCDate() !== local.d
  )
    return undefined;
  if (local.h > 23 || local.mi > 59 || local.s > 59) return undefined;
  const hasTime = h !== undefined;
  let utc: Date;
  if (offset) {
    const minutes =
      offset === 'Z'
        ? 0
        : (offset.startsWith('-') ? -1 : 1) *
          (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(-2)));
    utc = new Date(
      Date.UTC(local.y, local.m - 1, local.d, local.h, local.mi, local.s) - minutes * 60_000,
    );
  } else {
    utc = zonedToUtc(local, zone);
  }
  const date = `${y}-${m}-${d}`;
  return {
    utc,
    local: hasTime ? (offset ? utcToLocal(utc, zone) : `${date}T${h}:${mi}:${s ?? '00'}`) : date,
    hasTime,
  };
};

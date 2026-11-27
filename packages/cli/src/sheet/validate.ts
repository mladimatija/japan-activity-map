import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { ActivityType, EventTag } from '@jam/core';

import { type Gpx, parseGpx } from '../gpx.ts';
import { ROOT_DIR } from '../paths.ts';
import type { RawSheet } from './read.ts';
import {
  COLUMNS,
  type RowStatus,
  isTimeZone,
  normaliseHeader,
  parseActivityType,
  parseDuration,
  parseFlag,
  parseNumber,
  parseStatus,
  parseTags,
} from './spec.ts';
import { type ParsedDate, parseDate } from './time.ts';
import { errorText } from '../errors.ts';

export interface SheetRow {
  rowId: string;
  line: number;
  date: ParsedDate;
  /** Last local day of a multi-day trip. */
  endDate?: string;
  timeZone: string;
  activityType: ActivityType;
  eventTags: EventTag[];
  name: string;
  placeRefs: string[];
  status: RowStatus;
  lat?: number;
  lon?: number;
  distanceM?: number;
  elevationGainM?: number;
  durationS?: number;
  /** As written in the sheet, and resolved against the sheet's folder. */
  gpxPath?: string;
  gpxFile?: string;
  gpx?: Gpx;
  stravaId?: number;
  showStravaLink?: boolean;
  hide?: boolean;
  notes?: string;
}

interface SheetProblem {
  /** Row in the sheet, counting the header as row 1; 1 for header problems. */
  line: number;
  column?: string;
  message: string;
}

interface Validated {
  rows: SheetRow[];
  problems: SheetProblem[];
}

const ROW_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const validateSheet = (
  sheet: RawSheet,
  sheetPath: string,
  defaultZone: string,
): Validated => {
  const problems: SheetProblem[] = [];
  const known = new Set(COLUMNS.map((column) => column.name));
  const index = new Map<string, number>();
  sheet.headers.forEach((header, i) => {
    if (header === '') return;
    const name = normaliseHeader(header);
    if (!known.has(name))
      problems.push({
        line: 1,
        column: header,
        message: `unknown column "${header}". Known columns: ${[...known].join(', ')}`,
      });
    else if (index.has(name))
      problems.push({ line: 1, column: header, message: `column "${name}" appears twice` });
    else index.set(name, i);
  });
  for (const column of COLUMNS) {
    if (column.required && !index.has(column.name))
      problems.push({
        line: 1,
        column: column.name,
        message: `required column "${column.name}" is missing`,
      });
  }
  if (problems.length > 0) return { rows: [], problems };

  const rows: SheetRow[] = [];
  const seenIds = new Map<string, number>();
  const seenStrava = new Map<number, number>();
  for (const { line, cells } of sheet.rows) {
    const cell = (name: string) => {
      const i = index.get(name);
      return i === undefined ? '' : (cells[i] ?? '');
    };
    const before = problems.length;
    const problem = (column: string, message: string) => problems.push({ line, column, message });

    const rowId = cell('row_id');
    if (rowId === '') problem('row_id', 'is empty');
    else if (!ROW_ID.test(rowId))
      problem(
        'row_id',
        `"${rowId}" may only hold letters, digits, ".", "_" and "-", up to 64 characters`,
      );
    else if (seenIds.has(rowId))
      problem('row_id', `"${rowId}" is also used on row ${seenIds.get(rowId)}`);
    else seenIds.set(rowId, line);

    const zoneText = cell('time_zone');
    const timeZone = zoneText || defaultZone;
    if (zoneText && !isTimeZone(zoneText))
      problem('time_zone', `"${zoneText}" is not an IANA time zone such as Asia/Tokyo`);
    const zone = isTimeZone(timeZone) ? timeZone : defaultZone;

    const dateText = cell('date');
    const date = dateText ? parseDate(dateText, zone) : undefined;
    if (dateText === '') problem('date', 'is empty');
    else if (!date)
      problem('date', `"${dateText}" is not a date like 2026-05-03 or 2026-05-03T06:30`);

    const endText = cell('end_date');
    let endDate: string | undefined;
    if (endText) {
      const end = parseDate(endText, zone);
      if (!end) problem('end_date', `"${endText}" is not a date like 2026-05-04`);
      else if (date && end.local.slice(0, 10) < date.local.slice(0, 10))
        problem('end_date', `${endText} is before the date ${dateText}`);
      else endDate = end.local.slice(0, 10);
    }

    const typeText = cell('activity_type');
    const activityType = parseActivityType(typeText);
    if (typeText === '') problem('activity_type', 'is empty');
    else if (!activityType)
      problem('activity_type', `"${typeText}" is not one of Hike, Walk, Run, Trail Run, Ride`);

    const { tags, unknown } = parseTags(cell('event_tags'));
    if (unknown.length > 0)
      problem(
        'event_tags',
        `unknown tag ${unknown.map((tag) => `"${tag}"`).join(', ')}; use race, training, commute, group, solo or overnight`,
      );

    const name = cell('name');
    if (name === '') problem('name', 'is empty');

    const statusText = cell('status');
    const status = parseStatus(statusText);
    if (!status) problem('status', `"${statusText}" is not one of done, DNS, repeat, want`);

    const latText = cell('lat');
    const lonText = cell('lon');
    const lat = parseNumber(latText);
    const lon = parseNumber(lonText);
    if ((latText === '') !== (lonText === ''))
      problem(latText === '' ? 'lat' : 'lon', 'give both lat and lon, or neither');
    if (latText && (lat === undefined || lat < -90 || lat > 90))
      problem('lat', `"${latText}" is not a latitude`);
    if (lonText && (lon === undefined || lon < -180 || lon > 180))
      problem('lon', `"${lonText}" is not a longitude`);

    const number = (column: string) => {
      const text = cell(column);
      if (text === '') return undefined;
      const value = parseNumber(text);
      if (value === undefined || value < 0) {
        problem(column, `"${text}" is not a positive number`);
        return undefined;
      }
      return value;
    };
    const distanceKm = number('distance_km');
    const elevationGainM = number('elevation_gain_m');

    const durationText = cell('duration');
    const durationS = durationText ? parseDuration(durationText) : undefined;
    if (durationText && durationS === undefined)
      problem('duration', `"${durationText}" is not H:MM, H:MM:SS or a number of minutes`);

    const gpxPath = cell('gpx_path');
    let gpxFile: string | undefined;
    let gpx: Gpx | undefined;
    if (gpxPath) {
      gpxFile = isAbsolute(gpxPath) ? gpxPath : resolve(dirname(sheetPath), gpxPath);
      if (!existsSync(gpxFile)) {
        problem(
          'gpx_path',
          `file not found: ${gpxPath} (looked for ${relative(ROOT_DIR, gpxFile) || gpxFile})`,
        );
      } else {
        try {
          gpx = parseGpx(readFileSync(gpxFile, 'utf8'));
        } catch (error) {
          problem('gpx_path', `${gpxPath}: ${errorText(error)}`);
        }
      }
    }

    const stravaText = cell('strava_id');
    let stravaId: number | undefined;
    if (stravaText) {
      if (!/^\d{1,19}$/.test(stravaText))
        problem('strava_id', `"${stravaText}" is not a Strava activity id (digits only)`);
      else if (seenStrava.has(Number(stravaText)))
        problem(
          'strava_id',
          `${stravaText} is also used on row ${seenStrava.get(Number(stravaText))}`,
        );
      else {
        stravaId = Number(stravaText);
        seenStrava.set(stravaId, line);
      }
    }
    if (stravaId !== undefined && status === 'want')
      problem('status', 'a row with a strava_id records an outing, so it cannot be "want"');
    if (stravaId !== undefined && gpxPath)
      problem('gpx_path', 'a row with a strava_id uses the Strava track; leave gpx_path empty');

    const flag = (column: string) => {
      const value = parseFlag(cell(column));
      if (value === 'invalid') {
        problem(column, `"${cell(column)}" is not yes or no`);
        return undefined;
      }
      return value;
    };
    const showStravaLink = flag('show_strava_link');
    const hide = flag('hide');

    const placeRefs = cell('place')
      .split(/[;；]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const notes = cell('notes');

    if (problems.length > before || !date || !activityType || !status) continue;
    rows.push({
      rowId,
      line,
      date,
      ...(endDate ? { endDate } : {}),
      timeZone: zone,
      activityType,
      eventTags: tags,
      name,
      placeRefs,
      status,
      ...(lat !== undefined && lon !== undefined ? { lat, lon } : {}),
      ...(distanceKm !== undefined ? { distanceM: Math.round(distanceKm * 1000) } : {}),
      ...(elevationGainM !== undefined ? { elevationGainM } : {}),
      ...(durationS !== undefined ? { durationS } : {}),
      ...(gpxPath ? { gpxPath } : {}),
      ...(gpxFile ? { gpxFile } : {}),
      ...(gpx ? { gpx } : {}),
      ...(stravaId !== undefined ? { stravaId } : {}),
      ...(showStravaLink !== undefined ? { showStravaLink } : {}),
      ...(hide !== undefined ? { hide } : {}),
      ...(notes ? { notes } : {}),
    });
  }
  return { rows, problems };
};

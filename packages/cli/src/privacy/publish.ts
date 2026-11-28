import type { Position, SiteOptions, Thresholds } from '@jam/core';

import { publicId } from '../store/ids.ts';
import type { Database } from '../store/sqlite.ts';
import { clipLine, type Fragment } from './clip.ts';
import { type AppliedZone, radiusFor } from './zones.ts';

export interface PublishSettings {
  site: SiteOptions;
  thresholds: Thresholds;
  zones: AppliedZone[];
  salt: string;
}

/** One activity as the public site may show it. Nothing private is in here except `stravaId`. */
export interface PublicActivity {
  /** From the salt and the Strava id (or the act_ id of a sheet row or GPX file): unguessable. */
  publicId: string;
  /** Internal, for the build and the audit; never written to the output. */
  ref: string;
  /** Internal: the store's act_ id. */
  activityId: string;
  /** Internal: the Strava id, kept only to check the output. Published only inside `link`. */
  stravaId: number | null;
  source: string;
  date: string;
  /** Local start time, only when `publish.timeOfDay` is on. */
  startLocal: string | null;
  /** Local start hour, for counts by hour; published only as totals. */
  hour: number | null;
  type: string;
  tags: string[];
  name: string;
  distanceM: number | null;
  gainM: number | null;
  movingS: number | null;
  elapsedS: number | null;
  prefectures: Record<string, { distanceM: number; gainM: number }>;
  link: string | null;
  hasGps: boolean;
  fragments: Fragment[];
  /** Had a track, but all of it was inside privacy zones: statistics only. */
  trackHidden: boolean;
  clipped: boolean;
  inHeatmap: boolean;
}

export interface ExcludedActivity {
  ref: string;
  publicId: string;
  stravaId: number | null;
  name: string | null;
  reason: string;
}

export interface Selection {
  activities: PublicActivity[];
  excluded: ExcludedActivity[];
}

interface Row {
  id: string;
  strava_id: number | null;
  source: string;
  start_time: string;
  start_local: string | null;
  time_zone: string | null;
  activity_type: string;
  event_tags: string;
  name: string | null;
  distance_m: number | null;
  elevation_gain_m: number | null;
  moving_time_s: number | null;
  elapsed_time_s: number | null;
  visibility: string | null;
  coordinates: string | null;
  elevations: string | null;
  times: string | null;
  location: string | null;
  prefectures: string | null;
  [key: string]: string | number | null;
}

const parse = <T>(text: string | null, fallback: T): T =>
  text ? (JSON.parse(text) as T) : fallback;

const refOfRow = (row: { id: string; strava_id: number | null }) =>
  row.strava_id !== null ? `strava:${row.strava_id}` : row.id;

const SOURCE_NAMES: Record<string, string> = {
  strava: 'Strava',
  gpx: 'GPX files',
  garmin: 'Garmin',
  yamap: 'YAMAP',
};

const stravaLink = (id: number) => `https://www.strava.com/activities/${id}`;

/**
 * Applies every publish rule: which activities go out, with which fields, and their tracks cut at
 * the privacy zones. The order of the checks decides the reason reported for an excluded activity.
 */
export const selectPublic = (db: Database, settings: PublishSettings): Selection => {
  const { site, thresholds, zones, salt } = settings;
  const publish = site.publish;
  const chosen: string = site.activities.source;
  const overrides = new Map<string, Map<string, unknown>>();
  for (const row of db.all<{ target_id: string; field: string; value: string }>(
    `SELECT target_id, field, value FROM overrides WHERE target_kind = 'activity'`,
  )) {
    const fields = overrides.get(row.target_id) ?? new Map<string, unknown>();
    fields.set(row.field, JSON.parse(row.value));
    overrides.set(row.target_id, fields);
  }
  const rows = db.all<Row>(
    `SELECT a.id, a.strava_id, a.source, a.start_time, a.start_local, a.time_zone, a.activity_type, a.event_tags, a.name,
            a.distance_m, a.elevation_gain_m, a.moving_time_s, a.elapsed_time_s, a.visibility,
            t.coordinates, t.elevations, t.times, l.location, l.prefectures
       FROM activities a LEFT JOIN tracks t ON t.activity_id = a.id LEFT JOIN activity_areas l ON l.activity_id = a.id
      ORDER BY a.start_time`,
  );
  const activities: PublicActivity[] = [];
  const excluded: ExcludedActivity[] = [];
  for (const row of rows) {
    const ref = refOfRow(row);
    const own = (field: string) =>
      overrides.get(ref)?.get(field) ?? overrides.get(row.id)?.get(field);
    const id = publicId(salt, ref);
    const exclude = (reason: string) =>
      excluded.push({ ref, publicId: id, stravaId: row.strava_id, name: row.name, reason });
    const hasGps = Boolean(row.coordinates);
    // The sheet's own rows always count; of the other sources, only the one the site is built from.
    if (row.source !== 'sheet' && row.source !== chosen)
      exclude(
        `from ${SOURCE_NAMES[row.source] ?? row.source}, and the site is built from ${SOURCE_NAMES[chosen] ?? chosen} (activities.source)`,
      );
    else if (own('hide') === true) exclude('hidden in the sheet');
    else if (row.visibility === 'only_me' && !publish.includeOnlyMeActivities)
      exclude('Only You on Strava');
    else if (row.location === null) exclude('not matched yet (run `pnpm jam match`)');
    else if (row.location === 'outside') exclude('outside Japan');
    else if (row.location === 'none' && !publish.activitiesWithoutGps)
      exclude('no GPS (publish.activitiesWithoutGps is off)');
    else if (row.location === 'none' && row.time_zone !== 'Asia/Tokyo')
      exclude(`no GPS, and the time zone is ${row.time_zone ?? 'unknown'}, not Asia/Tokyo`);
    if (excluded.at(-1)?.ref === ref) continue;

    const type = (own('activity_type') as string | undefined) ?? row.activity_type;
    const tags = (own('event_tags') as string[] | undefined) ?? parse<string[]>(row.event_tags, []);
    // Without a name (or with names not published) it is empty, and the site calls it by its type
    // in the reader's language.
    const name = publish.activityNames
      ? ((own('name') as string | undefined) ?? row.name ?? '')
      : '';
    const showLink =
      row.strava_id !== null &&
      ((own('show_strava_link') as boolean | undefined) ?? publish.stravaLinks);
    const local = row.start_local ?? row.start_time;

    let fragments: Fragment[] = [];
    let trackHidden = false;
    let clipped = false;
    if (row.coordinates) {
      const result = clipLine(
        parse<Position[]>(row.coordinates, []),
        zones.map((zone) => ({ centre: zone.centre, radiusM: radiusFor(zone, ref, salt) })),
        thresholds.privacy.minFragmentM,
        {
          elevations: parse<number[] | null>(row.elevations, null),
          times: parse<string[] | null>(row.times, null),
        },
      );
      fragments = result.fragments;
      trackHidden = result.hidden;
      clipped = result.clipped;
      // The build publishes only seconds from each stretch's start (no clock times), and only
      // when pace along tracks is on; otherwise the times go no further than here.
      if (!publish.paceAlongTracks)
        fragments = fragments.map((fragment) => ({ ...fragment, times: null }));
    }
    activities.push({
      publicId: id,
      ref,
      activityId: row.id,
      stravaId: row.strava_id,
      source: row.source,
      date: local.slice(0, 10),
      startLocal: publish.timeOfDay ? local.slice(0, 16) : null,
      hour: local.length >= 13 && local[10] === 'T' ? Number(local.slice(11, 13)) : null,
      type,
      tags,
      name,
      distanceM: row.distance_m,
      gainM: row.elevation_gain_m,
      movingS: row.moving_time_s,
      elapsedS: row.elapsed_time_s,
      prefectures: parse(row.prefectures, {}),
      link: showLink && row.strava_id !== null ? stravaLink(row.strava_id) : null,
      hasGps,
      fragments,
      trackHidden,
      clipped,
      inHeatmap: publish.commutesInHeatmap || !tags.includes('commute'),
    });
  }
  return { activities, excluded };
};

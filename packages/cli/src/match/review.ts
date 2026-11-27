import { join } from 'node:path';

import type { Thresholds } from '@jam/core';
import { PREFECTURES } from '@jam/core';

import type { Logger } from '../logger.ts';
import { DATA_DIR } from '../paths.ts';
import type { Database } from '../store/sqlite.ts';
import type { Catalog } from './catalog.ts';
import type { ListProgress } from './status.ts';
import { writeFileAtomic } from '../files.ts';

export const MATCH_REVIEW_FILE = join(DATA_DIR, 'match-review.md');

interface ReviewLine {
  activity: string;
  target: string;
  detail: string;
}

interface Review {
  locations: Record<'japan' | 'outside' | 'none' | 'unmatched', number>;
  recentOutside: { day: string; name: string; source: string }[];
  prefecturesVisited: number;
  newMatches: ReviewLine[];
  uncertain: ReviewLine[];
  ignored: ReviewLine[];
}

const km = (metres: number) => `${(metres / 1000).toFixed(1)} km`;

const activityLabel = (row: {
  day: string;
  name: string | null;
  source: string;
  strava_id: number | null;
  id: string;
}) => {
  const ref = row.strava_id !== null ? `strava ${row.strava_id}` : row.id;
  return `${row.day} ${row.name ?? '(no name)'} (${ref})`;
};

export const buildReview = (
  db: Database,
  catalog: Catalog,
  thresholds: Thresholds,
  runStartedAt: string | undefined,
): Review => {
  const names = new Map<string, string>();
  for (const place of catalog.places.values())
    names.set(place.id, `${place.name.ja} (${place.name.en})`);
  for (const item of catalog.routeItems) names.set(item.id, `${item.name.ja}`);
  const locations: Review['locations'] = { japan: 0, outside: 0, none: 0, unmatched: 0 };
  for (const row of db.all<{ location: string | null; n: number }>(
    `SELECT l.location, COUNT(*) AS n FROM activities a LEFT JOIN activity_areas l ON l.activity_id = a.id GROUP BY l.location`,
  )) {
    const key = (row.location ?? 'unmatched') as keyof Review['locations'];
    locations[key] = Number(row.n);
  }
  const recentOutside = db
    .all<{ day: string; name: string | null; source: string }>(
      `SELECT substr(coalesce(a.start_local, a.start_time), 1, 10) AS day, a.name, a.source FROM activities a JOIN activity_areas l ON l.activity_id = a.id
      WHERE l.location = 'outside' ORDER BY a.start_time DESC LIMIT 5`,
    )
    .map((row) => ({ day: row.day, name: row.name ?? '(no name)', source: row.source }));
  const visited = new Set<string>();
  for (const row of db.all<{ prefectures: string }>(`SELECT prefectures FROM activity_areas`)) {
    for (const code of Object.keys(JSON.parse(row.prefectures) as object)) visited.add(code);
  }

  const matchRows = db.all<{
    id: string;
    strava_id: number | null;
    day: string;
    name: string | null;
    source: string;
    target_kind: string;
    target_id: string;
    distance_m: number | null;
    covered_m: number | null;
    matched: number;
    uncertain: number;
    first_seen_at: string;
  }>(
    `SELECT a.id, a.strava_id, substr(coalesce(a.start_local, a.start_time), 1, 10) AS day, a.name, a.source,
            m.target_kind, m.target_id, m.distance_m, m.covered_m, m.matched, m.uncertain, m.first_seen_at
       FROM matches m JOIN activities a ON a.id = m.activity_id ORDER BY a.start_time DESC`,
  );
  const ignoredBy = new Map<string, Set<string>>();
  for (const row of db.all<{ target_id: string; value: string }>(
    `SELECT target_id, value FROM overrides WHERE target_kind = 'activity' AND field = 'ignore_matches'`,
  )) {
    ignoredBy.set(row.target_id, new Set(JSON.parse(row.value) as string[]));
  }
  const isIgnored = (row: (typeof matchRows)[number]) =>
    ignoredBy.get(row.id)?.has(row.target_id) ||
    (row.strava_id !== null && ignoredBy.get(`strava:${row.strava_id}`)?.has(row.target_id));
  const radius = (placeId: string) =>
    catalog.places.get(placeId)?.radiusM ?? thresholds.matching.pointRadiusM;
  const line = (row: (typeof matchRows)[number]): ReviewLine => ({
    activity: activityLabel(row),
    target: `${names.get(row.target_id) ?? row.target_id} [${row.target_id}]`,
    detail:
      row.target_kind === 'place'
        ? `${Math.round(row.distance_m ?? 0)} m from the summit point (radius ${radius(row.target_id)} m)`
        : `${km(row.covered_m ?? 0)} covered`,
  });
  return {
    locations,
    recentOutside,
    prefecturesVisited: visited.size,
    newMatches: runStartedAt
      ? matchRows
          .filter((row) => row.matched && row.first_seen_at === runStartedAt && !isIgnored(row))
          .map(line)
      : [],
    uncertain: matchRows
      .filter((row) => row.uncertain && !isIgnored(row))
      .map((row) => ({
        ...line(row),
        detail: `${line(row).detail}; ${row.matched ? 'counted' : 'not counted'}, summary track only.${row.strava_id !== null ? ` Fetch the full track: pnpm jam sync strava --streams ${row.strava_id}` : ''}`,
      })),
    ignored: matchRows.filter((row) => isIgnored(row)).map(line),
  };
};

/** The new and uncertain matches, line by line, for `--report`. */
export const logReview = (log: Logger, review: Pick<Review, 'newMatches' | 'uncertain'>): void => {
  for (const [title, rows] of [
    ['New matches', review.newMatches],
    ['Uncertain matches', review.uncertain],
  ] as const) {
    log.info(`${title}:${rows.length === 0 ? ' none' : ''}`);
    for (const row of rows) log.info(`  ${row.activity}: ${row.target}, ${row.detail}`);
  }
};

export const writeReview = (
  progress: ListProgress[],
  review: Review,
  runStartedAt: string,
): void => {
  const lines = [
    '# Match review',
    '',
    `Written by \`pnpm jam match\` at ${runStartedAt.slice(0, 16).replace('T', ' ')} UTC. Regenerated on every run.`,
    '',
    '## Lists',
    '',
    '| List | Done | Partly | DNS | Want | Items | Covered |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...progress.map(
      (list) =>
        `| ${list.title.ja} (${list.id}) | ${list.counts.done} | ${list.kind === 'route' ? list.counts.partial : ''} | ${list.counts.dns} | ${list.counts.want} | ${list.items.length} | ${list.kind === 'route' ? `${km(list.coveredM ?? 0)} of ${km(list.lengthM ?? 0)}` : ''} |`,
    ),
    '',
    '## Where activities were',
    '',
    `In Japan: ${review.locations.japan}. Outside Japan: ${review.locations.outside}. No location (no track and no coordinates): ${review.locations.none}.`,
    `Prefectures with distance recorded: ${review.prefecturesVisited} of ${PREFECTURES.length}.`,
    '',
    ...(review.recentOutside.length > 0
      ? [
          'Most recent outside Japan, to check the tag:',
          '',
          ...review.recentOutside.map((row) => `- ${row.day} ${row.name} (${row.source})`),
          '',
        ]
      : []),
    '## New matches in this run',
    '',
    ...(review.newMatches.length > 0
      ? review.newMatches.map((row) => `- ${row.activity}: ${row.target}, ${row.detail}`)
      : ['None.']),
    '',
    '## Uncertain matches',
    '',
    'The track came within the uncertainty margin of the radius, and only the simplified summary track was available.',
    'Mark a false match with `pnpm jam match ignore <activity> <place id>`; a full track settles it either way.',
    '',
    ...(review.uncertain.length > 0
      ? review.uncertain.map((row) => `- ${row.activity}: ${row.target}, ${row.detail}`)
      : ['None.']),
    '',
    '## Ignored matches',
    '',
    ...(review.ignored.length > 0
      ? review.ignored.map((row) => `- ${row.activity}: ${row.target}, ${row.detail}`)
      : ['None.']),
    '',
  ];
  writeFileAtomic(MATCH_REVIEW_FILE, lines.join('\n'));
};

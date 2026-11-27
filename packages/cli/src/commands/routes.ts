import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeFileAtomic } from '../files.ts';
import { LISTS_DIR } from '../lists/sources.ts';
import { DATA_DIR, shownPath } from '../paths.ts';
import { loadRoutes, type Route } from '../routes/group.ts';
import { type Grouped, nameOf, regroup } from '../routes/regroup.ts';
import { type Candidate, candidates, duration, pace, statsOf } from '../routes/summary.ts';
import { openStore } from '../store/store.ts';
import { configFor } from './config.ts';
import type { CommandContext } from './types.ts';

const ROUTES_REVIEW_FILE = join(DATA_DIR, 'routes-review.md');
/** Merge and split candidates as data (local, never published). */
export const ROUTES_CANDIDATES_FILE = join(DATA_DIR, 'routes-candidates.json');

const line = (grouped: Grouped, route: Route): string => {
  const stats = statsOf(route, grouped.activities);
  const reversed = stats.reversed ? `, ${stats.reversed} reversed` : '';
  const dates =
    stats.first === stats.latest ? (stats.first ?? '') : `${stats.first} to ${stats.latest}`;
  const varies = Boolean(
    stats.minDistanceM && stats.maxDistanceM && stats.maxDistanceM > stats.minDistanceM * 1.05,
  );
  const range = varies
    ? `, ${((stats.minDistanceM ?? 0) / 1000).toFixed(1)} to ${((stats.maxDistanceM ?? 0) / 1000).toFixed(1)} km`
    : '';
  // With laps the distances differ, so times do not compare; pace does.
  const times = !stats.fastestS
    ? ''
    : varies
      ? `, best pace ${pace(stats.bestPaceS)}, median ${pace(stats.medianPaceS)}`
      : `, fastest ${duration(stats.fastestS)}, median ${duration(stats.medianS)}`;
  const variant = route.variantOf ? `, variant of ${route.variantOf}` : '';
  return `${nameOf(grouped, route)}: ${stats.count}×${reversed}, ${dates}${range}${times}${variant} [${route.id}]`;
};

const writeReview = (grouped: Grouped, found: { merge: Candidate[]; split: Candidate[] }): void => {
  const sorted = grouped.routes.toSorted(
    (a, b) => statsOf(b, grouped.activities).count - statsOf(a, grouped.activities).count,
  );
  const label = (id: string) => {
    const route = grouped.routes.find((candidate) => candidate.id === id);
    return route ? `${nameOf(grouped, route)} [${id}]` : id;
  };
  const members = (route: Route) =>
    [...route.members.keys()].map((ref) => {
      const activity = grouped.activities.get(ref);
      return activity
        ? `${activity.day} ${activity.name ?? ''} (${ref.replace('strava:', '')})`
        : `${ref.replace('strava:', '')} (not in the store)`;
    });
  const text = [
    '# Routes review',
    '',
    `Written by \`pnpm jam routes\` at ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Regenerated on every run.`,
    'Rename, merge or split routes in `config/routes.jsonc`, naming activities by their Strava id (or act_ id).',
    '',
    '## Merge candidates',
    '',
    ...(found.merge.length
      ? found.merge.map((c) => `- ${c.routes.map(label).join(' and ')}: ${c.reason}`)
      : ['None.']),
    '',
    '## Split candidates',
    '',
    ...(found.split.length
      ? found.split.map((c) => `- ${c.routes.map(label).join(', ')}: ${c.reason}`)
      : ['None.']),
    '',
    '## All routes',
    '',
    ...sorted.flatMap((route) => [
      `### ${line(grouped, route)}`,
      '',
      ...members(route).map((member) => `- ${member}`),
      '',
    ]),
  ];
  writeFileAtomic(ROUTES_REVIEW_FILE, text.join('\n'));
  // The same candidates as data, for the setup wizard to offer one by one. Each route is named
  // by one of its activities, as config/routes.jsonc names them.
  const described = (candidate: Candidate) => ({
    reason: candidate.reason,
    routes: candidate.routes.flatMap((id) => {
      const route = grouped.routes.find((entry) => entry.id === id);
      const ref = route ? [...route.members.keys()][0] : undefined;
      return route && ref
        ? [
            {
              name: nameOf(grouped, route),
              count: statsOf(route, grouped.activities).count,
              ref: ref.replace('strava:', ''),
            },
          ]
        : [];
    }),
  });
  writeFileAtomic(
    ROUTES_CANDIDATES_FILE,
    `${JSON.stringify({ merge: found.merge.map(described), split: found.split.map(described) }, null, 1)}\n`,
  );
};

const run = async (
  context: CommandContext,
  mode: 'group' | 'review' | 'regroup',
): Promise<number> => {
  const { log, flags, options } = context;
  const config = configFor(context);
  if (!config) return 1;
  if (!existsSync(join(LISTS_DIR, 'places.geojson'))) {
    log.error('The reference lists are not built. Run `pnpm jam lists build` first.');
    return 1;
  }
  const store = await openStore(log);
  try {
    const before = loadRoutes(store.db);
    const grouped = regroup(
      store,
      config.thresholds,
      config.routes,
      mode === 'regroup',
      flags.dryRun,
      log,
    );
    // Routes whose representative is in Japan, from `jam match`; the review covers those unless --all.
    const japan = new Set(
      store.db
        .all<{ id: string; strava_id: number | null }>(
          `SELECT a.id, a.strava_id FROM activities a JOIN activity_areas l ON l.activity_id = a.id WHERE l.location = 'japan'`,
        )
        .map((row) => (row.strava_id !== null ? `strava:${row.strava_id}` : row.id)),
    );
    const scoped = options.all !== true && japan.size > 0;
    const unmatched = Number(
      store.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM activities a LEFT JOIN activity_areas l ON l.activity_id = a.id WHERE l.activity_id IS NULL',
      )?.n ?? 0,
    );
    if (unmatched > 0) {
      log.warn(
        `${unmatched} activities are not matched yet. Run \`pnpm jam match\` first: it tells which are in Japan, which this review and list focus on, and which places a route reaches, for its name.`,
      );
    }
    const found = candidates(
      grouped.routes,
      grouped.activities,
      config.thresholds,
      scoped ? japan : undefined,
    );
    if (!flags.dryRun) writeReview(grouped, found);
    const would = flags.dryRun ? 'would be ' : '';
    if (mode === 'regroup') {
      const kept = grouped.routes.filter((route) =>
        before.some((old) => old.id === route.id),
      ).length;
      log.info(
        `Regrouped from scratch: ${before.length} routes before, ${grouped.routes.length} ${would}after; ${kept} kept their ids${grouped.merged ? `; ${grouped.merged} merged once their representatives settled` : ''}.`,
      );
    } else {
      log.info(
        `${grouped.routes.length} routes from ${grouped.activities.size} activities with a track: ${grouped.joined} ${would}added to existing routes, ${grouped.created} new routes${grouped.variants ? ` (${grouped.variants} variants)` : ''}${grouped.merged ? `, ${grouped.merged} routes merged into one that now matches` : ''}.`,
      );
    }
    if (grouped.withoutTrack)
      log.info(`${grouped.withoutTrack} activities have no track and are not grouped.`);
    if (mode === 'review') {
      const label = (id: string) => {
        const route = grouped.routes.find((candidate) => candidate.id === id);
        return route ? `${nameOf(grouped, route)} [${id}]` : id;
      };
      const where = scoped ? ' in Japan (--all for every route)' : '';
      for (const [title, list] of [
        ['Merge candidates', found.merge],
        ['Split candidates', found.split],
      ] as const) {
        log.info(
          `${title}${where}: ${list.length === 0 ? 'none' : list.length}${list.length > 15 ? ', the 15 most alike' : ''}`,
        );
        for (const candidate of list.slice(0, 15))
          log.info(`  ${candidate.routes.map(label).join(' + ')}: ${candidate.reason}`);
      }
    } else {
      const repeated = [...grouped.routes]
        .filter((route) => !scoped || japan.has(route.representativeRef))
        .map((route) => ({ route, count: statsOf(route, grouped.activities).count }))
        .filter((entry) => options.all === true || entry.count > 1)
        .sort((a, b) => b.count - a.count);
      const shown = options.all === true ? repeated : repeated.slice(0, 10);
      if (shown.length)
        log.info(
          options.all === true
            ? 'Routes:'
            : `Most repeated${scoped ? ' in Japan (--all for every route)' : ''}:`,
        );
      for (const { route } of shown) log.info(`  ${line(grouped, route)}`);
      if (found.merge.length || found.split.length)
        log.info(
          `${found.merge.length} merge and ${found.split.length} split candidates${scoped ? ' in Japan' : ''}: \`pnpm jam routes review\`.`,
        );
    }
    if (!flags.dryRun) log.info(`Details in ${shownPath(ROUTES_REVIEW_FILE)}.`);
    return 0;
  } finally {
    store.close();
  }
};

export const routes = (context: CommandContext) => run(context, 'group');
export const routesReview = (context: CommandContext) => run(context, 'review');
export const routesRegroup = (context: CommandContext) => run(context, 'regroup');

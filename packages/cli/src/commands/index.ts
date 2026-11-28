import { backup } from './backup.ts';
import { demoCommand } from './demo.ts';
import { deployCommand } from './deploy.ts';
import { currentStoreMarker, demoRefusal } from '../demo/marker.ts';
import { listsBuild, listsFetch, listsValidate } from './lists.ts';
import { gpxWipe, syncGpx } from './gpx.ts';
import { syncSheet } from './sheet.ts';
import { buildCommand } from './build.ts';
import { match, matchIgnore } from './match.ts';
import { auditCommand, zonesCommand } from './privacy.ts';
import { routes, routesRegroup, routesReview } from './routes.ts';
import { stravaAuth, stravaWipe, syncStrava } from './strava.ts';
import { scheduleCommand } from './schedule.ts';
import { setupCommand } from './setup.ts';
import { status } from './status.ts';
import type { Command } from './types.ts';
import { updateCommand } from './update.ts';

/** A command that never runs against the demo store: made-up data is not published. */
const refuseOnDemo = (command: Command): Command => ({
  ...command,
  run: (context) => {
    if (!currentStoreMarker()) return command.run(context);
    context.log.error(demoRefusal(`"${command.name}" does not run on it`));
    return 1;
  },
});

/** Every command, in the order shown in help. */
export const COMMANDS: readonly Command[] = [
  { name: 'status', summary: 'Show config, local store and sync state', run: status },
  {
    name: 'strava auth',
    summary: 'Sign in to Strava and store the refresh token',
    run: stravaAuth,
  },
  {
    name: 'sync strava',
    summary: 'Fetch Strava activities since the last pull',
    options: {
      'if-stale': {
        type: 'string',
        value: 'age',
        description: 'Only pull when the last pull is older than this (7d, 12h)',
      },
      streams: {
        type: 'string',
        value: 'ids',
        description: 'Fetch full tracks instead: "missing" or Strava ids, comma-separated',
      },
      limit: {
        type: 'string',
        value: 'n',
        description: 'With --streams: at most this many activities (default 25)',
      },
    },
    run: syncStrava,
  },
  {
    name: 'sync sheet',
    summary: 'Import the manual activity sheet into the local store',
    args: {
      usage: '[file]',
      help: [
        'Reads the sheet set in config/sheet.jsonc (default data/activities.csv), or the file given.',
        'CSV or .xlsx; the columns are described in templates/README.md. Every row is checked first:',
        'if any row has a problem, nothing is imported.',
      ].join('\n'),
    },
    run: syncSheet,
  },
  {
    name: 'sync gpx',
    summary: 'Import GPX files from a folder or a .zip into the local store',
    args: {
      usage: '[path]',
      help: [
        'Reads a folder (subfolders and .zip archives in it included) or one .zip archive. Without a',
        'path: data/activities, or the folder set as activities.gpx.folder in config/site.jsonc.',
        'One file is one activity, recognised by its start time, so importing it again updates it.',
        'A file that cannot be read is reported and skipped. See docs/gpx.md.',
      ].join('\n'),
    },
    options: {
      replace: {
        type: 'boolean',
        description: 'Also remove GPX activities that are not in this import (store copied first)',
      },
    },
    run: syncGpx,
  },
  {
    name: 'gpx wipe',
    summary: 'Delete GPX activities from the local store, keeping everything else',
    options: {
      yes: {
        type: 'boolean',
        description: 'Really delete (the store is copied to data/backups first)',
      },
    },
    run: gpxWipe,
  },
  {
    name: 'strava wipe',
    summary: 'Delete Strava activities from the local store, keeping manual data',
    options: {
      yes: {
        type: 'boolean',
        description: 'Really delete (the store is copied to data/backups first)',
      },
    },
    run: stravaWipe,
  },
  {
    name: 'lists fetch',
    summary: 'Download the reference sources that need the network into lists/sources',
    args: {
      usage:
        '[gsi] [highpoints] [wikidata] [wikipedia] [osm] [moe] [gokaido] [outlines] [municipalities]',
      help: "Sources to fetch (default: all). gsi: GSI mountain list CSV. highpoints: coordinates in GSI's\nprefectural high-point table. wikidata: the two Kannon circuits. wikipedia: 山梨百名山, the temple and castle lists, 花の百名山,\n関東百名山, 関西百名山 and 日本の滝百選.\nosm: cycle routes, long trails and Yamanashi peaks from OpenStreetMap (slow: several minutes).\nmoe: 東海自然歩道 GPX. gokaido: 五街道 GPX. outlines: each prefecture's outline in full detail\n(about 500 MB to download, a few minutes). municipalities: every 市区町村 with its outline\nand English name, for the municipality list.",
    },
    run: listsFetch,
  },
  {
    name: 'lists build',
    summary: 'Build the reference lists from lists/sources and lists/overrides.jsonc',
    run: listsBuild,
  },
  {
    name: 'lists validate',
    summary: 'Check the reference list files',
    run: listsValidate,
  },
  {
    name: 'match',
    summary: 'Match activities to list places, routes and prefectures',
    options: {
      report: { type: 'boolean', description: 'Print new and uncertain matches' },
      force: { type: 'boolean', description: 'Recompute every activity, ignoring the cache' },
    },
    run: match,
  },
  {
    name: 'match ignore',
    summary: 'Mark an automatic match as false (a road under a summit)',
    args: {
      usage: '<activity> <place or route item id>',
      help: 'The activity is its Strava id or its act_ id.',
    },
    options: { undo: { type: 'boolean', description: 'Stop ignoring it' } },
    run: matchIgnore,
  },
  {
    name: 'routes',
    summary: 'Group repeated activities into routes',
    options: {
      all: {
        type: 'boolean',
        description: 'List every route, outside Japan too, not just the most repeated',
      },
    },
    run: routes,
  },
  {
    name: 'routes review',
    summary: 'List routes that may need merging or splitting',
    options: {
      all: { type: 'boolean', description: 'Review every route, not just those in Japan' },
    },
    run: routesReview,
  },
  {
    name: 'routes regroup',
    summary: 'Regroup every route from scratch, keeping names and ids',
    run: routesRegroup,
  },
  {
    name: 'build',
    summary: 'Build the public site data into dist/data',
    options: {
      report: { type: 'boolean', description: 'Also print new and uncertain matches' },
      force: { type: 'boolean', description: 'Recompute every match, ignoring the cache' },
      out: { type: 'string', value: 'folder', description: 'Write somewhere else than dist/data' },
    },
    run: buildCommand,
  },
  {
    name: 'audit',
    summary: 'Check the build output for anything that must not be published',
    args: { usage: '[folder]', help: 'The folder to check (default: dist).' },
    run: auditCommand,
  },
  {
    name: 'zones',
    summary: 'Show what the privacy zones and publish rules do, without showing where zones are',
    options: {
      preview: {
        type: 'boolean',
        description: 'Write the cut tracks to data/privacy-preview.geojson',
      },
    },
    run: zonesCommand,
  },
  refuseOnDemo({
    name: 'deploy',
    summary: 'Audit dist/ and upload it to Cloudflare Pages, Netlify or GitHub Pages',
    options: {
      create: { type: 'boolean', description: 'Create the project first (Cloudflare, Netlify)' },
      branch: {
        type: 'string',
        value: 'name',
        description: 'Upload as a preview under this name, leaving the public site alone',
      },
      dir: { type: 'string', value: 'folder', description: 'Upload another folder than dist' },
    },
    run: deployCommand,
  }),
  {
    name: 'update',
    summary: 'Sync, group, build and deploy in one go: the weekly run',
    options: {
      'no-sync': { type: 'boolean', description: 'Build from what is already in the store' },
      'no-deploy': { type: 'boolean', description: 'Stop after building' },
    },
    run: (context) => updateCommand(context, (name) => findCommand(name)?.command),
  },
  {
    name: 'schedule',
    summary: 'Write a weekly job that runs `jam update`, for you to install',
    options: {
      day: { type: 'string', value: 'day', description: 'Day of the week (default sun)' },
      at: { type: 'string', value: 'hh:mm', description: 'Time of day (default 06:30)' },
      cron: { type: 'boolean', description: 'Print a crontab line instead of a launchd job' },
    },
    run: scheduleCommand,
  },
  { name: 'backup', summary: 'Copy the local store to data/backups', run: backup },
  {
    name: 'demo',
    summary: 'Make and build made-up demo data in data/demo, apart from your own',
    options: {
      seed: {
        type: 'string',
        value: 'n',
        description: 'Seed for the made-up history (default fixed)',
      },
      until: {
        type: 'string',
        value: 'date',
        description: 'Last day of the history (default today)',
      },
      years: { type: 'string', value: 'n', description: 'Years of history (default 5)' },
      lang: {
        type: 'string',
        value: 'en|ja',
        description: 'Language of activity names (default en)',
      },
      clear: { type: 'boolean', description: 'Delete the demo data instead' },
    },
    run: demoCommand,
  },
  setupCommand,
];

/** Matches the longest command name at the start of the positional arguments. */
export const findCommand = (
  positionals: readonly string[],
): { command: Command; rest: string[] } | undefined => {
  for (const length of [2, 1]) {
    const name = positionals.slice(0, length).join(' ');
    const command = COMMANDS.find((candidate) => candidate.name === name);
    if (command && positionals.length >= length) {
      return { command, rest: positionals.slice(length) };
    }
  }
  return undefined;
};

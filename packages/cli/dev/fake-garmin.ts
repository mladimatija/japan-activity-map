/**
 * A stand-in for the Garmin Connect Personal API, for trying `jam sync garmin` without a key or
 * the network. It serves made-up activities around Tokyo Station: the token exchange, the paged
 * activity list and each activity's file, zipped as Garmin sends it. See dev/README.md.
 *
 *   node packages/cli/dev/fake-garmin.ts [--port 8726]
 *
 * The key it accepts is "good-key". POST /__control with JSON changes its behaviour:
 *   { "limitFilesAfter": 2 }   answer 429 to file downloads after this many more
 *   { "add": "Evening run" }   add a run dated now
 *   { "remove": 5001 }         drop an activity
 *   { "rename": 5001 }         change an activity's name
 *   { "expireTokens": true }   forget every token handed out
 * GET /__stats says how many requests of each kind it answered.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';

import { fitFile, type FitPoint } from './fit-writer.ts';
import { makeZip } from './zip-writer.ts';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8726' } } });
const port = Number(values.port);
const KEY = 'good-key';

interface Fake {
  id: number;
  name: string;
  typeKey: string;
  /** UTC start. */
  start: number;
  privacy: 'public' | 'private';
  event?: string;
  /** Metres east of Tokyo Station where the line starts; undefined for an indoor session. */
  east?: number;
}

const DAY = 86_400_000;
const BASE = Date.parse('2025-03-01T00:00:00Z');
const activities: Fake[] = [
  { id: 5001, name: 'Morning hike', typeKey: 'hiking', start: BASE, privacy: 'public', east: 0 },
  {
    id: 5002,
    name: 'Trail loop',
    typeKey: 'trail_running',
    start: BASE + 10 * DAY,
    privacy: 'public',
    east: 400,
  },
  {
    id: 5003,
    name: 'City 10 km',
    typeKey: 'running',
    start: BASE + 20 * DAY,
    privacy: 'public',
    event: 'race',
    east: 800,
  },
  {
    id: 5004,
    name: 'Bay ride',
    typeKey: 'cycling',
    start: BASE + 30 * DAY,
    privacy: 'public',
    east: 1200,
  },
  { id: 5005, name: 'Yoga', typeKey: 'yoga', start: BASE + 31 * DAY, privacy: 'public' },
  {
    id: 5006,
    name: 'Quiet hike',
    typeKey: 'hiking',
    start: BASE + 40 * DAY,
    privacy: 'private',
    east: 1600,
  },
  {
    id: 5007,
    name: 'Treadmill',
    typeKey: 'treadmill_running',
    start: BASE + 50 * DAY,
    privacy: 'public',
  },
  {
    id: 5008,
    name: 'Evening walk',
    typeKey: 'walking',
    start: BASE + 60 * DAY,
    privacy: 'public',
    east: 2000,
  },
];
let nextId = 6000;

const M_LON = 1 / 90_600;
const points = (activity: Fake): FitPoint[] =>
  Array.from({ length: 40 }, (_, i) => ({
    lon: 139.7671 + ((activity.east ?? 0) + i * 25) * M_LON,
    lat: 35.6812 + Math.sin(i / 6) * 0.0004,
    ele: 5 + i,
    time: new Date(activity.start + i * 20_000).toISOString(),
  }));
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const JST = 9 * 3_600_000;

const summary = (activity: Fake) => {
  const track = activity.east === undefined ? undefined : points(activity);
  return {
    activityId: activity.id,
    activityName: activity.name,
    startTimeLocal: stamp(activity.start + JST),
    startTimeGMT: stamp(activity.start),
    activityType: { typeId: 1, typeKey: activity.typeKey },
    eventType: { typeKey: activity.event ?? 'uncategorized' },
    privacy: { typeKey: activity.privacy },
    distance: track ? 975.4 : 5000,
    duration: 780.2,
    elapsedDuration: 800,
    movingDuration: 770.6,
    elevationGain: track ? 39 : null,
    hasPolyline: track !== undefined,
    startLatitude: track?.[0]?.lat ?? null,
    startLongitude: track?.[0]?.lon ?? null,
  };
};

const tokens = new Set<string>();
let limitFilesAfter: number | undefined;
const stats = { token: 0, list: 0, file: 0, refused: 0 };

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
) => {
  // No kept-alive sockets: a check that pauses between calls must not find its socket closed.
  response.writeHead(status, { 'Content-Type': type, Connection: 'close' });
  response.end(type === 'application/json' ? JSON.stringify(body) : (body as Buffer));
};
const body = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => resolve(text));
  });

let plain = false;
const refused = new Set<number>();

createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/__stats') return send(response, 200, stats);
    if (url.pathname === '/__control') {
      const change = JSON.parse((await body(request)) || '{}') as Record<string, unknown>;
      if (typeof change.limitFilesAfter === 'number') limitFilesAfter = change.limitFilesAfter;
      if (change.limitFilesAfter === null) limitFilesAfter = undefined;
      if (typeof change.add === 'string')
        activities.push({
          id: nextId++,
          name: change.add,
          typeKey: 'running',
          start: Date.now() - 3_600_000,
          privacy: 'public',
          east: 2400,
        });
      if (typeof change.remove === 'number') {
        const at = activities.findIndex((activity) => activity.id === change.remove);
        if (at >= 0) activities.splice(at, 1);
      }
      if (typeof change.rename === 'number') {
        const found = activities.find((activity) => activity.id === change.rename);
        if (found) found.name = `${found.name} (renamed)`;
      }
      if (change.expireTokens === true) tokens.clear();
      if (typeof change.plain === 'boolean') plain = change.plain;
      if (typeof change.refuseFile === 'number') refused.add(change.refuseFile);
      if (typeof change.hide === 'number') {
        const found = activities.find((activity) => activity.id === change.hide);
        if (found) found.privacy = 'private';
      }
      return send(response, 200, { ok: true });
    }
    if (url.pathname === '/personalapitoken-service/personal-api/personal-api-key/token') {
      if (request.method !== 'POST' || request.headers.authorization !== `ApiKey ${KEY}`) {
        stats.refused++;
        return send(response, 401, { error: 'invalid key' });
      }
      stats.token++;
      const token = `token-${tokens.size + 1}-${Date.now()}`;
      tokens.add(token);
      // The plain form: a token as text, and no answer at all to a caller that insists on JSON.
      if (plain) {
        if (!/\*\/\*|text\/plain/.test(request.headers.accept ?? ''))
          return send(response, 406, { error: 'not acceptable' });
        return send(response, 200, Buffer.from(token), 'text/plain');
      }
      return send(response, 200, { access_token: token, token_type: 'Bearer', expires_in: 86_400 });
    }
    const bearer = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    if (!bearer || !tokens.has(bearer)) {
      stats.refused++;
      return send(response, 401, { error: 'token is not active' });
    }
    if (url.pathname === '/activitylist-service/activities/search/activities') {
      stats.list++;
      const start = Number(url.searchParams.get('start') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '99');
      const from = url.searchParams.get('startDate');
      const until = url.searchParams.get('endDate');
      const day = (activity: Fake) => stamp(activity.start + JST).slice(0, 10);
      const matching = activities
        .filter(
          (activity) => (!from || day(activity) >= from) && (!until || day(activity) <= until),
        )
        .toSorted((a, b) => a.start - b.start);
      return send(response, 200, matching.slice(start, start + limit).map(summary));
    }
    const file = /^\/download-service\/files\/activity\/(\d+)$/.exec(url.pathname);
    if (file) {
      if (limitFilesAfter !== undefined && limitFilesAfter-- <= 0)
        return send(response, 429, { error: 'too many requests' });
      stats.file++;
      if (refused.has(Number(file[1]))) return send(response, 403, { error: 'forbidden' });
      const activity = activities.find((entry) => entry.id === Number(file[1]));
      if (!activity || activity.east === undefined)
        return send(response, 404, { error: 'no file' });
      const sport =
        {
          hiking: 'hiking',
          trail_running: 'running',
          running: 'running',
          cycling: 'cycling',
          walking: 'walking',
        }[activity.typeKey] ?? 'generic';
      const fit = Buffer.from(fitFile(points(activity), { sport }));
      // The plain form sends the recording itself, not a zip of it.
      if (plain) return send(response, 200, fit, 'application/octet-stream');
      const zip = makeZip([{ name: `${activity.id}_ACTIVITY.fit`, data: fit }]);
      return send(response, 200, zip, 'application/x-zip-compressed');
    }
    return send(response, 404, { error: 'unknown path' });
  })();
}).listen(port, '127.0.0.1', () => console.log(`fake Garmin on http://127.0.0.1:${port}`));

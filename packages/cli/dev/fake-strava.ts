/**
 * A stand-in for the Strava API, for trying `jam strava auth` and `jam sync strava` without an
 * account or network. It serves made-up activities, sign-in, rate-limit headers and streams,
 * and can be told to fail. See dev/README.md.
 *
 *   node packages/cli/dev/fake-strava.ts [--port 8724] [--count 260]
 *
 * POST /__control with JSON changes its behaviour while it runs:
 *   { "failPage": 3, "failTimes": 99 }   answer 503 for page 3 this many times
 *   { "grantScope": "read,activity:read" } grant this instead of what was asked
 *   { "add": 2 }                          add new activities dated now
 *   { "rename": 123 }                     change an activity's name
 *   { "readUsage": 98 }                   set the 15-minute read usage
 *   { "dailyUsage": 998 }                 set the daily usage
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';

import { encodePolyline } from '../src/strava/polyline.ts';

const { values } = parseArgs({
  options: { port: { type: 'string', default: '8724' }, count: { type: 'string', default: '260' } },
});
const port = Number(values.port);

interface Fake {
  id: number;
  name: string;
  sport: string;
  start: number;
  private: boolean;
  trainer: boolean;
  manual: boolean;
  track: [number, number][];
}

const SPORTS = [
  'Hike',
  'Run',
  'Walk',
  'TrailRun',
  'Ride',
  'Yoga',
  'VirtualRide',
  'Hike',
  'Run',
  'Swim',
];
const activities: Fake[] = [];
let nextId = 10_000_000_000;

const track = (seed: number): [number, number][] => {
  const lat = 35.3 + (seed % 37) / 100;
  const lon = 138.7 + (seed % 53) / 100;
  return Array.from({ length: 12 }, (_, i) => [lon + i * 0.002, lat + Math.sin(i + seed) * 0.003]);
};

const add = (start: number, index: number) => {
  const sport = SPORTS[index % SPORTS.length] ?? 'Run';
  activities.push({
    id: nextId++,
    name: `${sport} ${index}`,
    sport,
    start,
    private: index % 11 === 4,
    trainer: sport === 'VirtualRide',
    manual: index % 17 === 9,
    track: track(index),
  });
};

const first = Date.UTC(2024, 0, 1, 23, 0) / 1000;
for (let i = 0; i < Number(values.count); i++) add(first + i * 2.5 * 86_400, i);

// Tokens carry their scope (a-<scope>-<random>, r-<scope>-<random>), so a restarted server still accepts them.
const scopeOf = (token: string, prefix: string) =>
  token.startsWith(prefix) ? token.slice(prefix.length).replace(/-[0-9a-f]{12}$/, '') : '';
const control = { failPage: 0, failTimes: 0, grantScope: '', readUsage: 0, dailyUsage: 0 };
const counts = { list: 0, streams: 0, token: 0 };

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

const body = async (request: IncomingMessage): Promise<string> => {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  return text;
};

const summary = (activity: Fake) => {
  const iso = new Date(activity.start * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const local = new Date((activity.start + 9 * 3600) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const hasTrack = !activity.trainer && !activity.manual;
  const last = activity.track.at(-1) ?? [0, 0];
  const firstPoint = activity.track[0] ?? [0, 0];
  return {
    resource_state: 2,
    athlete: { id: 4242, resource_state: 1 },
    id: activity.id,
    name: activity.name,
    distance: 5000 + (activity.id % 9000),
    moving_time: 3000,
    elapsed_time: 3600,
    total_elevation_gain: activity.sport === 'Hike' ? 820 : 40,
    type: activity.sport,
    sport_type: activity.sport,
    workout_type: activity.id % 13 === 0 ? 1 : 0,
    start_date: iso,
    start_date_local: local,
    timezone: '(GMT+09:00) Asia/Tokyo',
    utc_offset: 32400,
    trainer: activity.trainer,
    commute: activity.id % 19 === 0,
    manual: activity.manual,
    private: activity.private,
    visibility: activity.private
      ? 'only_me'
      : activity.id % 5 === 0
        ? 'followers_only'
        : 'everyone',
    kudos_count: Math.floor(Math.random() * 10),
    start_latlng: hasTrack ? [firstPoint[1], firstPoint[0]] : [],
    end_latlng: hasTrack ? [last[1], last[0]] : [],
    map: {
      id: `a${activity.id}`,
      summary_polyline: hasTrack ? encodePolyline(activity.track) : '',
      resource_state: 2,
    },
  };
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`);
  const path = url.pathname;

  if (path === '/__control' && request.method === 'POST') {
    const change = JSON.parse((await body(request)) || '{}') as Record<string, unknown>;
    if (typeof change.failPage === 'number') control.failPage = change.failPage;
    if (typeof change.failTimes === 'number') control.failTimes = change.failTimes;
    if (typeof change.grantScope === 'string') control.grantScope = change.grantScope;
    if (typeof change.readUsage === 'number') control.readUsage = change.readUsage;
    if (typeof change.dailyUsage === 'number') control.dailyUsage = change.dailyUsage;
    if (typeof change.add === 'number')
      for (let i = 0; i < change.add; i++)
        add(Math.floor(Date.now() / 1000) - 3600 * (i + 1), activities.length);
    if (typeof change.rename === 'number') {
      const target = activities.find((activity) => activity.id === change.rename);
      if (target) target.name += ' (renamed)';
    }
    send(response, 200, { ...control, activities: activities.length, counts });
    return;
  }
  if (path === '/__state') {
    send(response, 200, {
      activities: activities.map((activity) => ({
        id: activity.id,
        sport: activity.sport,
        private: activity.private,
      })),
      counts,
    });
    return;
  }

  if (path === '/oauth/authorize') {
    const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
    redirect.searchParams.set('state', url.searchParams.get('state') ?? '');

    const granted = control.grantScope || (url.searchParams.get('scope') ?? '');
    redirect.searchParams.set('code', `c-${granted}`);
    redirect.searchParams.set('scope', granted);
    response.writeHead(302, { location: redirect.href });
    response.end();
    return;
  }
  if (path === '/oauth/token' && request.method === 'POST') {
    counts.token++;
    const form = new URLSearchParams(await body(request));
    if (form.get('client_secret') !== 'fake-secret')
      return send(response, 401, {
        message: 'Bad Request',
        errors: [{ field: 'client_secret', code: 'invalid' }],
      });
    let scope = '';
    if (form.get('grant_type') === 'refresh_token') {
      scope = scopeOf(form.get('refresh_token') ?? '', 'r-');
      if (!scope)
        return send(response, 400, {
          message: 'Bad Request',
          errors: [{ resource: 'RefreshToken', code: 'invalid' }],
        });
    } else {
      scope = (form.get('code') ?? '').replace(/^c-/, '');
    }
    const access = `a-${scope}-${randomBytes(6).toString('hex')}`;
    const next = `r-${scope}-${randomBytes(6).toString('hex')}`;
    send(response, 200, {
      token_type: 'Bearer',
      access_token: access,
      refresh_token: next,
      expires_at: Math.floor(Date.now() / 1000) + 21_600,
      expires_in: 21_600,
      athlete: { id: 4242, firstname: 'Test', lastname: 'Athlete' },
    });
    return;
  }

  const auth = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
  if (!scopeOf(auth, 'a-'))
    return send(response, 401, {
      message: 'Authorization Error',
      errors: [{ resource: 'Athlete', field: 'access_token', code: 'invalid' }],
    });
  const readAll = auth.includes('activity:read_all');
  control.readUsage++;
  control.dailyUsage++;
  const rate = {
    'x-ratelimit-limit': '200,2000',
    'x-ratelimit-usage': `${control.readUsage},${control.dailyUsage}`,
    'x-readratelimit-limit': '100,1000',
    'x-readratelimit-usage': `${control.readUsage},${control.dailyUsage}`,
  };

  if (path === '/api/v3/athlete/activities') {
    counts.list++;
    const page = Number(url.searchParams.get('page') ?? 1);
    const perPage = Number(url.searchParams.get('per_page') ?? 30);
    if (control.failPage === page && control.failTimes > 0) {
      control.failTimes--;
      return send(response, 503, { message: 'Service Unavailable' }, rate);
    }
    const after = Number(url.searchParams.get('after') ?? 0);
    const before = url.searchParams.has('before')
      ? Number(url.searchParams.get('before'))
      : Infinity;
    const list = activities
      .filter(
        (activity) =>
          activity.start > after && activity.start < before && (readAll || !activity.private),
      )
      .sort((a, b) => a.start - b.start)
      .slice((page - 1) * perPage, page * perPage);
    return send(response, 200, list.map(summary), rate);
  }
  const streams = /^\/api\/v3\/activities\/(\d+)\/streams$/.exec(path);
  if (streams) {
    counts.streams++;
    const activity = activities.find((item) => item.id === Number(streams[1]));
    if (!activity) return send(response, 404, { message: 'Record Not Found' }, rate);
    if (activity.trainer || activity.manual)
      return send(response, 200, { time: { data: [0, 60], series_type: 'distance' } }, rate);
    const points = activity.track.flatMap(([lon, lat]) =>
      [0, 1, 2].map((k): [number, number] => [lat + k * 0.0001, lon + k * 0.0001]),
    );
    return send(
      response,
      200,
      {
        latlng: {
          data: points,
          series_type: 'distance',
          original_size: points.length,
          resolution: 'high',
        },
        altitude: {
          data: points.map((_, i) => 500 + i),
          series_type: 'distance',
          original_size: points.length,
          resolution: 'high',
        },
        time: {
          data: points.map((_, i) => i * 20),
          series_type: 'distance',
          original_size: points.length,
          resolution: 'high',
        },
      },
      rate,
    );
  }
  send(response, 404, { message: 'Record Not Found' }, rate);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Fake Strava on http://127.0.0.1:${port} with ${activities.length} activities`);
});

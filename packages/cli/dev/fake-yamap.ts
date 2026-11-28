/**
 * A stand-in for the parts of YAMAP's web API that `jam sync yamap` uses, with made-up
 * activities: the paged list of a user's activities, one activity's details, and its track as
 * GPX, which is only given with the sign-in token. Nothing here talks to YAMAP.
 *
 * The token it accepts is "good-token". POST /__control with JSON changes its behaviour:
 *   { "add": "A name" }          a new activity, an hour ago
 *   { "remove": 9001 }           delete an activity
 *   { "rename": 9001 }           change an activity's title
 *   { "token": "new-token" }     accept this token from now on: the old one has expired
 *   { "leanList": true }         leave start_at out of the list, as a list of summaries might
 *   { "oldestFirst": true }      list the oldest activity first
 *   { "strictList": true }       answer 401 to a list request that carries a wrong token
 *   { "timeOutTracks": 2 }       answer 504 to this many track requests
 * GET /__stats says how many requests of each kind were answered.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8727' } } });
const port = Number(values.port);
const USER = '424242';
const PAGE = 4;
const DAY = 86_400;
const JST = 9 * 3600;

interface Fake {
  id: number;
  title: string;
  /** Unix seconds. */
  start: number;
  /** Seconds it lasted. */
  lasted: number;
  /** Whether it has a recorded track. */
  points: boolean;
}

// 2025-03-01 07:00 in Japan, then one every ten days.
const BASE = Date.UTC(2025, 2, 1, 7) / 1000 - JST;
const activities: Fake[] = [
  '大菩薩嶺',
  '金時山',
  '北岳',
  '剣ノ山・飯盛山',
  '高尾山',
  '筑波山',
  '写真だけの記録',
  '丹沢山',
  '雲取山',
  '塔ノ岳',
].map((title, index) => ({
  id: 9001 + index,
  title,
  start: BASE + index * 10 * DAY,
  lasted: 4 * 3600,
  points: title !== '写真だけの記録',
}));
let nextId = 9100;
let token = 'good-token';
let leanList = false;
let oldestFirst = false;
let strictList = false;
let timeOutTracks = 0;
const stats = { list: 0, detail: 0, track: 0, refused: 0 };

/** Made-up points east of 東京駅, one about every 20 m as YAMAP writes them. */
const gpx = (activity: Fake): string => {
  const points = Array.from({ length: 60 }, (_, i) => {
    const time = new Date((activity.start + i * 75) * 1000).toISOString().replace('.000Z', 'Z');
    const lat = (35.6812 + i * 0.00018).toFixed(7);
    const lon = (139.7671 + (activity.id % 7) * 0.01 + i * 0.00005).toFixed(7);
    return `<trkpt lat="${lat}" lon="${lon}"><ele>${(40 + i * 6).toFixed(2)}</ele><time>${time}</time></trkpt>`;
  }).join('');
  return `<?xml version='1.0' encoding='UTF-8'?><gpx creator="YAMAP - https://yamap.com" version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${activity.title}</name><number>1</number><trkseg>${points}</trkseg></trk></gpx>`;
};

const record = (activity: Fake, lean: boolean) => ({
  id: activity.id,
  title: activity.title,
  ...(lean ? {} : { start_at: activity.start, finish_at: activity.start + activity.lasted }),
  time_zone: 9,
  distance: 7622.03,
  cumulative_up: 465,
  cumulative_down: 504,
  has_points: activity.points,
  public_type: 'public',
});

const send = (
  response: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json',
) => {
  // No kept-alive sockets: a check that pauses between calls must not find its socket closed.
  response.writeHead(status, { 'Content-Type': type, Connection: 'close' });
  response.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const body = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => resolve(text));
  });

createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/__stats') return send(response, 200, stats);
    if (url.pathname === '/__control') {
      const change = JSON.parse((await body(request)) || '{}') as Record<string, unknown>;
      if (typeof change.add === 'string')
        activities.push({
          id: nextId++,
          title: change.add,
          start: Math.floor(Date.now() / 1000) - 3600,
          lasted: 1800,
          points: true,
        });
      if (typeof change.remove === 'number') {
        const at = activities.findIndex((activity) => activity.id === change.remove);
        if (at >= 0) activities.splice(at, 1);
      }
      if (typeof change.rename === 'number') {
        const found = activities.find((activity) => activity.id === change.rename);
        if (found) found.title = `${found.title}（改）`;
      }
      if (typeof change.token === 'string') token = change.token;
      if (typeof change.leanList === 'boolean') leanList = change.leanList;
      if (typeof change.oldestFirst === 'boolean') oldestFirst = change.oldestFirst;
      if (typeof change.strictList === 'boolean') strictList = change.strictList;
      if (typeof change.timeOutTracks === 'number') timeOutTracks = change.timeOutTracks;
      return send(response, 200, { ok: true });
    }
    // The real one takes a caller named "yamap…" for an outdated phone app.
    if (/^yamap/i.test(request.headers['user-agent'] ?? ''))
      return send(response, 490, { error: 'update the app' });
    const given = /^Bearer token=(.+)$/.exec(request.headers.authorization ?? '')?.[1];
    const signedIn = given === token;

    const list = /^\/users\/(\d+)\/activities$/.exec(url.pathname);
    if (list) {
      if (list[1] !== USER) return send(response, 404, { error: 'no such user' });
      if (strictList && given !== undefined && !signedIn) {
        stats.refused++;
        return send(response, 401, { error: 'unauthorized' });
      }
      stats.list++;
      const page = Number(url.searchParams.get('page') ?? '1');
      const ordered = activities.toSorted((a, b) =>
        oldestFirst ? a.start - b.start : b.start - a.start,
      );
      const slice = ordered.slice((page - 1) * PAGE, page * PAGE);
      return send(response, 200, {
        activities: slice.map((activity) => record(activity, leanList)),
        meta: {
          total_count: ordered.length,
          next_page: page * PAGE < ordered.length ? page + 1 : null,
        },
      });
    }
    const track = /^\/activities\/(\d+)\/points\.xml$/.exec(url.pathname);
    if (track) {
      if (!signedIn) {
        stats.refused++;
        return send(response, 401, { error: 'unauthorized' });
      }
      if (timeOutTracks > 0) {
        timeOutTracks--;
        return send(response, 504, { error: 'gateway timeout' });
      }
      stats.track++;
      const activity = activities.find((entry) => entry.id === Number(track[1]));
      if (!activity?.points) return send(response, 404, { error: 'no points' });
      return send(response, 200, gpx(activity), 'application/gpx+xml');
    }
    const detail = /^\/activities\/(\d+)$/.exec(url.pathname);
    if (detail) {
      stats.detail++;
      const activity = activities.find((entry) => entry.id === Number(detail[1]));
      if (!activity) return send(response, 404, { error: 'no such activity' });
      return send(response, 200, { activity: record(activity, false) });
    }
    return send(response, 404, { error: 'unknown path' });
  })();
}).listen(port, '127.0.0.1', () => console.log(`fake YAMAP on http://127.0.0.1:${port}`));

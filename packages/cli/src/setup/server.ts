/**
 * The web wizard's server: `jam setup --web`. For the owner alone, on this machine: loopback only,
 * a random port, a one-time token swapped for a cookie, Host and Origin checked on every request,
 * a fixed list of actions with arguments decided here, and no way to read a secret back.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cleanToken } from '../yamap/token.ts';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

import type { CommandContext } from '../commands/types.ts';
import { applyMerge, mergeCandidates } from './merges.ts';
import { setLogSink } from '../logger.ts';
import { DATA_DIR, ROOT_DIR } from '../paths.ts';
import { authHooks, openBrowser } from '../strava/auth.ts';
import { ACTIONS, isActionId, runAction } from './actions.ts';
import { SetupError, writeDraft } from './engine.ts';
import { gpxFolder } from '../gpx-import/files.ts';
import { saveUpload, uploadName, UploadRefused } from './upload.ts';
import { SOURCES } from './sources.ts';
import { changeGroups, planView, stage, type Staged, type Start, viewOf } from './stage.ts';
import { clearState, findFacts, keepable } from './state.ts';
import { GROUPS, groupNamed } from './steps.ts';
import type { Ctx } from './types.ts';
import { REVIEW_FILES } from './wizard.ts';

/** The built page. JAM_SETUP_BUNDLE points elsewhere, for the dev checks. */
const BUNDLE_DIR = process.env.JAM_SETUP_BUNDLE
  ? resolve(process.env.JAM_SETUP_BUNDLE)
  : join(ROOT_DIR, 'packages/web/dist-setup');
const IDLE_MS = 30 * 60_000;
const MAX_BODY = 256 * 1024;
const COOKIE = 'jam_setup';
const HEADER = 'x-jam-setup';
const UPLOAD_PATH = '/api/gpx';
const FILE_NAME_HEADER = 'x-jam-file-name';
const STARTS: readonly string[] = ['demo', 'quick', 'full', 'change'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/** The map needs tiles over https, workers from blobs and inline styles; nothing else is allowed. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  'child-src blob:',
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const same = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

interface Event {
  id: number;
  type: 'log' | 'start' | 'end' | 'authorize' | 'progress';
  data: Record<string, unknown>;
}

class Refused extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const serveSetup = (context: CommandContext): Promise<number> => {
  const { log, flags } = context;
  if (!existsSync(join(BUNDLE_DIR, 'index.html'))) {
    log.error('The setup page is not built. Run `pnpm setup:build` once, then try again.');
    return Promise.resolve(1);
  }

  const token = randomBytes(32).toString('hex');
  const session = randomBytes(32).toString('hex');
  let tokenUsed = false;
  /** Secret values seen in this session, so no output line can carry one back. */
  const secrets = new Set<string>();
  /** The answers last written, for the arguments of actions. Never secrets or locations. */
  let applied: Ctx | undefined;
  let running: string | undefined;
  /** Stops the running command, when it runs as a process of its own. */
  let stopRunning: (() => void) | undefined;
  const events: Event[] = [];
  const listeners = new Set<ServerResponse>();
  let nextId = 1;

  const redact = (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.split(secret).join('********');
    return out;
  };
  const emit = (type: Event['type'], data: Record<string, unknown>) => {
    const event: Event = { id: nextId++, type, data };
    events.push(event);
    if (events.length > 2000) events.shift();
    for (const listener of listeners)
      listener.write(`id: ${event.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  return new Promise<number>((done) => {
    let idle: NodeJS.Timeout;
    const shutdown = (why: string) => {
      clearTimeout(idle);
      setLogSink(undefined);
      delete authHooks.onAuthorizeUrl;
      log.info(`Setup page closed (${why}).`);
      for (const listener of listeners) listener.end();
      server.close(() => done(0));
      server.closeAllConnections();
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => shutdown('30 minutes without a request'), IDLE_MS);
    };

    const origin = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (response: ServerResponse, status: number, body: unknown, type?: string) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      response
        .writeHead(status, { 'Content-Type': type ?? 'application/json; charset=utf-8' })
        .end(redact(text));
    };

    const readBody = (request: IncomingMessage): Promise<Record<string, unknown>> =>
      new Promise((resolveBody, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            reject(new Refused(413, 'Too large.'));
            request.destroy();
          } else chunks.push(chunk);
        });
        request.on('end', () => {
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            if (value === null || typeof value !== 'object' || Array.isArray(value))
              throw new Error('not an object');
            resolveBody(value as Record<string, unknown>);
          } catch {
            reject(new Refused(400, 'The body must be a JSON object.'));
          }
        });
        request.on('error', reject);
      });

    /** `{ start, answers, group }` from a request body, checked. Remembers any secret in it. */
    const staged = (body: Record<string, unknown>): { start: Start; result: Staged } => {
      const start = typeof body.start === 'string' && STARTS.includes(body.start) ? body.start : '';
      if (!start) throw new Refused(400, 'start must be demo, quick, full or change.');
      const answers =
        body.answers !== null && typeof body.answers === 'object' && !Array.isArray(body.answers)
          ? (body.answers as Record<string, unknown>)
          : {};
      for (const id of [
        'strava.clientSecret',
        'garmin.apiKey',
        'yamap.token',
        'deploy.apiToken',
        'deploy.accountId',
        'deploy.netlifyToken',
      ])
        if (typeof answers[id] === 'string' && answers[id].length >= 4) secrets.add(answers[id]);
      // The YAMAP token is stored tidied; that form must not come back in output either.
      if (typeof answers['yamap.token'] === 'string') {
        const tidy = cleanToken(answers['yamap.token']);
        if (tidy.length >= 4) secrets.add(tidy);
      }
      const group = typeof body.group === 'string' ? groupNamed(body.group) : undefined;
      if (start === 'change' && !group) throw new Refused(400, 'Change mode needs a group.');
      return {
        start: start as Start,
        result: stage(flags.configDir, start as Start, answers, group ? [group] : undefined),
      };
    };

    const api = async (
      request: IncomingMessage,
      response: ServerResponse,
      path: string,
    ): Promise<void> => {
      const method = request.method ?? 'GET';
      if (method === 'GET' && path === '/api/state') {
        const { ctx } = stage(flags.configDir, 'quick', {});
        const demo = SOURCES.find((source) => source.id === 'demo');
        send(response, 200, {
          marker: 'jam-setup',
          facts: ctx.facts,
          demo: { available: ctx.facts.demoAvailable, reason: demo?.unavailable?.(ctx.facts) },
          groups: changeGroups(),
          titles: Object.fromEntries(GROUPS.map((group) => [group.id, group.title])),
          zones: ctx.config.privacyZones.zones.length,
          mapStyle: ctx.config.site.map.styleUrl,
          running: running ?? null,
          reviews: REVIEW_FILES.filter((file) => existsSync(file.path)).map(({ name, what }) => ({
            name,
            what,
          })),
        });
        return;
      }
      if (method === 'GET' && path === '/api/events') {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          Connection: 'keep-alive',
        });
        const since = Number(request.headers['last-event-id'] ?? 0);
        for (const event of events)
          if (event.id > since)
            response.write(
              `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
            );
        listeners.add(response);
        request.on('close', () => listeners.delete(response));
        return;
      }
      if (method === 'GET' && path.startsWith('/api/review/')) {
        const file = REVIEW_FILES.find((item) => item.name === path.slice('/api/review/'.length));
        if (!file || !existsSync(file.path)) throw new Refused(404, 'No such review file.');
        send(response, 200, readFileSync(file.path, 'utf8'), 'text/plain; charset=utf-8');
        return;
      }
      if (method === 'GET' && path === '/api/merges') {
        send(response, 200, { merges: mergeCandidates(flags.configDir) });
        return;
      }
      if (method === 'GET' && path === '/api/privacy-preview') {
        const file = join(DATA_DIR, 'privacy-preview.geojson');
        if (!existsSync(file)) throw new Refused(404, 'No preview yet.');
        send(response, 200, readFileSync(file, 'utf8'));
        return;
      }
      if (method !== 'POST') throw new Refused(404, 'Not found.');

      // A .zip or .gpx for the GPX import. The body is the file; the folder is decided here, from
      // the config, and the name the page sent is cut down to a plain file name.
      if (path === UPLOAD_PATH) {
        const name = uploadName(String(request.headers[FILE_NAME_HEADER] ?? ''));
        if (!name) throw new Refused(415, 'Only a .zip or .gpx file is taken.');
        const folder = gpxFolder(stage(flags.configDir, 'quick', {}).ctx.config);
        const result = await saveUpload(request, folder, name, { keep: !flags.dryRun });
        log.debug(`setup page: took an upload of ${result.bytes} bytes`);
        send(response, 200, { saved: result.saved, files: result.files });
        return;
      }

      const body = await readBody(request);
      if (path === '/api/answers') {
        send(response, 200, viewOf(staged(body).result));
        return;
      }
      if (path === '/api/apply') {
        const { start, result } = staged(body);
        if (Object.keys(result.errors).length > 0) {
          send(response, 400, viewOf(result));
          return;
        }
        // A new plan starts with an empty output: what an earlier run printed is not about it.
        events.length = 0;
        const written = flags.dryRun ? [] : writeDraft(result.draft).map((change) => change.name);
        log.debug(`setup page: wrote ${written.length} config files (${start})`);
        applied = {
          ...result.ctx,
          answers: {
            // Change mode saves one group at a time before running: an earlier group's options
            // for a command (the days to pull) must still be there when the command runs.
            ...(start === 'change' ? applied?.answers : {}),
            ...keepable(result.ctx.answers),
            ...(start === 'demo' ? { sources: ['demo'] } : {}),
          },
          facts: findFacts(flags.configDir, result.ctx.config.sheet.path),
        };
        send(response, 200, { written, plan: planView(result.plan, applied) });
        return;
      }
      if (path.startsWith('/api/actions/')) {
        const id = path.slice('/api/actions/'.length);
        if (!isActionId(id)) throw new Refused(404, 'No such action.');
        if (running) throw new Refused(409, `"${running}" is still running.`);
        const ctx: Ctx = applied ?? stage(flags.configDir, 'quick', {}).ctx;
        ctx.facts = findFacts(flags.configDir, ctx.config.sheet.path);
        running = id;
        stopRunning = undefined;
        emit('start', { id, title: ACTIONS[id].title });
        void runAction(id, ctx, flags, log, {
          separate: true,
          onStoppable: (stop) => {
            stopRunning = stop;
          },
        })
          .catch(() => 1)
          .then((code) => {
            running = undefined;
            stopRunning = undefined;
            // The days asked for "this time only" are spent once their pull has run: a later pull
            // in the same session must not be narrowed to them without being asked.
            const source =
              id === 'sync-strava'
                ? 'strava'
                : id === 'sync-garmin'
                  ? 'garmin'
                  : id === 'sync-yamap'
                    ? 'yamap'
                    : '';
            if (source && code === 0 && applied) {
              delete applied.answers[`${source}.pull.from`];
              delete applied.answers[`${source}.pull.to`];
            }
            emit('end', { id, code });
          });
        send(response, 202, { started: id });
        return;
      }
      if (path === '/api/stop') {
        if (!running) throw new Refused(409, 'Nothing is running.');
        if (!stopRunning) throw new Refused(409, 'This step cannot be stopped; it ends by itself.');
        emit('log', { level: 'warn', line: `Stopping "${running}"…` });
        stopRunning();
        send(response, 200, { stopping: running });
        return;
      }
      if (path === '/api/merges') {
        const index = Number(body.index);
        if (!Number.isInteger(index) || !applyMerge(flags.configDir, index, flags.dryRun))
          throw new Refused(404, 'No such candidate.');
        send(response, 200, { merges: mergeCandidates(flags.configDir) });
        return;
      }
      if (path === '/api/shutdown') {
        if (body.finished === true) clearState();
        send(response, 200, { ok: true });
        setImmediate(() => shutdown('finished'));
        return;
      }
      throw new Refused(404, 'Not found.');
    };

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      touch();
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Security-Policy', CSP);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Referrer-Policy', 'no-referrer');

      // DNS rebinding: a page elsewhere that resolves its own name to 127.0.0.1 sends its name here.
      const port = (server.address() as AddressInfo).port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(request.headers.host ?? '')) throw new Refused(403, 'Wrong host.');
      const from = request.headers.origin;
      if (from !== undefined && !hosts.map((host) => `http://${host}`).includes(from))
        throw new Refused(403, 'Wrong origin.');

      const url = new URL(request.url ?? '/', origin());
      const method = request.method ?? 'GET';
      if (method !== 'GET' && method !== 'POST') throw new Refused(405, 'Not allowed.');

      // The one-time token, as the opened address carries it: swapped for a cookie scripts cannot read.
      const offered = url.searchParams.get('token');
      if (offered !== null) {
        if (method !== 'GET' || tokenUsed || !same(offered, token))
          throw new Refused(403, 'This link was already used. Run `pnpm jam setup --web` again.');
        tokenUsed = true;
        response
          .writeHead(302, {
            'Set-Cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`,
            Location: '/',
          })
          .end();
        return;
      }
      const cookie = (request.headers.cookie ?? '')
        .split(';')
        .map((part) => part.trim().split('='))
        .find(([name]) => name === COOKIE)?.[1];
      if (!cookie || !same(cookie, session))
        throw new Refused(403, 'Open the address that `pnpm jam setup --web` printed.');
      if (method === 'POST') {
        if (request.headers[HEADER] !== '1') throw new Refused(403, 'Missing header.');
        // Every change is JSON, except the one file upload, which is the file's bytes.
        const type = request.headers['content-type'] ?? '';
        if (url.pathname === UPLOAD_PATH) {
          if (!type.startsWith('application/octet-stream')) throw new Refused(415, 'Send a file.');
        } else if (!type.startsWith('application/json')) throw new Refused(415, 'Send JSON.');
      }

      if (url.pathname.startsWith('/api/')) {
        await api(request, response, url.pathname);
        return;
      }
      if (method !== 'GET') throw new Refused(404, 'Not found.');
      // Only files of the built page; the path is checked to stay inside its folder.
      const wanted = normalize(join(BUNDLE_DIR, decodeURIComponent(url.pathname)));
      const file = url.pathname === '/' ? join(BUNDLE_DIR, 'index.html') : wanted;
      if (!file.startsWith(BUNDLE_DIR + sep) || !existsSync(file) || !statSync(file).isFile())
        throw new Refused(404, 'Not found.');
      response
        .writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' })
        .end(readFileSync(file));
    };

    const server = createServer((request, response) => {
      handle(request, response).catch((error: unknown) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        if (error instanceof Refused || error instanceof UploadRefused)
          send(response, error.status, { error: error.message });
        else if (error instanceof SetupError) send(response, 409, { error: error.message });
        else {
          log.debug(`setup page: ${error instanceof Error ? (error.stack ?? '') : 'error'}`);
          send(response, 500, { error: 'Something went wrong; see the terminal.' });
        }
      });
    });
    server.on('error', (error) => {
      log.error(`Could not start the setup page: ${error.message}`);
      done(1);
    });
    // Loopback only, and a port the system picks.
    server.listen(0, '127.0.0.1', () => {
      setLogSink((level, message) => {
        if (level === 'progress') emit('progress', JSON.parse(message) as Record<string, unknown>);
        else emit('log', { level, line: redact(message) });
      });
      authHooks.onAuthorizeUrl = (address) => emit('authorize', { url: address });
      const address = `${origin()}/?token=${token}`;
      // Straight to the terminal: the address carries the token, so it stays out of the log file.
      process.stdout.write(
        `Setup page: ${address}\nIt works once, in one browser, on this machine. Ctrl-C stops it.\n`,
      );
      openBrowser(address, log);
      touch();
    });
  });
};

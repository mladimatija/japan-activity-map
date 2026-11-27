import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';

import type { StravaConfig } from '@jam/core';
import { z } from 'zod';

import type { Logger } from '../logger.ts';
import { DATA_DIR } from '../paths.ts';
import { StravaAuthError, StravaRequestError } from './http.ts';
import { errorText } from '../errors.ts';

/** The sign-in, kept outside the database so backups never carry it. Git-ignored, owner-only. */
const TOKEN_FILE = join(DATA_DIR, 'strava-token.json');

const tokenSchema = z.object({
  athlete: z.object({ id: z.int(), name: z.string() }),
  /** Scopes Strava actually granted, as it reported them. */
  scope: z.string(),
  accessToken: z.string(),
  /** Unix seconds. */
  expiresAt: z.int(),
  refreshToken: z.string(),
  obtainedAt: z.string(),
});
export type StravaToken = z.infer<typeof tokenSchema>;

interface Credentials {
  clientId: string;
  clientSecret: string;
}

const READ_ALL = 'activity:read_all';
const scopeFor = (includePrivate: boolean) =>
  includePrivate ? `read,${READ_ALL}` : 'read,activity:read';
export const hasReadAll = (scope: string) =>
  scope
    .split(',')
    .map((part) => part.trim())
    .includes(READ_ALL);
export const canReadActivities = (scope: string) =>
  scope.split(',').some((part) => ['activity:read', READ_ALL].includes(part.trim()));

export const loadToken = (): StravaToken | undefined => {
  if (!existsSync(TOKEN_FILE)) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  } catch {
    // A file cut short or edited by hand: the same answer as one with the wrong shape.
    value = undefined;
  }
  const parsed = tokenSchema.safeParse(value);
  if (!parsed.success)
    throw new StravaAuthError(
      `${TOKEN_FILE} is not a valid sign-in file. Run \`pnpm jam strava auth\` again.`,
    );
  return parsed.data;
};

const saveToken = (token: StravaToken): void => {
  mkdirSync(dirname(TOKEN_FILE), { recursive: true });
  const temporary = `${TOKEN_FILE}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, TOKEN_FILE);
  chmodSync(TOKEN_FILE, 0o600);
};

const tokenResponse = z.looseObject({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_at: z.int(),
  athlete: z
    .looseObject({ id: z.int(), firstname: z.string().nullish(), lastname: z.string().nullish() })
    .optional(),
});

const postToken = async (
  api: StravaConfig['api'],
  body: Record<string, string>,
): Promise<z.infer<typeof tokenResponse>> => {
  let response: Response;
  try {
    response = await fetch(`${api.oauthUrl.replace(/\/$/, '')}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new StravaRequestError(`Could not reach Strava to sign in: ${errorText(error)}`);
  }
  const text = await response.text();
  if (response.status === 400 || response.status === 401) {
    const detail = `(${response.status}: ${text.slice(0, 200)})`;
    throw new StravaAuthError(
      body.grant_type === 'refresh_token'
        ? `Strava no longer accepts the saved sign-in ${detail}. It may have been revoked under My Apps in Strava's settings, or the client secret changed. Check config/secrets.jsonc, then run \`pnpm jam strava auth\`.`
        : `Strava refused the sign-in ${detail}. Check the client id and secret in config/secrets.jsonc, then run \`pnpm jam strava auth\`.`,
    );
  }
  if (!response.ok)
    throw new StravaRequestError(
      `Strava sign-in failed (${response.status}): ${text.slice(0, 200)}`,
    );
  return tokenResponse.parse(JSON.parse(text));
};

/** A fresh access token. Strava may rotate the refresh token, so the file is rewritten each time. */
export const refreshToken = async (
  api: StravaConfig['api'],
  credentials: Credentials,
  token: StravaToken,
): Promise<StravaToken> => {
  const response = await postToken(api, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
  });
  const next: StravaToken = {
    ...token,
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: response.expires_at,
    obtainedAt: new Date().toISOString(),
  };
  saveToken(next);
  return next;
};

/**
 * Told the sign-in address when `authorize` starts listening, so another front end (the setup
 * wizard's page) can show it as a link. The browser is still opened as usual.
 */
export const authHooks: { onAuthorizeUrl?: (url: string) => void } = {};

export const openBrowser = (url: string, log: Logger): void => {
  if (process.env.JAM_NO_BROWSER) return;
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => log.debug('Could not open a browser; the link above works too.'));
    child.unref();
  } catch {
    log.debug('Could not open a browser; the link above works too.');
  }
};

const page = (title: string, text: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3em"><h1>${title}</h1><p>${text}</p></body>`;

/**
 * Signs in through the browser: Strava's consent page redirects to a short-lived local server,
 * which checks the state value, then the code is exchanged for tokens.
 */
export const authorize = async (
  api: StravaConfig['api'],
  credentials: Credentials,
  includePrivate: boolean,
  log: Logger,
  onAuthorizeUrl: ((url: string) => void) | undefined = authHooks.onAuthorizeUrl,
): Promise<StravaToken> => {
  const state = randomBytes(16).toString('hex');
  const redirectUri = `http://localhost:${api.redirectPort}/callback`;
  const requested = scopeFor(includePrivate);
  const authorizeUrl = new URL(`${api.oauthUrl.replace(/\/$/, '')}/authorize`);
  authorizeUrl.search = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'force',
    scope: requested,
    state,
  }).toString();

  const result = await new Promise<{ code: string; scope: string }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const finish = (status: number, title: string, text: string, outcome: () => void) => {
        response
          .writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
          .end(page(title, text));
        clearTimeout(timer);
        server.close();
        outcome();
      };
      if (url.searchParams.get('state') !== state) {
        finish(
          400,
          'Sign-in not accepted',
          'The request did not come from this sign-in. Run the command again.',
          () =>
            reject(
              new StravaAuthError(
                'The sign-in redirect had the wrong state value, so it was ignored. Run `pnpm jam strava auth` again.',
              ),
            ),
        );
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        finish(
          400,
          'Sign-in cancelled',
          'Strava did not grant access. You can close this tab.',
          () => reject(new StravaAuthError(`Strava did not grant access (${error ?? 'no code'}).`)),
        );
        return;
      }
      finish(
        200,
        'Signed in',
        'Japan Activity Map can now read your Strava activities. You can close this tab.',
        () => resolve({ code, scope: url.searchParams.get('scope') ?? '' }),
      );
    });
    const timer = setTimeout(() => {
      server.close();
      reject(
        new StravaAuthError(
          'No answer from the Strava sign-in page within 5 minutes. Run `pnpm jam strava auth` again.',
        ),
      );
    }, 5 * 60_000);
    server.on('error', (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not listen on localhost:${api.redirectPort} for the sign-in (${error.message}). Set another strava.api.redirectPort in config/strava.jsonc.`,
        ),
      );
    });
    server.listen(api.redirectPort, '127.0.0.1', () => {
      log.info('Opening the Strava sign-in page. If no browser opens, visit:');
      log.info(`  ${authorizeUrl.href}`);
      onAuthorizeUrl?.(authorizeUrl.href);
      openBrowser(authorizeUrl.href, log);
    });
  });

  const response = await postToken(api, {
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    code: result.code,
    grant_type: 'authorization_code',
  });
  const athlete = response.athlete;
  const token: StravaToken = {
    athlete: {
      id: athlete?.id ?? 0,
      name: [athlete?.firstname, athlete?.lastname].filter(Boolean).join(' '),
    },
    scope: result.scope,
    accessToken: response.access_token,
    expiresAt: response.expires_at,
    refreshToken: response.refresh_token,
    obtainedAt: new Date().toISOString(),
  };
  saveToken(token);
  return token;
};

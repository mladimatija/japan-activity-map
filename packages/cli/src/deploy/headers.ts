/**
 * The `_headers` file Cloudflare Pages and Netlify read from the uploaded folder: which addresses the page
 * may load from (so a mistake or an injected script cannot send a visitor's requests elsewhere),
 * and how long the hashed app files are kept.
 */
import type { SiteOptions } from '@jam/core';
import { JamError } from '../errors.ts';

/** Cloudflare's limit for one line of `_headers`. */
const MAX_LINE = 2000;

export class HeadersError extends JamError {
  constructor(message: string) {
    super(message);
    this.name = 'HeadersError';
  }
}

const originOf = (url: string): string | undefined => {
  try {
    const parsed = new URL(url.replaceAll(/\{[a-z0-9_-]+\}/gi, 'x'));
    return parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
};

/** The addresses the config names itself: the map styles, the terrain source, the extra hosts. */
export const configuredUrls = (site: SiteOptions): string[] =>
  [
    site.map.styleUrl,
    site.map.darkStyleUrl,
    site.map.terrain.enabled ? site.map.terrain.sourceUrl : undefined,
    site.map.terrain.enabled ? site.map.terrain.tiles : undefined,
    ...site.deploy.extraHosts,
  ].filter((url): url is string => typeof url === 'string' && url !== '');

/** Every address a MapLibre style or a TileJSON file loads from. */
const urlsIn = (json: unknown): { urls: string[]; tileJson: string[] } => {
  const urls: string[] = [];
  const tileJson: string[] = [];
  const text = (value: unknown) => {
    if (typeof value === 'string') urls.push(value);
  };
  if (json === null || typeof json !== 'object') return { urls, tileJson };
  const style = json as Record<string, unknown>;
  text(style.glyphs);
  if (Array.isArray(style.sprite))
    for (const sprite of style.sprite) text((sprite as { url?: unknown } | null)?.url);
  else text(style.sprite);
  if (Array.isArray(style.tiles)) for (const tile of style.tiles) text(tile);
  if (style.sources !== null && typeof style.sources === 'object')
    for (const source of Object.values(style.sources as Record<string, unknown>)) {
      const { url, tiles } = (source ?? {}) as { url?: unknown; tiles?: unknown };
      if (typeof url === 'string') {
        urls.push(url);
        tileJson.push(url);
      }
      if (Array.isArray(tiles)) for (const tile of tiles) text(tile);
    }
  return { urls, tileJson };
};

export type FetchJson = (url: string) => Promise<unknown>;

/**
 * The origins the published page loads from: the configured addresses, and what the styles and
 * their tile sources point at in turn. A style that cannot be read is named in `unread`; its own
 * origin still counts.
 */
export const mapOrigins = async (
  site: SiteOptions,
  fetchJson: FetchJson | undefined,
): Promise<{ origins: string[]; unread: string[]; insecure: string[] }> => {
  const urls = configuredUrls(site);
  const unread: string[] = [];
  if (fetchJson) {
    const documents = [
      site.map.styleUrl,
      site.map.darkStyleUrl,
      site.map.terrain.enabled ? site.map.terrain.sourceUrl : undefined,
    ].filter((url): url is string => typeof url === 'string');
    const seen = new Set<string>();
    const read = async (url: string, depth: number): Promise<void> => {
      if (seen.has(url) || !originOf(url)) return;
      seen.add(url);
      try {
        const found = urlsIn(await fetchJson(url));
        urls.push(...found.urls);
        if (depth < 1) for (const next of found.tileJson) await read(next, depth + 1);
      } catch {
        unread.push(url);
      }
    };
    for (const url of documents) await read(url, 0);
  }
  const origins = new Set<string>();
  // An http address cannot be loaded by an https page at all: named, so it can be put right.
  const insecure = new Set<string>();
  for (const url of urls) {
    const origin = originOf(url);
    if (origin) origins.add(origin);
    else if (/^http:/i.test(url)) insecure.add(url);
  }
  return { origins: [...origins].sort(), unread, insecure: [...insecure].sort() };
};

const hostOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The content security policy for a site that loads only from itself and the given origins. As a
 * meta element it leaves out what browsers only take from a header.
 */
export const contentPolicy = (origins: readonly string[], asMeta = false): string => {
  const outside = origins.join(' ');
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React and MapLibre set element styles directly.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${outside}`.trim(),
    "font-src 'self'",
    `connect-src 'self' ${outside}`.trim(),
    // MapLibre's tile workers: the app ships the worker as a file of its own (MapView's
    // workerUrl); blob: covers MapLibre's default, should the app ever go back to it.
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    ...(asMeta ? [] : ["frame-ancestors 'none'"]),
  ].join('; ');
};

/**
 * The text of `_headers`, which Cloudflare Pages and Netlify both read from the uploaded folder
 * and apply to every response.
 */
export const headersFile = (
  origins: readonly string[],
  baseUrl: string | undefined,
  host: 'cloudflare' | 'netlify' | 'github' = 'cloudflare',
): string => {
  const everywhere = [
    `Content-Security-Policy: ${contentPolicy(origins)}`,
    'X-Content-Type-Options: nosniff',
    'X-Frame-Options: DENY',
    'Referrer-Policy: strict-origin-when-cross-origin',
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  ];
  const lines = ['/*', ...everywhere.map((line) => `  ${line}`), ''];
  // The app's files carry a hash of their content in their names, so a copy never goes stale.
  lines.push('/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '');
  // With an address of its own, the pages.dev copies of the site stay out of search engines.
  // (Netlify's rules match paths only; it sends visitors of the netlify.app address on instead.)
  const site = hostOf(baseUrl);
  if (host === 'cloudflare' && site && !site.endsWith('.pages.dev'))
    lines.push(
      'https://:project.pages.dev/*',
      '  X-Robots-Tag: noindex',
      '',
      'https://:deployment.:project.pages.dev/*',
      '  X-Robots-Tag: noindex',
      '',
    );
  const long = lines.find((line) => line.length > MAX_LINE);
  if (long)
    throw new HeadersError(
      `The page's list of allowed addresses is ${long.length} characters, and one line of _headers takes at most ${MAX_LINE}. Shorten deploy.extraHosts in site.jsonc.`,
    );
  return lines.join('\n');
};

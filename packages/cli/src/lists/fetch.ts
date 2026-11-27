import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { PREFECTURES, type Position } from '@jam/core';

import type { Logger } from '../logger.ts';
import { LIST_DEFINITIONS } from './definitions.ts';
import { compareFile, writeText } from './output.ts';
import { readZip, xmlText } from './zip.ts';
import { buildOutlines, OUTLINE_OPTIONS, outlineCollection } from './outlines.ts';
import { type Cell, htmlRows, listEntries } from './wiki-html.ts';
import {
  MUNICIPALITIES_FILE,
  municipalitiesFrom,
  municipalityCollection,
} from './municipalities.ts';
import {
  POST_TOWN_NODES,
  ROUTES_INDEX,
  matchingRelations,
  relationFile,
  townNames,
} from './routes.ts';
import {
  GOKAIDO_DIR,
  HIGHPOINTS_FILE,
  gpxExists,
  loadGpx,
  loadPostTowns,
  MOE_DIR,
  OSM_DIR,
  outlineFile,
  SOURCES_DIR,
  YAMANASHI_FILE,
  loadHighpoints,
  overpassSchema,
  parseGsiCsv,
  templeFile,
  templeFileSchema,
  postTownsFile,
  postTownsSchema,
  wikipediaSetFile,
  wikipediaSetSchema,
  yamanashiFileSchema,
} from './sources.ts';
import { errorText } from '../errors.ts';

export const FETCH_SOURCES = [
  'gsi',
  'highpoints',
  'wikidata',
  'wikipedia',
  'osm',
  'moe',
  'gokaido',
  'outlines',
  'municipalities',
] as const;
export type FetchSource = (typeof FETCH_SOURCES)[number];

const USER_AGENT = 'japan-activity-map/0.1 (personal, non-commercial; jam lists fetch)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** The whole of Japan, as south, west, north, east. */
const JAPAN_BBOX = '20,122,46,154';
/** Yamanashi with a margin, for the peaks the 山梨百名山 list needs. */
const YAMANASHI_BBOX = '35.1,138.1,36.05,139.25';
const GSI_PAGE = 'https://www.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html';
const GSI_HIGHPOINTS_PDF = 'https://www.gsi.go.jp/KOKUJYOHO/MOUNTAIN/todofuken.pdf';
/** Pilgrimage circuits on Wikidata: members say "part of" (P361) with a series ordinal (P1545). */
const CIRCUITS = [
  { key: 'bando-33', qid: 'Q806417', label: '坂東三十三観音' },
  { key: 'chichibu-34', qid: 'Q11596109', label: '秩父札所三十四観音霊場' },
];
/**
 * Numbered lists read from Japanese Wikipedia list articles. Wikidata's own sets for these were
 * incomplete in November 2026 (四国八十八箇所 7 numbered members, 続日本100名城 58), so membership
 * and numbers come from the article's tables, and coordinates from each linked article's Wikidata
 * item and the article itself.
 */
const WIKIPEDIA_SETS = [
  { key: 'shikoku-88', page: '四国八十八箇所', kind: 'temple', first: 1, count: 88 },
  { key: 'saigoku-33', page: '西国三十三所', kind: 'temple', first: 1, count: 33 },
  { key: 'castles-100', page: '日本100名城', kind: 'castle', first: 1, count: 100 },
  { key: 'castles-zoku-100', page: '続日本100名城', kind: 'castle', first: 101, count: 100 },
] as const;
/**
 * Lists of places (mountains, waterfalls) on Japanese Wikipedia, read like the sets above but with
 * whatever layout the article has (see `listEntries`): a number per row where the article numbers
 * the list, page order where it does not. `nameHeader` is the heading of the column with the names.
 */
export const WIKIPEDIA_PLACE_LISTS = [
  { key: 'hana-no-hyakumeizan', page: '花の百名山', count: 100, nameHeader: /山名|山岳名|^山$/ },
  { key: 'taki-100', page: '日本の滝百選', count: 100, nameHeader: /滝名|名称|^滝$|滝の名/ },
  { key: 'kanto-hyakumeizan', page: '関東百名山', count: 100, nameHeader: /山名|^山$/ },
  { key: 'kansai-hyakumeizan', page: '関西百名山', count: 100, nameHeader: /山名|^山$/ },
] as const;
const WIKIPEDIA_PAGE = '山梨百名山';
/** The Ministry of the Environment's long-distance nature trail page, which links the GPX zip. */
const MOE_PAGE = 'https://www.env.go.jp/nature/long-trail.html';
/** The zip the page linked in November 2026, used if the link cannot be found on the page. */
const MOE_TOKAI_ZIP = 'https://www.env.go.jp/content/000304454.zip';

interface Context {
  dryRun: boolean;
  log: Logger;
  today: string;
}

/** "fetch failed" hides the reason; the cause has the network or TLS error code. */
const describe = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: string; message?: string } | undefined;
  return cause
    ? `${error.message} (${cause.code ?? ''}${cause.code && cause.message ? ': ' : ''}${cause.message ?? ''})`
    : error.message;
};

const run = promisify(execFile);

/**
 * curl as a fallback for hosts Node's fetch cannot reach (some Japanese government sites send
 * an incomplete certificate chain, which browsers and curl handle and Node does not).
 */
const curl = async (url: string, init: RequestInit): Promise<Response> => {
  const args = [
    '--silent',
    '--show-error',
    '--fail',
    '--location',
    '--max-time',
    '300',
    '--user-agent',
    USER_AGENT,
  ];
  if (init.method === 'POST' && typeof init.body === 'string')
    args.push(
      '--data-binary',
      init.body,
      '--header',
      'Content-Type: application/x-www-form-urlencoded',
    );
  new Headers(init.headers).forEach((value, key) => {
    if (key !== 'user-agent' && key !== 'content-type') args.push('--header', `${key}: ${value}`);
  });
  const { stdout } = await run('curl', [...args, url], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
  });
  return new Response(stdout);
};

const request = async (url: string, init: RequestInit = {}, attempts = 3): Promise<Response> => {
  let lastError: unknown;
  let wait = 0;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    wait = attempt * 10_000;
    try {
      const headers = new Headers(init.headers);
      headers.set('User-Agent', USER_AGENT);
      const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(300_000) });
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText} from ${new URL(url).host}`);
      if (response.status === 429) {
        // Rate limited: wait as long as the server asks (Wikipedia sends Retry-After), and
        // allow more tries than for other errors.
        const asked = Number(response.headers.get('Retry-After'));
        wait = Math.min(
          Number.isFinite(asked) && asked > 0 ? asked * 1000 : attempt * 30_000,
          120_000,
        );
        attempts = Math.max(attempts, 5);
      } else if (response.status < 500) break;
    } catch (error) {
      // A network or TLS failure: try curl once before waiting and retrying.
      try {
        return await curl(url, init);
      } catch (curlError) {
        lastError = new Error(`${describe(error)}; curl: ${describe(curlError).split('\n')[0]}`);
      }
    }
    if (attempt < attempts) await sleep(wait);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const save = (context: Context, path: string, text: string): void => {
  const result = compareFile(path, text);
  const name = path.slice(SOURCES_DIR.length + 1);
  if (result === 'unchanged') {
    context.log.info(`  ${name}: unchanged`);
    return;
  }
  if (!context.dryRun) writeText(path, text);
  context.log.info(
    `  ${name}: ${context.dryRun ? 'would be ' : ''}${result === 'new' ? 'created' : 'updated'}`,
  );
};

// --- GSI -------------------------------------------------------------------------------------

const fetchGsi = async (context: Context): Promise<void> => {
  const page = await (await request(GSI_PAGE)).text();
  const csv = [...page.matchAll(/\/KOKUJYOHO\/MOUNTAIN\/(1003zan\d{8}\.csv)/g)]
    .flatMap((match) => (match[1] ? [match[1]] : []))
    .sort((a, b) => a.localeCompare(b))
    .at(-1);
  if (!csv) throw new Error('GSI page: no link to the mountain list CSV');
  const bytes = await (
    await request(new URL(`/KOKUJYOHO/MOUNTAIN/${csv}`, GSI_PAGE).href)
  ).arrayBuffer();
  const text = new TextDecoder('shift_jis').decode(bytes).replace(/\r\n/g, '\n');
  const rows = parseGsiCsv(text);
  context.log.info(`  GSI mountain list ${csv}: ${rows.length} rows`);
  save(context, join(SOURCES_DIR, 'gsi-mountains', csv), text.endsWith('\n') ? text : `${text}\n`);
};

/** Refreshes the coordinates of the 47 high points from the map links in GSI's PDF. */
const fetchHighpoints = async (context: Context): Promise<void> => {
  const bytes = new Uint8Array(await (await request(GSI_HIGHPOINTS_PDF)).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const links = [
    ...text.matchAll(/\/URI\s*\(https:\/\/maps\.gsi\.go\.jp\/#\d+\/([\d.]+)\/([\d.]+)\/?\)/g),
  ].map((match) => ({
    lat: Number(match[1]),
    lon: Number(match[2]),
  }));
  if (links.length !== 47)
    throw new Error(`GSI high points PDF: expected 47 map links, found ${links.length}`);
  const current = loadHighpoints();
  const items = current.items.map((item, i) => {
    const link = links[i];
    if (!link) return item;
    if (link.lat !== item.lat || link.lon !== item.lon)
      context.log.warn(`  ${item.prefecture}: coordinates changed in GSI's table`);
    return { ...item, lat: link.lat, lon: link.lon };
  });
  context.log.info(
    '  Names and heights are not re-read from the PDF; check its edition if GSI publishes a new one.',
  );
  // Keeps the file's other fields (source, edition, note) as they are.
  const raw = JSON.parse(readFileSync(HIGHPOINTS_FILE, 'utf8')) as Record<string, unknown>;
  const changed = items.some(
    (item, i) => item.lat !== current.items[i]?.lat || item.lon !== current.items[i]?.lon,
  );
  const document = changed ? { ...raw, fetchedAt: context.today, items } : raw;
  save(context, HIGHPOINTS_FILE, `${JSON.stringify(document, null, 1)}\n`);
};

// --- Wikidata --------------------------------------------------------------------------------

const sparql = async (
  query: string,
): Promise<{ results: { bindings: Record<string, { value: string } | undefined>[] } }> => {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
  const response = await request(url, { headers: { Accept: 'application/sparql-results+json' } });
  return (await response.json()) as {
    results: { bindings: Record<string, { value: string } | undefined>[] };
  };
};

const fetchWikidata = async (context: Context): Promise<void> => {
  for (const circuit of CIRCUITS) {
    const { qid } = circuit;
    const query = `SELECT ?item ?ja ?en ?ord ?coord WHERE { ?item p:P361 ?st . ?st ps:P361 wd:${qid} ; pq:P1545 ?ord . OPTIONAL { ?item wdt:P625 ?coord } OPTIONAL { ?item rdfs:label ?ja FILTER(LANG(?ja)="ja") } OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") } } ORDER BY xsd:integer(?ord)`;
    const { results } = await sparql(query);
    const items = new Map<string, Record<string, unknown>>();
    let unnumbered = 0;
    for (const row of results.bindings) {
      const itemQid = row.item?.value.split('/').pop();
      if (!itemQid || items.has(itemQid) || !row.ord || !row.ja) continue;
      const order = Number(row.ord.value);
      if (!Number.isInteger(order) || order < 1) {
        unnumbered++;
        continue;
      }
      const point = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(row.coord?.value ?? '');
      items.set(itemQid, {
        qid: itemQid,
        order,
        ja: row.ja.value,
        ...(row.en ? { en: row.en.value } : {}),
        ...(point ? { lon: Number(point[1]), lat: Number(point[2]) } : {}),
      });
    }
    if (items.size === 0) {
      context.log.warn(
        `  ${circuit.key}: ${qid} has no numbered members with a Japanese label; skipped.`,
      );
      continue;
    }
    const document = templeFileSchema.parse({
      source: 'Wikidata',
      circuit: qid,
      circuitLabel: circuit.label,
      fetchedAt: context.today,
      query: `Items with part of (P361) = ${qid} and a series ordinal (P1545) qualifier; coordinates from P625.`,
      items: [...items.values()].sort((a, b) => Number(a.order) - Number(b.order)),
    });
    context.log.info(
      `  ${circuit.key}: ${document.items.length} members${unnumbered > 0 ? ` (${unnumbered} with an ordinal that is not a plain number left out)` : ''}`,
    );
    save(context, templeFile(circuit.key), `${JSON.stringify(document, null, 1)}\n`);
  }
};

// --- Wikipedia -------------------------------------------------------------------------------

const API = 'https://ja.wikipedia.org/w/api.php';

const wikiLink = (cell: string): { title: string | null; text: string } => {
  const match = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(cell);
  return match?.[1]
    ? { title: match[1].trim(), text: (match[2] ?? match[1]).trim() }
    : { title: null, text: cell.replace(/<[^>]+>/g, '').trim() };
};

const fetchWikipedia = async (context: Context): Promise<void> => {
  const parse = (await (
    await request(
      `${API}?action=parse&page=${encodeURIComponent(WIKIPEDIA_PAGE)}&prop=wikitext|revid&format=json&formatversion=2`,
    )
  ).json()) as { parse: { revid: number; wikitext: string } };
  const wikitext = parse.parse.wikitext;
  const start = wikitext.indexOf('{|');
  const table = wikitext.slice(start, wikitext.indexOf('|}', start));
  const rows = table
    .split(/\n\|-\s*\n/)
    .slice(1)
    .map((row) =>
      row
        .replace(/^\|\s*/, '')
        .split('||')
        .map((cell) => cell.trim()),
    )
    .filter((cells) => /^\d+$/.test(cells[0] ?? ''));
  const items = rows.map((cells) => {
    const name = wikiLink(cells[1] ?? '');
    return {
      no: Number(cells[0]),
      name: name.text,
      article: name.title,
      kana: (cells[2] ?? '').split(/<br\s*\/?>/)[0]?.trim() ?? '',
      elevationM: Number((cells[3] ?? '').replace(/[^0-9.]/g, '')),
      range: wikiLink(cells[4] ?? '').text,
    };
  });

  // Each linked article's primary coordinates, following redirects.
  const titles = [
    ...new Set(
      items.map((item) => item.article).filter((title): title is string => title !== null),
    ),
  ];
  const redirects = new Map<string, string>();
  const coordinates = new Map<string, { lat: number; lon: number }>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).join('|');
    const result = (await (
      await request(
        `${API}?action=query&prop=coordinates&redirects=1&colimit=max&format=json&formatversion=2&titles=${encodeURIComponent(batch)}`,
      )
    ).json()) as {
      query: {
        redirects?: { from: string; to: string }[];
        normalized?: { from: string; to: string }[];
        pages: { title: string; coordinates?: { lat: number; lon: number }[] }[];
      };
    };
    for (const entry of [...(result.query.redirects ?? []), ...(result.query.normalized ?? [])])
      redirects.set(entry.from, entry.to);
    for (const page of result.query.pages) {
      const first = page.coordinates?.[0];
      if (first) coordinates.set(page.title, { lat: first.lat, lon: first.lon });
    }
  }
  const resolve = (title: string | null) => {
    let current = title;
    for (let hops = 0; current && redirects.has(current) && hops < 5; hops++)
      current = redirects.get(current) ?? null;
    return current;
  };
  const document = yamanashiFileSchema.parse({
    source: 'Japanese Wikipedia',
    page: WIKIPEDIA_PAGE,
    revid: parse.parse.revid,
    fetchedAt: context.today,
    note: "Membership, number, name, reading, elevation and range from the page's list table; lat/lon are the primary coordinates of each linked article (GeoData), where it has them.",
    items: items
      .map(({ article, ...item }) => {
        const resolved = resolve(article);
        const point = resolved ? coordinates.get(resolved) : undefined;
        return { ...item, article: resolved, ...point };
      })
      .map(({ no, name, kana, elevationM, range, article, ...point }) => ({
        no,
        name,
        kana,
        elevationM,
        range,
        article,
        ...point,
      })),
  });
  context.log.info(
    `  ${WIKIPEDIA_PAGE}: ${document.items.length} mountains, ${document.items.filter((item) => item.lat !== undefined).length} with article coordinates`,
  );
  save(context, YAMANASHI_FILE, `${JSON.stringify(document, null, 1)}\n`);
  let failure: unknown;
  for (const step of [fetchWikipediaSets, fetchWikipediaPlaceLists, fetchPostTowns]) {
    try {
      await step(context);
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
};

// --- Wikipedia list articles ----------------------------------------------------------------

/**
 * What a temple's or castle's link looks like, best first: in 四国八十八箇所 the 院号 column
 * (一乗院) comes before the temple (霊山寺), so a name ending in 寺 wins over one with 院.
 */
const NAME_PATTERNS = {
  temple: [/寺(\s*\([^)]*\))?$/, /寺|院|堂|庵|坊/],
  // 日本100名城 #88 is 吉野ヶ里, linked as 吉野ヶ里遺跡: a site, as a last resort.
  castle: [/城|館|郭|台場|陣屋|チャシ|砦/, /遺跡|史跡|跡$/],
};
/** The list number and the linked temple or castle of one table row, if it has both. */
const rowEntry = (
  cells: Cell[],
  patterns: RegExp[],
): { order: number; title: string; text: string } | undefined => {
  const number = (cell: Cell) => /^第?(\d{1,3})番?(札所)?$/.exec(cell.raw.replace(/\s/g, ''));
  const at = cells.findIndex((cell) => number(cell) !== null);
  if (at < 0) return undefined;
  const order = Number(number(cells[at] as Cell)?.[1]);
  const links = cells.slice(at + 1).flatMap((cell) => cell.links);
  for (const pattern of patterns) {
    const link = links.find(
      (candidate) => pattern.test(candidate.title) || pattern.test(candidate.text),
    );
    if (link) return { order, ...link };
  }
  return undefined;
};

/** An article's Wikidata item, English label, and positions from Wikidata and the article. */
interface ArticleFacts {
  article: string;
  qid?: string;
  en?: string;
  wikidata?: { lat: number; lon: number };
  wikipedia?: { lat: number; lon: number };
}

/**
 * Facts about Japanese Wikipedia articles, following redirects: each article's primary
 * coordinates (GeoData) and Wikidata item, then that item's P625 and English label.
 */
const articleFacts = async (
  titles: string[],
): Promise<{ describe: (title: string) => ArticleFacts }> => {
  const unique = [...new Set(titles)];
  const redirects = new Map<string, string>();
  const pages = new Map<string, { qid?: string; lat?: number; lon?: number }>();
  for (let i = 0; i < unique.length; i += 50) {
    if (i > 0) await sleep(1000);
    const batch = unique.slice(i, i + 50).join('|');
    const result = (await (
      await request(
        `${API}?action=query&prop=coordinates|pageprops&ppprop=wikibase_item&redirects=1&colimit=max&format=json&formatversion=2&titles=${encodeURIComponent(batch)}`,
      )
    ).json()) as {
      query: {
        redirects?: { from: string; to: string }[];
        normalized?: { from: string; to: string }[];
        pages: {
          title: string;
          coordinates?: { lat: number; lon: number }[];
          pageprops?: { wikibase_item?: string };
        }[];
      };
    };
    for (const entry of [...(result.query.redirects ?? []), ...(result.query.normalized ?? [])])
      redirects.set(entry.from, entry.to);
    for (const page of result.query.pages) {
      const point = page.coordinates?.[0];
      pages.set(page.title, {
        ...(page.pageprops?.wikibase_item ? { qid: page.pageprops.wikibase_item } : {}),
        ...(point ? { lat: point.lat, lon: point.lon } : {}),
      });
    }
  }
  const resolve = (title: string) => {
    let current = title;
    for (let hops = 0; redirects.has(current) && hops < 5; hops++)
      current = redirects.get(current) ?? current;
    return current;
  };

  const qids = [...new Set([...pages.values()].flatMap((page) => (page.qid ? [page.qid] : [])))];
  const items = new Map<string, { en?: string; lat?: number; lon?: number }>();
  for (let i = 0; i < qids.length; i += 150) {
    const values = qids
      .slice(i, i + 150)
      .map((qid) => `wd:${qid}`)
      .join(' ');
    const { results } = await sparql(
      `SELECT ?item ?en ?coord WHERE { VALUES ?item { ${values} } OPTIONAL { ?item wdt:P625 ?coord } OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en)="en") } }`,
    );
    for (const row of results.bindings) {
      const qid = row.item?.value.split('/').pop();
      if (!qid || items.has(qid)) continue;
      const point = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(row.coord?.value ?? '');
      items.set(qid, {
        ...(row.en ? { en: row.en.value } : {}),
        ...(point ? { lon: Number(point[1]), lat: Number(point[2]) } : {}),
      });
    }
  }
  return {
    describe: (title) => {
      const article = resolve(title);
      const page = pages.get(article);
      const item = page?.qid ? items.get(page.qid) : undefined;
      return {
        article,
        ...(page?.qid ? { qid: page.qid } : {}),
        ...(item?.en ? { en: item.en } : {}),
        ...(item?.lat !== undefined && item.lon !== undefined
          ? { wikidata: { lat: item.lat, lon: item.lon } }
          : {}),
        ...(page?.lat !== undefined && page.lon !== undefined
          ? { wikipedia: { lat: page.lat, lon: page.lon } }
          : {}),
      };
    },
  };
};

/** The post-town tables of the 五街道 articles, for splitting each highway into stages. */
const POST_TOWN_PAGES = [
  { key: 'tokaido', page: '東海道五十三次' },
  { key: 'nakasendo', page: '中山道六十九次' },
  { key: 'koshu-kaido', page: '甲州街道' },
  { key: 'nikko-kaido', page: '日光街道' },
  { key: 'oshu-kaido', page: '奥州街道' },
] as const;

/** Every "1. 品川宿" row of a rendered article's tables, in page order, with its link. */
const postTownRows = (html: string): { number: number; ja: string; title?: string }[] => {
  const rows: { number: number; ja: string; title?: string }[] = [];
  for (const cells of htmlRows(html)) {
    for (const cell of cells) {
      const match = /^(\d+)\.\s*(\S.*)$/.exec(
        cell.raw
          .replace(/\[\d+\]/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
      if (!match) continue;
      const number = Number(match[1]);
      // "0. 日本橋" is the starting point, not a post town; "5. 7" rows come from other tables.
      if (
        number >= 1 &&
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(match[2] ?? '')
      ) {
        const link = cell.links[0];
        rows.push({ number, ja: (match[2] ?? '').trim(), ...(link ? { title: link.title } : {}) });
      }
      break;
    }
  }
  return rows;
};

const fetchPostTowns = async (context: Context): Promise<void> => {
  const failed: string[] = [];
  for (const highway of POST_TOWN_PAGES) {
    try {
      await sleep(5000);
      const parse = (await (
        await request(
          `${API}?action=parse&page=${encodeURIComponent(highway.page)}&prop=text|revid&redirects=1&disablelimitreport=1&disableeditsection=1&format=json&formatversion=2`,
        )
      ).json()) as { parse: { revid: number; text: string } };
      const rows = postTownRows(parse.parse.text);
      if (rows.length === 0) throw new Error("no numbered post-town rows in the article's tables");
      const { describe: about } = await articleFacts(
        rows.flatMap((row) => (row.title ? [row.title] : [])),
      );
      const document = postTownsSchema.parse({
        source: 'Japanese Wikipedia',
        page: highway.page,
        revid: parse.parse.revid,
        fetchedAt: context.today,
        note: 'The rendered article\'s numbered post-town rows ("1. 品川宿"), in page order, each with its linked article\'s Wikidata item, English label and positions. The build keeps those on its 五街道 line.',
        items: rows.map((row, seq) => ({
          seq,
          number: row.number,
          ja: row.ja,
          ...(row.title ? about(row.title) : {}),
        })),
      });
      const placed = document.items.filter((item) => item.wikipedia ?? item.wikidata).length;
      context.log.info(
        `  ${highway.page}: ${document.items.length} post towns, ${placed} with coordinates`,
      );
      save(context, postTownsFile(highway.key), `${JSON.stringify(document, null, 1)}\n`);
    } catch (error) {
      failed.push(highway.page);
      context.log.error(`  ${highway.page}: ${describe(error)}`);
    }
  }
  if (failed.length > 0) throw new Error(`${failed.join(', ')} could not be read`);
};

const fetchWikipediaSets = async (context: Context): Promise<void> => {
  const failed: string[] = [];
  for (const set of WIKIPEDIA_SETS) {
    try {
      await fetchWikipediaSet(context, set);
    } catch (error) {
      failed.push(set.page);
      context.log.error(`  ${set.page}: ${describe(error)}`);
    }
  }
  if (failed.length > 0) throw new Error(`${failed.join(', ')} could not be read`);
};

const fetchWikipediaSet = async (
  context: Context,
  set: (typeof WIKIPEDIA_SETS)[number],
): Promise<void> => {
  // Each article costs several API calls; spaced out so Wikipedia does not rate-limit the run.
  await sleep(5000);
  const parse = (await (
    await request(
      `${API}?action=parse&page=${encodeURIComponent(set.page)}&prop=text|revid&redirects=1&disablelimitreport=1&disableeditsection=1&format=json&formatversion=2`,
    )
  ).json()) as { parse: { revid: number; text: string } };
  const last = set.first + set.count - 1;
  const found = new Map<number, { title: string; text: string }>();
  const clashes: string[] = [];
  // The rendered page, not the wikitext: some of these articles build their tables from
  // templates, which only the rendered page has expanded.
  for (const cells of htmlRows(parse.parse.text)) {
    const entry = rowEntry(cells, NAME_PATTERNS[set.kind]);
    if (!entry || entry.order < set.first || entry.order > last) continue;
    const seen = found.get(entry.order);
    if (!seen) found.set(entry.order, entry);
    else if (seen.title !== entry.title)
      clashes.push(`#${entry.order} ${entry.text} (kept ${seen.text})`);
  }
  if (found.size === 0)
    throw new Error(
      `no row with a number from ${set.first} to ${last} and a linked ${set.kind} in the article's tables`,
    );
  const missing = Array.from({ length: set.count }, (_, i) => set.first + i).filter(
    (n) => !found.has(n),
  );

  const { describe: about } = await articleFacts([...found.values()].map((entry) => entry.title));

  const document = wikipediaSetSchema.parse({
    source: 'Japanese Wikipedia',
    page: set.page,
    revid: parse.parse.revid,
    fetchedAt: context.today,
    note: "Membership and numbers from the rendered article's tables (each row's number and its first linked temple or castle). wikidata: P625 of the linked article's item; wikipedia: the linked article's primary coordinates.",
    items: [...found.entries()]
      .sort(([a], [b]) => a - b)
      .map(([order, entry]) => ({ order, ja: entry.text, ...about(entry.title) })),
  });
  const placed = document.items.filter((item) => item.wikidata ?? item.wikipedia).length;
  context.log.info(
    `  ${set.page}: ${document.items.length} of ${set.count} numbers found, ${placed} with coordinates`,
  );
  if (missing.length > 0)
    context.log.warn(`  ${set.page}: no row found for #${missing.join(', #')}`);
  if (clashes.length > 0)
    context.log.warn(`  ${set.page}: other rows with the same number: ${clashes.join('; ')}`);
  save(context, wikipediaSetFile(set.key), `${JSON.stringify(document, null, 1)}\n`);
};

/**
 * A place list's document from the rendered article and the facts about its linked articles.
 * Apart from the network, so the checks can run it on a saved page.
 */
export const placeListDocument = (
  list: { page: string; count: number; first?: number; nameHeader: RegExp },
  page: { revid: number; text: string },
  about: (title: string) => ArticleFacts,
  today: string,
) => {
  const reading = listEntries(page.text, list);
  if (reading.entries.length === 0)
    throw new Error(
      `no list found in the article: no numbered rows or items, and no table column headed ${String(list.nameHeader)}`,
    );
  const unlinked = reading.entries.filter((entry) => !entry.title);
  const problems = [
    ...(reading.missing.length > 0
      ? [
          `${reading.entries.length} of ${list.count} found; nothing for #${reading.missing.join(', #')}.`,
        ]
      : []),
    ...(reading.clashes.length > 0
      ? [`Rows left out, their number already taken: ${reading.clashes.join('; ')}.`]
      : []),
    ...(reading.layout === 'table in page order'
      ? ['The article does not number the list; the numbers are its order on the page.']
      : []),
    ...(unlinked.length > 0
      ? [
          `No article linked, so no coordinates: ${unlinked.map((entry) => `#${entry.order} ${entry.text}`).join(', ')}.`,
        ]
      : []),
  ];
  return wikipediaSetSchema.parse({
    source: 'Japanese Wikipedia',
    page: list.page,
    revid: page.revid,
    fetchedAt: today,
    note: `Membership from the rendered article (${reading.layout}): each entry's number and its linked article. wikidata: P625 of the linked article's item; wikipedia: the linked article's primary coordinates.`,
    ...(problems.length > 0 ? { problems } : {}),
    items: reading.entries.map((entry) => ({
      order: entry.order,
      ja: entry.text,
      ...(entry.title ? about(entry.title) : {}),
    })),
  });
};

const fetchWikipediaPlaceLists = async (context: Context): Promise<void> => {
  const failed: string[] = [];
  for (const list of WIKIPEDIA_PLACE_LISTS) {
    try {
      await sleep(5000);
      const parse = (await (
        await request(
          `${API}?action=parse&page=${encodeURIComponent(list.page)}&prop=text|revid&redirects=1&disablelimitreport=1&disableeditsection=1&format=json&formatversion=2`,
        )
      ).json()) as { parse: { revid: number; text: string } };
      const titles = listEntries(parse.parse.text, list).entries.flatMap((entry) =>
        entry.title ? [entry.title] : [],
      );
      const { describe: about } = await articleFacts(titles);
      const document = placeListDocument(list, parse.parse, about, context.today);
      const placed = document.items.filter((item) => item.wikidata ?? item.wikipedia).length;
      context.log.info(
        `  ${list.page}: ${document.items.length} of ${list.count} found, ${placed} with coordinates`,
      );
      for (const problem of document.problems ?? []) context.log.warn(`  ${list.page}: ${problem}`);
      save(context, wikipediaSetFile(list.key), `${JSON.stringify(document, null, 1)}\n`);
    } catch (error) {
      failed.push(list.page);
      context.log.error(`  ${list.page}: ${describe(error)}`);
    }
  }
  if (failed.length > 0) throw new Error(`${failed.join(', ')} could not be read`);
};

// --- OpenStreetMap ---------------------------------------------------------------------------

const overpass = async (context: Context, query: string): Promise<string> => {
  let lastError: unknown;
  for (const endpoint of OVERPASS) {
    try {
      const response = await request(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }).toString(),
        },
        2,
      );
      const text = await response.text();
      overpassSchema.parse(JSON.parse(text));
      return text;
    } catch (error) {
      lastError = error;
      context.log.warn(`  ${new URL(endpoint).host}: ${errorText(error)}`);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const quote = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Relation files fetched more recently than this are kept, so an interrupted run resumes. */
const FRESH_MS = 24 * 60 * 60 * 1000;
/** Relations per Overpass request. */
const BATCH = 15;

const isFresh = (path: string): boolean =>
  existsSync(path) && Date.now() - statSync(path).mtimeMs < FRESH_MS;

/**
 * For each 五街道 with fetched tracks and post towns: a name pattern for its towns ("^(品川|…)(宿)?(跡)?$")
 * and the bounding box of its line with a 2 km margin, as Overpass wants it.
 */
const postTownBoxes = (): { pattern: string; box: string }[] =>
  LIST_DEFINITIONS.flatMap((definition) => {
    const { builder } = definition;
    if (builder.type !== 'gpx-route' || !builder.stages || builder.files === 'all') return [];
    const towns = loadPostTowns(builder.stages.towns);
    if (!towns || !builder.files.every((file) => gpxExists(file, builder.source))) return [];
    const points = builder.files.flatMap((file) => loadGpx(file, builder.source).lines.flat());
    const lats = points.map(([, lat]) => lat);
    const lons = points.map(([lon]) => lon);
    const margin = 0.02;
    const box = [
      Math.min(...lats) - margin,
      Math.min(...lons) - margin,
      Math.max(...lats) + margin,
      Math.max(...lons) + margin,
    ]
      .map((value) => value.toFixed(3))
      .join(',');
    const names = [...new Set(towns.items.flatMap((town) => townNames(town.ja)))]
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    return [{ pattern: `^(${names})(宿)?(跡)?$`, box }];
  });

const fetchOsm = async (context: Context): Promise<void> => {
  let failedSteps = 0;
  const routes = LIST_DEFINITIONS.flatMap((definition) =>
    definition.builder.type === 'osm-route' ? [{ id: definition.id, ...definition.builder }] : [],
  );
  const statements = routes.flatMap(({ route, name }) => {
    const routeTag = route === 'bicycle' ? '^bicycle$' : '^(hiking|foot|walking)$';
    return ['name', 'name:ja', 'name:en'].map(
      (key) =>
        `relation["type"~"^(route|superroute)$"]["route"~"${routeTag}"]["${key}"~"${quote(name)}",i](${JAPAN_BBOX});`,
    );
  });
  // Every national cycle route too, so the index shows what else exists.
  statements.push(`relation["type"="route"]["route"="bicycle"]["network"="ncn"](${JAPAN_BBOX});`);
  context.log.info('  Overpass: finding route relations');
  const indexText = await overpass(
    context,
    `[out:json][timeout:600];(${statements.join('')});out tags;`,
  );
  save(context, join(OSM_DIR, ROUTES_INDEX), indexText);
  const index = overpassSchema.parse(JSON.parse(indexText));
  context.log.info(`  ${index.elements.length} relations in the index`);

  // The small query first, so a later failure does not lose it.
  const peaksPath = join(OSM_DIR, 'yamanashi-peaks.json');
  if (isFresh(peaksPath)) {
    context.log.info('  yamanashi-peaks.json: fetched in the last 24 h, kept');
  } else {
    context.log.info('  Overpass: peaks in and around Yamanashi');
    try {
      save(
        context,
        peaksPath,
        await overpass(
          context,
          `[out:json][timeout:300];node["natural"="peak"]["name"](${YAMANASHI_BBOX});out;`,
        ),
      );
    } catch {
      // The route relations matter more; the peaks only fill gaps the GSI list leaves.
      context.log.warn(
        `  Yamanashi peaks not fetched; ${existsSync(peaksPath) ? 'the earlier file is kept' : 'the build places those peaks without them'}. Continuing with the routes.`,
      );
      failedSteps++;
    }
  }

  // Places named like the 五街道's post towns, for towns whose articles give no usable position.
  const townsPath = join(OSM_DIR, POST_TOWN_NODES);
  const townBoxes = postTownBoxes();
  if (townBoxes.length === 0) {
    context.log.info('  post towns: none fetched yet (lists fetch wikipedia, gokaido), skipped');
  } else if (isFresh(townsPath)) {
    context.log.info(`  ${POST_TOWN_NODES}: fetched in the last 24 h, kept`);
  } else {
    context.log.info('  Overpass: places named like the 五街道 post towns');
    try {
      const statements = townBoxes.map(
        ({ pattern, box }) => `node["name"~"${quote(pattern)}"](${box});`,
      );
      save(
        context,
        townsPath,
        await overpass(context, `[out:json][timeout:300];(${statements.join('')});out;`),
      );
    } catch {
      context.log.warn('  Post-town places not fetched. Continuing with the routes.');
      failedSteps++;
    }
  }

  const wanted = new Map<number, string>();
  for (const route of routes) {
    const matched = matchingRelations(index.elements, route.route, route.name, route.exclude);
    context.log.info(
      `  ${route.id}: ${matched.length === 0 ? 'no relation found' : `${matched.length} relation(s)`}`,
    );
    for (const element of matched) wanted.set(element.id, route.id);
  }
  const todo = [...wanted.keys()].filter((id) => !isFresh(join(OSM_DIR, relationFile(id))));
  if (todo.length < wanted.size)
    context.log.info(`  ${wanted.size - todo.length} relations fetched in the last 24 h, kept`);

  const failed: number[] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const ids = todo.slice(i, i + BATCH);
    context.log.info(
      `  Overpass: relations ${i + 1}–${i + ids.length} of ${todo.length}, with stages and geometry`,
    );
    await sleep(2000);
    let text: string;
    try {
      text = await overpass(
        context,
        `[out:json][timeout:900];relation(id:${ids.join(',')})->.top;rel(r.top)->.kids;rel(r.kids)->.grand;(.top;.kids;.grand;);out geom;`,
      );
    } catch {
      failed.push(...ids);
      continue;
    }
    // One file per requested relation: the relation and everything below it.
    const data = overpassSchema.parse(JSON.parse(text));
    const byId = new Map(
      data.elements
        .filter((element) => element.type === 'relation')
        .map((element) => [element.id, element]),
    );
    for (const id of ids) {
      const keep = new Map<number, unknown>();
      const visit = (relationId: number, depth: number) => {
        const relation = byId.get(relationId);
        if (!relation || keep.has(relationId) || depth > 3) return;
        keep.set(relationId, relation);
        for (const member of relation.members ?? [])
          if (member.type === 'relation') visit(member.ref, depth + 1);
      };
      visit(id, 0);
      if (keep.size === 0) {
        failed.push(id);
        continue;
      }
      save(
        context,
        join(OSM_DIR, relationFile(id)),
        `${JSON.stringify({ osm3s: data.osm3s, elements: [...keep.values()] })}\n`,
      );
    }
  }
  if (failed.length > 0 || failedSteps > 0) {
    throw new Error(
      `${failed.length > 0 ? `${failed.length} relations` : 'The Yamanashi peaks'} could not be fetched (Overpass busy?). Run \`pnpm jam lists fetch osm\` again later; finished files are kept.`,
    );
  }
};

// --- Ministry of the Environment: 東海自然歩道 ----------------------------------------------------

const fetchMoe = async (context: Context): Promise<void> => {
  const page = await (await request(MOE_PAGE)).text();
  const link = [...page.matchAll(/<a[^>]+href="([^"]+\.zip)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((match) => (match[2] ?? '').includes('東海自然歩道'))
    .map((match) => match[1])
    .find((href) => href !== undefined);
  if (!link) context.log.warn(`  No 東海自然歩道 zip link on the page; trying ${MOE_TOKAI_ZIP}`);
  const url = link ? new URL(link, MOE_PAGE).href : MOE_TOKAI_ZIP;
  const entries = readZip(new Uint8Array(await (await request(url)).arrayBuffer()));
  const gpx = entries.filter((entry) => entry.name.toLowerCase().endsWith('.gpx'));
  if (gpx.length === 0) throw new Error(`${url}: no GPX files in the archive`);
  const files: { file: string; entry: string; bytes: number }[] = [];
  const taken = new Set<string>();
  for (const entry of gpx) {
    const base = (entry.name.split('/').pop() ?? entry.name).replace(/[\\:*?"<>|]/g, '_');
    const file = taken.has(base) ? `${files.length + 1}-${base}` : base;
    taken.add(file);
    files.push({ file, entry: entry.name, bytes: entry.data.length });
    save(context, join(MOE_DIR, file), xmlText(entry.data));
  }
  // The notes the page asks users to read, as UTF-8 text.
  const notes: string[] = [];
  for (const entry of entries.filter((entry) => /\.txt$/i.test(entry.name))) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(entry.data);
    } catch {
      text = new TextDecoder('shift_jis').decode(entry.data);
    }
    const file = (entry.name.split('/').pop() ?? entry.name).replace(/[\\:*?"<>|]/g, '_');
    notes.push(file);
    save(context, join(MOE_DIR, file), text.replace(/\r\n/g, '\n'));
  }
  const manifest = {
    source: 'Ministry of the Environment (環境省)',
    page: MOE_PAGE,
    zip: url,
    fetchedAt: context.today,
    licence: '公共データ利用規約 (第1.0版), PDL1.0',
    files,
    notes,
    notExtracted: entries
      .filter((entry) => !/\.(gpx|txt)$/i.test(entry.name))
      .map((entry) => entry.name),
  };
  context.log.info(`  ${url}: ${files.length} GPX files`);
  save(context, join(MOE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
};

// --- 五街道 GPX (くにみち) ------------------------------------------------------------------------

/**
 * The 五街道 tracks are CC BY-NC-SA, so they are not committed: this fetches them from the
 * author's repository at a pinned commit, and checks each file against the hash of the copy
 * the lists were built and reviewed with.
 */
const GOKAIDO_REPO = 'https://raw.githubusercontent.com/japan-road-jp/Gokaodo-Map';
const GOKAIDO_COMMIT = '3d3094558b093774b23d1314c0180f26e64ab9c5';
const GOKAIDO_FILES = [
  [
    'data/gpx/Tokaido1_v3.gpx',
    'tokaido-1.gpx',
    '0fac17dcb7175671f1838831a00f774c5679466aee36ae2e58ea40886a8b1a4c',
  ],
  [
    'data/gpx/Tolaodo_2_v3.gpx',
    'tokaido-2.gpx',
    '2088978a0d38633270e8ec4ffd0dc0f47285801190513eede8064766af303c07',
  ],
  [
    'data/gpx/Nakasendo_1.2.gpx',
    'nakasendo.gpx',
    '6aed8b1af99e5b751b8297147d43c40516692ce819cee492dc67f4a99a7d7ce0',
  ],
  [
    'data/gpx/Koshu_Kaido_v2.gpx',
    'koshu-kaido.gpx',
    'd6c8248348878a77a3e2abd37b7dc259d6195871000a628129700cc6320e504b',
  ],
  [
    'data/gpx/Nikko Kaido.gpx',
    'nikko-kaido.gpx',
    '7648748a32202bcf29ed523ac4183f1e6482755046c2fb83b327be7e63a5d3b5',
  ],
  [
    'data/gpx/Oshu Kaido.gpx',
    'oshu-kaido.gpx',
    'dcc0e7cb55373dd999bedf38557ec79a5c26cf327aab422c5fcf5aff99d51728',
  ],
  ['LICENSE', 'LICENSE', 'c9f7a7e3b15c06be09252042fa585700447178453cf002fb55fd279114441695'],
] as const;

const fetchGokaido = async (context: Context): Promise<void> => {
  for (const [path, file, sha256] of GOKAIDO_FILES) {
    const url = `${GOKAIDO_REPO}/${GOKAIDO_COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const bytes = new Uint8Array(await (await request(url)).arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (hash !== sha256)
      throw new Error(
        `${path}: not the reviewed file (sha256 ${hash.slice(0, 12)}…, expected ${sha256.slice(0, 12)}…)`,
      );
    save(context, join(GOKAIDO_DIR, file), new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
};

// --- Prefecture outlines ----------------------------------------------------------------------

/**
 * N03 at full detail, one file per prefecture (its municipalities, as MLIT draws them), converted
 * to GeoJSON by niiyz/JapanCityGeoJson. Pinned to a commit, so the outlines only change on purpose.
 */
const OUTLINES_REPO = 'https://raw.githubusercontent.com/niiyz/JapanCityGeoJson';
const OUTLINES_COMMIT = 'f163894b3b6acfe31e772da6fce87b13427d3b56';

const fetchOutlines = async (context: Context): Promise<void> => {
  // Every prefecture is read before any is written: which stretches are land borders shows only
  // once both neighbours are in.
  const outlines = await buildOutlines(
    PREFECTURES.map(({ code }) => code),
    async (code) => {
      const file = (await (
        await request(`${OUTLINES_REPO}/${OUTLINES_COMMIT}/geojson/prefectures/${code}.json`)
      ).json()) as {
        features: {
          properties: { N03_001?: string };
          geometry: { type: string; coordinates: Position[][][] | Position[][] };
        }[];
      };
      const named = file.features[0]?.properties.N03_001;
      const ja = PREFECTURES.find((prefecture) => prefecture.code === code)?.ja;
      if (named !== ja) throw new Error(`${code}.json is ${named ?? 'unnamed'}, expected ${ja}`);
      return file.features.flatMap((feature) =>
        feature.geometry.type === 'MultiPolygon'
          ? (feature.geometry.coordinates as Position[][][])
          : [feature.geometry.coordinates as Position[][]],
      );
    },
    OUTLINE_OPTIONS,
    (code) => context.log.info(`  ${code}: read`),
  );
  for (const outline of outlines) {
    if (outline.area.length === 0) throw new Error(`${outline.code}: no outline left`);
    save(context, outlineFile(outline.code), `${JSON.stringify(outlineCollection(outline))}\n`);
  }
};

// --- Municipalities ---------------------------------------------------------------------------

/**
 * N03 municipalities simplified to 1 % by the SmartNews Media Research Institute (designated cities
 * whole), and their English names from nobuf/list-of-cities-in-japan (MIT). Both pinned to a commit.
 */
const MUNICIPALITIES_URL =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/b403e71eb97f1fdf32f63d16bd485129f703855e/data/municipality/geojson/s0010/N03-21_210101_designated_city.json';
const MUNICIPALITY_NAMES_URL =
  'https://raw.githubusercontent.com/nobuf/list-of-cities-in-japan/abffcb263d0fd92e5180ef7419909554fadf50c7/build/cities_in_japan_2024.csv';

const fetchMunicipalities = async (context: Context): Promise<void> => {
  const n03 = (await (await request(MUNICIPALITIES_URL)).json()) as Parameters<
    typeof municipalitiesFrom
  >[0];
  const names = await (await request(MUNICIPALITY_NAMES_URL)).text();
  const municipalities = municipalitiesFrom(n03, names);
  if (municipalities.length < 1700)
    throw new Error(`only ${municipalities.length} municipalities found; expected about 1,740`);
  save(context, MUNICIPALITIES_FILE, `${JSON.stringify(municipalityCollection(municipalities))}\n`);
  context.log.info(`  ${municipalities.length} municipalities`);
};

// --- Command ---------------------------------------------------------------------------------

export const fetchSources = async (
  sources: readonly FetchSource[],
  { dryRun, log }: { dryRun: boolean; log: Logger },
): Promise<number> => {
  const context: Context = { dryRun, log, today: new Date().toISOString().slice(0, 10) };
  const steps: Record<FetchSource, (context: Context) => Promise<void>> = {
    gsi: fetchGsi,
    highpoints: fetchHighpoints,
    wikidata: fetchWikidata,
    wikipedia: fetchWikipedia,
    osm: fetchOsm,
    moe: fetchMoe,
    gokaido: fetchGokaido,
    outlines: fetchOutlines,
    municipalities: fetchMunicipalities,
  };
  let failed = 0;
  for (const [index, source] of sources.entries()) {
    if (sources.length > 1) log.progress(index, sources.length, source);
    log.info(`${source}:`);
    try {
      await steps[source](context);
    } catch (error) {
      failed++;
      log.error(`  ${source} failed: ${describe(error)}`);
    }
  }
  log.info('');
  log.info(
    failed === 0
      ? 'Done. Run `pnpm jam lists build` next.'
      : `${failed} source(s) failed; the others were saved.`,
  );
  return failed === 0 ? 0 : 1;
};

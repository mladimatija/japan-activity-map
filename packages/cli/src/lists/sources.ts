import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  Feature,
  FeatureCollection,
  MultiPolygonGeometry,
  PolygonGeometry,
  SourceRef,
} from '@jam/core';
import { z } from 'zod';

import { parseGpx } from '../gpx.ts';
import { ROOT_DIR } from '../paths.ts';
import { readJson } from '../files.ts';

/** The built lists and their sources. JAM_LISTS_DIR points it elsewhere, for the dev checks. */
export const LISTS_DIR = process.env.JAM_LISTS_DIR
  ? resolve(process.env.JAM_LISTS_DIR)
  : join(ROOT_DIR, 'lists');
export const SOURCES_DIR = join(LISTS_DIR, 'sources');

export const SOURCE_REFS = {
  gsi: {
    id: 'gsi-mountains',
    name: '国土地理院「日本の主な山岳標高」 (GSI list of Japan’s main mountains)',
    url: 'https://www.gsi.go.jp/kihonjohochousa/kihonjohochousa41139.html',
    licence: 'GSI content terms of use (compatible with CC BY 4.0)',
    attribution: '出典：国土地理院「日本の主な山岳標高」を加工して作成 (Source: GSI, processed)',
    licenceJa: '国土地理院コンテンツ利用規約（CC BY 4.0互換）',
    attributionJa: '出典：国土地理院「日本の主な山岳標高」を加工して作成',
  },
  mountix: {
    id: 'mountix',
    name: 'mountix (machine-readable copy of an earlier edition of the GSI list)',
    url: 'https://github.com/codemountains/mountix',
    licence: 'MIT',
    attribution: 'mountix by codemountains (MIT)',
    attributionJa: 'codemountains「mountix」（MIT）',
  },
  gsiHighpoints: {
    id: 'gsi-highpoints',
    name: '国土地理院「都道府県の最高地点」 (GSI table of prefectural high points)',
    url: 'https://www.gsi.go.jp/KOKUJYOHO/MOUNTAIN/todofuken.pdf',
    licence: 'GSI content terms of use (compatible with CC BY 4.0)',
    attribution: '出典：国土地理院「都道府県の最高地点」を加工して作成 (Source: GSI, processed)',
    licenceJa: '国土地理院コンテンツ利用規約（CC BY 4.0互換）',
    attributionJa: '出典：国土地理院「都道府県の最高地点」を加工して作成',
  },
  kongo: {
    id: 'kongo',
    name: 'kongo: Famous Mountains in Japan',
    url: 'https://github.com/ryunosuke0922/kongo',
    licence: 'MIT',
    attribution: 'List membership, numbering and English names from kongo by ryunosuke (MIT)',
    attributionJa: 'リストの構成・番号・英語名：ryunosuke「kongo」（MIT）',
  },
  n03: {
    id: 'n03',
    name: '国土交通省 国土数値情報（行政区域データ）',
    url: 'https://nlftp.mlit.go.jp/ksj/',
    licence: 'MLIT National Land Numerical Information terms of use',
    attribution:
      '出典：国土交通省国土数値情報（行政区域データ）を加工して作成 (Source: MLIT National Land Numerical Information, processed; simplified by SmartNews Media Research Institute)',
    licenceJa: '国土数値情報利用約款',
    attributionJa: '出典：国土交通省国土数値情報（行政区域データ）を加工して作成',
  },
  wikidata: {
    id: 'wikidata',
    name: 'Wikidata',
    url: 'https://www.wikidata.org/',
    licence: 'CC0 1.0',
    attribution:
      'Membership, numbering and coordinates of the temple and castle lists from Wikidata (CC0)',
    attributionJa: '寺院と城のリストの構成・番号・座標：Wikidata（CC0）',
  },
  wikipedia: {
    id: 'wikipedia-ja',
    name: 'Japanese Wikipedia: 山梨百名山',
    url: 'https://ja.wikipedia.org/wiki/%E5%B1%B1%E6%A2%A8%E7%99%BE%E5%90%8D%E5%B1%B1',
    licence: 'CC BY-SA 4.0',
    attribution: 'List of the Yamanashi 100 Mountains from Japanese Wikipedia, CC BY-SA 4.0',
    attributionJa: '山梨百名山のリスト：日本語版ウィキペディア（CC BY-SA 4.0）',
  },
  wikipediaLists: {
    id: 'wikipedia-ja-lists',
    name: 'Japanese Wikipedia list articles: 四国八十八箇所, 西国三十三所, 日本100名城, 続日本100名城',
    url: 'https://ja.wikipedia.org/',
    licence: 'CC BY-SA 4.0',
    attribution:
      'Membership and numbering of the temple and castle lists from Japanese Wikipedia, CC BY-SA 4.0',
    attributionJa: '寺院と城のリストの構成と番号：日本語版ウィキペディア（CC BY-SA 4.0）',
  },
  wikipediaPlaces: {
    id: 'wikipedia-ja-place-lists',
    name: 'Japanese Wikipedia list articles: 花の百名山, 関東百名山, 関西百名山, 日本の滝百選',
    url: 'https://ja.wikipedia.org/',
    licence: 'CC BY-SA 4.0',
    attribution:
      'Membership and order of the 花の百名山, 関東百名山, 関西百名山 and 日本の滝百選 lists from Japanese Wikipedia, CC BY-SA 4.0',
    attributionJa:
      '花の百名山・関東百名山・関西百名山・日本の滝百選の構成と順序：日本語版ウィキペディア（CC BY-SA 4.0）',
  },
  michi100: {
    id: 'wikipedia-ja-michi-100',
    name: 'Japanese Wikipedia: 日本の道100選',
    url: 'https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E3%81%AE%E9%81%93100%E9%81%B8',
    licence: 'CC BY-SA 4.0',
    attribution: 'Membership and order of 日本の道100選 from Japanese Wikipedia, CC BY-SA 4.0',
    attributionJa: '日本の道100選の構成と順序：日本語版ウィキペディア（CC BY-SA 4.0）',
  },
  gokaido: {
    id: 'gokaido-map',
    name: '五街道GPX・五街道KML・五街道SHP (国道愛好家 くにみち)',
    url: 'https://github.com/japan-road-jp/Gokaodo-Map',
    licence: 'CC BY-NC-SA 4.0',
    attribution:
      '五街道データ: 国道愛好家 くにみち「五街道GPX・五街道KML・五街道SHP」CC BY-NC-SA 4.0 (processed; derived route files are shared under the same licence)',
    attributionJa:
      '五街道データ：国道愛好家 くにみち「五街道GPX・五街道KML・五街道SHP」CC BY-NC-SA 4.0（加工して作成。派生したルートファイルも同じライセンスで共有）',
  },
  moe: {
    id: 'moe-tokai-gpx',
    name: '環境省「東海自然歩道GPSデータ」 (Ministry of the Environment GPS data for the Tōkai Nature Trail)',
    url: 'https://www.env.go.jp/nature/long-trail.html',
    licence: '公共データ利用規約 (第1.0版) / Public Data License 1.0 (compatible with CC BY 4.0)',
    attribution:
      '出典：環境省「東海自然歩道GPSデータ」(https://www.env.go.jp/nature/long-trail.html) を加工して作成、PDL1.0 (Source: Ministry of the Environment, processed)',
    licenceJa: '公共データ利用規約（第1.0版）（CC BY 4.0互換）',
    attributionJa:
      '出典：環境省「東海自然歩道GPSデータ」(https://www.env.go.jp/nature/long-trail.html) を加工して作成、PDL1.0',
  },
  cityNames: {
    id: 'city-names',
    name: 'list-of-cities-in-japan (nobuf)',
    url: 'https://github.com/nobuf/list-of-cities-in-japan',
    licence: 'MIT',
    attribution: 'English names of municipalities from list-of-cities-in-japan by nobuf (MIT)',
    attributionJa: '市区町村の英語名：nobuf「list-of-cities-in-japan」（MIT）',
  },
  osm: {
    id: 'openstreetmap',
    name: 'OpenStreetMap',
    url: 'https://www.openstreetmap.org/copyright',
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors (ODbL)',
  },
} as const satisfies Record<string, SourceRef>;

// --- GSI mountain list -------------------------------------------------------------------------

/** One row of GSI's mountain list, whichever copy it came from. */
export interface GsiRow {
  serial: number;
  /** As GSI writes it, with half-width brackets: "大雪山<旭岳>". */
  name: string;
  kana: string;
  elevationM: number;
  /** Japanese prefecture names. */
  prefectures: string[];
  lon: number;
  lat: number;
}

export interface GsiList {
  edition: string;
  rows: GsiRow[];
  /** Sources to credit for this copy. */
  sources: SourceRef[];
}

const mountixSchema = z.looseObject({
  _id: z.int().positive(),
  name: z.string().min(1),
  name_kana: z.string(),
  prefectures: z.array(z.string()).min(1),
  elevation: z.number(),
  location: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }),
});

const GSI_DIR = join(SOURCES_DIR, 'gsi-mountains');
const CSV_HEADER =
  '連番,索引番号,山名＜山頂名＞,山名よみ＜山頂名よみ＞,標高値(m),種別,都道府県,緯度,経度';

/** GSI's own CSV, as saved by `jam lists fetch` (UTF-8), for example 1003zan20260331.csv. */
const latestGsiCsv = (): string | undefined => {
  if (!existsSync(GSI_DIR)) return undefined;
  return readdirSync(GSI_DIR)
    .filter((name) => /^1003zan\d{8}\.csv$/.test(name))
    .sort((a, b) => a.localeCompare(b))
    .at(-1);
};

const halfWidthBrackets = (text: string) => text.replace(/＜/g, '<').replace(/＞/g, '>').trim();

export const parseGsiCsv = (text: string): GsiRow[] => {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  if (lines[0] !== CSV_HEADER) throw new Error(`Unexpected GSI CSV header: ${lines[0]}`);
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== 9) throw new Error(`GSI CSV line ${index + 2}: expected 9 cells`);
    const [serial, , name, kana, elevation, , prefectures, lat, lon] = cells;
    return {
      serial: z.coerce.number().int().positive().parse(serial),
      name: halfWidthBrackets(name ?? ''),
      kana: halfWidthBrackets(kana ?? ''),
      elevationM: z.coerce.number().parse(elevation),
      prefectures: (prefectures ?? '').split(/[\s　]+/).filter(Boolean),
      lat: z.coerce.number().parse(lat),
      lon: z.coerce.number().parse(lon),
    };
  });
};

/** GSI's own CSV when `jam lists fetch` has saved one, otherwise the older mountix copy. */
export const loadGsiList = (): GsiList => {
  const csv = latestGsiCsv();
  if (csv) {
    const date = /(\d{4})(\d{2})(\d{2})/.exec(csv);
    return {
      edition: date ? `${date[1]}-${date[2]}-${date[3]}` : csv,
      rows: parseGsiCsv(readFileSync(join(GSI_DIR, csv), 'utf8')),
      sources: [SOURCE_REFS.gsi],
    };
  }
  const text = readFileSync(join(GSI_DIR, 'mountains.jsonl'), 'utf8');
  const rows = text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const row = mountixSchema.parse(JSON.parse(line));
      return {
        serial: row._id,
        name: row.name,
        kana: row.name_kana,
        elevationM: row.elevation,
        prefectures: row.prefectures,
        lon: row.location.coordinates[0],
        lat: row.location.coordinates[1],
      };
    });
  return {
    edition: 'before 2025-04-01 (mountix copy)',
    rows,
    sources: [SOURCE_REFS.gsi, SOURCE_REFS.mountix],
  };
};

// --- GSI prefectural high points ---------------------------------------------------------------

const highpointsSchema = z.object({
  edition: z.string(),
  items: z
    .array(
      z.object({
        prefecture: z.string(),
        name: z.string().min(1),
        kana: z.string().optional(),
        elevationM: z.number(),
        lat: z.number(),
        lon: z.number(),
      }),
    )
    .length(47),
});
export const HIGHPOINTS_FILE = join(SOURCES_DIR, 'gsi-highpoints', 'todofuken.json');

export const loadHighpoints = (): z.infer<typeof highpointsSchema> =>
  highpointsSchema.parse(readJson(HIGHPOINTS_FILE));

// --- kongo -------------------------------------------------------------------------------------

const kongoItemSchema = z.looseObject({
  no: z.int().positive(),
  name: z.string().min(1),
  kanaName: z.string().optional(),
  elevation: z.number(),
  nameEn: z.string().min(1),
  longitude: z.number(),
  latitude: z.number(),
  yamapLandmarkId: z.int().optional(),
});
export type KongoItem = z.infer<typeof kongoItemSchema>;

const sambyakuSourceSchema = z.array(
  z.object({ landmarkId: z.int(), sourceNumber: z.int().positive(), sourceName: z.string() }),
);

export type KongoFile =
  | 'mountains'
  | 'nihyakumeizan'
  | 'sambyakumeizan'
  | 'hyakukozan'
  | 'hyakuteizan';

export const loadKongo = (file: KongoFile): KongoItem[] => {
  const items = z
    .array(kongoItemSchema)
    .parse(readJson(join(SOURCES_DIR, 'kongo', `${file}.json`)));
  return items.toSorted((a, b) => a.no - b.no);
};

/** Official 300 Meizan numbers (Japanese Alpine Club), keyed by kongo's landmark id. */
export const loadSambyakuNumbers = (): Map<number, number> => {
  const rows = sambyakuSourceSchema.parse(
    readJson(join(SOURCES_DIR, 'kongo', 'sambyakumeizan-source.json')),
  );
  return new Map(rows.map((row) => [row.landmarkId, row.sourceNumber]));
};

// --- Wikidata temples --------------------------------------------------------------------------

export const templeFileSchema = z.object({
  source: z.literal('Wikidata'),
  circuit: z.string().regex(/^Q\d+$/),
  circuitLabel: z.string(),
  fetchedAt: z.string(),
  query: z.string(),
  items: z
    .array(
      z.object({
        qid: z.string().regex(/^Q\d+$/),
        order: z.int().positive(),
        ja: z.string().min(1),
        en: z.string().min(1).optional(),
        lon: z.number().optional(),
        lat: z.number().optional(),
      }),
    )
    .min(1),
});
type TempleFile = z.infer<typeof templeFileSchema>;
export const templeFile = (key: string) => join(SOURCES_DIR, 'wikidata', `${key}.json`);

export const loadTemples = (key: string): TempleFile =>
  templeFileSchema.parse(readJson(templeFile(key)));

// --- Wikipedia: 山梨百名山 -----------------------------------------------------------------------

export const yamanashiFileSchema = z.object({
  source: z.literal('Japanese Wikipedia'),
  page: z.string(),
  revid: z.int(),
  fetchedAt: z.string(),
  note: z.string(),
  items: z
    .array(
      z.object({
        no: z.int().positive(),
        name: z.string().min(1),
        kana: z.string().min(1),
        elevationM: z.number(),
        range: z.string(),
        article: z.string().nullable(),
        lat: z.number().optional(),
        lon: z.number().optional(),
      }),
    )
    .length(100),
});
type YamanashiFile = z.infer<typeof yamanashiFileSchema>;
export const YAMANASHI_FILE = join(SOURCES_DIR, 'wikipedia', 'yamanashi-hyakumeizan.json');

export const loadYamanashi = (): YamanashiFile =>
  yamanashiFileSchema.parse(readJson(YAMANASHI_FILE));

// --- Wikipedia list articles: numbered temples and castles --------------------------------------

const latLonPoint = z.object({ lat: z.number(), lon: z.number() });

/** Where a list read from a Japanese Wikipedia article came from: the page and its revision. */
const wikipediaArticle = {
  source: z.literal('Japanese Wikipedia'),
  page: z.string().min(1),
  revid: z.int().positive(),
  fetchedAt: z.string(),
  note: z.string(),
};

export const wikipediaSetSchema = z.object({
  ...wikipediaArticle,
  /** What the fetch could not read cleanly (numbers with no entry, names with no article). */
  problems: z.array(z.string()).optional(),
  items: z
    .array(
      z.object({
        order: z.int().positive(),
        ja: z.string().min(1),
        /** The linked article; absent when the list gives the name as plain text. */
        article: z.string().min(1).optional(),
        qid: z
          .string()
          .regex(/^Q\d+$/)
          .optional(),
        en: z.string().min(1).optional(),
        /** P625 of the article's Wikidata item. */
        wikidata: latLonPoint.optional(),
        /** The article's primary coordinates (GeoData). */
        wikipedia: latLonPoint.optional(),
      }),
    )
    .min(1),
});
type WikipediaSet = z.infer<typeof wikipediaSetSchema>;
export const wikipediaSetFile = (key: string) => join(SOURCES_DIR, 'wikipedia', `${key}.json`);

export const loadWikipediaSet = (key: string): WikipediaSet =>
  wikipediaSetSchema.parse(readJson(wikipediaSetFile(key)));

// --- Wikipedia: post towns of the 五街道 --------------------------------------------------------

export const postTownsSchema = z.object({
  ...wikipediaArticle,
  items: z
    .array(
      z.object({
        /** Position in the article, which runs from the start of the highway to its end. */
        seq: z.int().nonnegative(),
        /** The article's number for the post town (1 = the first after 日本橋). */
        number: z.int().positive(),
        ja: z.string().min(1),
        article: z.string().min(1).optional(),
        qid: z
          .string()
          .regex(/^Q\d+$/)
          .optional(),
        en: z.string().min(1).optional(),
        wikidata: latLonPoint.optional(),
        wikipedia: latLonPoint.optional(),
      }),
    )
    .min(1),
});
type PostTowns = z.infer<typeof postTownsSchema>;
export const postTownsFile = (key: string) =>
  join(SOURCES_DIR, 'wikipedia', `post-towns-${key}.json`);

export const loadPostTowns = (key: string): PostTowns | undefined => {
  const path = postTownsFile(key);
  return existsSync(path) ? postTownsSchema.parse(readJson(path)) : undefined;
};

// --- OpenStreetMap -----------------------------------------------------------------------------

export const OSM_DIR = join(SOURCES_DIR, 'osm');

const osmTags = z.record(z.string(), z.string()).default({});
const latLon = z.object({ lat: z.number(), lon: z.number() });

export const overpassSchema = z.looseObject({
  osm3s: z.looseObject({ timestamp_osm_base: z.string().optional() }).optional(),
  elements: z.array(
    z.looseObject({
      type: z.enum(['node', 'way', 'relation']),
      id: z.int(),
      tags: osmTags,
      lat: z.number().optional(),
      lon: z.number().optional(),
      geometry: z.array(latLon).optional(),
      members: z
        .array(
          z.looseObject({
            type: z.enum(['node', 'way', 'relation']),
            ref: z.int(),
            role: z.string(),
            geometry: z.array(latLon.nullable()).optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export type Overpass = z.infer<typeof overpassSchema>;
export type OsmElement = Overpass['elements'][number];

export const loadOsm = (name: string): Overpass | undefined => {
  const path = join(OSM_DIR, name);
  return existsSync(path) ? overpassSchema.parse(readJson(path)) : undefined;
};

// --- 五街道 GPX ----------------------------------------------------------------------------------

export const GOKAIDO_DIR = join(SOURCES_DIR, 'gokaido');
/** 東海自然歩道 GPX files from the Ministry of the Environment, written by `jam lists fetch moe`. */
export const MOE_DIR = join(SOURCES_DIR, 'moe-tokai');
export const GPX_DIRS = { gokaido: GOKAIDO_DIR, moe: MOE_DIR } as const;

/**
 * Each prefecture's outline at full N03 detail, simplified to about 15 m, written by
 * `jam lists fetch outlines`: what the map draws round a selected prefecture when zoomed in.
 */
export const OUTLINES_DIR = join(SOURCES_DIR, 'n03-prefectures', 'outlines');
export const outlineFile = (code: string) => join(OUTLINES_DIR, `${code}.geojson`);
export type GpxSource = keyof typeof GPX_DIRS;

export const gpxExists = (file: string, source: GpxSource) =>
  existsSync(join(GPX_DIRS[source], file));

/** The GPX files of a source folder, sorted; empty when the folder is missing. */
export const gpxFiles = (source: GpxSource): string[] => {
  const dir = GPX_DIRS[source];
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((file) => file.toLowerCase().endsWith('.gpx'))
        .sort((a, b) => a.localeCompare(b))
    : [];
};

interface GpxTrack {
  name?: string;
  lines: [number, number][][];
}

const gpxName = (xml: string) =>
  /<name>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/name>/.exec(xml)?.[1]?.trim();
const lonLatLines = (xml: string) =>
  parseGpx(xml).segments.map((segment) =>
    segment.map((point): [number, number] => [point.lon, point.lat]),
  );

/** A GPX file's lines as [lon, lat], its first name element, and the same split by track. */
export const loadGpx = (
  file: string,
  source: GpxSource = 'gokaido',
): { lines: [number, number][][]; name?: string; tracks: GpxTrack[] } => {
  const xml = readFileSync(join(GPX_DIRS[source], file), 'utf8');
  const name = gpxName(xml);
  const tracks = [...xml.matchAll(/<trk\b[\s\S]*?<\/trk>/g)].flatMap((match): GpxTrack[] => {
    try {
      const trackName = gpxName(match[0]);
      return [
        { ...(trackName ? { name: trackName } : {}), lines: lonLatLines(`<gpx>${match[0]}</gpx>`) },
      ];
    } catch {
      return [];
    }
  });
  return { lines: lonLatLines(xml), ...(name ? { name } : {}), tracks };
};

// --- N03 prefecture outlines -------------------------------------------------------------------

const prefectureFileSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(
    z.object({
      type: z.literal('Feature'),
      properties: z.object({ N03_001: z.string() }),
      geometry: z.object({
        type: z.enum(['Polygon', 'MultiPolygon']),
        coordinates: z.array(z.any()),
      }),
    }),
  ),
});

export type PrefectureShape = Feature<PolygonGeometry | MultiPolygonGeometry, { N03_001: string }>;
export type PrefectureShapes = FeatureCollection<PrefectureShape>;

export const loadPrefectureShapes = (detail: 's0010' | 's0001'): PrefectureShapes => {
  const data = prefectureFileSchema.parse(
    readJson(join(SOURCES_DIR, 'n03-prefectures', `prefectures-${detail}.json`)),
  );
  return data as unknown as PrefectureShapes;
};

// --- Hand-assembled lists ----------------------------------------------------------------------

const curatedSchema = z.strictObject({
  page: z.string().optional(),
  checked: z.string().optional(),
  note: z.string().optional(),
  items: z.array(
    z.strictObject({
      order: z.number().int().positive(),
      ja: z.string().min(1),
      en: z.string().min(1),
      /** Prefecture code, for an item with no position. */
      prefecture: z.string().regex(/^\d{2}$/),
      municipality: z.string().optional(),
      lat: z.number().min(20).max(46).optional(),
      lon: z.number().min(122).max(154).optional(),
      /** Where the position comes from, and the article, item or object it was read from. */
      from: z.enum(['wikipedia', 'wikidata', 'osm']).optional(),
      ref: z.string().optional(),
    }),
  ),
});
export type CuratedList = z.infer<typeof curatedSchema>;

/** A list kept by hand under lists/sources (see its SOURCE.md), positions included. */
export const loadCurated = (folder: string, file: string): CuratedList =>
  curatedSchema.parse(readJson(join(SOURCES_DIR, folder, `${file}.json`)));

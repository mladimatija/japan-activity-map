import type { CatalogEntry, SourceRef } from '@jam/core';

import type { WikipediaSetKind } from './points.ts';
import { type GpxSource, type KongoFile, SOURCE_REFS } from './sources.ts';

type Base = Pick<CatalogEntry, 'id' | 'title' | 'kind' | 'theme' | 'phase'> & {
  description: string;
  /** How many items the complete list has, where that is fixed. */
  expectedSize?: number;
  /** The official length of a route list, in km, to tell a complete route from a fragment. */
  officialKm?: number;
  countingRule?: string;
  /** Sources besides the ones the builder adds itself (the GSI edition in use, for example). */
  sources: SourceRef[];
};

export type Builder =
  | { type: 'kongo'; file: KongoFile }
  | { type: 'prefecture-highpoints' }
  | { type: 'peaks-3000m' }
  | { type: 'yamanashi' }
  /** A numbered set on Wikidata (see CIRCUITS in fetch.ts), one place per member. */
  | { type: 'wikidata'; key: string; kind: 'temple' | 'castle' }
  /**
   * A list article on Japanese Wikipedia (see WIKIPEDIA_SETS and WIKIPEDIA_PLACE_LISTS in
   * fetch.ts); `kind` is what its members are.
   */
  | { type: 'wikipedia-set'; key: string; kind: WikipediaSetKind }
  /** A list put together by hand in lists/sources/<folder>/<file>.json, positions included. */
  | { type: 'curated'; folder: string; file: string }
  | {
      type: 'gpx-route';
      /** The folder under lists/sources the GPX files are in. */
      source: GpxSource;
      /** File names, or every GPX file in the folder. */
      files: string[] | 'all';
      name: { ja: string; en: string; kana: string };
      note?: string;
      /** One item per file or per track, instead of one for the whole route. */
      split?: 'file' | 'track';
      /** Tracks whose name matches this are left out (with split: 'track'). */
      excludeTracks?: string;
      /** With split: 'track', name each track by this label and the prefectures it runs between. */
      trackNames?: { ja: string; en: string };
      /**
       * Split the route into stages between post towns (lists/sources/wikipedia/post-towns-*.json),
       * named from the start and end of the line where no post town is.
       */
      stages?: {
        towns: string;
        start: { ja: string; en: string };
        end: { ja: string; en: string };
      };
    }
  | {
      type: 'osm-route';
      route: 'bicycle' | 'hiking';
      /** Regular expression for the relation's name, name:ja or name:en tag. */
      name: string;
      /** Relations whose name also matches this are left out (connectors, unrelated routes). */
      exclude?: string;
      note?: string;
      /** Stages are ordered by the numbers in their names (四国遍路: 1番 … 88番). */
      numeric?: boolean;
    };

export type ListDefinition = Base & { builder: Builder };

const kongoSources = [SOURCE_REFS.kongo];

/**
 * Why a route may stay unbuilt, added to the reason the build gives when OpenStreetMap has no
 * matching relation. Checked November 2026.
 */
const BLOCKED_NOTES: Record<string, string> = {
  'yukiguni-uonuma-golden-cycle-route':
    'Designated in July 2026 (193 km, three stages); the official route is only in the ツール・ド app, with no open data.',
  amaichi:
    'Designated in July 2026 (about 150 km, 三角駅 to 牛深港); the official map links a Ride with GPS route with no licence for reuse.',
  'japan-trail': 'About 10,000 km, published only in the Japan Long Trail Association app.',
};

/**
 * Official lengths of the long-distance nature trails, from the Ministry of the Environment's
 * 2023 table (自然公園等の利用者数, 長距離自然歩道 距離).
 */
const OFFICIAL_KM: Record<string, number> = {
  'kanto-fureai-no-michi': 1797.3,
  'kyushu-shizen-hodo': 2934.9,
  'chugoku-shizen-hodo': 2293.7,
  'shikoku-shizen-hodo': 1645.4,
  'kinki-shizen-hodo': 3291.7,
  'chubu-hokuriku-shizen-hodo': 4092,
  'tohoku-shizen-hodo': 4368.7,
  'hokkaido-shizen-hodo': 4599.7,
  'michinoku-coastal-trail': 1030.9,
};

/** Where each 五街道 line starts and ends, for naming the first and last stage. */
interface Ends {
  start: { ja: string; en: string };
  end: { ja: string; en: string };
}
const NIHONBASHI = { ja: '日本橋', en: 'Nihonbashi' };
const GOKAIDO_ENDS: Record<string, Ends> = {
  tokaido: { start: NIHONBASHI, end: { ja: '三条大橋', en: 'Sanjō Ōhashi' } },
  nakasendo: { start: NIHONBASHI, end: { ja: '草津追分', en: 'Kusatsu-oiwake' } },
  'koshu-kaido': { start: NIHONBASHI, end: { ja: '下諏訪追分', en: 'Shimosuwa-oiwake' } },
  'nikko-kaido': { start: NIHONBASHI, end: { ja: '日光神橋', en: 'Shinkyō' } },
  'oshu-kaido': {
    start: { ja: '宇都宮', en: 'Utsunomiya' },
    end: { ja: '白河追分', en: 'Shirakawa-oiwake' },
  },
};

const gokaidoStages = (id: string): Ends & { towns: string } => {
  const ends = GOKAIDO_ENDS[id];
  if (!ends) throw new Error(`No start and end names for ${id}`);
  return { towns: id, ...ends };
};

export const LIST_DEFINITIONS: ListDefinition[] = [
  {
    id: 'hyakumeizan',
    title: { en: '100 Famous Japanese Mountains', ja: '日本百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'kongo', file: 'mountains' },
    description: "Fukada Kyūya's 1964 list. Numbered in Fukada's order, north to south.",
    expectedSize: 100,
    sources: kongoSources,
  },
  {
    id: 'nihyakumeizan',
    title: { en: '200 Famous Japanese Mountains (#101–200)', ja: '日本二百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'kongo', file: 'nihyakumeizan' },
    description:
      'The 100 mountains added to the 100 Meizan to make the 200 Meizan. Numbered by reading.',
    expectedSize: 100,
    sources: kongoSources,
  },
  {
    id: 'sambyakumeizan',
    title: { en: '300 Famous Japanese Mountains (#201–300)', ja: '日本三百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'kongo', file: 'sambyakumeizan' },
    description:
      "The 100 mountains added to the 200 Meizan to make the 300 Meizan. Each item also carries its number in the Japanese Alpine Club's full 300 list.",
    expectedSize: 100,
    sources: kongoSources,
  },
  {
    id: 'prefecture-highpoints',
    title: { en: 'Highest point of each prefecture', ja: '都道府県の最高地点' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'prefecture-highpoints' },
    description:
      "One item per prefecture, as in GSI's table of prefectural high points. Four are not summits: the high point lies on a slope or a subsidiary top, and the summit is in the neighbouring prefecture.",
    expectedSize: 47,
    sources: [SOURCE_REFS.gsiHighpoints],
  },
  {
    id: 'peaks-3000m',
    title: { en: 'Peaks of 3,000 m and higher', ja: '日本の3000m峰' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'peaks-3000m' },
    description: 'Every peak of 3,000 m or more, highest first.',
    expectedSize: 21,
    countingRule:
      "The common 21-peak count: every entry of 3,000 m or more in GSI's mountain list except 荒川前岳 and 農鳥岳 (east summit), which are counted with their neighbours. GSI lists 23.",
    sources: [],
  },
  {
    id: 'yamanashi-hyakumeizan',
    title: { en: 'Yamanashi 100 Mountains', ja: '山梨百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'first',
    builder: { type: 'yamanashi' },
    description:
      'Chosen by Yamanashi Prefecture in 1997. Numbered by the prefecture, grouped by mountain range.',
    expectedSize: 100,
    sources: [SOURCE_REFS.wikipedia],
  },
  {
    id: 'bando-33',
    title: { en: 'Bandō 33 Kannon', ja: '坂東三十三観音' },
    kind: 'point',
    theme: 'pilgrimage',
    phase: 'first',
    builder: { type: 'wikidata', key: 'bando-33', kind: 'temple' },
    description:
      'The 33 Kannon temples of the Kantō, from Kamakura to the tip of the Bōsō peninsula.',
    expectedSize: 33,
    sources: [SOURCE_REFS.wikidata],
  },
  {
    id: 'chichibu-34',
    title: { en: 'Chichibu 34 Kannon', ja: '秩父三十四観音' },
    kind: 'point',
    theme: 'pilgrimage',
    phase: 'first',
    builder: { type: 'wikidata', key: 'chichibu-34', kind: 'temple' },
    description: 'The 34 Kannon temples of the Chichibu basin, about 100 km on foot.',
    expectedSize: 34,
    sources: [SOURCE_REFS.wikidata],
  },
  {
    id: 'shikoku-88',
    title: { en: 'Shikoku 88 Temples', ja: '四国八十八箇所' },
    kind: 'point',
    theme: 'pilgrimage',
    phase: 'first',
    builder: { type: 'wikipedia-set', key: 'shikoku-88', kind: 'temple' },
    description:
      'The 88 temples of the Shikoku pilgrimage (四国遍路), round the island from 霊山寺 to 大窪寺. The walking route itself is the Shikoku Henro list.',
    expectedSize: 88,
    sources: [SOURCE_REFS.wikipediaLists, SOURCE_REFS.wikidata],
  },
  {
    id: 'saigoku-33',
    title: { en: 'Saigoku 33 Kannon', ja: '西国三十三所' },
    kind: 'point',
    theme: 'pilgrimage',
    phase: 'first',
    builder: { type: 'wikipedia-set', key: 'saigoku-33', kind: 'temple' },
    description:
      "The 33 Kannon temples of the Kansai and Gifu, Japan's oldest pilgrimage, from 青岸渡寺 to 華厳寺.",
    expectedSize: 33,
    sources: [SOURCE_REFS.wikipediaLists, SOURCE_REFS.wikidata],
  },
  {
    id: 'nihon-100-meijo',
    title: { en: '100 Fine Castles of Japan', ja: '日本100名城' },
    kind: 'point',
    theme: 'castles',
    phase: 'first',
    builder: { type: 'wikipedia-set', key: 'castles-100', kind: 'castle' },
    description:
      "The Japan Castle Foundation's 2006 list, numbered north to south. Visiting means reaching the castle grounds.",
    expectedSize: 100,
    sources: [SOURCE_REFS.wikipediaLists, SOURCE_REFS.wikidata],
  },
  {
    id: 'zoku-nihon-100-meijo',
    title: { en: 'Continued 100 Fine Castles of Japan', ja: '続日本100名城' },
    kind: 'point',
    theme: 'castles',
    phase: 'first',
    builder: { type: 'wikipedia-set', key: 'castles-zoku-100', kind: 'castle' },
    description:
      "The Japan Castle Foundation's 2017 sequel, numbered 101 to 200, north to south. Many are hilltop ruins.",
    expectedSize: 100,
    sources: [SOURCE_REFS.wikipediaLists, SOURCE_REFS.wikidata],
  },
  {
    id: 'hyakukozan',
    title: { en: '100 Highest Mountains of Japan', ja: '日本百高山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'later',
    builder: { type: 'kongo', file: 'hyakukozan' },
    description: 'The 100 highest mountains, ranked by elevation.',
    expectedSize: 100,
    sources: kongoSources,
  },
  {
    id: 'hyakuteizan',
    title: { en: '100 Low Mountains of Japan', ja: '日本百低山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'later',
    builder: { type: 'kongo', file: 'hyakuteizan' },
    description:
      'Low mountains worth the climb, all under 1,500 m: 101 of them, from Hokkaidō to Okinawa. Membership and numbering as in the kongo project.',
    expectedSize: 101,
    sources: kongoSources,
  },
  {
    id: 'hana-no-hyakumeizan',
    title: { en: '100 Mountains of Flowers', ja: '花の百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'later',
    builder: { type: 'wikipedia-set', key: 'hana-no-hyakumeizan', kind: 'peak' },
    description:
      "Tanaka Sumie's 1980 book: a hundred mountains, each for a flower. Many are low, and best in the flower's season.",
    expectedSize: 100,
    countingRule:
      'Where the article links a mountain that GSI lists, the place is its GSI summit; otherwise the position of its Wikipedia article.',
    sources: [SOURCE_REFS.wikipediaPlaces, SOURCE_REFS.wikidata],
  },
  {
    id: 'kanto-hyakumeizan',
    title: { en: 'Kantō 100 Mountains', ja: '関東百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'later',
    builder: { type: 'wikipedia-set', key: 'kanto-hyakumeizan', kind: 'peak' },
    description:
      'A hundred mountains of the Kantō chosen by the publisher Yama-kei (山と溪谷社), from Nasu to the Izu islands.',
    expectedSize: 100,
    countingRule:
      'Where the article links a mountain that GSI lists, the place is its GSI summit; otherwise the position of its Wikipedia article.',
    sources: [SOURCE_REFS.wikipediaPlaces, SOURCE_REFS.wikidata],
  },
  {
    id: 'kansai-hyakumeizan',
    title: { en: 'Kansai 100 Mountains', ja: '関西百名山' },
    kind: 'point',
    theme: 'peaks',
    phase: 'later',
    builder: { type: 'wikipedia-set', key: 'kansai-hyakumeizan', kind: 'peak' },
    description:
      "A hundred mountains of the Kansai chosen by Yama-kei's Osaka office (山と溪谷社大阪支局) in 1998.",
    expectedSize: 100,
    countingRule:
      'Where the article links a mountain that GSI lists, the place is its GSI summit; otherwise the position of its Wikipedia article.',
    sources: [SOURCE_REFS.wikipediaPlaces, SOURCE_REFS.wikidata],
  },
  {
    id: 'taki-100',
    title: { en: "Japan's Top 100 Waterfalls", ja: '日本の滝百選' },
    kind: 'point',
    theme: 'waterfalls',
    phase: 'later',
    builder: { type: 'wikipedia-set', key: 'taki-100', kind: 'waterfall' },
    description:
      'A hundred waterfalls chosen in 1990 from public nominations, under the Environment Agency and the Forestry Agency. Reaching one means standing where it is seen from; the point is the waterfall itself.',
    expectedSize: 100,
    sources: [SOURCE_REFS.wikipediaPlaces, SOURCE_REFS.wikidata],
  },
  {
    id: 'michi-100',
    title: { en: "Japan's 100 Roads", ja: '日本の道100選' },
    kind: 'point',
    theme: 'roads',
    phase: 'later',
    builder: { type: 'curated', folder: 'michi-100', file: 'roads' },
    description:
      'The 104 roads chosen in 1986 and 1987 for the Ministry of Construction, for their history, scenery or design. A road is a line; each is placed here as one point on or beside it, so being there once counts.',
    expectedSize: 104,
    countingRule:
      'One point per road, placed by hand from Wikipedia, Wikidata or OpenStreetMap. Roads with no trustworthy point are listed without one.',
    sources: [SOURCE_REFS.michi100, SOURCE_REFS.wikidata, SOURCE_REFS.osm],
  },
  // 五街道
  ...(
    [
      [
        'tokaido',
        '東海道',
        'Tōkaidō',
        'とうかいどう',
        ['tokaido-1.gpx', 'tokaido-2.gpx'],
        '日本橋 to 三条大橋. The gap between 宮 and 桑名 is the sea crossing, 七里の渡し.',
      ],
      [
        'nakasendo',
        '中山道',
        'Nakasendō',
        'なかせんどう',
        ['nakasendo.gpx'],
        '日本橋 to 草津追分, where it joins the Tōkaidō.',
      ],
      [
        'koshu-kaido',
        '甲州道中',
        'Kōshū Kaidō',
        'こうしゅうどうちゅう',
        ['koshu-kaido.gpx'],
        '日本橋 to 下諏訪追分, where it joins the Nakasendō.',
      ],
      [
        'nikko-kaido',
        '日光道中',
        'Nikkō Kaidō',
        'にっこうどうちゅう',
        ['nikko-kaido.gpx'],
        '日本橋 to 日光神橋.',
      ],
      [
        'oshu-kaido',
        '奥州道中',
        'Ōshū Kaidō',
        'おうしゅうどうちゅう',
        ['oshu-kaido.gpx'],
        '宇都宮 to 白河追分. 日本橋 to 宇都宮 is shared with the Nikkō Kaidō.',
      ],
    ] as const
  ).map(([id, ja, en, kana, files, note]): ListDefinition => ({
    id,
    title: { en, ja },
    kind: 'route',
    theme: 'old-highways',
    phase: 'first',
    builder: {
      type: 'gpx-route',
      source: 'gokaido',
      files: [...files],
      name: { ja, en, kana },
      note,
      stages: gokaidoStages(id),
    },
    description: `One of the five Edo-period highways from Nihonbashi, in stages between its post towns. ${note}`,
    sources: [SOURCE_REFS.gokaido],
  })),
  {
    id: 'tokai-shizen-hodo',
    title: { en: 'Tōkai Nature Trail', ja: '東海自然歩道' },
    kind: 'route',
    theme: 'long-trails',
    phase: 'first',
    builder: {
      type: 'gpx-route',
      source: 'moe',
      files: 'all',
      name: { ja: '東海自然歩道', en: 'Tōkai Nature Trail', kana: 'とうかいしぜんほどう' },
      split: 'track',
      excludeTracks: '本線以外',
      trackNames: { ja: '本線', en: 'Main line' },
    },
    description:
      "Japan's first long-distance nature trail, from 明治の森高尾 (Tokyo) to 明治の森箕面 (Osaka). The main line from the Ministry of the Environment's GPS data, one item per track; its 115 branch and detour tracks (本線以外, about 360 km) are left out.",
    sources: [SOURCE_REFS.moe],
  },
  // National Cycle Routes and long trails from OpenStreetMap.
  ...(
    [
      [
        'shimanami-kaido',
        'Shimanami Kaidō',
        'しまなみ海道',
        'cycle-routes',
        'bicycle',
        'しまなみ',
        undefined,
        1,
      ],
      [
        'biwaichi',
        'Biwaichi',
        'ビワイチ',
        'cycle-routes',
        'bicycle',
        'ビワイチ|琵琶湖一周',
        undefined,
        1,
      ],
      [
        'tsukuba-kasumigaura-ring-ring-road',
        'Tsukuba Kasumigaura Ring-Ring Road',
        'つくば霞ヶ浦りんりんロード',
        'cycle-routes',
        'bicycle',
        'つくば霞ヶ浦りんりんロード|Tsukuba-Kasumigaura Ring-Ring',
        undefined,
        1,
      ],
      [
        'tokapuchi-400',
        'Tokapuchi 400',
        'トカプチ400',
        'cycle-routes',
        'bicycle',
        'トカプチ',
        undefined,
        2,
      ],
      [
        'pacific-coast-cycling-road',
        'Pacific Coast Cycling Road',
        '太平洋岸自転車道',
        'cycle-routes',
        'bicycle',
        '太平洋岸自転車道',
        undefined,
        2,
      ],
      [
        'toyama-bay-cycling-course',
        'Toyama Bay Cycling Course',
        '富山湾岸サイクリングコース',
        'cycle-routes',
        'bicycle',
        '富山湾岸',
        '連絡',
        2,
      ],
      [
        'fukushima-hamadori-cycle-route',
        'Fukushima Hamadori Cycle Route',
        'ふくしま浜通りサイクルルート',
        'cycle-routes',
        'bicycle',
        'ふくしま浜通り|Fukushima Hamadori',
        undefined,
        3,
      ],
      [
        'fujiichi',
        'Fujiichi',
        'フジイチ',
        'cycle-routes',
        'bicycle',
        'フジイチ|Fujiichi',
        undefined,
        3,
      ],
      [
        'yukiguni-uonuma-golden-cycle-route',
        'Yukiguni Uonuma Golden Cycle Route',
        '雪国魚沼Golden Cycle Route',
        'cycle-routes',
        'bicycle',
        '魚沼|Uonuma',
        undefined,
        3,
      ],
      [
        'ishikawa-satoyama-satoumi-cycling-route',
        'Ishikawa Satoyama-Satoumi Cycling Route',
        'いしかわ里山里海サイクリングルート',
        'cycle-routes',
        'bicycle',
        'いしかわ里山里海|Satoyama-Satoumi',
        undefined,
        3,
      ],
      [
        'tottori-uminami-road',
        'Tottori Uminami Road',
        '鳥取うみなみロード',
        'cycle-routes',
        'bicycle',
        'うみなみロード|Uminami',
        undefined,
        3,
      ],
      [
        'amaichi',
        'Amaichi',
        'あまいち',
        'cycle-routes',
        'bicycle',
        'あまいち|Amaichi',
        undefined,
        3,
      ],
      [
        'kanto-fureai-no-michi',
        'Tokyo Metropolitan Nature Trail (Kanto Fureai no Michi)',
        '関東ふれあいの道',
        'long-trails',
        'hiking',
        '関東ふれあいの道|首都圏自然歩道|^KFT ',
        undefined,
        0,
      ],
      [
        'japan-trail',
        'Japan Trail',
        'JAPAN TRAIL',
        'long-trails',
        'hiking',
        'JAPAN TRAIL|ジャパントレイル|ジャパン・トレイル',
        undefined,
        0,
      ],
      [
        'shikoku-henro',
        'Shikoku Henro',
        '四国遍路',
        'pilgrimage',
        'hiking',
        '四国遍路|Shikoku Henro|Shikoku Pilgrimage',
        '四国自然歩道|四国のみち',
        0,
      ],
      [
        'kumano-kodo',
        'Kumano Kodō',
        '熊野古道',
        'pilgrimage',
        'hiking',
        '熊野古道|Kumano Kod',
        undefined,
        0,
      ],
      [
        'kyushu-shizen-hodo',
        'Kyūshū Nature Trail',
        '九州自然歩道',
        'long-trails',
        'hiking',
        '九州自然歩道|Kyushu Nature Trail',
        undefined,
        0,
      ],
      [
        'chugoku-shizen-hodo',
        'Chūgoku Nature Trail',
        '中国自然歩道',
        'long-trails',
        'hiking',
        '中国自然歩道|Chugoku Nature Trail',
        undefined,
        0,
      ],
      [
        'shikoku-shizen-hodo',
        'Shikoku Nature Trail',
        '四国自然歩道',
        'long-trails',
        'hiking',
        '四国自然歩道|四国のみち|Shikoku Nature Trail',
        undefined,
        0,
      ],
      [
        'kinki-shizen-hodo',
        'Kinki Nature Trail',
        '近畿自然歩道',
        'long-trails',
        'hiking',
        '近畿自然歩道|Kinki Nature Trail',
        undefined,
        0,
      ],
      [
        'chubu-hokuriku-shizen-hodo',
        'Chūbu-Hokuriku Nature Trail',
        '中部北陸自然歩道',
        'long-trails',
        'hiking',
        '中部北陸自然歩道|Chubu.Hokuriku Nature Trail',
        undefined,
        0,
      ],
      [
        'tohoku-shizen-hodo',
        'Tōhoku Nature Trail',
        '東北自然歩道',
        'long-trails',
        'hiking',
        '東北自然歩道|新・奥の細道|Tohoku Nature Trail',
        undefined,
        0,
      ],
      [
        'hokkaido-shizen-hodo',
        'Hokkaidō Nature Trail',
        '北海道自然歩道',
        'long-trails',
        'hiking',
        '北海道自然歩道|Hokkaido Nature Trail',
        undefined,
        0,
      ],
      [
        'michinoku-coastal-trail',
        'Michinoku Coastal Trail',
        'みちのく潮風トレイル',
        'long-trails',
        'hiking',
        'みちのく潮風トレイル|Michinoku Coastal Trail',
        undefined,
        0,
      ],
      [
        'shinetsu-trail',
        'Shinetsu Trail',
        '信越トレイル',
        'long-trails',
        'hiking',
        '信越トレイル|Shin-?etsu Trail',
        undefined,
        0,
      ],
      [
        'hokkaido-higashi-trail',
        'Hokkaidō East Trail',
        '北海道東トレイル',
        'long-trails',
        'hiking',
        '北海道東トレイル|Hokkaido East Trail|Hokkaido Higashi Trail',
        undefined,
        0,
      ],
      [
        'kyushu-olle',
        'Kyūshū Olle',
        '九州オルレ',
        'long-trails',
        'hiking',
        '九州オルレ|Kyushu Olle',
        undefined,
        0,
      ],
    ] as const
  ).map(([id, en, ja, theme, route, name, exclude, round]): ListDefinition => ({
    id,
    title: { en, ja },
    kind: 'route',
    theme,
    phase: 'first',
    builder: {
      type: 'osm-route',
      route,
      name,
      ...(exclude ? { exclude } : {}),
      ...(BLOCKED_NOTES[id] ? { note: BLOCKED_NOTES[id] } : {}),
      ...(id === 'shikoku-henro' ? { numeric: true } : {}),
    },
    ...(OFFICIAL_KM[id] ? { officialKm: OFFICIAL_KM[id] } : {}),
    description: `${round > 0 ? `National Cycle Route (round ${round} of designations${round === 3 ? ', July 2026' : ''}). ` : ''}From the OpenStreetMap route relations named like ${ja}: one item per relation, or per stage where the route is split into stages.`,
    sources: [SOURCE_REFS.osm],
  })),
];

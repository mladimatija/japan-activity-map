/**
 * Every activity name the demo history uses, in English and Japanese. `jam demo --lang` picks one
 * language for the whole history, as a real person's names are in one language. `{name}` marks a
 * value filled in (a peak, a route, a distance); those come from the lists, which have both.
 * No real event, business or person is named here.
 */
export type DemoLang = 'en' | 'ja';

export const DEMO_LANGS: readonly DemoLang[] = ['en', 'ja'];

export const NAMES = {
  morningRun: { en: 'Morning run', ja: '朝ラン' },
  eveningRun: { en: 'Evening run', ja: '夜ラン' },
  palaceLoop: { en: 'Imperial Palace loop', ja: '皇居ラン' },
  palaceLaps: { en: 'Imperial Palace, two laps', ja: '皇居ラン 2周' },
  sumidaRun: { en: 'Sumida river run', ja: '隅田川ラン' },
  sumidaShort: { en: 'Short run to the Sumida river', ja: '隅田川までショートラン' },
  exploreRun: { en: 'Run around new streets', ja: '知らない道をラン' },
  longRun: { en: 'Long run along the Arakawa', ja: '荒川ロング走' },
  arakawaRun: { en: 'Run out to the Arakawa and back', ja: '荒川まで往復ラン' },
  treadmill: { en: 'Treadmill run', ja: 'トレッドミル' },
  tamaRide: { en: 'Tama river ride', ja: '多摩川サイクリング' },
  tamaLongRide: { en: 'Tama river ride to Hamura', ja: '多摩川サイクリング 羽村まで' },
  arakawaRide: { en: 'Arakawa ride', ja: '荒川サイクリング' },
  commute: { en: 'Ride to work', ja: '通勤ライド' },
  commuteHome: { en: 'Ride home', ja: '帰宅ライド' },
  shortWalk: { en: 'Short walk', ja: 'ちょっと散歩' },
  gardenWalk: { en: 'Walk through the palace East Gardens', ja: '皇居東御苑を散歩' },
  templeWalk: { en: 'Walk to {name}', ja: '{name}まで散歩' },
  cityWalk: { en: 'City walk', ja: '街歩き' },
  hike: { en: '{name} hike', ja: '{name} 登山' },
  hikeTwo: { en: '{name} and {other}', ja: '{name}・{other} 縦走' },
  hikeDns: { en: '{name}, turned back', ja: '{name} 途中撤退' },
  hikeWant: { en: '{name}, some day', ja: '{name} いつか' },
  trailRun: { en: '{name} trail run', ja: '{name} トレイルラン' },
  ridgeRun: { en: 'Trail run from {name} to {other}', ja: '{name}から{other}へトレイルラン' },
  routeRide: { en: '{name} ride', ja: '{name} サイクリング' },
  routeWalk: { en: '{name} walk', ja: '{name} ウォーク' },
  visit: { en: 'Walk to {name}', ja: '{name} めぐり' },
  race5k: { en: 'Riverside 5 km race', ja: 'リバーサイド5kmレース' },
  race10k: { en: 'Riverside 10 km race', ja: 'リバーサイド10kmレース' },
  raceHalf: { en: 'Riverbank half marathon', ja: '河川敷ハーフマラソン' },
  raceFull: { en: 'Riverbank marathon', ja: '河川敷マラソン' },
  abroadRun: { en: 'Run along the Han river, Seoul', ja: 'ソウル 漢江ラン' },
  abroadHike: { en: 'Hill walk above Taipei', ja: '台北 郊外ハイキング' },
  siteTitle: { en: 'Japan Activity Map (demo)', ja: 'Japan Activity Map（デモ）' },
  siteDescription: {
    en: 'Made-up activities that show what the site does.',
    ja: 'サイトの機能を紹介するための架空のアクティビティです。',
  },
  noteDns: { en: 'Turned back in the rain', ja: '雨のため途中で引き返した' },
  noteTreadmill: { en: 'Indoors, no GPS', ja: '屋内、GPSなし' },
} as const satisfies Record<string, Record<DemoLang, string>>;

export type NameKey = keyof typeof NAMES;

/** A name in the chosen language, with `{name}`-style values filled in. */
export const demoName = (
  key: NameKey,
  lang: DemoLang,
  values: Record<string, string> = {},
): string => NAMES[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);

/**
 * The made-up athlete's story: where they live, the courses they repeat, and the trips of each
 * year. Hand-written, original, and about no real person: the home is Tokyo Station, a place
 * nobody lives at, and the workplace is a point by the bay. Everything else (which day, how
 * fast, the filler between trips) comes from the seeded generator in generate.ts.
 *
 * Trips name places and routes by their ids in the committed lists. An id the lists no longer
 * have is skipped, so a list update can shrink the story but not break it. The 五街道 are never
 * used: their files are not committed, and a fresh clone must give the same history.
 */
import type { NameKey } from './names.ts';
import type { LonLat } from './track.ts';

/** Tokyo Station: the made-up home, and the centre of the demo's first privacy zone. */
export const DEMO_HOME: LonLat = [139.7671, 35.6812];
/** A point by the bay at 豊洲: the made-up workplace, and the second privacy zone. */
export const DEMO_WORK: LonLat = [139.796, 35.654];

export const DEMO_ZONES = [
  { label: 'demo home', lat: DEMO_HOME[1], lon: DEMO_HOME[0], radiusM: 400 },
  { label: 'demo work', lat: DEMO_WORK[1], lon: DEMO_WORK[0], radiusM: 300 },
] as const;

/** A hand-drawn line with the height at each corner: [lon, lat, metres]. */
type Drawn = readonly (readonly [number, number, number])[];

/** Once round the Imperial Palace moat, anticlockwise from 和田倉門, about 5 km. */
export const PALACE_LOOP: Drawn = [
  [139.7612, 35.6838, 4],
  [139.7618, 35.6862, 4],
  [139.76, 35.6893, 5],
  [139.757, 35.6912, 7],
  [139.7525, 35.6925, 14],
  [139.7478, 35.6918, 22],
  [139.7448, 35.688, 28],
  [139.744, 35.6838, 30],
  [139.7455, 35.6795, 22],
  [139.75, 35.6772, 10],
  [139.754, 35.6768, 5],
  [139.7572, 35.678, 4],
  [139.7598, 35.6805, 4],
  [139.7612, 35.6838, 4],
];
/** From home to the moat. */
export const TO_PALACE: Drawn = [
  [DEMO_HOME[0], DEMO_HOME[1], 4],
  [139.7645, 35.6818, 4],
  [139.7627, 35.6824, 4],
  [139.7612, 35.6838, 4],
];
/** From the moat through the East Gardens, past the site of 江戸城's keep, and out at 竹橋. */
export const EAST_GARDENS: Drawn = [
  [139.7612, 35.6838, 4],
  [139.7618, 35.6862, 4],
  [139.7585, 35.6868, 8],
  [139.7544, 35.6883, 20],
  [139.7532, 35.6903, 18],
  [139.757, 35.6912, 7],
];
/** From home to 日本橋, the 隅田川 at 浜町, and up the west bank to 吾妻橋. */
export const SUMIDA: Drawn = [
  [DEMO_HOME[0], DEMO_HOME[1], 4],
  [139.7705, 35.6828, 4],
  [139.7745, 35.6841, 4],
  [139.781, 35.6855, 3],
  [139.7885, 35.6868, 3],
  [139.7893, 35.692, 3],
  [139.7892, 35.6935, 3],
  [139.7905, 35.6985, 3],
  [139.7922, 35.703, 3],
  [139.795, 35.7078, 3],
  [139.798, 35.7105, 3],
];
/** How far along SUMIDA 両国橋 is, as a share: the short run turns there. */
export const SUMIDA_SHORT_SHARE = 0.5;
/** The west bank of the 荒川 from its mouth upstream to 羽根倉橋, about 36 km. */
export const ARAKAWA: Drawn = [
  [139.844, 35.648, 2],
  [139.8475, 35.662, 3],
  [139.849, 35.676, 3],
  [139.8478, 35.688, 3],
  [139.844, 35.7, 3],
  [139.838, 35.712, 3],
  [139.827, 35.725, 3],
  [139.817, 35.74, 3],
  [139.808, 35.752, 3],
  [139.79, 35.762, 4],
  [139.765, 35.77, 4],
  [139.74, 35.783, 4],
  [139.715, 35.793, 5],
  [139.685, 35.801, 5],
  [139.65, 35.815, 6],
  [139.62, 35.84, 7],
  [139.605, 35.865, 8],
];
/** From home east through 錦糸町 to the 荒川 at 小松川 (the fifth corner of ARAKAWA). */
export const TO_ARAKAWA: Drawn = [
  [DEMO_HOME[0], DEMO_HOME[1], 4],
  [139.7745, 35.6841, 4],
  [139.79, 35.688, 3],
  [139.815, 35.696, 2],
  [139.835, 35.7, 2],
  [139.844, 35.7, 3],
];
/** From the mouth of the 荒川 back home through 新木場 and 月島. */
export const FROM_BAY: Drawn = [
  [139.844, 35.648, 2],
  [139.825, 35.648, 3],
  [139.806, 35.661, 3],
  [139.789, 35.667, 3],
  [139.778, 35.672, 3],
  [139.771, 35.677, 4],
  [DEMO_HOME[0], DEMO_HOME[1], 4],
];
/** From home down the bay side to 六郷, then up the 多摩川 to 羽村, about 70 km. */
export const TAMA: Drawn = [
  [DEMO_HOME[0], DEMO_HOME[1], 4],
  [139.762, 35.672, 4],
  [139.757, 35.6555, 4],
  [139.75, 35.623, 3],
  [139.736, 35.588, 3],
  [139.717, 35.562, 3],
  [139.7075, 35.547, 3],
  [139.69, 35.56, 5],
  [139.67, 35.584, 8],
  [139.648, 35.6, 11],
  [139.627, 35.611, 14],
  [139.595, 35.62, 19],
  [139.565, 35.626, 24],
  [139.53, 35.64, 32],
  [139.48, 35.655, 43],
  [139.44, 35.672, 58],
  [139.405, 35.685, 72],
  [139.36, 35.71, 98],
  [139.315, 35.756, 128],
];
/** Shares of TAMA where a ride turns round: 二子玉川, 府中, 羽村. */
export const TAMA_TURNS = { futako: 0.5, fuchu: 0.72, hamura: 1 } as const;
/** From home to the workplace. */
export const COMMUTE: Drawn = [
  [DEMO_HOME[0], DEMO_HOME[1], 4],
  [139.771, 35.677, 4],
  [139.774, 35.672, 3],
  [139.783, 35.662, 3],
  [139.79, 35.6575, 3],
  [DEMO_WORK[0], DEMO_WORK[1], 3],
];
/** The ridge from 陣馬高原下 over 陣馬山 and 景信山 to 高尾山 and down to 高尾山口. */
export const JINBA_TAKAO: Drawn = [
  [139.17, 35.672, 330],
  [139.166546, 35.652177, 855],
  [139.183, 35.645, 690],
  [139.203, 35.637, 727],
  [139.222, 35.631, 560],
  [139.243611, 35.625166, 599],
  [139.257, 35.6285, 400],
  [139.27, 35.632, 190],
];

/** Where a hike starts when the story says so; otherwise a point is drawn below the summit. */
type Trailhead = readonly [number, number, number];

export type Trip =
  | {
      kind: 'peak';
      /** Which year of the history, 0 the oldest, and the calendar month. */
      year: number;
      month: number;
      /** Place ids of the summits, in the order reached. */
      peaks: readonly string[];
      type?: 'hike' | 'trail_run';
      from?: Trailhead;
      /** Two days with a night at a hut. */
      overnight?: boolean;
      /** Turned back before the summit: the row says DNS. */
      dns?: boolean;
    }
  | {
      kind: 'route';
      year: number;
      month: number;
      list: string;
      item: string;
      type: 'ride' | 'walk' | 'hike';
      /** Kilometres along the item's longest piece; left out, every piece end to end. */
      slice?: readonly [number, number];
      /** Height the line starts and ends at, and the size of the hills between. */
      heights: readonly [number, number, number];
      overnight?: boolean;
    }
  | { kind: 'visit'; year: number; month: number; places: readonly string[] }
  | { kind: 'race'; year: number; month: number; km: number; name: NameKey }
  | {
      kind: 'abroad';
      year: number;
      month: number;
      name: NameKey;
      type: 'run' | 'hike';
      at: LonLat;
      timeZone: string;
      /** Hours ahead of UTC there (both places used keep one offset all year). */
      utcOffset: number;
      radiusM: number;
      heights: readonly [number, number];
    };

const TAKAO: Trailhead = [139.27, 35.632, 190];
const TSUKUBA: Trailhead = [140.089, 36.206, 230];

/** 高尾山 by the same path many times: the hill at the end of the train line. */
export const LOCAL_HILL = { peak: 'peak-376', from: TAKAO } as const;

/**
 * The trips, year by year: Kanto first, then the Alps, Kansai and Shikoku, then Tohoku, Hokkaido
 * and Kyushu, so each year breaks new ground.
 */
export const TRIPS: readonly Trip[] = [
  // Year 0: a quiet start close to home.
  { kind: 'peak', year: 0, month: 4, peaks: ['peak-376'], from: TAKAO },
  { kind: 'peak', year: 0, month: 5, peaks: ['peak-263'], from: TSUKUBA },
  { kind: 'peak', year: 0, month: 6, peaks: ['peak-374'] },
  { kind: 'peak', year: 0, month: 10, peaks: ['peak-385'] },
  { kind: 'peak', year: 0, month: 11, peaks: ['peak-387'] },
  { kind: 'peak', year: 0, month: 1, peaks: ['peak-379'] },
  {
    kind: 'visit',
    year: 0,
    month: 2,
    places: ['temple-q3503094', 'temple-q615465', 'temple-q1034293'],
  },
  { kind: 'visit', year: 0, month: 12, places: ['castle-q1073688'] },
  {
    kind: 'route',
    year: 0,
    month: 9,
    list: 'tsukuba-kasumigaura-ring-ring-road',
    item: 'tsukuba-kasumigaura-ring-ring-road-003',
    type: 'ride',
    heights: [5, 30, 6],
  },
  {
    kind: 'route',
    year: 0,
    month: 3,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-141',
    type: 'walk',
    heights: [180, 250, 120],
  },
  { kind: 'race', year: 0, month: 11, km: 5, name: 'race5k' },
  // Year 1: the mountains west of Tokyo, Fuji, and the first long ride away.
  { kind: 'peak', year: 1, month: 3, peaks: ['peak-359'] },
  { kind: 'peak', year: 1, month: 4, peaks: ['peak-392'] },
  { kind: 'peak', year: 1, month: 5, peaks: ['peak-363'], from: [138.9895, 35.7865, 540] },
  { kind: 'peak', year: 1, month: 6, peaks: ['peak-368'] },
  { kind: 'peak', year: 1, month: 7, peaks: ['peak-396'], from: [138.733, 35.395, 2300] },
  { kind: 'peak', year: 1, month: 8, peaks: ['peak-351'] },
  { kind: 'peak', year: 1, month: 9, peaks: ['peak-350'] },
  { kind: 'peak', year: 1, month: 10, peaks: ['peak-279'] },
  { kind: 'peak', year: 1, month: 11, peaks: ['peak-345'] },
  { kind: 'peak', year: 1, month: 12, peaks: ['peak-404'] },
  { kind: 'peak', year: 1, month: 9, peaks: ['peak-434'], dns: true },
  {
    kind: 'route',
    year: 1,
    month: 5,
    list: 'shimanami-kaido',
    item: 'shimanami-kaido-001',
    type: 'ride',
    heights: [5, 5, 22],
  },
  {
    kind: 'route',
    year: 1,
    month: 10,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-151',
    type: 'walk',
    heights: [150, 200, 90],
  },
  {
    kind: 'route',
    year: 1,
    month: 2,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-158',
    type: 'walk',
    heights: [5, 8, 15],
  },
  { kind: 'visit', year: 1, month: 1, places: ['castle-q8014937'] },
  { kind: 'visit', year: 1, month: 6, places: ['waterfall-q11497279'] },
  { kind: 'race', year: 1, month: 3, km: 10, name: 'race10k' },
  { kind: 'race', year: 1, month: 11, km: 21.0975, name: 'raceHalf' },
  // Year 2: Nikko and the first 3,000 m peaks, a start on Lake Biwa.
  { kind: 'peak', year: 2, month: 5, peaks: ['peak-357'] },
  { kind: 'peak', year: 2, month: 6, peaks: ['peak-273'] },
  { kind: 'peak', year: 2, month: 7, peaks: ['peak-265'] },
  { kind: 'peak', year: 2, month: 8, peaks: ['peak-592', 'peak-593'], overnight: true },
  { kind: 'peak', year: 2, month: 9, peaks: ['ext-hyakumeizan-030'] },
  { kind: 'peak', year: 2, month: 10, peaks: ['peak-348'] },
  { kind: 'peak', year: 2, month: 11, peaks: ['peak-707'] },
  { kind: 'peak', year: 2, month: 7, peaks: ['peak-589'] },
  { kind: 'visit', year: 2, month: 6, places: ['waterfall-q37580'] },
  { kind: 'visit', year: 2, month: 2, places: ['castle-q2969389'] },
  {
    kind: 'route',
    year: 2,
    month: 4,
    list: 'biwaichi',
    item: 'biwaichi-001',
    type: 'ride',
    slice: [0, 72],
    heights: [86, 88, 8],
  },
  {
    kind: 'route',
    year: 2,
    month: 11,
    list: 'biwaichi',
    item: 'biwaichi-001',
    type: 'ride',
    slice: [72, 128],
    heights: [88, 86, 8],
  },
  {
    kind: 'route',
    year: 2,
    month: 3,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-149',
    type: 'hike',
    heights: [200, 320, 160],
  },
  { kind: 'race', year: 2, month: 3, km: 10, name: 'race10k' },
  { kind: 'race', year: 2, month: 12, km: 42.195, name: 'raceFull' },
  {
    kind: 'abroad',
    year: 2,
    month: 5,
    name: 'abroadRun',
    type: 'run',
    at: [126.935, 37.528],
    timeZone: 'Asia/Seoul',
    utcOffset: 9,
    radiusM: 1500,
    heights: [12, 3],
  },
  // Year 3: the Northern Alps, Kansai and Shikoku.
  { kind: 'peak', year: 3, month: 5, peaks: ['peak-228'] },
  { kind: 'peak', year: 3, month: 5, peaks: ['peak-906'] },
  { kind: 'peak', year: 3, month: 6, peaks: ['peak-443'] },
  { kind: 'peak', year: 3, month: 7, peaks: ['peak-546'], from: [137.5565, 36.1225, 2702] },
  { kind: 'peak', year: 3, month: 8, peaks: ['peak-533'], overnight: true },
  { kind: 'peak', year: 3, month: 9, peaks: ['peak-539'], overnight: true },
  { kind: 'peak', year: 3, month: 10, peaks: ['ext-hyakumeizan-043'] },
  { kind: 'peak', year: 3, month: 11, peaks: ['peak-753'] },
  { kind: 'peak', year: 3, month: 10, peaks: ['peak-431'], dns: true },
  { kind: 'peak', year: 3, month: 11, peaks: ['peak-757'] },
  { kind: 'peak', year: 3, month: 4, peaks: ['peak-376'], from: TAKAO, type: 'trail_run' },
  {
    kind: 'route',
    year: 3,
    month: 11,
    list: 'kumano-kodo',
    item: 'kumano-kodo-002',
    type: 'hike',
    heights: [80, 60, 380],
    overnight: true,
  },
  {
    kind: 'route',
    year: 3,
    month: 12,
    list: 'kumano-kodo',
    item: 'kumano-kodo-003',
    type: 'hike',
    heights: [60, 90, 300],
  },
  {
    kind: 'route',
    year: 3,
    month: 3,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-157',
    type: 'walk',
    heights: [10, 20, 110],
  },
  {
    kind: 'route',
    year: 3,
    month: 4,
    list: 'tsukuba-kasumigaura-ring-ring-road',
    item: 'tsukuba-kasumigaura-ring-ring-road-001',
    type: 'ride',
    slice: [0, 64],
    heights: [3, 4, 4],
  },
  { kind: 'visit', year: 3, month: 2, places: ['castle-q11565113'] },
  { kind: 'race', year: 3, month: 1, km: 21.0975, name: 'raceHalf' },
  { kind: 'race', year: 3, month: 3, km: 42.195, name: 'raceFull' },
  { kind: 'race', year: 3, month: 10, km: 10, name: 'race10k' },
  {
    kind: 'abroad',
    year: 3,
    month: 12,
    name: 'abroadHike',
    type: 'hike',
    at: [121.575, 25.03],
    timeZone: 'Asia/Taipei',
    utcOffset: 8,
    radiusM: 1400,
    heights: [40, 180],
  },
  // Year 4: Tohoku, Hokkaido, Kyushu and the far west.
  { kind: 'peak', year: 4, month: 3, peaks: ['peak-973'] },
  { kind: 'peak', year: 4, month: 3, peaks: ['peak-1020'] },
  { kind: 'peak', year: 4, month: 3, peaks: ['peak-1033'] },
  { kind: 'peak', year: 4, month: 5, peaks: ['ext-hyakumeizan-092'] },
  { kind: 'peak', year: 4, month: 6, peaks: ['peak-171'] },
  { kind: 'peak', year: 4, month: 6, peaks: ['peak-156'] },
  { kind: 'peak', year: 4, month: 7, peaks: ['peak-549'] },
  { kind: 'peak', year: 4, month: 7, peaks: ['peak-232'] },
  {
    kind: 'peak',
    year: 4,
    month: 8,
    peaks: ['ext-hyakumeizan-049'],
    from: [137.596, 36.577, 2450],
  },
  { kind: 'peak', year: 4, month: 9, peaks: ['peak-105'] },
  { kind: 'peak', year: 4, month: 10, peaks: ['peak-432'] },
  { kind: 'peak', year: 4, month: 11, peaks: ['peak-263'], from: TSUKUBA },
  {
    kind: 'route',
    year: 4,
    month: 3,
    list: 'kyushu-olle',
    item: 'kyushu-olle-001',
    type: 'walk',
    heights: [10, 15, 60],
  },
  {
    kind: 'route',
    year: 4,
    month: 4,
    list: 'fujiichi',
    item: 'fujiichi-001',
    type: 'ride',
    slice: [0, 24],
    heights: [600, 850, 60],
  },
  {
    kind: 'route',
    year: 4,
    month: 2,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-142',
    type: 'walk',
    heights: [250, 400, 180],
  },
  {
    kind: 'route',
    year: 4,
    month: 12,
    list: 'kanto-fureai-no-michi',
    item: 'kanto-fureai-no-michi-101',
    type: 'walk',
    heights: [120, 260, 140],
  },
  { kind: 'visit', year: 4, month: 1, places: ['waterfall-q37321'] },
  { kind: 'race', year: 4, month: 2, km: 42.195, name: 'raceFull' },
  { kind: 'race', year: 4, month: 5, km: 5, name: 'race5k' },
  { kind: 'race', year: 4, month: 10, km: 21.0975, name: 'raceHalf' },
];

/** Summits wanted but not yet climbed: `want` rows with no outing. */
export const WANTED: readonly string[] = [
  'peak-1041',
  'peak-35',
  'peak-185',
  'peak-465',
  'peak-929',
  'peak-174',
];

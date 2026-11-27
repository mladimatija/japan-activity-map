export const REGIONS = [
  { id: 'hokkaido', en: 'Hokkaido', ja: '北海道' },
  { id: 'tohoku', en: 'Tohoku', ja: '東北' },
  { id: 'kanto', en: 'Kanto', ja: '関東' },
  { id: 'chubu', en: 'Chubu', ja: '中部' },
  { id: 'kinki', en: 'Kinki', ja: '近畿' },
  { id: 'chugoku', en: 'Chugoku', ja: '中国' },
  { id: 'shikoku', en: 'Shikoku', ja: '四国' },
  { id: 'kyushu', en: 'Kyushu & Okinawa', ja: '九州・沖縄' },
] as const;
export type RegionId = (typeof REGIONS)[number]['id'];

export interface Prefecture {
  /** Two-digit JIS X 0401 code, "01" to "47". */
  code: string;
  ja: string;
  en: string;
  region: RegionId;
}

const rows: [string, string, string, RegionId][] = [
  ['01', '北海道', 'Hokkaido', 'hokkaido'],
  ['02', '青森県', 'Aomori', 'tohoku'],
  ['03', '岩手県', 'Iwate', 'tohoku'],
  ['04', '宮城県', 'Miyagi', 'tohoku'],
  ['05', '秋田県', 'Akita', 'tohoku'],
  ['06', '山形県', 'Yamagata', 'tohoku'],
  ['07', '福島県', 'Fukushima', 'tohoku'],
  ['08', '茨城県', 'Ibaraki', 'kanto'],
  ['09', '栃木県', 'Tochigi', 'kanto'],
  ['10', '群馬県', 'Gunma', 'kanto'],
  ['11', '埼玉県', 'Saitama', 'kanto'],
  ['12', '千葉県', 'Chiba', 'kanto'],
  ['13', '東京都', 'Tokyo', 'kanto'],
  ['14', '神奈川県', 'Kanagawa', 'kanto'],
  ['15', '新潟県', 'Niigata', 'chubu'],
  ['16', '富山県', 'Toyama', 'chubu'],
  ['17', '石川県', 'Ishikawa', 'chubu'],
  ['18', '福井県', 'Fukui', 'chubu'],
  ['19', '山梨県', 'Yamanashi', 'chubu'],
  ['20', '長野県', 'Nagano', 'chubu'],
  ['21', '岐阜県', 'Gifu', 'chubu'],
  ['22', '静岡県', 'Shizuoka', 'chubu'],
  ['23', '愛知県', 'Aichi', 'chubu'],
  ['24', '三重県', 'Mie', 'kinki'],
  ['25', '滋賀県', 'Shiga', 'kinki'],
  ['26', '京都府', 'Kyoto', 'kinki'],
  ['27', '大阪府', 'Osaka', 'kinki'],
  ['28', '兵庫県', 'Hyogo', 'kinki'],
  ['29', '奈良県', 'Nara', 'kinki'],
  ['30', '和歌山県', 'Wakayama', 'kinki'],
  ['31', '鳥取県', 'Tottori', 'chugoku'],
  ['32', '島根県', 'Shimane', 'chugoku'],
  ['33', '岡山県', 'Okayama', 'chugoku'],
  ['34', '広島県', 'Hiroshima', 'chugoku'],
  ['35', '山口県', 'Yamaguchi', 'chugoku'],
  ['36', '徳島県', 'Tokushima', 'shikoku'],
  ['37', '香川県', 'Kagawa', 'shikoku'],
  ['38', '愛媛県', 'Ehime', 'shikoku'],
  ['39', '高知県', 'Kochi', 'shikoku'],
  ['40', '福岡県', 'Fukuoka', 'kyushu'],
  ['41', '佐賀県', 'Saga', 'kyushu'],
  ['42', '長崎県', 'Nagasaki', 'kyushu'],
  ['43', '熊本県', 'Kumamoto', 'kyushu'],
  ['44', '大分県', 'Oita', 'kyushu'],
  ['45', '宮崎県', 'Miyazaki', 'kyushu'],
  ['46', '鹿児島県', 'Kagoshima', 'kyushu'],
  ['47', '沖縄県', 'Okinawa', 'kyushu'],
];

export const PREFECTURES: readonly Prefecture[] = rows.map(([code, ja, en, region]) => ({
  code,
  ja,
  en,
  region,
}));

export const PREFECTURE_CODES: readonly string[] = PREFECTURES.map((p) => p.code);

const byJa = new Map(PREFECTURES.map((p) => [p.ja, p]));
const byCode = new Map(PREFECTURES.map((p) => [p.code, p]));

/** Looks up a prefecture by its full Japanese name, for example "長野県" or "北海道". */
export const prefectureByJa = (name: string): Prefecture | undefined => byJa.get(name.trim());

export const prefectureByCode = (code: string): Prefecture | undefined => byCode.get(code);

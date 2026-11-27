import type { ListDefinition } from './definitions.ts';
import { escapeRegExp } from '../files.ts';

/** A route item's name as its source gives it; `en` is missing when the source has none. */
export interface SourceName {
  ja: string;
  en?: string;
}

export interface NameContext {
  /** English names of the 四国八十八箇所 temples by number, for the 四国遍路 stages. */
  shikokuTemples: Map<number, string>;
}

const deburr = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

/** The text without a leading copy of `title`, compared without macrons, case or spacing. */
const stripTitle = (text: string, title: string): string => {
  const words = deburr(title)
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (words.length === 0) return text;
  const nfc = text.normalize('NFC');
  const match = new RegExp(`^${words.join('[\\s-]*')}(?![a-z])[\\s\\-–—:,]*`).exec(
    deburr(nfc).toLowerCase(),
  );
  return match ? nfc.slice(match[0].length) : nfc;
};

/** "（綾里峠ルート）" → "綾里峠ルート". */
const unwrap = (text: string) => text.replace(/^[（(]\s*([^()（）]*?)\s*[）)]$/, '$1').trim();

const stripJa = (ja: string, title: string) =>
  unwrap(ja.startsWith(title) ? ja.slice(title.length).replace(/^[\s\-–—・:：]+/, '') : ja);

/** Spacing and casing that OpenStreetMap's English names vary in. */
const tidyEn = (en: string): string => {
  let text = en.trim().replace(/\s+-\s+|\s+-(?=\S)|(?<=\S)-\s+/g, ' – ');
  // ALL CAPS → Title Case.
  if (/[A-Z]{4}/.test(text) && !/[a-z]/.test(text))
    text = text.toLowerCase().replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  // "Tokapuchi400" → "Tokapuchi 400", for single words only (codes like T23 stay).
  if (!/\s/.test(text)) text = text.replace(/(\p{Ll})(\d)/gu, '$1 $2');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const KANTO_PREFECTURES: Record<string, [string, string]> = {
  TK: ['東京', 'Tokyo'],
  T: ['栃木', 'Tochigi'],
  G: ['群馬', 'Gunma'],
  C: ['千葉', 'Chiba'],
  I: ['茨城', 'Ibaraki'],
  S: ['埼玉', 'Saitama'],
  K: ['神奈川', 'Kanagawa'],
};
const BY_EN = new Map(Object.values(KANTO_PREFECTURES).map(([ja, en]) => [en.toLowerCase(), ja]));
const BY_JA = new Map(Object.values(KANTO_PREFECTURES).map(([ja, en]) => [ja, en]));
const CONNECTING = /^(連絡コース|連絡区間)$/;

/** Rules for lists whose stage names follow a pattern of their own. */
const LIST_RULES: Record<string, (name: SourceName, context: NameContext) => SourceName> = {
  // "関東ふれあいの道 - 栃木23 - ヤシオさく庚申のみち" / "KFT - T23 - Yashio saku Koushin no michi"
  // → "栃木23 ヤシオさく庚申のみち" / "Tochigi 23: Yashio saku Koushin no michi".
  'kanto-fureai-no-michi': ({ ja, en }) => {
    const jaRest = ja
      .replace(/^関東ふれあいの道[\s　\-–]*/, '')
      .replace(/^[（(]([^)）]+)[)）]/, '$1')
      .replace(/\s+[-–]\s+|\s+[-–](?=\S)|(?<=[^\d\s])[-–]\s+/g, ' ')
      .trim();
    const jaCode = /^(東京|栃木|群馬|千葉|茨城|埼玉|神奈川)(\d+(?:-\d+)?)\s*(.*)$/.exec(jaRest);
    let enOut: string | undefined;
    if (en) {
      const rest = en.replace(/^(?:KFT|Kanto Fureai no Michi)\s*[-–]?\s*/i, '');
      const code =
        /^\(?(TK|T|G|C|I|S|K|Tokyo|Tochigi|Gunma|Chiba|Ibaraki|Saitama|Kanagawa)\s*(\d+(?:-\d+)?)\)?\s*[-–]?\s*(.*)$/i.exec(
          rest,
        );
      if (code) {
        const key = code[1] ?? '';
        const prefecture =
          KANTO_PREFECTURES[key.toUpperCase()]?.[1] ??
          (BY_EN.has(key.toLowerCase())
            ? key.charAt(0).toUpperCase() + key.slice(1).toLowerCase()
            : key);
        const what = (code[3] ?? '').trim();
        enOut = `${prefecture} ${code[2]}${what ? `: ${what.charAt(0).toUpperCase()}${what.slice(1)}` : ''}`;
      } else if (!rest.startsWith('Tokyo Metropolitan Nature Trail')) {
        enOut = rest;
      }
    }
    if (!enOut && jaCode) {
      const what = jaCode[3] ?? '';
      enOut = `${BY_JA.get(jaCode[1] ?? '')} ${jaCode[2]}${what ? `: ${CONNECTING.test(what) ? 'Connecting route' : what}` : ''}`;
    }
    if (!enOut && CONNECTING.test(jaRest)) enOut = 'Connecting route';
    return {
      ja: jaRest || ja,
      ...(enOut ? { en: enOut.replace(/Connection route/i, 'Connecting route') } : {}),
    };
  },
  // "四国遍路 1番札所霊山寺~2番札所極楽寺" → "1番 霊山寺 – 2番 極楽寺" / "1 Ryōzen-ji – 2 Gokuraku-ji".
  'shikoku-henro': ({ ja, en }, { shikokuTemples }) => {
    const stage = /(\d+)番(?:札所)?\s*(\S+?)\s*[~〜～\-–]\s*(\d+)番(?:札所)?\s*(\S+)$/.exec(ja);
    if (!stage) return { ja, ...(en ? { en } : {}) };
    const [, a = '', aName = '', b = '', bName = ''] = stage;
    const temple = (n: string) => shikokuTemples.get(Number(n));
    const enOut =
      temple(a) && temple(b) ? `${a} ${temple(a)} – ${b} ${temple(b)}` : `Temples ${a}–${b}`;
    return { ja: `${a}番 ${aName} – ${b}番 ${bName}`, en: enOut };
  },
};

/**
 * Display names for the items of a route list: the list's own name taken off each stage
 * (the list title already says it), English names tidied, and stages without an English name
 * given one where a rule can make it. Duplicates are numbered after this, by the caller.
 */
export const routeNames = (
  definition: ListDefinition,
  names: SourceName[],
  context: NameContext,
): { ja: string; en: string }[] => {
  const single = names.length === 1;
  const rule = LIST_RULES[definition.id];
  return names.map((source) => {
    const ja = source.ja.replace(/　/g, ' ').replace(/\s+/g, ' ').trim();
    const named = rule ? rule({ ...source, ja }, context) : { ...source, ja };
    // A stage named exactly like the list keeps the list's English name, so the sections
    // of one route do not each carry a different translation.
    const rest = single ? named.ja : stripJa(named.ja, definition.title.ja);
    const sameAsList = rest === '' || named.ja === definition.title.ja;
    if (sameAsList) return { ja: definition.title.ja, en: definition.title.en };
    const enRest = named.en
      ? single
        ? tidyEn(named.en)
        : unwrap(tidyEn(stripTitle(named.en, definition.title.en))) || tidyEn(named.en)
      : undefined;
    return { ja: rest, en: enRest ?? rest };
  });
};

/** Numbers names that occur more than once in a list: "迂回路 (1)", "迂回路 (2)". */
export const numberDuplicates = (
  names: { ja: string; en: string }[],
): { ja: string; en: string }[] => {
  const key = (name: { ja: string; en: string }) => `${name.ja}\u0000${name.en}`;
  const counts = new Map<string, number>();
  for (const name of names) counts.set(key(name), (counts.get(key(name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((counts.get(key(name)) ?? 0) < 2) return name;
    const n = (seen.get(key(name)) ?? 0) + 1;
    seen.set(key(name), n);
    return { ja: `${name.ja} (${n})`, en: `${name.en} (${n})` };
  });
};

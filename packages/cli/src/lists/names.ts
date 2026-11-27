import { kanaToRomaji } from './romaji.ts';

/** Splits a GSI name such as "大雪山<旭岳>" into the mountain and the named summit. */
export const splitSummit = (name: string): { main: string; summit?: string } => {
  const match = /^([^<]+)<\s*(.+)>$/.exec(name.trim());
  const main = match?.[1]?.trim();
  const summit = match?.[2]?.trim();
  return main && summit ? { main, summit } : { main: name.trim() };
};

/** Drops alternative readings or names in brackets: "りしりざん（りしりふじ）" → "りしりざん". */
export const stripAlternatives = (text: string): string =>
  text.replace(/[（(][^）)]*[）)]/g, '').trim();

export const romajiOf = (kana: string): string => kanaToRomaji(stripAlternatives(kana));

const variants = (name: string): string[] =>
  name
    .normalize('NFKC')
    .replace(/[ヶヵケ]/g, 'ケ')
    .replace(/\s/g, '')
    .split(/[()<>［］[\]〈〉]/)
    .filter((part) => part.length >= 2);

/** True when either name contains the other, ignoring ヶ/ケ spelling and bracketed parts. */
export const namesOverlap = (a: string, b: string): boolean => {
  const left = variants(a);
  const right = variants(b);
  return left.some((x) => right.some((y) => x.includes(y) || y.includes(x)));
};

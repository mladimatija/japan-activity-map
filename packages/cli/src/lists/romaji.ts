// Hepburn romanisation without macrons, for English fallback names of places that have no
// published English name. Long vowels are shortened (おう and おお → o, うう → u), as in "Tokyo".

const BASE: Record<string, string> = {
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  ん: 'n',
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  ゔ: 'vu',
};

const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' };

const toHiragana = (text: string): string =>
  text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Converts a hiragana or katakana reading to romaji. Unknown characters are dropped. */
export const kanaToRomaji = (kana: string): string => {
  // Kana are all in the Basic Multilingual Plane, so splitting by UTF-16 unit is safe.
  const chars = toHiragana(kana).split('');
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] ?? '';
    const next = chars[i + 1] ?? '';
    if (c === 'っ') {
      const following = BASE[next] ?? '';
      out += following.startsWith('ch') ? 't' : (following[0] ?? '');
      continue;
    }
    if (c === 'ー') continue;
    const base = BASE[c];
    if (base === undefined) continue;
    const small = SMALL_Y[next];
    if (small && base.endsWith('i') && base.length > 1) {
      const stem = base.slice(0, -1);
      out += ['sh', 'ch', 'j'].includes(stem) ? stem + small : `${stem}y${small}`;
      i++;
      continue;
    }
    if (c === 'ん' && /^[aiueoy]/.test(BASE[next] ?? '')) {
      out += "n'";
      continue;
    }
    out += base;
  }
  out = out
    .replace(/ou/g, 'o')
    .replace(/oo/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/n'(?=[^aiueoy])/g, 'n');
  return out.charAt(0).toUpperCase() + out.slice(1);
};

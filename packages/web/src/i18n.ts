import { JA } from './i18n-ja.ts';

/**
 * The interface in the language of the switch. Strings are written in English and looked up in
 * the Japanese dictionary when 日本語 is on; anything missing stays English. `{name}` marks a
 * value filled in from `vars`. This module imports nothing from the app, so anything can use it.
 */
let current: 'en' | 'ja' = 'en';

export const setTranslationLang = (lang: 'en' | 'ja') => {
  current = lang;
};

export const isJa = () => current === 'ja';

/** Strings asked for in Japanese that the dictionary lacks; the web check fails on any. */
export const untranslated = new Set<string>();

/**
 * Japanese for pages built apart from the public site (the setup page): kept out of i18n-ja.ts so
 * the public bundle does not carry it, and added here when such a page starts.
 */
const EXTRA: Record<string, string> = {};
export const registerTranslations = (more: Record<string, string>): void => {
  Object.assign(EXTRA, more);
};

export const t = (text: string, vars?: Record<string, string | number>): string => {
  let template = text;
  if (current === 'ja') {
    const japanese = JA[text] ?? EXTRA[text];
    if (japanese === undefined) untranslated.add(text);
    else template = japanese;
  }
  return vars
    ? template.replace(/\{(\w+)\}/g, (whole, key: string) =>
        key in vars ? String(vars[key]) : whole,
      )
    : template;
};

/**
 * Label tables (statuses, themes, months, seasons…) that read in the current language: every
 * string read from them goes through `t`, nested objects and arrays too. Ids are not in the
 * dictionary, so they come through unchanged.
 */
const proxies = new WeakMap<object, object>();
const IDENTIFIERS = new Set<string | symbol>(['id', 'value', 'key', 'query']);

export const localized = <T extends object>(table: T): T => {
  // One proxy per table, so the same entry read twice is the same object.
  const known = proxies.get(table);
  if (known) return known as T;
  const proxy = new Proxy(table, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      // Identifiers (an id, a select's value, a key, an address query) are never translated.
      if (typeof value === 'string') return IDENTIFIERS.has(key) ? value : t(value);
      if (value && typeof value === 'object') return localized(value);
      return value;
    },
  });
  proxies.set(table, proxy);
  return proxy;
};

/** Dates and figures in the current language's way of writing them. */
export const locale = () => (current === 'ja' ? 'ja-JP' : 'en-GB');

/** MapLibre's own control labels, for maps made while Japanese is on. */
export const mapLocale = (): Record<string, string> | undefined =>
  current === 'ja'
    ? {
        'AttributionControl.ToggleAttribution': '出典の表示を切り替え',
        'Map.Title': '地図',
        'NavigationControl.ResetBearing': '北を上に戻す',
        'NavigationControl.ZoomIn': '拡大',
        'NavigationControl.ZoomOut': '縮小',
        'Popup.Close': '閉じる',
        'TerrainControl.Enable': '3D地形を表示',
        'TerrainControl.Disable': '3D地形を隠す',
      }
    : undefined;

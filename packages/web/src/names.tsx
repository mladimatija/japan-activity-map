import type { ReactElement } from 'react';

import type { Data, Route } from './data.ts';
import { distanceText, typeLabel } from './format.ts';
import { t } from './i18n.ts';
import { type Lang, useStore } from './store.ts';

/** Anything with a Japanese and an English name: places, list items, lists, prefectures, regions. */
export interface Named {
  ja: string;
  en: string;
}

export const otherLang = (lang: Lang): Lang => (lang === 'ja' ? 'en' : 'ja');

/** The name in `lang`, or the other one when that is empty. */
export const nameIn = (name: Named, lang: Lang): string =>
  (lang === 'ja' ? name.ja : name.en) || name.ja || name.en;

/** The name in the other language, when it says something the first one does not. */
export const subName = (name: Named, lang: Lang): string | undefined => {
  const other = nameIn(name, otherLang(lang));
  return other && other !== nameIn(name, lang) ? other : undefined;
};

export const useLang = (): Lang => useStore((state) => state.lang);

/** An activity's name; one without a name (or with names not published) is called by its type. */
export const activityName = (activity: { name: string; type: string }): string =>
  activity.name || typeLabel(activity.type);

/**
 * A route's name: the one given to it, or the automatic one said in the interface's language
 * ("雲取山 · Hike 20.5 km", "雲取山・ハイキング 20.5 km").
 */
export const routeName = (route: Route, lang: Lang = useStore.getState().lang): string => {
  const { auto } = route;
  if (!auto) return route.name;
  const vars = {
    place: nameIn(auto.place, lang),
    type: typeLabel(route.type),
    distance: distanceText(auto.km * 1000),
  };
  const text = auto.loop
    ? t('{place} · {type} {distance} loop', vars)
    : t('{place} · {type} {distance}', vars);
  return auto.n ? `${text} (${auto.n})` : text;
};

/**
 * A name in the viewer's language, then the other language for reference: "Mount Fuji 富士山"
 * in English, "富士山 Mount Fuji" in Japanese. `only` shows the first alone (tight places).
 */
export const Name = ({
  name,
  main,
  sub = 'text-muted-foreground font-normal',
  only = false,
}: {
  name: Named;
  /** Class of the first name. */
  main?: string;
  /** Class of the second. */
  sub?: string;
  only?: boolean;
}): ReactElement => {
  const lang = useLang();
  const second = only ? undefined : subName(name, lang);
  return (
    <>
      <span data-name="main" className={main} lang={lang}>
        {nameIn(name, lang)}
      </span>
      {second && (
        <>
          {' '}
          <span className={sub} lang={otherLang(lang)}>
            {second}
          </span>
        </>
      )}
    </>
  );
};

/** A prefecture's name in the reader's language, from its code; the code itself if unknown. */
export const prefectureName = (data: Data, code: string | undefined, lang: Lang): string => {
  const feature = code ? data.prefectureByCode.get(code)?.properties : undefined;
  return feature ? nameIn(feature, lang) : (code ?? '');
};

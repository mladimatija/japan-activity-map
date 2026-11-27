import type { Data } from './data.ts';
import { date, typeLabel } from './format.ts';
import type { Selection } from './store.ts';
import { activityName, nameIn, routeName, subName } from './names.tsx';
import type { Lang } from './store.ts';
import { t } from './i18n.ts';

/** One thing search can find. `text` is everything it matches on, normalised. */
export interface Entry {
  kind: 'place' | 'prefecture' | 'route' | 'activity';
  key: string;
  title: string;
  detail: string;
  /** Lang of the title, for screen readers. */
  lang?: string;
  /** The list to switch to before selecting, for places. */
  list?: string;
  selection: Selection;
  text: string;
  /** Lower sorts first among equal matches. */
  rank: number;
}

export const KIND_LABELS: Record<Entry['kind'], string> = {
  place: 'Places',
  prefecture: 'Prefectures',
  route: 'My routes',
  activity: 'Activities',
};

/** Lower case, full-width folded, accents and long-vowel marks removed: Ōdake, odake and ＯＤＡＫＥ meet. */
const normalise = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-‐・·'’.,()（）]/g, '');

/** Every place (once, in the first list that has it), prefecture, grouped route and activity. */
export const buildIndex = (data: Data, lang: Lang = 'en'): Entry[] => {
  const entries: Entry[] = [];
  const seen = new Set<string>();
  for (const list of data.lists) {
    for (const item of list.items) {
      const key = item.placeId ?? `${list.id}/${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lists = item.placeId
        ? (data.itemsByPlace.get(item.placeId) ?? []).map((entry) => nameIn(entry.list.title, lang))
        : [nameIn(list.title, lang)];
      entries.push({
        kind: 'place',
        key: `place:${key}`,
        title: nameIn(item.name, lang),
        lang,
        detail: [subName(item.name, lang), lists.slice(0, 2).join(', ')]
          .filter(Boolean)
          .join(' · '),
        list: list.id,
        selection: { kind: 'item', list: list.id, id: item.id },
        text: normalise(`${item.name.ja} ${item.name.en}`),
        rank: item.status === 'done' ? 0 : 1,
      });
    }
  }
  for (const feature of data.prefectures.features) {
    const p = feature.properties;
    entries.push({
      kind: 'prefecture',
      key: `prefecture:${p.code}`,
      title: nameIn(p, lang),
      lang,
      detail: [
        subName(p, lang),
        p.activities === 1 ? t('1 activity') : t('{count} activities', { count: p.activities }),
      ]
        .filter(Boolean)
        .join(' · '),
      selection: { kind: 'prefecture', code: p.code },
      text: normalise(`${p.ja} ${p.en} ${p.ja.replace(/[都道府県]$/, '')}`),
      rank: 0,
    });
  }
  for (const route of data.routes) {
    entries.push({
      kind: 'route',
      key: `route:${route.id}`,
      title: routeName(route, lang),
      detail: `${typeLabel(route.type)} · ${t('done {count} times', { count: route.count })}`,
      selection: { kind: 'route', id: route.id },
      // Found by its name in either language.
      text: normalise(`${routeName(route, 'ja')} ${routeName(route, 'en')}`),
      rank: -route.count,
    });
  }
  for (const activity of data.activities) {
    entries.push({
      kind: 'activity',
      key: `activity:${activity.id}`,
      title: activityName(activity),
      detail: `${date(activity.date)} · ${typeLabel(activity.type)}`,
      selection: { kind: 'activity', id: activity.id },
      text: normalise(`${activityName(activity)} ${activity.date} ${typeLabel(activity.type)}`),
      rank: -Number(activity.date.replaceAll('-', '')),
    });
  }
  return entries;
};

interface ResultGroup {
  kind: Entry['kind'];
  entries: Entry[];
}

/** Matches grouped by kind: names that start with the query first, then the rest. */
export const search = (index: Entry[], query: string, perKind = 5): ResultGroup[] => {
  const q = normalise(query);
  if (!q) return [];
  const groups = new Map<Entry['kind'], { entry: Entry; score: number }[]>();
  for (const entry of index) {
    const at = entry.text.indexOf(q);
    if (at < 0) continue;
    const score = (at === 0 ? 0 : 1) * 1e9 + entry.rank;
    groups.set(entry.kind, [...(groups.get(entry.kind) ?? []), { entry, score }]);
  }
  const order: Entry['kind'][] = ['place', 'prefecture', 'route', 'activity'];
  return order
    .filter((kind) => groups.has(kind))
    .map((kind) => ({
      kind,
      entries: (groups.get(kind) ?? [])
        .sort((a, b) => a.score - b.score)
        .slice(0, perKind)
        .map(({ entry }) => entry),
    }));
};

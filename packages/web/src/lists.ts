import type { Data, List, ListItem } from './data.ts';
import { REGIONS } from '@jam/core/prefectures';
import { derive, type Filters } from './filters.ts';
import type { Status } from './map/palette.ts';

/** An item's region: that of its first prefecture, as the reference site groups them. */
export const regionOf = (data: Data, item: ListItem): string => {
  const code = item.prefectures[0];
  const feature = code ? data.prefectureByCode.get(code) : undefined;
  return feature?.properties.region ?? 'other';
};

/** The items the list shows now: those passing the place filters. */
export const visibleItems = (data: Data, list: List, filters: Filters): ListItem[] =>
  derive(data, filters).items(list);

interface RegionGroup {
  id: string;
  ja: string;
  en: string;
  items: ListItem[];
  done: number;
  total: number;
}

/** Items grouped by region, north to south, with each region's progress over all its items. */
export const groupByRegion = (data: Data, list: List, shown: ListItem[]): RegionGroup[] => {
  const totals = new Map<string, { done: number; total: number }>();
  for (const item of list.items) {
    const region = regionOf(data, item);
    const entry = totals.get(region) ?? { done: 0, total: 0 };
    entry.total++;
    if (item.status === 'done') entry.done++;
    totals.set(region, entry);
  }
  const byRegion = new Map<string, ListItem[]>();
  for (const item of shown) {
    const region = regionOf(data, item);
    byRegion.set(region, [...(byRegion.get(region) ?? []), item]);
  }
  return [...REGIONS, { id: 'other', ja: 'その他', en: 'Other' }]
    .filter((region) => byRegion.has(region.id))
    .map((region) => ({
      ...region,
      items: byRegion.get(region.id) ?? [],
      done: totals.get(region.id)?.done ?? 0,
      total: totals.get(region.id)?.total ?? 0,
    }));
};

/** Status counts in display order, for the progress bar and the chips. */
export const STATUS_ORDER: Status[] = ['done', 'partial', 'dns', 'want', 'none'];

/** Done out of total: items for a point list, metres for a route list. */
export const progressOf = (list: List): { done: number; total: number; share: number } => {
  const done = list.kind === 'route' ? (list.coveredM ?? 0) : (list.counts.done ?? 0);
  const total = list.kind === 'route' ? (list.lengthM ?? 0) : list.items.length;
  return { done, total, share: total ? done / total : 0 };
};

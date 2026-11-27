import { XIcon } from 'lucide-react';

import { Button } from '../components/ui/button.tsx';
import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import {
  filterCount,
  type Filters,
  METRICS,
  MONTHS,
  NO_FILTERS,
  REPEATS,
  SEASONS,
  SOURCES,
  WEEKDAYS,
  WHENS,
} from '../filters.ts';
import { REGIONS } from '@jam/core/prefectures';
import {
  heightText,
  hoursText,
  numberText,
  rangeText,
  STATUS_LABELS,
  typeLabel,
  wholeDistance,
  yearsText,
} from '../format.ts';
import { distanceM, distanceUnit, heightM, heightUnit } from '../units.ts';
import { type Lang, setFilters, useStore } from '../store.ts';
import { nameIn, useLang } from '../names.tsx';
import { t } from '../i18n.ts';

interface Chip {
  key: string;
  label: string;
  remove: Partial<Filters>;
}

/** One chip per set filter value, each removable. */
const onListName = (data: Data, id: string, lang: Lang) => {
  const list = data.listById.get(id);
  return list ? nameIn(list.title, lang) : id;
};

export const filterChips = (filters: Filters, data: Data, lang: Lang = 'en'): Chip[] => {
  const chips: Chip[] = [];
  const each = <T,>(key: keyof Filters, values: readonly T[], label: (value: T) => string) => {
    for (const value of values)
      chips.push({
        key: `${key}:${String(value)}`,
        label: label(value),
        remove: {
          [key]: (filters[key] as unknown as readonly T[]).filter((entry) => entry !== value),
        },
      });
  };
  const range = (
    key: 'years' | 'km' | 'gain' | 'hours' | 'elev' | 'visits' | 'idle',
    label: string,
  ) => {
    if (filters[key].min !== null || filters[key].max !== null)
      chips.push({ key, label, remove: { [key]: NO_FILTERS[key] } });
  };
  const prefName = (code: string) => {
    const feature = data.prefectureByCode.get(code)?.properties;
    return feature ? nameIn(feature, lang) : code;
  };
  each('types', filters.types, typeLabel);
  each('tags', filters.tags, (tag) => t((tag[0]?.toUpperCase() ?? '') + tag.slice(1)));
  range('years', rangeText(filters.years, String));
  if (filters.when)
    chips.push({
      key: 'when',
      label: WHENS.find((entry) => entry.id === filters.when)?.label ?? filters.when,
      remove: { when: null },
    });
  each('seasons', filters.seasons, (id) => SEASONS.find((season) => season.id === id)?.label ?? id);
  each('months', filters.months, (month) => MONTHS[month - 1] ?? String(month));
  each('days', filters.days, (id) => WEEKDAYS.find((day) => day.id === id)?.label ?? id);
  each('prefs', filters.prefs, prefName);
  each('onLists', filters.onLists, (id) => t('On {list}', { list: onListName(data, id, lang) }));
  if (filters.firsts)
    chips.push({ key: 'firsts', label: t('New ground'), remove: { firsts: false } });
  if (filters.repeat)
    chips.push({
      key: 'repeat',
      label: REPEATS.find((entry) => entry.id === filters.repeat)?.label ?? filters.repeat,
      remove: { repeat: null },
    });
  each('sources', filters.sources, (id) => SOURCES.find((source) => source.id === id)?.label ?? id);
  range('km', rangeText(filters.km, wholeDistance));
  range('gain', rangeText(filters.gain, heightText, 'Climb'));
  range('hours', rangeText(filters.hours, hoursText, 'Moving'));
  each('status', filters.status, (status) => STATUS_LABELS[status]);
  if (filters.in)
    chips.push({
      key: 'in',
      label: t('In {place}', { place: prefName(filters.in) }),
      remove: { in: null },
    });
  each('regions', filters.regions, (id) => {
    const region = REGIONS.find((entry) => entry.id === id);
    return region ? nameIn(region, lang) : id;
  });
  range('elev', rangeText(filters.elev, heightText, 'Height'));
  range(
    'visits',
    rangeText(filters.visits, (value) => `${value}×`, 'Visited'),
  );
  if (filters.firstIn)
    chips.push({
      key: 'firstIn',
      label: t('First reached: {when}', {
        when: WHENS.find((entry) => entry.id === filters.firstIn)?.label ?? filters.firstIn,
      }),
      remove: { firstIn: null },
    });
  range('idle', rangeText(filters.idle, yearsText, 'Not reached for'));
  each('has', filters.has, (type) => t('Has {type}', { type: typeLabel(type).toLowerCase() }));
  each('lacks', filters.lacks, (type) =>
    t('Never {type}', { type: typeLabel(type).toLowerCase() }),
  );
  if (filters.metric) {
    const metric = METRICS.find((entry) => entry.id === filters.metric?.key);
    chips.push({
      key: 'metric',
      label: t('At least {amount} {unit}', {
        amount:
          filters.metric.key === 'km'
            ? numberText((filters.metric.min * 1000) / distanceM(), 0)
            : filters.metric.key === 'gain'
              ? numberText(Math.round(filters.metric.min / heightM()))
              : numberText(filters.metric.min),
        unit:
          filters.metric.key === 'km'
            ? distanceUnit()
            : filters.metric.key === 'gain'
              ? heightUnit()
              : t(metric?.unit || 'activities'),
      }),
      remove: { metric: null },
    });
  }
  return chips;
};

/** The filters in force, over the top of the map (or a page): each removable, and all at once. */
export const ActiveFilters = ({ data, className }: { data: Data; className?: string }) => {
  const filters = useStore((state) => state.filters);
  const lang = useLang();
  if (filterCount(filters) === 0) return null;
  const chips = filterChips(filters, data, lang);
  return (
    <div
      className={cn('pointer-events-none', className)}
      role="region"
      aria-label={t('Filters in force')}
    >
      <ul className="pointer-events-auto flex gap-1.5 max-md:no-scrollbar max-md:overflow-x-auto md:flex-wrap">
        {chips.map((chip) => (
          <li key={chip.key} className="flex-none">
            <Button
              size="sm"
              className="rounded-full shadow-sm"
              aria-label={t('Remove filter: {filter}', { filter: chip.label })}
              onClick={() => setFilters(chip.remove)}
            >
              {chip.label}
              <XIcon data-icon="inline-end" className="opacity-70" />
            </Button>
          </li>
        ))}
        <li className="flex-none">
          <Button
            variant="secondary"
            size="sm"
            className="rounded-full shadow-sm"
            onClick={() => useStore.setState({ filters: NO_FILTERS })}
          >
            {t('Clear all')}
          </Button>
        </li>
      </ul>
    </div>
  );
};

import { BookmarkPlusIcon } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { GROUP_ROW, GroupChevron, PANE_TITLE, SortSelect } from '../components/app.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '../components/ui/field.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.tsx';
import { Input } from '../components/ui/input.tsx';

import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import {
  activityCounts,
  activityValues,
  clearScope,
  derive,
  filterActivities,
  type Filters,
  firstsOf,
  METRICS,
  MONTHS,
  NO_FILTERS,
  presentIn,
  REPEATS,
  type Scope,
  scopeCount,
  SEASONS,
  SOURCES,
  usesOnlyPresent,
  WEEKDAYS,
  WHENS,
  countByWhen,
} from '../filters.ts';
import { REGIONS } from '@jam/core/prefectures';
import {
  heightText,
  hoursText,
  STATUS_LABELS,
  typeLabel,
  wholeDistance,
  yearsText,
  withUnits,
} from '../format.ts';
import { STATUS_COLORS, TYPE_COLORS } from '../map/palette.ts';
import { STATUS_ORDER } from '../lists.ts';
import { deleteView, saveView, usePref, useSavedViews } from '../prefs.ts';
import { type Lang, setFilters, useStore } from '../store.ts';
import { decode as decodeView, encode, openView, viewTarget } from '../url.ts';
import { STICK_BOTTOM, STICK_TOP } from './scroll.ts';
import { ChoiceField, FacetLabel, RangeField, SwitchField } from './controls.tsx';
import { filterChips } from '../shell/ActiveFilters.tsx';
import { Name, nameIn, useLang } from '../names.tsx';
import { localized, t } from '../i18n.ts';
import {
  distanceM,
  distanceUnit,
  FOOT_M,
  formatUnits,
  heightM,
  heightUnit,
  MILE_M,
} from '../units.ts';

// Slider stops are round numbers in the units shown; the filter itself is always kilometres and
// metres, so a link reads the same whichever units its reader has.
const KM_STOPS = [0, 1, 2, 3, 5, 7, 10, 15, 21, 30, 42, 50, 70, 100, 150, 200, 300];
const MILE_STOPS = [0, 1, 2, 3, 5, 7, 10, 13, 20, 26, 30, 45, 60, 100, 125, 200];
const GAIN_STOPS = [0, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
const GAIN_FEET = [
  0, 150, 300, 500, 1000, 1500, 2500, 3500, 5000, 6500, 8000, 10_000, 13_000, 16_000,
];
const ELEVATION_STOPS = Array.from({ length: 39 }, (_, i) => i * 100);
const ELEVATION_FEET = Array.from({ length: 26 }, (_, i) => i * 500);
const inKm = (miles: number) => Number(((miles * MILE_M) / 1000).toFixed(3));
const inMetres = (feet: number) => Number((feet * FOOT_M).toFixed(2));
const STOPS = {
  metric: { km: KM_STOPS, gain: GAIN_STOPS, elev: ELEVATION_STOPS },
  imperial: {
    km: MILE_STOPS.map(inKm),
    gain: GAIN_FEET.map(inMetres),
    elev: ELEVATION_FEET.map(inMetres),
  },
};
/** A prefecture threshold as typed and shown: in the visitor's units, kept in km and metres. */
const shown = (key: string, value: number) =>
  key === 'km'
    ? Number(((value * 1000) / distanceM()).toFixed(1))
    : key === 'gain'
      ? Math.round(value / heightM())
      : value;
const stored = (key: string, value: number) =>
  key === 'km'
    ? Number(((value * distanceM()) / 1000).toFixed(3))
    : key === 'gain'
      ? Number((value * heightM()).toFixed(2))
      : value;
const HOUR_STOPS = [0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12];
const IDLE_STOPS = Array.from({ length: 11 }, (_, i) => i);
const TAG_LABELS: Record<string, string> = localized({
  race: 'Race',
  training: 'Training',
  commute: 'Commute',
  group: 'Group',
  solo: 'Solo',
  overnight: 'Overnight',
});

/** The part of an address after # for what is on screen: the list, the pane's view and every filter. */
const currentQuery = (data: Data): string => {
  const { list, view, filters } = useStore.getState();
  const derived = derive(data, filters);
  // From the filter panel, the view its "Show" button would open.
  const shown =
    view !== 'filters'
      ? view
      : derived.activityIds
        ? 'activities'
        : derived.matching
          ? 'prefectures'
          : 'list';
  return encode({ list, view: shown, filters, selection: null }).replace(/^#/, '');
};

/** A name for a view to save: what its filters are, as the chips over the map say. */
const suggestedName = (data: Data, lang: Lang) => {
  const chips = filterChips(useStore.getState().filters, data, lang).map((chip) => chip.label);
  const text = chips.join(', ');
  return text.length > 60 ? `${text.slice(0, 57)}…` : text || t('My view');
};

/** Saving the view on screen under a name, kept in this browser. */
const SaveView = ({ data }: { data: Data }) => {
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const id = useId();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(suggestedName(data, lang));
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <BookmarkPlusIcon data-icon="inline-start" />
        {t('Save this view')}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72" aria-label={t('Save this view')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            saveView({ name: trimmed, query: currentQuery(data) });
            setOpen(false);
          }}
        >
          <Field className="gap-1.5">
            <FieldLabel htmlFor={id}>{t('Name')}</FieldLabel>
            <Input
              id={id}
              value={name}
              // The field appears because its button was pressed: typing follows at once.
              // oxlint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <FieldDescription className="text-xs">
              {t('Saved in this browser, with the list, the tab and every filter.')}
            </FieldDescription>
          </Field>
          <Button type="submit" disabled={!name.trim()}>
            {t('Save')}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
};

/**
 * Saved views, in a dropdown: the reader's own first, then the site's. Choosing one sets the view
 * and every filter, and the list if it names one. The one on screen shows as chosen.
 */
const SavedViews = ({ data }: { data: Data }) => {
  const list = useStore((state) => state.list);
  const view = useStore((state) => state.view);
  const filters = useStore((state) => state.filters);
  const mine = useSavedViews((state) => state.views);
  // A site view about an activity type, tag, source or list the data does not have is not offered.
  const offered = data.meta.views.filter((saved) => {
    const target = decodeView(saved.query);
    const params = new URLSearchParams(saved.query);
    return (
      usesOnlyPresent(target.filters, data) &&
      (!params.has('list') || data.listById.has(target.list))
    );
  });
  // What is on screen, in the form a view's target takes; the filter panel counts as any view.
  const onScreen = (query: string) => {
    const target = decodeView(query);
    return encode({
      list,
      filters,
      view: view === 'filters' ? target.view : view,
      selection: null,
    });
  };
  const isOn = (query: string) => viewTarget(query, list) === onScreen(query);
  const mineOn = mine.find((saved) => isOn(saved.query));
  const siteOn = mineOn ? undefined : offered.find((saved) => isOn(saved.query));
  const chosen = mineOn ? `mine:${mineOn.query}` : siteOn ? `site:${siteOn.query}` : null;
  const mineOptions = mine.map((saved) => ({ value: `mine:${saved.query}`, label: saved.name }));
  const siteOptions = offered.map((saved) => ({
    value: `site:${saved.query}`,
    label: withUnits(t(saved.name)),
  }));
  const any = mineOptions.length + siteOptions.length > 0;
  return (
    <div className="mb-5 flex flex-col gap-2">
      {any && (
        <ChoiceField
          label="Saved views"
          multiple={false}
          required
          placeholder={t('Choose a saved view')}
          {...(mineOptions.length && siteOptions.length
            ? {
                groups: [
                  { id: 'mine', label: t('Yours'), options: mineOptions },
                  { id: 'site', label: t('Suggested'), options: siteOptions },
                ],
              }
            : { options: [...mineOptions, ...siteOptions] })}
          chosen={chosen ? [chosen] : []}
          onChange={([value]) => value && openView(value.replace(/^(mine|site):/, ''), data)}
        />
      )}
      <div className="flex items-center gap-3">
        <SaveView data={data} />
        {mineOn && (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 font-normal text-muted-foreground"
            onClick={() => deleteView(mineOn.query)}
          >
            {t('Delete “{name}”', { name: mineOn.name })}
          </Button>
        )}
      </div>
    </div>
  );
};

const PrefecturePicker = ({ data, filters }: { data: Data; filters: Filters }) => {
  const lang = useLang();
  const counts = activityCounts(data, filters, 'prefs', activityValues.prefs);
  const groups = REGIONS.map((region) => ({
    id: region.id,
    label: <Name name={region} sub="font-normal" />,
    options: data.prefectures.features
      .map((feature) => feature.properties)
      .filter((p) => p.region === region.id)
      .map((p) => ({
        value: p.code,
        label: nameIn(p, lang),
        content: <Name name={p} sub="text-xs text-muted-foreground" />,
        // Kinki is better known as Kansai.
        search: [p.en, p.ja, region.en, region.ja, region.id === 'kinki' ? 'Kansai 関西' : '']
          .join(' ')
          .trim(),
        count: counts.get(p.code) ?? 0,
      })),
  }));
  return (
    <ChoiceField
      label="Prefecture"
      groups={groups}
      chosen={filters.prefs}
      onChange={(next) => setFilters({ prefs: next })}
    />
  );
};

/**
 * A group of facets, with how many of its things are left. Its heading folds it away; which groups
 * are open is remembered. A folded group's filters still apply.
 */
const Facets = ({
  id,
  title,
  count,
  note,
  children,
}: {
  id: Scope;
  title: ReactNode;
  count: ReactNode;
  note?: string;
  children: ReactNode;
}) => {
  const [open, setOpen] = usePref<boolean>(`facets.${id}`, true);
  // How many of its filters are on, so a folded group never hides one.
  const on = useStore((state) => scopeCount(state.filters, id));
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setOpen(next)}
      render={<FieldSet className="min-w-0 gap-0 border-t" />}
    >
      <FieldLegend className="float-left mb-0 flex w-full items-center gap-2">
        <CollapsibleTrigger
          className={cn(
            GROUP_ROW,
            'group flex min-w-0 flex-1 items-center gap-2 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          <span className="min-w-0 flex-1">
            {typeof title === 'string' ? t(title) : title}{' '}
            <span className="font-normal whitespace-nowrap text-muted-foreground tabular-nums">
              {count}
            </span>
          </span>
          {on > 0 && (
            <Badge className="tabular-nums">
              {on === 1 ? t('1 filter') : t('{count} filters', { count: on })}
            </Badge>
          )}
          <GroupChevron />
        </CollapsibleTrigger>
        {on > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto shrink-0 px-0 font-normal"
            aria-label={t('Clear the {group} filters', {
              group: typeof title === 'string' ? t(title).toLowerCase() : t('list'),
            })}
            onClick={() => setFilters(clearScope(id))}
          >
            {t('Clear')}
          </Button>
        )}
      </FieldLegend>
      <CollapsibleContent className="flex flex-col gap-4 pt-1 pb-5">
        {note && <FieldDescription className="-mt-1 text-xs">{t(note)}</FieldDescription>}
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
};

const ActivityFacets = ({ data, filters }: { data: Data; filters: Filters }) => {
  const lang = useLang();
  const present = presentIn(data);
  const count = (
    key: Parameters<typeof activityCounts>[2],
    values: (typeof activityValues)[keyof typeof activityValues],
  ) => activityCounts(data, filters, key, values);
  const types = count('types', activityValues.types);
  const tags = count('tags', activityValues.tags);
  const seasons = count('seasons', activityValues.seasons);
  const months = count('months', activityValues.months);
  const sources = count('sources', activityValues.sources);
  const days = count('days', activityValues.days);
  const repeats = count('repeat', activityValues.repeat);
  const lists = (() => {
    const counts = new Map<string, number>();
    for (const list of data.lists)
      counts.set(list.id, derive(data, { ...filters, onLists: [list.id] }).activities.length);
    return counts;
  })();
  const whens = countByWhen(filterActivities(data, filters, 'when').map((a) => a.date));
  const firsts = firstsOf(data);
  const newCount = filterActivities(data, filters, 'firsts').filter((a) => firsts.has(a.id)).length;
  const allYears = [
    ...new Set(data.activities.map((activity) => Number(activity.date.slice(0, 4)))),
  ].sort((a, b) => a - b);
  const [thisYear] = useState(() => new Date().getFullYear());
  const yearStops = allYears.length ? allYears : [thisYear];
  const matching = derive(data, filters).activities.length;
  return (
    <Facets
      id="activities"
      title="Activities"
      count={t('{done} of {total}', { done: matching, total: data.activities.length })}
    >
      <ChoiceField
        label="Type"
        options={present.types.map((type) => ({
          value: type,
          label: typeLabel(type),
          count: types.get(type) ?? 0,
          dot: TYPE_COLORS[type],
        }))}
        chosen={filters.types}
        onChange={(next) => setFilters({ types: next })}
      />
      {present.tags.length > 0 && (
        <ChoiceField
          label="Event"
          options={present.tags.map((tag) => ({
            value: tag,
            label: TAG_LABELS[tag] ?? tag,
            count: tags.get(tag) ?? 0,
          }))}
          chosen={filters.tags}
          onChange={(next) => setFilters({ tags: next })}
        />
      )}
      {yearStops.length > 1 && (
        <RangeField
          label="Year"
          stops={yearStops}
          range={filters.years}
          format={String}
          onChange={(years) => setFilters({ years })}
        />
      )}
      <ChoiceField
        label="When"
        multiple={false}
        options={WHENS.map((entry) => ({
          value: entry.id,
          label: entry.label,
          count: whens.get(entry.id) ?? 0,
        }))}
        chosen={filters.when ? [filters.when] : []}
        onChange={(next) => setFilters({ when: next[0] ?? null })}
      />
      <ChoiceField
        label="Season"
        options={SEASONS.map((season) => ({
          value: season.id,
          label: season.label,
          count: seasons.get(season.id) ?? 0,
        }))}
        chosen={filters.seasons}
        onChange={(next) => setFilters({ seasons: next })}
      />
      <ChoiceField
        label="Month"
        options={MONTHS.map((month, i) => ({
          value: i + 1,
          label: month,
          count: months.get(String(i + 1)) ?? 0,
        }))}
        chosen={filters.months}
        onChange={(next) => setFilters({ months: next.toSorted((a, b) => a - b) })}
      />
      <ChoiceField
        label="Day of the week"
        options={WEEKDAYS.map((day) => ({
          value: day.id,
          label: day.label,
          count: days.get(day.id) ?? 0,
        }))}
        chosen={filters.days}
        onChange={(next) =>
          setFilters({ days: WEEKDAYS.map((day) => day.id).filter((id) => next.includes(id)) })
        }
      />
      <PrefecturePicker data={data} filters={filters} />
      <ChoiceField
        label="Reached a place on"
        options={data.lists.map((list) => ({
          value: list.id,
          label: nameIn(list.title, lang),
          content: <Name name={list.title} sub="text-xs text-muted-foreground" />,
          search: [list.title.en, list.title.ja].join(' '),
          count: lists.get(list.id) ?? 0,
        }))}
        chosen={filters.onLists}
        onChange={(next) => setFilters({ onLists: next })}
      />
      <SwitchField
        label="Only new ground"
        hint="Activities that reached a place, a route stretch or a prefecture for the first time."
        count={newCount}
        checked={filters.firsts}
        onChange={(firsts) => setFilters({ firsts })}
      />
      <ChoiceField
        label="Routes"
        multiple={false}
        options={REPEATS.map((entry) => ({
          value: entry.id,
          label: entry.label,
          count: repeats.get(entry.id) ?? 0,
        }))}
        chosen={filters.repeat ? [filters.repeat] : []}
        onChange={(next) => setFilters({ repeat: next[0] ?? null })}
      />
      {/* One source is no choice at all. */}
      {present.sources.length > 1 && (
        <ChoiceField
          label="Source"
          multiple={false}
          options={SOURCES.filter((source) => present.sources.includes(source.id)).map(
            (source) => ({
              value: source.id,
              label: source.label,
              count: sources.get(source.id) ?? 0,
            }),
          )}
          chosen={filters.sources}
          onChange={(next) => setFilters({ sources: next })}
        />
      )}
      <RangeField
        label="Distance"
        stops={STOPS[formatUnits()].km}
        range={filters.km}
        format={wholeDistance}
        onChange={(km) => setFilters({ km })}
      />
      <RangeField
        label="Climb"
        stops={STOPS[formatUnits()].gain}
        range={filters.gain}
        format={heightText}
        onChange={(gain) => setFilters({ gain })}
      />
      <RangeField
        label="Moving time"
        stops={HOUR_STOPS}
        range={filters.hours}
        format={hoursText}
        onChange={(hours) => setFilters({ hours })}
      />
    </Facets>
  );
};

const PlaceFacets = ({ data, filters }: { data: Data; filters: Filters }) => {
  const lang = useLang();
  const list = useStore((state) => data.listById.get(state.list));
  if (!list) return null;
  const derived = derive(data, filters);
  const byStatus = new Map<string, number>();
  for (const item of derived.items(list, 'status'))
    byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);
  const byRegion = new Map<string, number>();
  for (const item of derived.items(list, 'regions')) {
    const region = data.prefectureByCode.get(item.prefectures[0] ?? '')?.properties.region;
    if (region) byRegion.set(region, (byRegion.get(region) ?? 0) + 1);
  }
  const shown = derived.items(list).length;
  const firstIns = countByWhen(derived.items(list, 'firstIn').map((item) => item.first));
  const maxVisits = Math.max(1, ...list.items.map((item) => derived.visits(item)));
  const visitStops = Array.from({ length: Math.min(maxVisits, 20) + 1 }, (_, i) => i);
  return (
    <Facets
      id="places"
      title={<Name name={list.title} only />}
      count={t('{done} of {total}', { done: shown, total: list.items.length })}
      note="Narrows this list's rows and pins."
    >
      <ChoiceField
        label="Status"
        options={STATUS_ORDER.filter(
          (status) => (list.counts as Record<string, number>)[status],
        ).map((status) => ({
          value: status,
          label: STATUS_LABELS[status],
          count: byStatus.get(status) ?? 0,
          dot: STATUS_COLORS[status],
        }))}
        chosen={filters.status}
        onChange={(next) => setFilters({ status: next })}
      />
      <ChoiceField
        label="Region"
        options={REGIONS.map((region) => ({
          value: region.id,
          label: nameIn(region, lang),
          count: byRegion.get(region.id) ?? 0,
        }))}
        chosen={filters.regions}
        onChange={(next) => setFilters({ regions: next })}
      />
      {list.kind === 'point' && (
        <>
          <RangeField
            label="Height"
            stops={STOPS[formatUnits()].elev}
            range={filters.elev}
            format={heightText}
            onChange={(elev) => setFilters({ elev })}
          />
          <RangeField
            label="Visits"
            stops={visitStops}
            range={filters.visits}
            format={(value) => `${value}×`}
            onChange={(visits) => setFilters({ visits })}
          />
          <ChoiceField
            label="First reached"
            multiple={false}
            options={WHENS.map((entry) => ({
              value: entry.id,
              label: entry.label,
              count: firstIns.get(entry.id) ?? 0,
            }))}
            chosen={filters.firstIn ? [filters.firstIn] : []}
            onChange={(next) => setFilters({ firstIn: next[0] ?? null })}
          />
          <RangeField
            label="Not reached for"
            stops={IDLE_STOPS}
            range={filters.idle}
            format={yearsText}
            onChange={(idle) => setFilters({ idle })}
          />
        </>
      )}
    </Facets>
  );
};

const PrefectureFacets = ({ data, filters }: { data: Data; filters: Filters }) => {
  const present = presentIn(data);
  const derived = derive(data, filters);
  const metric = filters.metric;
  const id = useId();
  return (
    <Facets
      id="prefectures"
      title="Prefectures"
      count={t('{done} of {total}', {
        done: derived.matching ? derived.matching.size : data.prefectures.features.length,
        total: data.prefectures.features.length,
      })}
      note="Picks prefectures by what the matching activities did there."
    >
      <ChoiceField
        label="Has"
        options={present.types.map((type) => ({
          value: type,
          label: typeLabel(type),
          dot: TYPE_COLORS[type],
        }))}
        chosen={filters.has}
        onChange={(next) =>
          setFilters({ has: next, lacks: filters.lacks.filter((type) => !next.includes(type)) })
        }
      />
      <ChoiceField
        label="Never"
        options={present.types.map((type) => ({
          value: type,
          label: typeLabel(type),
          dot: TYPE_COLORS[type],
        }))}
        chosen={filters.lacks}
        onChange={(next) =>
          setFilters({ lacks: next, has: filters.has.filter((type) => !next.includes(type)) })
        }
      />
      <Field className="gap-1.5">
        <FacetLabel id={id}>{t('At least')}</FacetLabel>
        <div className="flex gap-2" role="group" aria-labelledby={id}>
          <Input
            type="number"
            min={0}
            inputMode="decimal"
            aria-label={t('Threshold')}
            className="h-8 w-24"
            value={metric ? shown(metric.key, metric.min) : ''}
            placeholder={t('Any')}
            onChange={(event) => {
              const value = event.target.value === '' ? null : Number(event.target.value);
              setFilters({
                metric:
                  value === null || Number.isNaN(value) || value <= 0
                    ? null
                    : {
                        key: metric?.key ?? 'activities',
                        min: stored(metric?.key ?? 'activities', value),
                      },
              });
            }}
          />
          <SortSelect
            label={t('Of')}
            value={metric?.key ?? 'activities'}
            options={METRICS.map((entry) => ({
              value: entry.id,
              label:
                entry.id === 'km'
                  ? distanceUnit()
                  : entry.id === 'gain'
                    ? t('{unit} climb', { unit: heightUnit() })
                    : entry.label.toLowerCase(),
            }))}
            onChange={(key) => setFilters({ metric: metric ? { ...metric, key } : null })}
          />
        </div>
      </Field>
    </Facets>
  );
};

/** Every facet in one place, with saved views at the top and the result count at the bottom. */
export const FilterPanel = ({ data }: { data: Data }) => {
  const filters = useStore((state) => state.filters);
  const derived = derive(data, filters);
  return (
    // At least as tall as the pane, so the buttons sit at its bottom however much is folded.
    <section aria-labelledby="filters-title" className="flex min-h-full flex-col">
      {/* Stays at the top while the facets scroll (the offsets undo the scroller's padding). */}
      <header
        className={cn(
          STICK_TOP,
          'mb-4 flex items-center justify-between border-b py-4 max-md:py-3',
        )}
      >
        <h2 id="filters-title" data-detail-title="" tabIndex={-1} className={PANE_TITLE}>
          {t('Filters')}
        </h2>
        <Button
          variant="link"
          className="h-auto p-0"
          onClick={() => useStore.setState({ filters: NO_FILTERS })}
        >
          {t('Clear all')}
        </Button>
      </header>
      <SavedViews data={data} />
      <ActivityFacets data={data} filters={filters} />
      <PlaceFacets data={data} filters={filters} />
      <PrefectureFacets data={data} filters={filters} />
      <footer className={cn(STICK_BOTTOM, 'mt-auto flex gap-2 border-t pt-3 pb-4')}>
        <Button
          className="flex-1"
          onClick={() =>
            useStore.setState({
              view: derived.matching && !derived.activityIds ? 'prefectures' : 'activities',
            })
          }
        >
          {derived.activities.length === 1
            ? t('Show 1 activity')
            : t('Show {count} activities', { count: derived.activities.length })}
        </Button>
        <Button variant="secondary" onClick={() => useStore.setState({ view: 'list' })}>
          {t('Show the list')}
        </Button>
      </footer>
    </section>
  );
};

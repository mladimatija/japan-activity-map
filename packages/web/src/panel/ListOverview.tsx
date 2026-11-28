import { XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Chip,
  Count,
  Empty,
  GROUP_ROW,
  ROW_MAIN,
  ROW_SUB,
  RowBody,
  RowButton,
  RowSide,
  STATUS_TEXT,
  StatusBadge,
} from '../components/app.tsx';
import { cn } from '../lib/utils.ts';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion.tsx';
import { Button } from '../components/ui/button.tsx';
import { VirtualRows } from '../components/VirtualRows.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { inView, setOnMapOnly, useViewport } from '../map/viewport.ts';
import type { Data, List, ListItem } from '../data.ts';
import {
  date,
  distanceText,
  heightText,
  metresBetween,
  percent,
  STATUS_LABELS,
} from '../format.ts';
import { panSoon, setHover, useHovered } from '../hover.ts';
import { groupByRegion, progressOf, regionOf, STATUS_ORDER, visibleItems } from '../lists.ts';
import { STATUS_COLORS } from '../map/palette.ts';
import { MiniBar } from '../shell/ListPicker.tsx';
import { ListCover } from './ListCover.tsx';
import { RouteLine } from './RouteLine.tsx';
import { STAMP_GRID_MAX, StampGrid } from './StampGrid.tsx';
import { derive, NO_FILTERS } from '../filters.ts';
import type { Status } from '../map/palette.ts';
import { usePref } from '../prefs.ts';
import { select, setFilters, useStore } from '../store.ts';
import { Name, prefectureName, useLang } from '../names.tsx';
import { t } from '../i18n.ts';

/**
 * A bar split by status, under the cover: for routes, and for lists too long for the stamp grid.
 */
const ProgressBar = ({ list }: { list: List }) => {
  const { total, share } = progressOf(list);
  const counts = list.counts as Record<string, number>;
  return (
    <div className="mb-3">
      <div
        className="flex h-2.5 overflow-hidden rounded-full bg-muted *:h-full"
        role="img"
        aria-label={
          list.kind === 'route'
            ? t('{share} covered', { share: percent(share, 1) })
            : STATUS_ORDER.filter((status) => counts[status])
                .map((status) => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`)
                .join(', ')
        }
      >
        {list.kind === 'route' ? (
          <span style={{ width: `${share * 100}%`, background: STATUS_COLORS.done }} />
        ) : (
          STATUS_ORDER.filter((status) => status !== 'none' && counts[status]).map((status) => (
            <span
              key={status}
              style={{
                width: `${((counts[status] ?? 0) / total) * 100}%`,
                background: STATUS_COLORS[status],
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};

/**
 * What is left, and a place to start: the not-yet item closest to the latest outing (or the first
 * on the list when there is none with a track). Shown for points lists that are not finished.
 */
const NextUp = ({ data, list }: { data: Data; list: List }) => {
  const { done, total } = progressOf(list);
  const left = list.items.filter((item) => item.status !== 'done' && item.at);
  if (list.kind !== 'point' || done >= total || left.length === 0) return null;
  const latest = data.activities.reduce<(typeof data.activities)[number] | undefined>(
    (best, activity) => (activity.bbox && (!best || activity.date > best.date) ? activity : best),
    undefined,
  );
  const from = latest?.bbox
    ? [(latest.bbox[0] + latest.bbox[2]) / 2, (latest.bbox[1] + latest.bbox[3]) / 2]
    : undefined;
  const next = from
    ? left.reduce((best, item) =>
        metresBetween(from, item.at ?? []) < metresBetween(from, best.at ?? []) ? item : best,
      )
    : left[0];
  if (!next) return null;
  return (
    <p className="mb-3 flex flex-wrap items-baseline gap-x-1.5 text-compact text-muted-foreground">
      <span className="tabular-nums">{t('{count} to go', { count: total - done })}</span>·
      <span>{from ? t('Closest to your latest outing:') : t('Start with:')}</span>
      <Button
        variant="link"
        className="h-auto p-0 text-compact"
        onClick={() => select({ kind: 'item', list: list.id, id: next.id }, true)}
      >
        <Name name={next.name} only />
      </Button>
    </p>
  );
};

/**
 * One chip per status the list has, plus All; they narrow the rows and the pins together. Several
 * can be on at once. Counts are of the items the other place filters leave.
 */
const StatusChips = ({ data, list }: { data: Data; list: List }) => {
  const filters = useStore((state) => state.filters);
  const others = derive(data, filters).items(list, 'status');
  const counts = new Map<Status, number>();
  for (const item of others) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const shown = STATUS_ORDER.filter((status) => (list.counts as Record<string, number>)[status]);
  if (shown.length < 2) return null;
  return (
    <div className="my-3 flex flex-wrap gap-1.5" role="group" aria-label={t('Show')}>
      <Chip on={filters.status.length === 0} onToggle={() => setFilters({ status: [] })}>
        {t('All')} <Count>{others.length}</Count>
      </Chip>
      {shown.map((status) => {
        const on = filters.status.includes(status);
        return (
          <Chip
            key={status}
            on={on}
            dot={STATUS_COLORS[status]}
            onToggle={() =>
              setFilters({
                status: on
                  ? filters.status.filter((entry) => entry !== status)
                  : [...filters.status, status],
              })
            }
          >
            {STATUS_LABELS[status]} <Count>{counts.get(status) ?? 0}</Count>
          </Chip>
        );
      })}
    </div>
  );
};

const Row = ({ data, list, item }: { data: Data; list: List; item: ListItem }) => {
  const hovered = useHovered(item.id);
  const lang = useLang();
  const prefectures = item.prefectures.map((code) => prefectureName(data, code, lang));
  const place =
    prefectures.length > 2
      ? `${prefectures[0]} +${prefectures.length - 1}`
      : prefectures.join('・');
  const meta =
    list.kind === 'route'
      ? t('{done} of {total}', {
          done: distanceText(item.coveredM ?? 0, 1),
          total: distanceText(item.lengthM, 1),
        })
      : [item.elevationM ? heightText(item.elevationM) : null, place].filter(Boolean).join(' · ');
  const when =
    item.status === 'done' || item.status === 'partial'
      ? item.first
      : item.status === 'dns'
        ? item.latest
        : undefined;
  return (
    <RowButton
      hovered={hovered}
      data-key={`item:${item.id}`}
      onClick={() => select({ kind: 'item', list: list.id, id: item.id }, true)}
      onMouseEnter={() => setHover(item.id)}
      onMouseLeave={() => setHover(null)}
      onFocus={() => setHover(item.id)}
      onBlur={() => setHover(null)}
    >
      <StatusBadge status={item.status}>{item.order}</StatusBadge>
      <RowBody
        title={<Name name={item.name} main={ROW_MAIN} sub={ROW_SUB} />}
        meta={
          <>
            {meta}
            {list.kind === 'route' && item.lengthM ? (
              <MiniBar share={(item.coveredM ?? 0) / item.lengthM} />
            ) : null}
          </>
        }
      />
      {when && (
        <RowSide className={STATUS_TEXT[item.status]}>
          {item.status === 'dns' ? t('Tried {date}', { date: date(when) }) : date(when)}
        </RowSide>
      )}
    </RowButton>
  );
};

/** The active list: progress, filters, then its items by region, north to south. */
export const ListOverview = ({ data }: { data: Data }) => {
  const listId = useStore((state) => state.list);
  const filters = useStore((state) => state.filters);
  const recent = useStore((state) => state.recent);
  const lang = useLang();
  const list = data.listById.get(listId);
  // Which regions are open, remembered across lists and visits.
  const [openRegions, setOpenRegions] = usePref<string[]>('openRegions', []);
  const open = new Set(openRegions);
  const setOpen = useCallback(
    (update: Set<string> | ((current: Set<string>) => Set<string>)) =>
      setOpenRegions((current) => [
        ...(typeof update === 'function' ? update(new Set(current)) : update),
      ]),
    [setOpenRegions],
  );
  // The row to bring into view and focus: coming back from a detail, or stepping with the arrows.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const onMapOnly = useViewport((state) => state.onMapOnly);
  const bounds = useViewport((state) => (state.onMapOnly ? state.bounds : null));
  const all = list ? visibleItems(data, list, filters) : [];
  // "Only what's on the map": places in view (route sections have no single point, so they stay).
  const shown = bounds ? all.filter((item) => !item.at || inView(bounds, item.at)) : all;
  const groups = list ? groupByRegion(data, list, shown) : [];
  // Small results open every region; long lists start folded, like the reference site.
  const allOpen = shown.length <= 40 || groups.length === 1;

  // Coming back from a detail: open its region, and bring its row into view with focus on it.
  useEffect(() => {
    if (!list || !recent) return;
    const item = list.items.find((candidate) => candidate.id === recent);
    if (!item) return;
    const region = regionOf(data, item);
    // Follows a navigation, not a render: the row to return to is known only once it exists.
    // oxlint-disable-next-line react/set-state-in-effect
    setOpen((current) => (current.has(region) ? current : new Set([...current, region])));
    // oxlint-disable-next-line react/set-state-in-effect
    setFocusKey(`item:${recent}`);
  }, [data, list, recent, setOpen]);

  // Arrow keys step through the rows (opening regions on the way) and the map follows after a
  // pause; Enter opens the detail, as on any button.
  // A key held down outruns the focus (a row has to render before it can take it), so steps go on
  // from the row asked for, not the one that has focus yet.
  const pending = useRef<string | null>(null);
  const asked = useRef(new Set<string>());
  const step = (event: React.KeyboardEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-key^="item:"]')
      ?.dataset.key;
    const key = target && (pending.current ?? target);
    if (!key || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const flat = groups.flatMap((group) => group.items.map((item) => ({ item, region: group.id })));
    const here = flat.findIndex((entry) => `item:${entry.item.id}` === key);
    const next =
      event.key === 'Home'
        ? flat[0]
        : event.key === 'End'
          ? flat.at(-1)
          : flat[
              Math.max(0, Math.min(flat.length - 1, here + (event.key === 'ArrowDown' ? 1 : -1)))
            ];
    if (!next) return;
    event.preventDefault();
    if (!allOpen)
      setOpen((current) =>
        current.has(next.region) ? current : new Set([...current, next.region]),
      );
    pending.current = `item:${next.item.id}`;
    asked.current.add(pending.current);
    setFocusKey(pending.current);
    panSoon(next.item.id);
  };
  // Focus reaching the last row asked for, or any row the arrows did not ask for (a click, Tab),
  // ends the run.
  const landed = (event: React.FocusEvent) => {
    const key = (event.target as HTMLElement).dataset.key ?? '';
    if (key === pending.current || !asked.current.has(key)) {
      pending.current = null;
      asked.current.clear();
    }
  };

  if (!list) return <Empty>{t('This list is not in the build.')}</Empty>;
  return (
    // Arrow keys move between the rows inside; the section itself takes no focus.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section aria-labelledby="list-title" onKeyDown={step} onFocus={landed}>
      <ListCover list={list} />
      <div className="mt-3">
        <NextUp data={data} list={list} />
        {list.kind === 'route' ? (
          <RouteLine list={list} />
        ) : list.items.length <= STAMP_GRID_MAX ? (
          <StampGrid list={list} />
        ) : (
          <ProgressBar list={list} />
        )}
      </div>
      <StatusChips data={data} list={list} />
      {list.kind === 'point' && (
        // The Switch inside is the control; the rule cannot see into the component.
        // oxlint-disable-next-line jsx-a11y/label-has-associated-control
        <label className="mb-2 flex cursor-pointer items-center justify-between gap-3 text-compact">
          <span className="flex flex-col gap-0.5">
            <span>
              {t("Only what's on the map")}
              {onMapOnly && (
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {t('{done} of {total}', { done: shown.length, total: all.length })}
                </span>
              )}
            </span>
            <span id="on-map-hint" className="text-xs text-muted-foreground">
              {t('Lists only the places in view, and follows the map as you move it.')}
            </span>
          </span>
          <Switch
            checked={onMapOnly}
            onCheckedChange={setOnMapOnly}
            aria-describedby="on-map-hint"
          />
        </label>
      )}
      {filters.in && (
        <p className="mt-1 mb-2 flex items-center gap-1.5 rounded-md bg-muted py-1 pr-1 pl-3">
          {t('In')} <span lang={lang}>{prefectureName(data, filters.in, lang)}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label={t('Show the whole list')}
            onClick={() => setFilters({ in: null })}
          >
            <XIcon />
          </Button>
        </p>
      )}
      {shown.length === 0 ? (
        <Empty
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setFilters({
                  status: [],
                  in: null,
                  regions: [],
                  elev: NO_FILTERS.elev,
                  visits: NO_FILTERS.visits,
                })
              }
            >
              {t('Show everything')}
            </Button>
          }
        >
          {t('Nothing here with this filter.')}
        </Empty>
      ) : (
        <Accordion
          multiple
          className="border-t"
          value={allOpen ? groups.map((group) => group.id) : [...open]}
          onValueChange={(value: string[]) => {
            if (!allOpen) setOpen(new Set(value));
          }}
        >
          {groups.map((group) => (
            <AccordionItem key={group.id} value={group.id}>
              <AccordionTrigger
                className={cn(GROUP_ROW, 'items-center gap-3 py-0 hover:no-underline')}
              >
                <span className="flex flex-1 items-baseline gap-2">
                  <Name name={group} sub="text-xs font-normal text-muted-foreground" />
                </span>
                {list.kind === 'point' && (
                  <span className="text-compact font-normal text-muted-foreground tabular-nums">
                    {group.done} / {group.total}
                  </span>
                )}
                {list.kind === 'point' && (
                  <MiniBar share={group.total ? group.done / group.total : 0} />
                )}
              </AccordionTrigger>
              <AccordionContent className="pb-2">
                <VirtualRows
                  items={group.items}
                  keyOf={(item) => `item:${item.id}`}
                  row={(item) => <Row data={data} list={list} item={item} />}
                  focusKey={focusKey}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </section>
  );
};

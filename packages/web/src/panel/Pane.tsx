import { ChevronRightIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.tsx';
import { Alert, AlertDescription } from '../components/ui/alert.tsx';
import { Drawer, DrawerContent } from '../components/ui/drawer.tsx';
import { useIsMobile } from '../hooks/use-mobile.ts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx';

import type { Data } from '../data.ts';
import { date } from '../format.ts';
import { lazyErrors, useLoaded } from '../lazy.ts';
import { popoverOpen } from '../shell/popover.ts';
import { PANE_PADDING, PaneScroll, STICK_TOP } from './scroll.ts';
import { derive } from '../filters.ts';
import { cn } from '../lib/utils.ts';
import { type PaneView, select, type SheetStop, useStore } from '../store.ts';
import { Details } from './Details.tsx';
import { FilterPanel } from './FilterPanel.tsx';
import { ListOverview } from './ListOverview.tsx';
import { ActivityResults, PrefectureResults } from './Results.tsx';
import { PaneResizer } from './PaneResizer.tsx';
import { t } from '../i18n.ts';
import { useLang } from '../names.tsx';

const STOPS: SheetStop[] = ['peek', 'half', 'full'];

/** Sheet heights in pixels for a window this tall; the map keeps its camera clear of the sheet. */
export const sheetHeight = (stop: SheetStop, windowHeight = window.innerHeight): number => {
  if (stop === 'peek') return Math.min(176, Math.round(windowHeight * 0.3));
  if (stop === 'half') return Math.round(windowHeight * 0.52);
  return windowHeight - 64;
};

const TABS: { view: PaneView; label: string }[] = [
  { view: 'list', label: 'List' },
  { view: 'activities', label: 'Activities' },
  { view: 'prefectures', label: 'Prefectures' },
];

/** List, activities, prefectures: three views of what the filters leave, as tabs. */
const PaneTabs = ({ data, view }: { data: Data; view: PaneView }) => {
  const filters = useStore((state) => state.filters);
  const derived = derive(data, filters);
  const count = (tab: PaneView) =>
    tab === 'activities'
      ? derived.activities.length
      : tab === 'prefectures'
        ? derived.matching
          ? derived.matching.size
          : derived.totals.size
        : undefined;
  return (
    <Tabs value={view} onValueChange={(value: PaneView) => useStore.setState({ view: value })}>
      {/* Stays at the top while the list scrolls (the offsets undo the scroller's padding). */}
      <div className={cn(STICK_TOP, 'pt-4 pb-2 max-md:pt-0')}>
        <TabsList className="w-full" aria-label={t('Show')}>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.view} value={tab.view}>
              {t(tab.label)}
              {count(tab.view) !== undefined && (
                <span className="font-normal tabular-nums">{count(tab.view)}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {TABS.map((tab) => (
        <TabsContent key={tab.view} value={tab.view}>
          {tab.view === 'activities' ? (
            <ActivityResults data={data} />
          ) : tab.view === 'prefectures' ? (
            <PrefectureResults data={data} />
          ) : (
            <ListOverview data={data} />
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
};

/**
 * The list or a detail: a pane on the left on wide screens, a bottom sheet with three stops on
 * phones (drag the handle, tap it, or use the arrow keys on it).
 */
export const Pane = ({ data }: { data: Data }) => {
  const selection = useStore((state) => state.selection);
  const view = useStore((state) => state.view);
  const stop = useStore((state) => state.sheet);
  const mobile = useIsMobile();
  useLoaded();
  const body = useRef<HTMLDivElement>(null);
  const key = selection ? JSON.stringify(selection) : view === 'filters' ? 'filters' : null;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const lang = useLang();
  const sources = useRef<HTMLButtonElement>(null);
  // Sheet heights follow the window.
  const [, onResize] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The map's credit link opens the Sources section here.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.jam-sources')) return;
      event.preventDefault();
      setSourcesOpen(true);
      sources.current?.scrollIntoView({ block: 'nearest' });
      sources.current?.focus();
      useStore.setState({ sheet: 'full' });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // The map's controls sit above the sheet: they read its height from the page root.
  useEffect(() => {
    document.documentElement.style.setProperty('--sheet-height', `${sheetHeight(stop)}px`);
  });

  // Esc closes the detail, unless a menu is open (Esc is the menu's then).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || popoverOpen()) return;
      const state = useStore.getState();
      if (state.selection) select(null);
      else if (state.view === 'filters') useStore.setState({ view: 'list' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A detail starts at its top, with keyboard focus on its title.
  useEffect(() => {
    if (!key || !body.current) return;
    body.current.scrollTop = 0;
    body.current.querySelector<HTMLElement>('[data-detail-title]')?.focus({ preventScroll: true });
  }, [key]);

  const { meta } = data;
  const label = selection ? t('Details') : t('List');
  // Tap the handle to step up through the stops, or use the arrow keys on it; dragging is the
  // drawer's own.
  const handle = (
    <button
      type="button"
      className="group h-7 w-full flex-none pointer-coarse:h-9"
      aria-label={t('Panel height: {stop}. Activate to change.', { stop: t(stop) })}
      onClick={() =>
        useStore.setState({ sheet: stop === 'peek' ? 'half' : stop === 'half' ? 'full' : 'peek' })
      }
      onKeyDown={(event) => {
        const i = STOPS.indexOf(stop);
        if (event.key === 'ArrowUp')
          useStore.setState({ sheet: STOPS[Math.min(2, i + 1)] ?? stop });
        if (event.key === 'ArrowDown')
          useStore.setState({ sheet: STOPS[Math.max(0, i - 1)] ?? stop });
      }}
    >
      <span className="mx-auto block h-1.5 w-10 rounded-full bg-border group-focus-visible:bg-ring" />
    </button>
  );
  const inner = (
    <>
      {meta.counts.activities === 0 && (
        <Alert role="status" className="mx-4 mt-3 w-auto md:mx-5">
          <InfoIcon />
          <AlertDescription>
            {t('No activities are published yet. The lists are shown without any progress.')}
          </AlertDescription>
        </Alert>
      )}
      {lazyErrors.length > 0 && (
        <Alert variant="destructive" className="mx-4 mt-3 w-auto md:mx-5">
          <TriangleAlertIcon />
          <AlertDescription>{lazyErrors.at(-1)}</AlertDescription>
        </Alert>
      )}
      <PaneScroll value={body}>
        <div
          ref={body}
          className={cn(
            // The scroll padding keeps a row brought into view clear of a sticky heading.
            'flex-1 scroll-pt-16 overflow-y-auto overscroll-contain',
            PANE_PADDING,
            stop === 'peek' && 'max-md:overflow-hidden',
          )}
        >
          {selection ? (
            <Details data={data} selection={selection} />
          ) : view === 'filters' ? (
            <FilterPanel data={data} />
          ) : (
            <PaneTabs data={data} view={view} />
          )}
        </div>
      </PaneScroll>
      <footer
        className={cn(
          'border-t px-4 py-2 text-xs text-muted-foreground md:px-5',
          stop === 'peek' && 'max-md:hidden',
        )}
      >
        <Collapsible open={sourcesOpen} onOpenChange={setSourcesOpen}>
          <CollapsibleTrigger
            ref={sources}
            className="group flex items-center gap-1 rounded-sm hover:text-foreground"
          >
            <ChevronRightIcon className="size-3.5 transition-transform group-data-panel-open:rotate-90" />
            {t('Sources · {count} activities to {date}', {
              count: meta.counts.activities,
              date: date(meta.latestActivity),
            })}
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted>
            <ul className="my-2 flex max-h-[30vh] flex-col gap-1 overflow-y-auto">
              {meta.credits.map((credit) => (
                <li key={credit.name}>
                  <a
                    href={credit.url}
                    target="_blank"
                    rel="noopener"
                    className="text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    {(lang === 'ja' && credit.attributionJa) || credit.attribution}
                  </a>{' '}
                  ({(lang === 'ja' && credit.licenceJa) || credit.licence})
                </li>
              ))}
            </ul>
            <p>
              {meta.map.terrain
                ? t('The base map and terrain are credited on the map.')
                : t('The base map is credited on the map.')}{' '}
              {t('Built {date}.', { date: date(meta.builtAt.slice(0, 10)) })}
            </p>
          </CollapsibleContent>
        </Collapsible>
      </footer>
    </>
  );

  if (!mobile)
    return (
      <aside
        id="jam-content"
        tabIndex={-1}
        className="relative z-20 flex min-h-0 flex-col border-r bg-background outline-none"
        aria-label={label}
      >
        {inner}
        <PaneResizer />
      </aside>
    );
  // Phones: a bottom sheet over the map (a drawer that never closes), at one of three heights.
  const heights = STOPS.map((entry) => sheetHeight(entry));
  return (
    <Drawer
      open
      modal={false}
      disablePointerDismissal
      // The sheet never closes: a swipe that would close it lowers it to its lowest stop.
      onOpenChange={(open, details) => {
        if (open) return;
        details.cancel();
        // After the drawer has put itself back, so it is not undone.
        setTimeout(() => useStore.setState({ sheet: 'peek' }), 0);
      }}
      snapPoints={heights}
      snapPoint={sheetHeight(stop)}
      onSnapPointChange={(point) => {
        const at = heights.indexOf(Number(point));
        if (at >= 0) useStore.setState({ sheet: STOPS[at] ?? stop });
      }}
    >
      <DrawerContent
        data-pane=""
        aria-label={label}
        initialFocus={false}
        finalFocus={false}
        className="z-20 shadow-[0_-2px_16px_color-mix(in_srgb,var(--foreground)_14%,transparent)] data-[swipe-axis=y]:[--drawer-content-max-height:calc(100dvh-4rem)]"
      >
        {/* Only the part of the sheet that is showing scrolls, so its last rows can be reached. */}
        <div
          className="flex min-h-0 flex-col pb-[env(safe-area-inset-bottom)]"
          style={{ height: sheetHeight(stop) }}
        >
          {handle}
          {inner}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

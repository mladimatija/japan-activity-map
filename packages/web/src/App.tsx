import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { TriangleAlertIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';

import { Loading } from './components/app.tsx';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';

import { type Data, loadData } from './data.ts';
import { ensureLoaded } from './lazy.ts';
import { LoadingLine, LoadingNote } from './map/LoadingLine.tsx';
import { MapKey } from './map/MapKey.tsx';
import { Pane } from './panel/Pane.tsx';
import { ActiveFilters } from './shell/ActiveFilters.tsx';
import { TopBar } from './shell/TopBar.tsx';
import { usePaneWidth } from './prefs.ts';
import { useStore } from './store.ts';

const Pages = lazy(() => import('./pages/Pages.tsx'));
// The map library is most of the app's size: it loads beside the shell, not before it.
const MapView = lazy(() =>
  import('./map/MapView.tsx').then((module) => ({ default: module.MapView })),
);
import { settle, syncWithAddress } from './url.ts';
import { t } from './i18n.ts';
import { cn } from './lib/utils.ts';

const DARK = '(prefers-color-scheme: dark)';
const onDarkChange = (listener: () => void) => {
  const media = window.matchMedia(DARK);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};
/** Whether the system is set to dark, re-rendering when that changes (as hooks/use-mobile.ts). */
const useDark = (): boolean =>
  useSyncExternalStore(
    onDarkChange,
    () => window.matchMedia(DARK).matches,
    () => false,
  );

/** The first stop for the Tab key: past the top bar, straight to the panel (or the page). */
const SkipLink = () => (
  <button
    type="button"
    className="sr-only max-md:hidden focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:rounded-md focus-visible:border focus-visible:bg-background focus-visible:px-3 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:shadow-md"
    // A button, not a link: the address after # is the app's state.
    onClick={() => document.getElementById('jam-content')?.focus()}
  >
    {t('Skip to the panel')}
  </button>
);

export const App = () => {
  const [data, setData] = useState<Data | undefined>();
  const [error, setError] = useState<string | undefined>();
  const dark = useDark();
  const page = useStore((state) => state.page);
  const filtering = useStore((state) => state.view === 'filters');
  const paneOn = page === 'map' || filtering;
  const paneWidth = usePaneWidth((state) => state.width);
  // The whole interface follows the language switch: this re-renders everything under it.
  const lang = useStore((state) => state.lang);
  // The units switch works the same way: every figure is formatted again.
  useStore((state) => state.units);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => syncWithAddress(), []);
  useEffect(() => {
    loadData().then(setData, (reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, []);
  // Lazy files (tracks by year, a route list's geometry) follow the store; components never fetch.
  useEffect(() => {
    if (!data) return;
    settle(data);
    ensureLoaded(useStore.getState(), data);
    return useStore.subscribe(() => ensureLoaded(useStore.getState(), data));
  }, [data]);
  useEffect(() => {
    if (data) document.title = data.meta.site.title;
  }, [data]);

  if (error) {
    return (
      <main className="grid h-full place-items-center p-6">
        <Alert variant="destructive" className="max-w-md">
          <TriangleAlertIcon />
          <AlertTitle>
            <h1>{t('The map could not load')}</h1>
          </AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="grid h-full place-content-center p-6" aria-busy="true">
        <Loading className="text-sm">{t('Loading the map…')}</Loading>
      </main>
    );
  }
  return (
    <TooltipProvider delay={400}>
      <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <SkipLink />
        <TopBar data={data} />
        {/* The pane's width is the reader's (dragged by its edge), within what leaves the map room. */}
        <div
          className={cn(
            'relative min-h-0',
            paneOn &&
              'md:grid md:grid-cols-[clamp(20rem,var(--pane-width),max(20rem,calc(100vw-22.5rem)))_1fr]',
          )}
          style={{ '--pane-width': `${paneWidth}px` } as React.CSSProperties}
        >
          {/* A chart page has the whole window: the pane (the sheet, on a phone) is the map's, and
              comes back on a chart page only for filtering (the Filters button). */}
          {paneOn && <Pane data={data} />}
          {/* The map stays mounted under a chart page, so coming back is instant. */}
          <main
            className="relative min-w-0 max-md:absolute max-md:inset-0 max-md:z-10"
            aria-label={t('Map')}
            hidden={page !== 'map'}
          >
            <ErrorBoundary resetKey="map">
              <Suspense
                fallback={
                  <Loading className="absolute inset-0 justify-center text-sm">
                    {t('Loading the map…')}
                  </Loading>
                }
              >
                <MapView data={data} dark={dark} />
              </Suspense>
            </ErrorBoundary>
            <LoadingLine />
            {/* The map's footer, bottom left: the key over the loading note, clear of the phone sheet. */}
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-7rem)] flex-col items-start gap-2 *:pointer-events-auto max-md:bottom-[calc(var(--sheet-height)+0.75rem)]">
              <MapKey data={data} />
              <LoadingNote />
            </div>
            <ActiveFilters
              data={data}
              className="absolute top-2 right-14 left-2 z-10 md:top-3 md:right-16 md:left-3"
            />
          </main>
          {page !== 'map' && (
            <main
              // The skip link's stop when there is no panel.
              id={paneOn ? undefined : 'jam-content'}
              tabIndex={-1}
              className="relative h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-muted/40 max-md:absolute max-md:inset-0 max-md:z-10"
              // Without the sheet there is nothing to keep the page's end clear of.
              style={paneOn ? undefined : ({ '--sheet-height': '0px' } as React.CSSProperties)}
            >
              <ActiveFilters
                data={data}
                className="sticky top-0 z-10 mx-auto max-w-260 px-3 pt-3 md:px-6"
              />
              <ErrorBoundary resetKey={page}>
                <Suspense
                  fallback={
                    <Loading className="justify-center p-6 text-sm">{t('Loading…')}</Loading>
                  }
                >
                  <Pages data={data} page={page} />
                </Suspense>
              </ErrorBoundary>
            </main>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

import {
  type Data,
  loadOnce,
  type PrefectureOutlineFile,
  type ReferenceRouteFile,
  type TracksFile,
} from './data.ts';
import { derive } from './filters.ts';
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

import type { State } from './store.ts';

/** Files the map loads when they are needed. The map and panel read these; only `ensureLoaded` fetches. */
export const tracksByYear = new Map<number, TracksFile>();
export const referenceByList = new Map<string, ReferenceRouteFile>();
/** Detailed outlines of prefectures that have been selected, by code. */
export const outlineByCode = new Map<string, PrefectureOutlineFile>();
export const lazyErrors: string[] = [];

/**
 * Files on their way, for the loading line on the map: how many were asked for in this burst and
 * how many have arrived. Both go back to zero a moment after the last one lands.
 */
export const useLoading = create<{
  total: number;
  done: number;
  what: 'tracks' | 'route' | null;
}>()(() => ({ total: 0, done: 0, what: null }));
let settleTimer: ReturnType<typeof setTimeout> | undefined;

const started = (what: 'tracks' | 'route'): void => {
  clearTimeout(settleTimer);
  useLoading.setState((state) => ({ total: state.total + 1, what }));
};

const finished = (): void => {
  useLoading.setState((state) => ({ done: state.done + 1 }));
  const { done, total } = useLoading.getState();
  if (done >= total)
    settleTimer = setTimeout(() => useLoading.setState({ total: 0, done: 0, what: null }), 2500);
};

// The maps above live outside React. Each arrival (or failure) moves `version` on, and components
// that read the maps call `useLoaded()` to render again when it does.
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const bump = () => {
  version += 1;
  for (const listener of listeners) listener();
};

/**
 * Subscribes a component to the lazily loaded files and returns a number that changes whenever
 * one arrives: call it before reading `tracksByYear`, `referenceByList` or `outlineByCode`, and
 * give the number to any memo that reads them.
 */
export const useLoaded = (): number =>
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );

const requested = new Set<number>();
const requestedRoutes = new Set<string>();
const requestedOutlines = new Set<string>();

/** Runs work once the browser has a quiet moment, so start-up is not competing with it. */
const whenIdle = (work: () => void) => {
  const idle = (
    globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (idle) idle(work, { timeout: 2000 });
  else setTimeout(work, 300);
};

const loadYear = (year: number): void => {
  started('tracks');
  loadOnce<TracksFile>(`tracks/${year}.geojson`)
    .then((file) => {
      if (!tracksByYear.has(year)) {
        tracksByYear.set(year, file);
        bump();
      }
    })
    .catch((error: unknown) => {
      requested.delete(year);
      lazyErrors.push(error instanceof Error ? error.message : String(error));
      bump();
    })
    .finally(finished);
};

/**
 * Starts loading whatever the current view needs and has not been requested yet. With the tracks
 * layer on that is every year with a track the filters keep, newest first and the older ones once
 * the page is idle; with it off,
 * only the year of a selected activity, so its track can be drawn.
 */
export const ensureLoaded = (state: State, data: Data): void => {
  const selectedYear =
    state.selection?.kind === 'activity'
      ? data.activityById.get(state.selection.id)?.trackYear
      : undefined;
  // With activity filters on, only the years that have a matching track.
  const { activityIds, activities } = derive(data, state.filters);
  const years = activityIds
    ? [...new Set(activities.flatMap((activity) => activity.trackYear ?? []))]
    : data.meta.trackYears;
  // The compare page needs every year (year maps, new ground, height profiles), and so do the
  // goals page and the tiles layer (records and tiles come from the tracks).
  const wanted =
    state.page === 'compare' || state.page === 'goals' || state.layers.tiles
      ? data.meta.trackYears.toSorted((a, b) => b - a)
      : state.layers.tracks
        ? years.toSorted((a, b) => b - a)
        : selectedYear === undefined
          ? []
          : [selectedYear];
  // A selected activity's year goes first either way.
  if (selectedYear !== undefined)
    wanted.sort((a, b) => Number(b === selectedYear) - Number(a === selectedYear));
  wanted
    .filter((year) => !tracksByYear.has(year) && !requested.has(year))
    .forEach((year, index) => {
      requested.add(year);
      if (index === 0) loadYear(year);
      else whenIdle(() => loadYear(year));
    });
  // A selected prefecture's detailed outline, quietly: until it arrives (or if the build has none)
  // the map outlines it with the simplified shape.
  const code = state.selection?.kind === 'prefecture' ? state.selection.code : undefined;
  if (code && !outlineByCode.has(code) && !requestedOutlines.has(code)) {
    requestedOutlines.add(code);
    loadOnce<PrefectureOutlineFile>(`prefectures/${code}.geojson`)
      .then((file) => {
        outlineByCode.set(code, file);
        bump();
      })
      .catch(() => undefined);
  }
  const list = data.listById.get(state.list);
  if (list?.kind === 'route' && !referenceByList.has(list.id) && !requestedRoutes.has(list.id)) {
    requestedRoutes.add(list.id);
    started('route');
    loadOnce<ReferenceRouteFile>(`reference-routes/${list.id}.geojson`)
      .then((file) => {
        if (!referenceByList.has(list.id)) {
          referenceByList.set(list.id, file);
          bump();
        }
      })
      .catch((error: unknown) => {
        requestedRoutes.delete(list.id);
        lazyErrors.push(error instanceof Error ? error.message : String(error));
        bump();
      })
      .finally(finished);
  }
};

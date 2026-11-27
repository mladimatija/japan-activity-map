import { useCallback } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

/**
 * The browser's local storage, quietly doing nothing where there is none (a server render, private
 * mode, storage turned off): choices then last until the page is closed.
 */
export const storage: StateStorage = {
  getItem: (name) => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      // Full or turned off: kept for this visit only.
    }
  },
  removeItem: (name) => {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      // As above.
    }
  },
};

/** Remembered choices that are not part of a link: sort orders, chart modes, open regions. */
const usePrefs = create<{ values: Record<string, unknown> }>()(
  persist(() => ({ values: {} }), {
    name: 'jam.prefs',
    version: 1,
    storage: createJSONStorage(() => storage),
  }),
);

type Json = string | number | boolean | string[];

const fits = <T extends Json>(stored: unknown, initial: T, allowed?: readonly T[]): stored is T =>
  allowed
    ? allowed.includes(stored as T)
    : Array.isArray(initial)
      ? Array.isArray(stored) && stored.every((entry) => typeof entry === 'string')
      : typeof stored === typeof initial;

/**
 * `useState` that the browser remembers. A stored value that is no longer one of `allowed` (or is
 * not of the initial value's kind) is ignored, so a renamed option falls back to the default.
 */
export const usePref = <T extends Json>(
  key: string,
  initial: T,
  allowed?: readonly T[],
): [T, (next: T | ((current: T) => T)) => void] => {
  const stored = usePrefs((state) => state.values[key]);
  const value = fits(stored, initial, allowed) ? stored : initial;
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      usePrefs.setState((state) => {
        const current = state.values[key];
        const base = fits(current, initial, allowed) ? current : initial;
        return {
          values: {
            ...state.values,
            [key]: typeof next === 'function' ? (next as (current: T) => T)(base) : next,
          },
        };
      }),
    // `initial` and `allowed` only stand in for a missing value; new arrays each render must not
    // make a new setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, set];
};

/** The side pane's width on wider screens, in pixels: dragged by its edge, and remembered. */
export const PANE_WIDTH = { initial: 400, min: 320, max: 720 } as const;

export const usePaneWidth = create<{ width: number }>()(
  persist(() => ({ width: PANE_WIDTH.initial as number }), {
    name: 'jam.paneWidth',
    storage: createJSONStorage(() => storage),
  }),
);

/** A width the pane can take: within its limits, and leaving the map at least 360 px. */
export const clampPaneWidth = (width: number, windowWidth = globalThis.innerWidth ?? 1440) =>
  Math.round(
    Math.max(
      PANE_WIDTH.min,
      Math.min(width, PANE_WIDTH.max, Math.max(PANE_WIDTH.min, windowWidth - 360)),
    ),
  );

/** A view the reader saved: a name, and the part of an address after #. Kept in their browser. */
interface SavedView {
  name: string;
  query: string;
}

export const useSavedViews = create<{ views: SavedView[] }>()(
  persist(() => ({ views: [] as SavedView[] }), {
    name: 'jam.savedViews',
    storage: createJSONStorage(() => storage),
  }),
);

/** Saves a view; one with the same name is replaced. */
export const saveView = (view: SavedView) =>
  useSavedViews.setState((state) => ({
    views: [...state.views.filter((entry) => entry.name !== view.name), view],
  }));

export const deleteView = (query: string) =>
  useSavedViews.setState((state) => ({
    views: state.views.filter((entry) => entry.query !== query),
  }));

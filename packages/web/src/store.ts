import { create } from 'zustand';

import { setTranslationLang } from './i18n.ts';
import { setFormatUnits, type Units, unitsFor } from './units.ts';

import { type Filters, NO_FILTERS } from './filters.ts';

/** What is selected: a list item (a place or a route stretch), an activity, a prefecture or a grouped route. */
export type Selection =
  | { kind: 'item'; list: string; id: string }
  | { kind: 'activity'; id: string }
  | { kind: 'prefecture'; code: string }
  | { kind: 'route'; id: string };

export type PrefectureFill = 'status' | 'activities' | 'days' | 'distance' | 'gain';

export interface Layers {
  prefectures: boolean;
  places: boolean;
  tracks: boolean;
  routes: boolean;
  /** Shaded relief under the labels; on by default when a terrain source is configured. */
  hillshade: boolean;
  /** 3D relief (tilts the map). */
  relief: boolean;
  /** Explorer tiles: the squares the tracks have passed through. */
  tiles: boolean;
}

/** Phones: how far the sheet is pulled up. */
export type SheetStop = 'peek' | 'half' | 'full';

/** The main area: the map, or one of the chart pages beside it. */
export type Page = 'map' | 'stats' | 'goals' | 'repeats' | 'compare';
export const PAGES: Page[] = ['map', 'stats', 'goals', 'repeats', 'compare'];

/** How tracks are drawn: one line per activity coloured by type, or a heatmap of all of them. */
export type TrackStyle = 'type' | 'heat';

/** Year against year on the compare page. */
export interface Compare {
  a: number | null;
  b: number | null;
  /** Show only ground the later year covered for the first time. */
  newOnly: boolean;
}

/** What the pane shows when nothing is selected. */
export type PaneView = 'list' | 'activities' | 'prefectures' | 'filters';
export const PANE_VIEWS: PaneView[] = ['list', 'activities', 'prefectures', 'filters'];

export interface State {
  /** The active list; its pins or its route are on the map. */
  list: string;
  selection: Selection | null;
  layers: Layers;
  prefectureFill: PrefectureFill;
  /** Every filter, in its three scopes (see filters.ts). */
  filters: Filters;
  view: PaneView;
  page: Page;
  trackStyle: TrackStyle;
  compare: Compare;
  sheet: SheetStop;
  /** The last list item whose detail was open, so the list returns to it. */
  recent: string | null;
  /** The map should move to the selection (set when it is chosen in the panel, not on the map). */
  focus: boolean;
  /** West, south, east, north the map should move to once (a page showing something on it). */
  fit: [number, number, number, number] | null;
  /**
   * Which name comes first for places, lists and routes; the other follows it, quieter. The
   * viewer's own choice: kept in the browser, not in links.
   */
  lang: Lang;
  /** Metric or imperial figures; kept across visits like the language. */
  units: Units;
}

const UNITS_KEY = 'jam.units';

/** The units chosen on an earlier visit; otherwise what the browser's language suggests. */
const savedUnits = (): Units => {
  let units = unitsFor(globalThis.navigator?.language);
  try {
    const saved = globalThis.localStorage?.getItem(UNITS_KEY);
    if (saved === 'metric' || saved === 'imperial') units = saved;
  } catch {
    // Storage off: the browser's language decides.
  }
  setFormatUnits(units);
  return units;
};

export type Lang = 'en' | 'ja';
export const LANGS: Lang[] = ['en', 'ja'];
const LANG_KEY = 'jam.lang';

/** The language chosen on an earlier visit; English when there is none (or storage is off). */
const savedLang = (): Lang => {
  let lang: Lang = 'en';
  try {
    if (globalThis.localStorage?.getItem(LANG_KEY) === 'ja') lang = 'ja';
  } catch {
    // Storage off: English.
  }
  setTranslationLang(lang);
  return lang;
};

export const DEFAULT_LIST = 'hyakumeizan';

export const initialState: State = {
  list: DEFAULT_LIST,
  selection: null,
  layers: {
    prefectures: true,
    places: true,
    tracks: true,
    routes: false,
    hillshade: false,
    relief: false,
    tiles: false,
  },
  prefectureFill: 'status',
  filters: NO_FILTERS,
  view: 'list',
  page: 'map',
  trackStyle: 'type',
  compare: { a: null, b: null, newOnly: false },
  sheet: 'peek',
  recent: null,
  focus: false,
  fit: null,
  lang: savedLang(),
  units: savedUnits(),
};

/**
 * The one store every component reads from: `useStore(select)` in components, and
 * `useStore.getState()` / `useStore.setState()` / `useStore.subscribe()` outside them. The actions
 * below are plain functions beside it.
 */
export const useStore = create<State>()((_set, _get, api) => {
  // Nothing is hydrated from server-rendered HTML, so a server render (the panel check renders the
  // panel to a string after setting the state) reads the live state, not the initial one.
  api.getInitialState = api.getState;
  return initialState;
});

/**
 * Selects something. `focus` moves the map to it, for choices made in the panel. On phones a
 * detail opens with the sheet at half height, so what it describes stays in view above it.
 */
export const select = (selection: Selection | null, focus = false) =>
  useStore.setState({
    selection,
    focus: focus && selection !== null,
    ...(selection ? { sheet: 'half' as const } : {}),
    ...(selection?.kind === 'item' ? { recent: selection.id } : {}),
  });

/** From a chart to the map: switches to the map page and selects what was clicked. */
export const showOnMap = (selection: Selection) => {
  useStore.setState({ page: 'map' });
  select(selection, true);
};

export const setUnits = (units: Units): void => {
  setFormatUnits(units);
  useStore.setState({ units });
  try {
    globalThis.localStorage?.setItem(UNITS_KEY, units);
  } catch {
    // Storage is off: the choice lasts for this visit.
  }
};

export const setLang = (lang: Lang): void => {
  setTranslationLang(lang);
  useStore.setState({ lang });
  try {
    globalThis.localStorage?.setItem(LANG_KEY, lang);
  } catch {
    // Private mode or storage off: the choice lasts until the page is closed.
  }
};

export const setLayer = (layer: keyof Layers, on: boolean) =>
  useStore.setState((state) => ({ layers: { ...state.layers, [layer]: on } }));

/** Changes some filters; the rest stay. */
export const setFilters = (change: Partial<Filters>) =>
  useStore.setState((state) => ({ filters: { ...state.filters, ...change } }));

/**
 * Switches the active list and shows it, clearing the status and prefecture filters that belonged
 * to the old one (region, height and visits carry over: they mean the same on any list).
 */
export const chooseList = (list: string, inPrefecture: string | null = null) =>
  useStore.setState((state) => ({
    list,
    view: 'list',
    filters: { ...state.filters, status: [], in: inPrefecture },
    selection: null,
    recent: null,
  }));

import type { Data } from './data.ts';
import { decodeFilters, encodeFilters, settleFilters } from './filters.ts';
import { storage } from './prefs.ts';
import {
  DEFAULT_LIST,
  initialState,
  type Layers,
  PAGES,
  PANE_VIEWS,
  type Page,
  type PaneView,
  type PrefectureFill,
  type Selection,
  type State,
  useStore,
} from './store.ts';

/** The parts of the state a link carries. */
type Linked = Pick<State, 'list' | 'view' | 'filters' | 'selection'> &
  Partial<Pick<State, 'page' | 'layers' | 'prefectureFill' | 'trackStyle' | 'compare'>>;

const LAYER_NAMES = Object.keys(initialState.layers) as (keyof Layers)[];
const FILLS: PrefectureFill[] = ['status', 'activities', 'days', 'distance', 'gain'];
const YEAR = /^\d{4}$/;

/**
 * The address keeps the page, the list, the pane's view, the map's layers and modes, every filter
 * and the selection: any view is a link. Defaults are left out.
 */
export const encode = (state: Linked): string => {
  const params = new URLSearchParams();
  if (state.page && state.page !== 'map') params.set('page', state.page);
  if (state.list !== DEFAULT_LIST) params.set('list', state.list);
  if (state.view !== 'list') params.set('view', state.view);
  if (state.layers) {
    const on = LAYER_NAMES.filter((name) => state.layers?.[name]);
    const defaults = LAYER_NAMES.filter((name) => initialState.layers[name]);
    if (on.join() !== defaults.join()) params.set('layers', on.join(',') || 'none');
  }
  if (state.prefectureFill && state.prefectureFill !== 'status')
    params.set('fill', state.prefectureFill);
  if (state.trackStyle === 'heat') params.set('tracks', 'heat');
  if (state.compare?.a) params.set('a', String(state.compare.a));
  if (state.compare?.b) params.set('b', String(state.compare.b));
  if (state.compare?.newOnly) params.set('new', '1');
  encodeFilters(state.filters, params);
  const selection = state.selection;
  if (selection?.kind === 'item') params.set('item', selection.id);
  if (selection?.kind === 'activity') params.set('activity', selection.id);
  if (selection?.kind === 'prefecture') params.set('prefecture', selection.code);
  if (selection?.kind === 'route') params.set('route', selection.id);
  // Commas and colons read better unescaped, and are safe in a fragment.
  const text = params.toString().replaceAll('%2C', ',').replaceAll('%3A', ':');
  return text ? `#${text}` : '';
};

/** Reads a view from an address's fragment (with or without the #). Unknown parts are dropped. */
export const decode = (hash: string): Required<Linked> => {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const pageText = params.get('page') ?? 'map';
  const page = (PAGES as string[]).includes(pageText) ? (pageText as Page) : 'map';
  const layerText = params.get('layers');
  const named = new Set((layerText ?? '').split(','));
  const layers = layerText
    ? (Object.fromEntries(LAYER_NAMES.map((name) => [name, named.has(name)])) as unknown as Layers)
    : initialState.layers;
  const fillText = params.get('fill') ?? 'status';
  const prefectureFill = (FILLS as string[]).includes(fillText)
    ? (fillText as PrefectureFill)
    : 'status';
  const year = (key: string) => {
    const text = params.get(key);
    return text && YEAR.test(text) ? Number(text) : null;
  };
  const list = params.get('list') ?? DEFAULT_LIST;
  const viewText = params.get('view') ?? 'list';
  const view = (PANE_VIEWS as string[]).includes(viewText) ? (viewText as PaneView) : 'list';
  let selection: Selection | null = null;
  const item = params.get('item');
  const activity = params.get('activity');
  const prefecture = params.get('prefecture');
  const route = params.get('route');
  if (item) selection = { kind: 'item', list, id: item };
  else if (activity) selection = { kind: 'activity', id: activity };
  else if (prefecture) selection = { kind: 'prefecture', code: prefecture };
  else if (route) selection = { kind: 'route', id: route };
  return {
    list,
    view,
    filters: decodeFilters(params),
    selection,
    page,
    layers,
    prefectureFill,
    trackStyle: params.get('tracks') === 'heat' ? 'heat' : 'type',
    compare: { a: year('a'), b: year('b'), newOnly: params.get('new') === '1' },
  };
};

const sameSelection = (a: Selection | null, b: Selection | null) =>
  JSON.stringify(a) === JSON.stringify(b);

/** The last view, as its address: what a visit to the bare address opens. The open detail is not kept. */
const SAVED_VIEW = 'jam.view';
const savedView = () => (storage.getItem(SAVED_VIEW) as string | null) ?? '';
const saveView = (state: State) =>
  storage.setItem(SAVED_VIEW, encode({ ...state, selection: null }));

/**
 * Keeps the address and the store in step. Opening something adds a history entry, so the browser's
 * Back button (or a phone's back gesture) closes it again; other changes replace the current entry.
 * Every change is also remembered, and the bare address opens the last view: a link always wins,
 * and shows exactly what it says.
 */
export const syncWithAddress = (): (() => void) => {
  const start = location.hash || savedView();
  useStore.setState(decode(start));
  if (start !== location.hash)
    history.replaceState(null, '', `${location.pathname}${location.search}${start}`);
  let shown = useStore.getState().selection;
  const unsubscribe = useStore.subscribe(() => {
    const state = useStore.getState();
    saveView(state);
    const hash = encode(state);
    const url = `${location.pathname}${location.search}${hash}`;
    if (state.selection && !sameSelection(state.selection, shown)) history.pushState(null, '', url);
    else if (hash !== location.hash) history.replaceState(null, '', url);
    shown = state.selection;
  });
  const onAddress = () => {
    if (location.hash === encode(useStore.getState())) return;
    const next = decode(location.hash);
    shown = next.selection;
    useStore.setState({ ...next, focus: false });
    settleNow?.();
  };
  window.addEventListener('popstate', onAddress);
  window.addEventListener('hashchange', onAddress);
  return () => {
    unsubscribe();
    window.removeEventListener('popstate', onAddress);
    window.removeEventListener('hashchange', onAddress);
  };
};

let settleNow: (() => void) | undefined;

/**
 * What a saved view opens, given the list now open: its own list if it names one, else this one.
 * For telling which saved view is the one on screen.
 */
export const viewTarget = (query: string, list: string): string => {
  const target = decode(query);
  const params = new URLSearchParams(query.replace(/^#/, ''));
  return encode({ ...target, list: params.has('list') ? target.list : list, selection: null });
};

/** Opens a saved view: its query replaces the view and every filter, and the list if it names one. */
export const openView = (query: string, data: Data): void => {
  const next = decode(query);
  const params = new URLSearchParams(query.replace(/^#/, ''));
  // The map's layers and modes stay as they are unless the view sets them, and so does the list:
  // "Still to do" is about whichever list is open.
  const { layers, prefectureFill, trackStyle, list, ...rest } = next;
  useStore.setState({
    ...rest,
    ...(params.has('list') ? { list } : {}),
    ...(params.has('layers') ? { layers } : {}),
    ...(params.has('fill') ? { prefectureFill } : {}),
    ...(params.has('tracks') ? { trackStyle } : {}),
    focus: false,
  });
  settle(data);
};

/** A link can outlive what it points at (a list renamed, an activity no longer published): fall back quietly. */
export const settle = (data: Data): void => {
  settleNow = () => settle(data);
  const { list, selection, filters } = useStore.getState();
  const known = data.listById.has(list)
    ? list
    : data.listById.has(DEFAULT_LIST)
      ? DEFAULT_LIST
      : (data.lists[0]?.id ?? list);
  let kept = selection;
  if (selection?.kind === 'item') {
    const owner = data.listById.get(selection.list === list ? known : selection.list);
    kept = owner?.items.some((item) => item.id === selection.id)
      ? { ...selection, list: owner.id }
      : null;
  } else if (selection?.kind === 'activity')
    kept = data.activityById.has(selection.id) ? selection : null;
  else if (selection?.kind === 'prefecture')
    kept = data.prefectureByCode.has(selection.code) ? selection : null;
  else if (selection?.kind === 'route') kept = data.routeById.has(selection.id) ? selection : null;
  useStore.setState({
    list: known,
    selection: kept,
    focus: kept !== null,
    filters: settleFilters(filters, data),
    ...(kept ? { sheet: 'half' as const } : {}),
  });
};

import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * What the pointer is over, shared by the list and the map. A store of its own, apart from the
 * main one, so moving the mouse re-renders only the two rows involved, never the map or the list.
 */
const useHover = create<{ id: string | null }>()(() => ({ id: null }));

export const setHover = (id: string | null): void => {
  if (useHover.getState().id !== id) useHover.setState({ id });
};

export const getHover = () => useHover.getState().id;

export const subscribeHover = (listener: () => void): (() => void) => useHover.subscribe(listener);

/**
 * Whether this item is the one under the pointer, in the list or on the map. A row that goes away
 * while hovered (the view changed under the pointer) lets go of the hover, so nothing stays lit.
 */
export const useHovered = (id: string): boolean => {
  useEffect(
    () => () => {
      if (getHover() === id) setHover(null);
    },
    [id],
  );
  return useHover((state) => state.id === id);
};

/**
 * A request to bring a list item into view on the map without opening it: stepping through a
 * list with the arrow keys. `n` makes asking for the same item twice a new request.
 */
const usePan = create<{ id: string | null; n: number }>()(() => ({ id: null, n: 0 }));

let panTimer: ReturnType<typeof setTimeout> | undefined;

/** Pans to an item after a short pause, so holding an arrow key does not swing the map about. */
export const panSoon = (id: string, delay = 300): void => {
  clearTimeout(panTimer);
  panTimer = setTimeout(() => usePan.setState((state) => ({ id, n: state.n + 1 })), delay);
};

export const getPan = () => usePan.getState().id;

export const subscribePan = (listener: () => void): (() => void) => usePan.subscribe(listener);

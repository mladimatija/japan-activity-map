import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { storage } from '../prefs.ts';

/**
 * What the map shows, for lists that follow it: the bounds after each move, and whether the list
 * is limited to them. A store of its own, so panning re-renders only the lists that ask.
 */
type Viewport = {
  bounds: [number, number, number, number] | null;
  onMapOnly: boolean;
};

export const useViewport = create<Viewport>()(
  // The switch is remembered; the bounds come from the map each visit.
  persist((): Viewport => ({ bounds: null, onMapOnly: false }), {
    name: 'jam.onMapOnly',
    storage: createJSONStorage(() => storage),
    partialize: (state) => ({ onMapOnly: state.onMapOnly }),
  }),
);

export const setOnMapOnly = (onMapOnly: boolean) => useViewport.setState({ onMapOnly });

export const inView = (
  bounds: [number, number, number, number],
  [lon = 0, lat = 0]: readonly number[],
) => lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3];

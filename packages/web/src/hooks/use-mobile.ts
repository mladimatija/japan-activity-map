import { useSyncExternalStore } from 'react';

/** Phones: under 768 px, the width where the pane becomes a bottom sheet. */
const QUERY = '(max-width: 767px)';

const matches = (query: string): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia(query).matches;

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

/** Whether the screen is phone-sized now, outside React. */
export const isMobile = (): boolean => matches(QUERY);

/**
 * Whether the screen is phone-sized, re-rendering when that changes. Rendered without a browser
 * (the web check), it goes by whatever stands in for `matchMedia`, and is wide without one.
 */
export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, isMobile, isMobile);

/** A screen with no pointer to hover with: the hints say "tap", not "point at". */
export const touchOnly = (): boolean => matches('(hover: none)');

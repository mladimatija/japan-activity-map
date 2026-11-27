import { useSyncExternalStore } from 'react';

/** Phones: under 768 px, the width where the pane becomes a bottom sheet. */
const QUERY = '(max-width: 767px)';

const subscribe = (listener: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', listener);
  return () => media.removeEventListener('change', listener);
};

/** Whether the screen is phone-sized now, outside React. */
export const isMobile = (): boolean => window.matchMedia(QUERY).matches;

/** Whether the screen is phone-sized, re-rendering when that changes. */
export const useIsMobile = (): boolean => useSyncExternalStore(subscribe, isMobile, () => false);

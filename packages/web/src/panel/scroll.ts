import { createContext, type RefObject, useContext } from 'react';

/** The pane's one scroll area, for lists inside it that render only their visible rows. */
export const PaneScroll = createContext<RefObject<HTMLDivElement | null>>({ current: null });

export const usePaneScroll = () => useContext(PaneScroll);

/** The scroll area's padding. The bars below undo it, so change them together. */
export const PANE_PADDING = 'px-4 pt-1 pb-4 md:px-5 md:pt-5 md:pb-6';

/** A bar pinned to the top of the scroll area, edge to edge (a heading, the tabs). */
export const STICK_TOP =
  'sticky -top-5 z-10 -mx-5 -mt-5 bg-background px-5 max-md:-top-1 max-md:-mx-4 max-md:-mt-1 max-md:px-4';

/** A bar pinned to the bottom of the scroll area, edge to edge (the filter panel's buttons). */
export const STICK_BOTTOM =
  'sticky -bottom-6 z-10 -mx-5 -mb-6 bg-background px-5 max-md:-bottom-4 max-md:-mx-4 max-md:-mb-4 max-md:px-4';

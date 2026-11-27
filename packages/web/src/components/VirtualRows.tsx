import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { usePaneScroll } from '../panel/scroll.ts';

/** Lists up to this long render every row; longer ones only what is in view. */
const ALL_UP_TO = 40;

/**
 * Rows in the pane's scroll area. A long list renders only the rows in view (plus a few), so a
 * 300-place list or every activity costs the same as a short one. `focusKey` brings a row into
 * view and moves keyboard focus to it, for the way back from a detail and for arrow keys.
 */
export const VirtualRows = <T,>({
  items,
  keyOf,
  row,
  rowHeight = 52,
  focusKey,
  className,
}: {
  items: readonly T[];
  keyOf: (item: T) => string;
  row: (item: T) => ReactNode;
  rowHeight?: number;
  focusKey?: string | null;
  className?: string;
}) => {
  const scroller = usePaneScroll();
  const list = useRef<HTMLOListElement>(null);
  const [margin, setMargin] = useState(0);
  const virtual = items.length > ALL_UP_TO;

  // Where the list starts inside the scroll area; it moves when regions above open or close.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!virtual || !element) return;
    const measure = () => {
      if (!list.current) return;
      const top =
        list.current.getBoundingClientRect().top -
        element.getBoundingClientRect().top +
        element.scrollTop;
      setMargin((current) => (Math.abs(current - top) > 0.5 ? top : current));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [scroller, virtual]);

  // The row asked for and the one before it stay rendered even off screen, so keyboard focus is
  // never dropped on the way from one to the other.
  const focusIndex = focusKey ? items.findIndex((item) => keyOf(item) === focusKey) : -1;
  const previous = useRef(-1);
  const kept = useRef<number[]>([]);
  if (focusIndex !== kept.current.at(-1)) {
    kept.current = [previous.current, focusIndex].filter((index) => index >= 0);
    previous.current = focusIndex;
  }

  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    scrollMargin: margin,
    // Clear of the sticky tabs or heading at the top of the pane.
    scrollPaddingStart: 64,
    // A server render (the panel check) shows the first screenful.
    initialRect: { width: 400, height: 900 },
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...kept.current])].sort((a, b) => a - b),
  });

  useEffect(() => {
    if (!focusKey) return;
    const index = items.findIndex((item) => keyOf(item) === focusKey);
    if (index < 0) return;
    if (virtual) virtualizer.scrollToIndex(index, { align: 'auto' });
    // The row exists once the scroll has rendered it: try for a few frames.
    let tries = 0;
    let frame = 0;
    const attempt = () => {
      const element = list.current?.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(focusKey)}"]`,
      );
      if (element) {
        if (!virtual) element.scrollIntoView({ block: 'nearest' });
        element.focus({ preventScroll: virtual });
      } else if (tries++ < 20) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
    // Only when asked to focus something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  if (!virtual)
    return (
      <ol ref={list} className={className}>
        {items.map((item) => (
          <li key={keyOf(item)}>{row(item)}</li>
        ))}
      </ol>
    );
  return (
    <ol
      ref={list}
      className={className}
      style={{ position: 'relative', height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((entry) => {
        const item = items[entry.index];
        if (item === undefined) return null;
        return (
          <li
            key={keyOf(item)}
            data-index={entry.index}
            ref={virtualizer.measureElement}
            aria-setsize={items.length}
            aria-posinset={entry.index + 1}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${entry.start - margin}px)` }}
          >
            {row(item)}
          </li>
        );
      })}
    </ol>
  );
};

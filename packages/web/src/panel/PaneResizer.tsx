import { useRef } from 'react';

import { t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';
import { clampPaneWidth, PANE_WIDTH, usePaneWidth } from '../prefs.ts';

const setWidth = (width: number) => usePaneWidth.setState({ width: clampPaneWidth(width) });

/**
 * The pane's right edge, to drag wider or narrower; arrow keys step it, Home and End go to the
 * limits, and a double-click puts it back. The width is remembered.
 */
export const PaneResizer = () => {
  const width = clampPaneWidth(usePaneWidth((state) => state.width));
  const handle = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      ref={handle}
      role="separator"
      aria-orientation="vertical"
      aria-label={t('Resize the panel')}
      aria-valuemin={PANE_WIDTH.min}
      aria-valuemax={clampPaneWidth(PANE_WIDTH.max)}
      aria-valuenow={width}
      title={t('Drag to resize; double-click to reset')}
      tabIndex={0}
      className={cn(
        'group absolute inset-y-0 -right-1.5 z-30 flex w-3 cursor-col-resize touch-none justify-center outline-none',
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.current?.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(event) => {
        if (start.current) setWidth(start.current.width + event.clientX - start.current.x);
      }}
      onPointerUp={(event) => {
        start.current = null;
        handle.current?.releasePointerCapture(event.pointerId);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }}
      onLostPointerCapture={() => {
        start.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }}
      onDoubleClick={() => setWidth(PANE_WIDTH.initial)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        const next =
          event.key === 'ArrowLeft'
            ? width - step
            : event.key === 'ArrowRight'
              ? width + step
              : event.key === 'Home'
                ? PANE_WIDTH.min
                : event.key === 'End'
                  ? PANE_WIDTH.max
                  : null;
        if (next === null) return;
        event.preventDefault();
        setWidth(next);
      }}
    >
      {/* A line that shows on hover, while dragging and with keyboard focus. */}
      <span className="w-0.5 bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring group-active:bg-ring" />
    </div>
  );
};

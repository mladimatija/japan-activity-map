import { type PointerEvent, useSyncExternalStore } from 'react';

import { Readout } from '../components/app.tsx';
import type { List, ListItem } from '../data.ts';
import { STATUS_LABELS } from '../format.ts';
import { getHover, setHover, subscribeHover } from '../hover.ts';
import { touchOnly } from '../hooks/use-mobile.ts';
import { STATUS_ORDER } from '../lists.ts';
import type { Status } from '../map/palette.ts';
import { nameIn, useLang } from '../names.tsx';
import { select } from '../store.ts';
import { t } from '../i18n.ts';

const COLUMNS = 10;
const CELL = 24;
/** Room on the left for the row's first number. */
const GUTTER = 22;
/** Lists up to this long get the grid; longer ones (every municipality) keep the bar. */
export const STAMP_GRID_MAX = 120;

/** One place's stamp: the map pin's shape for its status, or an empty slot waiting for one. */
const Stamp = ({ status, x, y }: { status: Status; x: number; y: number }) => {
  switch (status) {
    case 'done':
      return (
        <circle
          cx={x}
          cy={y}
          r={8.5}
          className="fill-status-done stroke-background"
          strokeWidth={2}
        />
      );
    case 'partial':
      return (
        <>
          <circle
            cx={x}
            cy={y}
            r={7.5}
            className="fill-background stroke-status-partial"
            strokeWidth={1.8}
          />
          <path
            d={`M${x},${y - 7.5}A7.5,7.5 0 0 0 ${x},${y + 7.5}Z`}
            className="fill-status-partial"
          />
        </>
      );
    case 'want':
      return (
        <circle
          cx={x}
          cy={y}
          r={7}
          className="fill-background stroke-status-want"
          strokeWidth={3}
        />
      );
    case 'dns': {
      const cross = `M${x - 5},${y - 5}L${x + 5},${y + 5}M${x + 5},${y - 5}L${x - 5},${y + 5}`;
      return (
        <>
          <path d={cross} className="stroke-background" strokeWidth={5.5} strokeLinecap="round" />
          <path d={cross} className="stroke-status-dns" strokeWidth={3} strokeLinecap="round" />
        </>
      );
    }
    default:
      return (
        <circle
          cx={x}
          cy={y}
          r={7.5}
          className="fill-none stroke-input"
          strokeWidth={1}
          strokeDasharray="2 2.6"
        />
      );
  }
};

const idOf = (event: { target: EventTarget }) =>
  (event.target as Element).closest?.('[data-id]')?.getAttribute('data-id') ?? null;

/**
 * Every place of a list as a stamp in list order, ten to a row, in the map's pin shapes: a stamp
 * book's page. Pointing at one lights its pin and says its name; selecting it opens it. A picture
 * for the pointer: the rows below are the way in by keyboard and screen reader.
 */
export const StampGrid = ({ list }: { list: List }) => {
  const lang = useLang();
  const hovered = useSyncExternalStore(subscribeHover, getHover, () => null);
  const items = [...list.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const rows = Math.ceil(items.length / COLUMNS);
  const counts = list.counts as Record<string, number>;
  const tip = (item: ListItem) =>
    `${item.order ?? ''} ${nameIn(item.name, lang)} · ${STATUS_LABELS[item.status]}`.trim();
  const open = (event: { target: EventTarget }) => {
    const id = idOf(event);
    if (id) select({ kind: 'item', list: list.id, id }, true);
  };
  return (
    <div className="mb-3">
      <Readout
        idle={
          touchOnly()
            ? t('In list order. Tap one to open it.')
            : t('In list order. Point at one to read it.')
        }
      >
        {/* A picture to point at; the list's rows below are the way in by keyboard. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <svg
          role="img"
          aria-label={STATUS_ORDER.filter((status) => counts[status])
            .map((status) => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`)
            .join(', ')}
          viewBox={`0 0 ${GUTTER + COLUMNS * CELL} ${rows * CELL}`}
          className="h-auto w-full max-w-80"
          onPointerOver={(event: PointerEvent) => setHover(idOf(event))}
          onPointerLeave={() => setHover(null)}
          onClick={open}
        >
          {items.map((item, at) => {
            const x = GUTTER + (at % COLUMNS) * CELL + CELL / 2;
            const y = Math.floor(at / COLUMNS) * CELL + CELL / 2;
            return (
              <g key={item.id} data-id={item.id} data-tip={tip(item)} className="cursor-pointer">
                {/* The whole cell answers the pointer, not just the drawn mark. */}
                <rect
                  x={x - CELL / 2}
                  y={y - CELL / 2}
                  width={CELL}
                  height={CELL}
                  className="fill-transparent"
                />
                <Stamp status={item.status} x={x} y={y} />
                {hovered === item.id && (
                  <circle
                    cx={x}
                    cy={y}
                    r={11}
                    className="fill-none stroke-primary"
                    strokeWidth={2}
                  />
                )}
                {at % COLUMNS === 0 && (
                  <text
                    x={GUTTER - 6}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="central"
                    className="fill-muted-foreground font-mono text-[8px]"
                  >
                    {item.order ?? at + 1}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </Readout>
    </div>
  );
};

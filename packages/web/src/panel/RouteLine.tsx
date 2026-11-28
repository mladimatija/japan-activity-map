import { type PointerEvent, useSyncExternalStore } from 'react';

import { Readout } from '../components/app.tsx';
import type { List, ListItem } from '../data.ts';
import { distanceText, percent, STATUS_LABELS } from '../format.ts';
import { getHover, setHover, subscribeHover } from '../hover.ts';
import { touchOnly } from '../hooks/use-mobile.ts';
import { progressOf } from '../lists.ts';
import { nameIn, useLang } from '../names.tsx';
import { select } from '../store.ts';
import { t } from '../i18n.ts';

/** The drawing's own units: about the pane's width, so text keeps its size. */
const WIDTH = 320;
const HEIGHT = 62;
const PAD = 4;
const LINE = 34;
/** A break where one stage does not start where the last ended (a sea crossing): not to scale. */
const BREAK = 8;

/** A stage's two ends, from its name ("日本橋–品川宿"); a single-stage route has none. */
const endsOf = (name: string): [string, string] | null => {
  const parts = name.split(/\s*–\s*/);
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
};

/** Where each stage starts and ends along the line, breaks included. */
const layOut = (stages: ListItem[], breaks: boolean[], scale: number) => {
  const laid: { stage: ListItem; from: number; to: number; broken: boolean }[] = [];
  let x = PAD;
  for (const [at, stage] of stages.entries()) {
    const broken = breaks[at] ?? false;
    if (broken) x += BREAK;
    laid.push({ stage, from: x, to: x + (stage.lengthM ?? 0) * scale, broken });
    x += (stage.lengthM ?? 0) * scale;
  }
  return laid;
};

const idOf = (event: { target: EventTarget }) =>
  (event.target as Element).closest?.('[data-id]')?.getAttribute('data-id') ?? null;

/**
 * A route as a line diagram (路線図): its stages end to end and to scale, the stretches covered
 * dyed in, the first and last stations named. Pointing at a stage reads it out and lights it on
 * the map; selecting it opens it. A picture for the pointer: the stages listed below are the way
 * in by keyboard.
 */
export const RouteLine = ({ list }: { list: List }) => {
  const lang = useLang();
  const hovered = useSyncExternalStore(subscribeHover, getHover, () => null);
  const stages = [...list.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const breaks = stages.map((stage, at) => {
    const before = at > 0 ? endsOf(stages[at - 1]?.name.ja ?? '') : null;
    const here = endsOf(stage.name.ja);
    return Boolean(before && here && before[1] !== here[0]);
  });
  const total = stages.reduce((sum, stage) => sum + (stage.lengthM ?? 0), 0);
  const scale = (WIDTH - 2 * PAD - breaks.filter(Boolean).length * BREAK) / Math.max(total, 1);
  const laid = layOut(stages, breaks, scale);
  const firstStage = stages[0];
  const lastStage = stages.at(-1);
  const first = firstStage ? endsOf(nameIn(firstStage.name, lang)) : null;
  const last = lastStage ? endsOf(nameIn(lastStage.name, lang)) : null;
  const tip = (stage: ListItem) =>
    [
      list.items.length > 1
        ? `${stage.order ?? ''} ${nameIn(stage.name, lang)}`
        : nameIn(stage.name, lang),
      distanceText(stage.lengthM ?? 0, 1),
      STATUS_LABELS[stage.status],
    ].join(' · ');
  const open = (event: { target: EventTarget }) => {
    const id = idOf(event);
    if (id) select({ kind: 'item', list: list.id, id }, true);
  };
  return (
    <div className="mb-3">
      <Readout
        idle={
          touchOnly()
            ? t('Stage by stage, to scale. Tap one to open it.')
            : t('Stage by stage, to scale. Point at one to read it.')
        }
      >
        {/* A picture to point at; the stages listed below are the way in by keyboard. */}
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
        <svg
          role="img"
          aria-label={t('{share} covered', { share: percent(progressOf(list).share, 1) })}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full"
          onPointerOver={(event: PointerEvent) => setHover(idOf(event))}
          onPointerLeave={() => setHover(null)}
          onClick={open}
        >
          {first && (
            <text x={PAD} y={14} className="fill-foreground font-title text-[12px] font-semibold">
              {first[0]}
            </text>
          )}
          {last && (
            <text
              x={WIDTH - PAD}
              y={14}
              textAnchor="end"
              className="fill-foreground font-title text-[12px] font-semibold"
            >
              {last[1]}
            </text>
          )}
          {laid.map(({ stage, from, to, broken }) => (
            <g key={stage.id} data-id={stage.id} data-tip={tip(stage)} className="cursor-pointer">
              {/* The whole height answers the pointer, not just the line. */}
              <rect
                x={from}
                y={20}
                width={Math.max(to - from, 1)}
                height={28}
                className="fill-transparent"
              />
              {broken && (
                <line
                  x1={from - BREAK + 1.5}
                  x2={from - 1.5}
                  y1={LINE}
                  y2={LINE}
                  className="stroke-muted-foreground"
                  strokeWidth={1.5}
                  strokeDasharray="0.1 3"
                  strokeLinecap="round"
                />
              )}
              <line
                x1={from}
                x2={to}
                y1={LINE}
                y2={LINE}
                className="stroke-input"
                strokeWidth={3}
              />
              {(stage.covered ?? []).map(([start, end]) => (
                <line
                  key={start}
                  x1={from + start * scale}
                  x2={from + end * scale}
                  y1={LINE}
                  y2={LINE}
                  className="stroke-status-done"
                  strokeWidth={7}
                />
              ))}
              {hovered === stage.id && (
                <line
                  x1={from}
                  x2={to}
                  y1={LINE + 8}
                  y2={LINE + 8}
                  className="stroke-primary"
                  strokeWidth={2}
                />
              )}
              {/* A station between stages: a cut across the line, where there is room. */}
              {from > PAD && !broken && to - from >= 3 && (
                <line
                  x1={from}
                  x2={from}
                  y1={LINE - 5}
                  y2={LINE + 5}
                  className="stroke-background"
                  strokeWidth={1.25}
                />
              )}
            </g>
          ))}
          <text x={PAD} y={HEIGHT - 2} className="fill-muted-foreground font-mono text-[8px]">
            0
          </text>
          <text
            x={WIDTH - PAD}
            y={HEIGHT - 2}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[8px]"
          >
            {distanceText(total, 0)}
          </text>
        </svg>
      </Readout>
    </div>
  );
};

import { type ReactNode, useEffect, useState } from 'react';

import { GroupChevron } from '../components/app.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.tsx';
import type { Data } from '../data.ts';
import { derive } from '../filters.ts';
import { distanceText, heightText, STATUS_LABELS, typeLabel } from '../format.ts';
import { useIsMobile } from '../hooks/use-mobile.ts';
import { cn } from '../lib/utils.ts';
import { nameIn, useLang } from '../names.tsx';
import { StatusIcon } from '../panel/StatusIcon.tsx';
import { usePref } from '../prefs.ts';
import { type PrefectureFill, useStore } from '../store.ts';
import { t } from '../i18n.ts';
import { prefectureBreaks } from './useMapSources.ts';
import {
  METRIC_SCALE,
  STATUS_COLORS,
  STATUSES,
  typeColorOf,
  UNKNOWN_TYPE_COLOR,
  mapColors,
} from './palette.ts';

/** One group of the key, under a small heading. */
const Group = ({ title, children }: { title: ReactNode; children: ReactNode }) => (
  <section className="flex flex-col gap-0.5 border-t px-3 py-2">
    <h3 className="text-xs font-medium text-muted-foreground">
      {typeof title === 'string' ? t(title) : title}
    </h3>
    {children}
  </section>
);

/** A key row: a swatch (or icon) and what it means. */
const Row = ({ children }: { children: ReactNode }) => (
  <li className="flex items-center gap-2 py-0.5 text-compact">{children}</li>
);

const HEAT = mapColors(false).heat;

const Swatch = ({ color, opacity }: { color: string; opacity?: number }) => (
  <span className="size-3.5 flex-none rounded-sm" style={{ background: color, opacity }} />
);

const LineSwatch = ({ color, dashed = false }: { color?: string; dashed?: boolean }) => (
  <span
    className={cn(
      'w-5.5 flex-none rounded-xs border-t-4 border-muted-foreground',
      dashed && 'border-t-3 border-dashed',
    )}
    style={color ? { borderTopColor: color } : undefined}
  />
);

const metricLabel = (fill: PrefectureFill, value: number) =>
  fill === 'distance'
    ? distanceText(value, value < 10_000 ? 1 : 0)
    : fill === 'gain'
      ? heightText(value)
      : String(value);

/**
 * What the map's colours and marks mean, for what is on it now, in the map's bottom-left corner.
 * It folds to one button; whether it is open is remembered (folded at first on phones).
 */
export const MapKey = ({ data, className }: { data: Data; className?: string }) => {
  const layers = useStore((state) => state.layers);
  const fill = useStore((state) => state.prefectureFill);
  const filters = useStore((state) => state.filters);
  const trackStyle = useStore((state) => state.trackStyle);
  const list = useStore((state) => data.listById.get(state.list));
  const lang = useLang();
  // Open on the first visit on wider screens, so the colours are explained once; folded after
  // that and on phones, until it is opened or folded by hand (which is then remembered).
  const mobile = useIsMobile();
  const [seen, setSeen] = usePref<boolean>('mapKeySeen', false);
  const [firstVisit] = useState(() => !seen);
  useEffect(() => {
    if (!seen) setSeen(true);
  }, [seen, setSeen]);
  const [choice, setChoice] = usePref<string>('mapKeyOpen', 'auto', ['auto', 'open', 'closed']);
  const open = choice === 'auto' ? firstVisit && !mobile : choice === 'open';
  const setOpen = (next: boolean) => setChoice(next ? 'open' : 'closed');

  const groups: ReactNode[] = [];
  if (layers.prefectures) {
    const breaks =
      fill === 'status'
        ? []
        : prefectureBreaks(
            data,
            derive(data, filters),
            fill === 'distance' ? 'distanceM' : fill === 'gain' ? 'gainM' : fill,
          );
    groups.push(
      <Group key="prefectures" title="Prefectures">
        <ul className={cn(fill !== 'status' && 'grid grid-cols-[repeat(2,max-content)] gap-x-5')}>
          {fill === 'status' ? (
            <Row>
              <Swatch color={STATUS_COLORS.done} opacity={0.35} /> {t('At least one activity')}
            </Row>
          ) : (
            breaks.map((value, i) => (
              <Row key={value}>
                <Swatch color={METRIC_SCALE[i] ?? UNKNOWN_TYPE_COLOR} />
                <span className="tabular-nums">{metricLabel(fill, value)}+</span>
              </Row>
            ))
          )}
        </ul>
      </Group>,
    );
  }
  if (list?.kind === 'point' && layers.places)
    groups.push(
      <Group key="places" title="List places">
        <ul className="grid grid-cols-[repeat(2,max-content)] gap-x-5">
          {STATUSES.filter((status) => status !== 'partial').map((status) => (
            <Row key={status}>
              <StatusIcon status={status} decorative /> {STATUS_LABELS[status]}
            </Row>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          {t('Bigger pins: visited more often. The number on a pin counts visits.')}
        </p>
      </Group>,
    );
  if (list?.kind === 'route')
    groups.push(
      <Group key="route" title={<span lang={lang}>{nameIn(list.title, lang)}</span>}>
        <ul>
          <Row>
            <LineSwatch color={STATUS_COLORS.done} /> {t('Covered')}
          </Row>
          <Row>
            <LineSwatch dashed /> {t('Not yet')}
          </Row>
        </ul>
      </Group>,
    );
  if (layers.tracks && trackStyle === 'heat')
    groups.push(
      <Group key="heat" title="Heatmap">
        <ul>
          <Row>
            <span
              className="h-1.5 w-8 flex-none rounded-full"
              style={{
                background: `linear-gradient(to right, color-mix(in srgb, ${HEAT} 20%, transparent), ${HEAT})`,
              }}
            />
            {t('Once, then brighter with every pass')}
          </Row>
        </ul>
        <p className="text-xs text-muted-foreground">
          {t('Commutes are left out unless the site is set to include them.')}
        </p>
      </Group>,
    );
  if ((layers.tracks && trackStyle === 'type') || layers.routes)
    groups.push(
      <Group key="types" title="Activity types">
        <ul className="grid grid-cols-[repeat(2,max-content)] gap-x-5">
          {Object.keys(data.stats.byType).map((type) => (
            <Row key={type}>
              <LineSwatch color={typeColorOf(type)} />
              {typeLabel(type)}
            </Row>
          ))}
        </ul>
      </Group>,
    );
  if (groups.length === 0) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setOpen(next)}
      render={<section aria-label={t('Map key')} />}
      className={cn(
        'w-72 max-w-full overflow-hidden rounded-lg bg-background/95 text-foreground shadow-sm ring-1 ring-foreground/10',
        !open && 'w-auto',
        className,
      )}
    >
      <CollapsibleTrigger className="group flex min-h-9 w-full items-center gap-2 px-3 text-left text-xs font-semibold outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
        <span className="flex-1">{t('Map key')}</span>
        <GroupChevron />
      </CollapsibleTrigger>
      <CollapsibleContent className="max-h-[50vh] overflow-y-auto">{groups}</CollapsibleContent>
    </Collapsible>
  );
};

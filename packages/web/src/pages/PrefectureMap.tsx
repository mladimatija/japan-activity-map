import type { Position } from 'geojson';
import { useMemo } from 'react';

import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import { nameIn, useLang } from '../names.tsx';
import { t } from '../i18n.ts';

const W = 300;
const H = 300;
/** The four main islands and the near ones; Okinawa gets an inset, as on printed maps. */
const MAIN = { west: 128.4, east: 146, south: 30.6, north: 45.6 };
// The inset frames Okinawa Island itself; the far islands would be specks at this size.
const INSET = { west: 126.55, east: 128.45, south: 25.95, north: 27.0, x: 4, y: 4, w: 80, h: 56 };
const OKINAWA = '47';
const COS = Math.cos((37 * Math.PI) / 180);
const scale = Math.min(W / ((MAIN.east - MAIN.west) * COS), H / (MAIN.north - MAIN.south));

const project = ([lon = 0, lat = 0]: Position): [number, number] => [
  (lon - MAIN.west) * COS * scale,
  (MAIN.north - lat) * scale,
];
const insetScale = Math.min(
  INSET.w / ((INSET.east - INSET.west) * COS),
  INSET.h / (INSET.north - INSET.south),
);
const projectInset = ([lon = 0, lat = 0]: Position): [number, number] => [
  INSET.x + (lon - INSET.west) * COS * insetScale,
  INSET.y + (INSET.north - lat) * insetScale,
];

/** An SVG path for a (multi)polygon, keeping every few points: enough at this size. */
const pathOf = (rings: Position[][], to: (point: Position) => [number, number]): string => {
  let d = '';
  for (const ring of rings) {
    if (ring.length < 4) continue;
    const step = Math.max(1, Math.floor(ring.length / 60));
    const points = ring.filter((_, i) => i % step === 0).map(to);
    if (points.length < 3) continue;
    d += `M${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L')}Z`;
  }
  return d;
};

/**
 * Japan's 47 prefectures, filled where there are matching activities. Each is a button to it on
 * the map; Okinawa sits in an inset at the top left.
 */
export const PrefectureMap = ({
  data,
  visited,
  onChoose,
  className,
}: {
  data: Data;
  visited: ReadonlySet<string>;
  onChoose: (code: string) => void;
  className?: string;
}) => {
  const lang = useLang();
  const shapes = useMemo(
    () =>
      data.prefectures.features.map((feature) => {
        const geometry = feature.geometry;
        const rings =
          geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
        const inset = feature.properties.code === OKINAWA;
        return {
          code: feature.properties.code,
          name: feature.properties,
          inset,
          d: pathOf(rings, inset ? projectInset : project),
        };
      }),
    [data],
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-auto w-full', className)} role="group">
      <defs>
        <clipPath id="prefecture-map-main">
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
        <clipPath id="prefecture-map-inset">
          <rect x={INSET.x} y={INSET.y} width={INSET.w} height={INSET.h} />
        </clipPath>
      </defs>
      <rect
        x={INSET.x - 2}
        y={INSET.y - 2}
        width={INSET.w + 4}
        height={INSET.h + 4}
        rx={4}
        className="fill-none stroke-border"
      />
      {shapes.map((shape) => {
        const on = visited.has(shape.code);
        const name = nameIn(shape.name, lang);
        return (
          <path
            key={shape.code}
            d={shape.d}
            clipPath={shape.inset ? 'url(#prefecture-map-inset)' : 'url(#prefecture-map-main)'}
            role="button"
            tabIndex={0}
            aria-label={on ? t('{name}, visited', { name }) : name}
            className={cn(
              'cursor-pointer stroke-background stroke-[0.6] outline-none hover:opacity-80 focus-visible:stroke-foreground focus-visible:stroke-2',
              on ? 'fill-status-done' : 'fill-muted-foreground/25',
            )}
            onClick={() => onChoose(shape.code)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onChoose(shape.code);
              }
            }}
            data-tip={on ? t('{name}, visited', { name }) : name}
          />
        );
      })}
    </svg>
  );
};

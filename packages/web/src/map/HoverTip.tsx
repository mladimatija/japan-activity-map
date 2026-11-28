import { Popup } from 'react-map-gl/maplibre';
import { create } from 'zustand';

import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import { derive, figuresOf } from '../filters.ts';
import { date, distanceText, heightText, STATUS_LABELS, typeLabel } from '../format.ts';
import { StatusIcon } from '../panel/StatusIcon.tsx';
import { useStore } from '../store.ts';
import { type Named, nameIn, otherLang, subName, useLang } from '../names.tsx';
import { isJa, t } from '../i18n.ts';

type Tip =
  | { kind: 'place'; list: string; id: string; at: [number, number] }
  | { kind: 'prefecture'; code: string; at: [number, number] };

// The tooltip keeps its own tiny store, so following the pointer re-renders only the tooltip.
const useTip = create<{ tip: Tip | null }>()(() => ({ tip: null }));

const sameTip = (a: Tip | null, b: Tip | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.kind === b.kind &&
    a.at[0] === b.at[0] &&
    a.at[1] === b.at[1] &&
    (a.kind === 'place' ? b.kind === 'place' && a.id === b.id && a.list === b.list : true));

export const showTip = (tip: Tip | null): void => {
  if (!sameTip(tip, useTip.getState().tip)) useTip.setState({ tip });
};

/** Visits listed in full up to this many; the panel has the rest. */
const MAX_DATES = 12;

export const PlaceTip = ({ data, list: listId, id }: { data: Data; list: string; id: string }) => {
  const item = data.listById.get(listId)?.items.find((candidate) => candidate.id === id);
  if (!item) return null;
  const visits = item.placeId ? (data.visitsByPlace.get(item.placeId) ?? []) : [];
  const dates = visits.toReversed().map((activity) => activity.date);
  return (
    <>
      {item.order !== undefined && (
        <span className="mr-1.5 font-mono text-xs text-muted-foreground tabular-nums">
          {item.order}
        </span>
      )}
      <TipName name={item.name} />
      <div>
        <StatusIcon status={item.status} size={13} decorative /> {STATUS_LABELS[item.status]}
        {item.elevationM ? ` · ${heightText(item.elevationM)}` : ''}
      </div>
      {item.visits === undefined ? null : dates.length > 0 ? (
        <div className="mt-0.5">
          {dates.length === 1 ? t('1 visit: ') : t('{count} visits: ', { count: dates.length })}
          {dates
            .slice(0, MAX_DATES)
            .map(date)
            .join(isJa() ? '、' : ', ')}
          {dates.length > MAX_DATES
            ? t(', and {count} more', { count: dates.length - MAX_DATES })
            : ''}
        </div>
      ) : item.first ? (
        <div className="mt-0.5">
          {item.first === item.latest || !item.latest
            ? date(item.first)
            : t('{from} to {to}', { from: date(item.first), to: date(item.latest) })}
        </div>
      ) : null}
    </>
  );
};

export const PrefectureTip = ({ data, code }: { data: Data; code: string }) => {
  const feature = data.prefectureByCode.get(code)?.properties;
  const filters = useStore((state) => state.filters);
  if (!feature) return null;
  const derived = derive(data, filters);
  const p = { ...figuresOf(data, derived, code), ja: feature.ja, en: feature.en };
  const total = Object.values(p.byType).reduce((sum, metres) => sum + (metres ?? 0), 0);
  const shares = Object.entries(p.byType)
    .map(([type, metres]) => ({ type, share: total ? (metres ?? 0) / total : 0 }))
    .filter((entry) => entry.share > 0)
    .sort((a, b) => b.share - a.share);
  return (
    <>
      <TipName name={p} />
      {derived.matching && !derived.matching.has(code) && (
        <div className="text-muted-foreground">{t('Not among the filtered prefectures')}</div>
      )}
      {p.activities === 0 ? (
        <div className="text-muted-foreground">
          {derived.activityIds ? t('No matching activities') : t('No activities yet')}
        </div>
      ) : (
        <>
          <div>
            {p.activities === 1
              ? t('1 activity')
              : t('{count} activities', { count: p.activities })}{' '}
            · {distanceText(p.distanceM, 0)} · {heightText(p.gainM)}
          </div>
          {shares.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-x-2.5">
              {shares.map((entry) => (
                <span key={entry.type}>
                  {typeLabel(entry.type)} {Math.round(entry.share * 100)}%
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
};

const canHover = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

/** A tooltip for the place or prefecture under the pointer; touch screens tap to select instead. */
export const HoverTip = ({ data }: { data: Data }) => {
  const tip = useTip((state) => state.tip);
  if (!tip || !canHover()) return null;
  return (
    <Popup
      longitude={tip.at[0]}
      latitude={tip.at[1]}
      anchor="bottom"
      offset={tip.kind === 'place' ? 16 : 12}
      closeButton={false}
      closeOnClick={false}
      className={cn(
        'pointer-events-none',
        '[&_.maplibregl-popup-content]:pointer-events-none [&_.maplibregl-popup-content]:rounded-md [&_.maplibregl-popup-content]:bg-popover [&_.maplibregl-popup-content]:px-2.5 [&_.maplibregl-popup-content]:py-2 [&_.maplibregl-popup-content]:text-compact [&_.maplibregl-popup-content]:leading-snug [&_.maplibregl-popup-content]:text-popover-foreground [&_.maplibregl-popup-content]:shadow-md [&_.maplibregl-popup-content]:ring-1 [&_.maplibregl-popup-content]:ring-foreground/10',
        '[&_.maplibregl-popup-tip]:border-t-popover!',
      )}
      maxWidth="280px"
    >
      {tip.kind === 'place' ? (
        <PlaceTip data={data} list={tip.list} id={tip.id} />
      ) : (
        <PrefectureTip data={data} code={tip.code} />
      )}
    </Popup>
  );
};

/** A tip's heading: the name in the viewer's language in bold, the other quieter after it. */
const TipName = ({ name }: { name: Named }) => {
  const lang = useLang();
  const other = subName(name, lang);
  return (
    <>
      <strong className="font-title text-row" lang={lang}>
        {nameIn(name, lang)}
      </strong>
      {other && (
        <>
          {' '}
          <span className="text-muted-foreground" lang={otherLang(lang)}>
            {other}
          </span>
        </>
      )}
    </>
  );
};

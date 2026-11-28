import { ChevronLeftIcon, ExternalLinkIcon, TrophyIcon } from 'lucide-react';
import { type ReactNode, useRef } from 'react';

import {
  Empty,
  Eyebrow,
  Facts,
  Headline,
  Loading,
  Note,
  PANE_TITLE,
  Section,
} from '../components/app.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Item } from '../components/ui/item.tsx';
import { Kbd } from '../components/ui/kbd.tsx';

import type { ActivityRecord, Data, List, ListItem } from '../data.ts';
import { REGIONS } from '@jam/core/prefectures';
import {
  clock,
  date,
  distanceText,
  duration,
  heightText,
  metresBetween,
  paceOrSpeed,
  percent,
  STATUS_LABELS,
  typeLabel,
} from '../format.ts';
import { TypeIcon } from '../icons.tsx';
import { cn } from '../lib/utils.ts';
import { referenceByList, useLoaded } from '../lazy.ts';
import { TYPE_COLORS, typeColorOf } from '../map/palette.ts';
import { MiniBar } from '../shell/ListPicker.tsx';
import { derive, figuresOf, SEASONS, seasonOf } from '../filters.ts';
import { recordLabel, recordsOf } from '../goals.ts';
import { chooseList, type Lang, type Selection, select, useStore } from '../store.ts';
import {
  activityName,
  Name,
  nameIn,
  prefectureName,
  routeName,
  subName,
  useLang,
} from '../names.tsx';
import { PlaceSign, useNeighbours } from './PlaceSign.tsx';
import { StatusIcon } from './StatusIcon.tsx';
import { TrackAnalysis } from './TrackAnalysis.tsx';
import { mapsUrl } from '../maps.ts';
import { RouteEstimate } from './RouteEstimate.tsx';
import { RouteGpxButton } from './RouteGpx.tsx';
import { RouteTimes } from './RouteTimes.tsx';
import { setHover } from '../hover.ts';
import { t } from '../i18n.ts';

/** Between names in a list: 東京都・神奈川県, or Tokyo, Kanagawa. */
const listJoin = (lang: Lang) => (lang === 'ja' ? '・' : ', ');

const Header = ({
  eyebrow,
  title,
  subtitle,
  lang,
  badge,
}: {
  eyebrow: ReactNode;
  title: string;
  subtitle?: string;
  lang?: string;
  badge?: ReactNode;
}) => (
  <header>
    <Eyebrow>{eyebrow}</Eyebrow>
    <h2 data-detail-title="" tabIndex={-1} lang={lang} className={PANE_TITLE}>
      {title}
    </h2>
    {subtitle && (
      <p
        className="mt-0.5 text-muted-foreground"
        lang={lang === 'ja' ? 'en' : lang === 'en' ? 'ja' : undefined}
      >
        {subtitle}
      </p>
    )}
    {badge && <div className="mt-2.5 flex flex-wrap gap-1.5">{badge}</div>}
  </header>
);

const STATUS_TINT: Record<ListItem['status'], string> = {
  done: 'bg-status-done/15',
  partial: 'bg-status-partial/20',
  dns: 'bg-status-dns/15',
  want: 'bg-status-want/20',
  none: 'bg-muted',
};

/** A badge for a status (or a route's count), tinted with its colour. */
const Pill = ({ tint, children }: { tint: string; children: ReactNode }) => (
  <Badge variant="secondary" className={cn('h-6 gap-1.5 px-2.5 text-compact font-semibold', tint)}>
    {children}
  </Badge>
);

const StatusPill = ({ status, note }: { status: ListItem['status']; note?: string }) => (
  <Pill tint={STATUS_TINT[status]}>
    <StatusIcon status={status} size={14} decorative /> {STATUS_LABELS[status]}
    {note && <span className="font-normal text-muted-foreground">{note}</span>}
  </Pill>
);

/** A row in a detail that opens something else: a visit, a nearby place, a list. */
const LinkRow = ({ className, ...props }: React.ComponentProps<'button'>) => (
  <Item
    size="sm"
    render={<button type="button" />}
    className={cn('min-h-12 flex-nowrap gap-3 px-2 py-1.5 text-left hover:bg-muted', className)}
    {...(props as React.ComponentProps<'div'>)}
  />
);

/** The quiet figure at a link row's end. */
const RowEnd = ({ children }: { children: ReactNode }) => (
  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{children}</span>
);

/** A bar split into shares, each its colour. */
const SplitBar = ({
  label,
  parts,
  className,
}: {
  label: string;
  parts: { key: string; share: number; color: string }[];
  className?: string;
}) => (
  <div
    className={cn('flex h-2.5 overflow-hidden rounded-full bg-muted *:h-full', className)}
    role="img"
    aria-label={label}
  >
    {parts.map((part) => (
      <span key={part.key} style={{ width: `${part.share * 100}%`, background: part.color }} />
    ))}
  </div>
);

/** Activities as a dated list; each opens its own detail. */
/**
 * Activities newest first, each opening its detail. `timed` adds the moving time and pace, which a
 * route's chart compares; pointing at or focusing a row lights its dot there and its track.
 */
const Timeline = ({
  activities,
  empty,
  timed = false,
}: {
  activities: ActivityRecord[];
  empty: ReactNode;
  timed?: boolean;
}) => {
  if (activities.length === 0) return <Empty>{typeof empty === 'string' ? t(empty) : empty}</Empty>;
  return (
    <ol>
      {activities.map((activity) => (
        <li key={activity.id}>
          <LinkRow
            onClick={() => select({ kind: 'activity', id: activity.id }, true)}
            onPointerEnter={() => setHover(activity.id)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(activity.id)}
            onBlur={() => setHover(null)}
          >
            <span className="w-23 flex-none text-compact text-muted-foreground tabular-nums">
              {date(activity.date)}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{activityName(activity)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {typeLabel(activity.type)} · {distanceText(activity.distanceM)} ·{' '}
                {heightText(activity.gainM)}
                {timed && activity.movingS
                  ? ` · ${clock(activity.movingS)} · ${paceOrSpeed(activity.type, activity.distanceM ?? 0, activity.movingS)}`
                  : ''}
              </span>
            </span>
            <span className="flex-none" style={{ color: TYPE_COLORS[activity.type] }}>
              <TypeIcon type={activity.type} />
            </span>
          </LinkRow>
        </li>
      ))}
    </ol>
  );
};

/** A button that opens a position in the device's maps app, in a new tab where it is a web page. */
const OpenInMaps = ({
  at,
  label,
  children,
}: {
  at: readonly number[] | undefined;
  label: string;
  children: ReactNode;
}) => {
  const href = mapsUrl(at, label);
  if (!href) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      // A web page opens beside the site; an app address (geo:) is the device's to handle.
      render={
        <a
          href={href}
          {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        />
      }
    >
      {children} <ExternalLinkIcon data-icon="inline-end" />
    </Button>
  );
};

const PlaceDetail = ({ data, list, item }: { data: Data; list: List; item: ListItem }) => {
  const lang = useLang();
  const others = (item.placeId ? (data.itemsByPlace.get(item.placeId) ?? []) : []).filter(
    (entry) => entry.list.id !== list.id,
  );
  const visits = item.placeId ? (data.visitsByPlace.get(item.placeId) ?? []) : [];
  const hidden = item.visits === undefined;
  const nearby = item.at
    ? list.items
        .filter((other) => other.id !== item.id && other.at && other.status !== 'done')
        .map((other) => ({ other, metres: metresBetween(item.at ?? [], other.at ?? []) }))
        .sort((a, b) => a.metres - b.metres)
        .slice(0, 3)
    : [];
  return (
    <>
      <PlaceSign
        data={data}
        list={list}
        item={item}
        badge={
          <StatusPill
            status={item.status}
            note={
              item.visits
                ? item.visits === 1
                  ? t('1 visit')
                  : t('{count} visits', { count: item.visits })
                : undefined
            }
          />
        }
      />
      <Facts
        rows={[
          ...(item.elevationM
            ? ([['Height', heightText(item.elevationM)]] as [string, ReactNode][])
            : []),
          [
            'Prefecture',
            <span key="prefecture" lang={lang}>
              {item.prefectures
                .map((code) => prefectureName(data, code, lang))
                .join(listJoin(lang)) || '–'}
            </span>,
          ],
          ...(hidden
            ? []
            : ([
                ['First', item.first ? date(item.first) : t('Not yet')],
                ...(item.latest && item.latest !== item.first
                  ? ([['Latest', date(item.latest)]] as [string, ReactNode][])
                  : []),
              ] as [string, ReactNode][])),
        ]}
      />
      <p className="mb-3">
        <OpenInMaps at={item.at} label={nameIn(item.name, lang)}>
          {t('Open in maps')}
        </OpenInMaps>
      </p>
      {!hidden && visits.length > 0 && (
        // Which seasons it has been reached in: a winter ascent is a different tick.
        <ul className="mb-1 flex flex-wrap gap-1.5" aria-label={t('Seasons reached in')}>
          {SEASONS.map((season) => {
            const count = visits.filter(
              (visit) => seasonOf(Number(visit.date.slice(5, 7))) === season.id,
            ).length;
            return (
              <li key={season.id}>
                <Pill tint={count > 0 ? STATUS_TINT.done : STATUS_TINT.none}>
                  {season.label}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {count > 0 ? `×${count}` : '–'}
                  </span>
                </Pill>
              </li>
            );
          })}
        </ul>
      )}
      <Section title="Visits" count={hidden ? undefined : visits.length}>
        {hidden ? (
          <Empty>{t('This place is inside a privacy zone, so its visits are not shown.')}</Empty>
        ) : (
          <Timeline
            activities={visits}
            empty={
              item.status === 'done'
                ? 'Done before the activities on this site, or recorded by hand.'
                : 'Not visited yet.'
            }
          />
        )}
      </Section>
      {nearby.length > 0 && (
        <Section title="Nearby in this list, not done yet">
          <ul>
            {nearby.map(({ other, metres }) => (
              <li key={other.id}>
                <LinkRow
                  onClick={() => select({ kind: 'item', list: list.id, id: other.id }, true)}
                >
                  <StatusIcon status={other.status} />
                  <span>
                    <Name name={other.name} />
                  </span>
                  <RowEnd>{distanceText(metres, metres < 10_000 ? 1 : 0)}</RowEnd>
                </LinkRow>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {others.length > 0 && (
        <Section title="Also in">
          <ul>
            {others.map(({ list: other, item: entry }) => (
              // By item: a peak on a border is in the prefecture high points once per prefecture.
              <li key={entry.id}>
                <LinkRow
                  onClick={() => {
                    chooseList(other.id);
                    select({ kind: 'item', list: other.id, id: entry.id }, true);
                  }}
                >
                  <StatusIcon status={entry.status} />
                  <span>
                    <Name name={other.title} />
                  </span>
                  <RowEnd>{t('No. {number}', { number: entry.order })}</RowEnd>
                </LinkRow>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
};

/** The first stretch at least `minM` long that the covered stretches leave open. */
const firstGap = (
  covered: readonly (readonly [number, number])[],
  lengthM: number,
  minM = 200,
): [number, number] | null => {
  let at = 0;
  for (const [from, to] of covered.toSorted((a, b) => a[0] - b[0])) {
    if (from - at >= minM) return [at, from];
    at = Math.max(at, to);
  }
  return lengthM - at >= minM ? [at, lengthM] : null;
};

/** West, south, east, north of a route's line between two distances along it. */
const boxAlong = (
  lines: readonly (readonly number[])[][],
  from: number,
  to: number,
): [number, number, number, number] | null => {
  let d = 0;
  let box: [number, number, number, number] | null = null;
  for (const part of lines)
    for (let i = 0; i < part.length; i++) {
      const point = part[i] as readonly number[];
      if (i > 0) d += metresBetween(part[i - 1] as readonly number[], point);
      if (d < from || d > to) continue;
      const [lon = 0, lat = 0] = point;
      box = box
        ? [
            Math.min(box[0], lon),
            Math.min(box[1], lat),
            Math.max(box[2], lon),
            Math.max(box[3], lat),
          ]
        : [lon, lat, lon, lat];
    }
  return box;
};

const RouteItemDetail = ({ data, list, item }: { data: Data; list: List; item: ListItem }) => {
  const lang = useLang();
  useLoaded();
  const activities = data.activitiesByRouteItem.get(item.id) ?? [];
  const share = item.lengthM ? (item.coveredM ?? 0) / item.lengthM : 0;
  // On a route already started: the first stretch of at least 200 m not covered yet.
  const gap = item.covered?.length ? firstGap(item.covered, item.lengthM ?? 0) : null;
  const line = referenceByList
    .get(list.id)
    ?.features.find((feature) => feature.properties.id === item.id)?.geometry.coordinates;
  const gapBox = gap && line ? boxAlong(line, gap[0], gap[1]) : null;
  return (
    <>
      <PlaceSign data={data} list={list} item={item} badge={<StatusPill status={item.status} />} />
      <div className="mt-4 mb-3">
        <Headline
          value={distanceText(item.coveredM ?? 0, 1)}
          of={t('of {total}', { total: distanceText(item.lengthM, 1) })}
          share={percent(share, 1)}
        />
        <CoverageStrip
          lengthM={item.lengthM ?? 1}
          covered={item.covered ?? []}
          label={t('{share} covered, in {count} stretches', {
            share: percent(share, 1),
            count: (item.covered ?? []).length,
          })}
        />
        {gap && (
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 text-compact">
            <span>
              {t('Next uncovered: {from} to {to} ({length})', {
                from: distanceText(gap[0]),
                to: distanceText(gap[1]),
                length: distanceText(gap[1] - gap[0]),
              })}
            </span>
            {gapBox && (
              <Button
                variant="link"
                className="h-auto p-0 text-compact"
                onClick={() => useStore.setState({ page: 'map', fit: gapBox })}
              >
                {t('Show on the map')}
              </Button>
            )}
          </p>
        )}
        <RouteEstimate data={data} list={list} lengthM={item.lengthM} coveredM={item.coveredM} />
      </div>
      <Facts
        rows={[
          [
            'Prefectures',
            <span key="prefectures" lang={lang}>
              {item.prefectures
                .map((code) => prefectureName(data, code, lang))
                .join(listJoin(lang)) || '–'}
            </span>,
          ],
          ...(item.first ? ([['First', date(item.first)]] as [string, ReactNode][]) : []),
          ...(item.latest && item.latest !== item.first
            ? ([['Latest', date(item.latest)]] as [string, ReactNode][])
            : []),
        ]}
      />
      {!referenceByList.has(list.id) && <Loading>{t('Loading the route…')}</Loading>}
      <p className="mt-3 flex flex-wrap gap-2">
        <RouteGpxButton data={data} list={list} item={item} />
        <OpenInMaps at={line?.[0]?.[0]} label={nameIn(item.name, lang)}>
          {t('Open the start in maps')}
        </OpenInMaps>
      </p>
      <Section title="Activities on it" count={activities.length}>
        <Timeline activities={activities} empty="None yet." />
      </Section>
    </>
  );
};

/** A route as a strip, with the stretches covered filled in where they are along it. */
const CoverageStrip = ({
  lengthM,
  covered,
  label,
}: {
  lengthM: number;
  covered: readonly (readonly [number, number])[];
  label: string;
}) => (
  <div
    className="relative h-2.5 overflow-hidden rounded-full bg-muted"
    role="img"
    aria-label={label}
  >
    {covered.map(([from, to]) => (
      <span
        key={from}
        className="absolute inset-y-0 bg-status-done"
        style={{
          left: `${(from / lengthM) * 100}%`,
          width: `${Math.max(0.4, ((to - from) / lengthM) * 100)}%`,
        }}
      />
    ))}
  </div>
);

const ActivityDetail = ({ data, id }: { data: Data; id: string }) => {
  const lang = useLang();
  const loaded = useLoaded();
  const activity = data.activityById.get(id);
  if (!activity) return <Empty>{t('This activity is not published.')}</Empty>;
  const route = activity.route ? data.routeById.get(activity.route) : undefined;
  const places = activity.places
    .map((place) => data.itemsByPlace.get(place)?.[0])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const prefectures = Object.entries(activity.prefectures).sort((a, b) => b[1] - a[1]);
  const bests = recordsOf(data.activities, loaded).filter((record) => record.activity.id === id);
  return (
    <>
      <Header
        eyebrow={
          <span
            className="inline-flex items-center gap-1.5"
            style={{ color: TYPE_COLORS[activity.type] }}
          >
            <TypeIcon type={activity.type} />
            <span className="text-muted-foreground">
              {typeLabel(activity.type)} · {date(activity.date)}
              {activity.time ? ` ${activity.time}` : ''}
            </span>
          </span>
        }
        title={activityName(activity)}
        badge={
          activity.tags.length + bests.length > 0 ? (
            <>
              {activity.tags.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
              {/* What this activity is the best at, among every published one of its type. */}
              {bests.map((record) => (
                <Badge key={record.id} variant="outline">
                  <TrophyIcon /> {recordLabel(record)}
                </Badge>
              ))}
            </>
          ) : undefined
        }
      />
      <Facts
        rows={[
          ['Distance', distanceText(activity.distanceM, 2)],
          ['Climb', heightText(activity.gainM)],
          ['Moving time', duration(activity.movingS)],
          [
            activity.type === 'ride' ? 'Speed' : 'Pace',
            paceOrSpeed(activity.type, activity.distanceM ?? 0, activity.movingS),
          ],
          ['Elapsed', duration(activity.elapsedS)],
        ]}
      />
      {activity.trackYear === undefined ? (
        <Note>{t('No track is published for this activity.')}</Note>
      ) : (
        <TrackAnalysis data={data} activity={activity} />
      )}
      {prefectures.length > 0 && (
        <Section title="Prefectures">
          <ul className="flex flex-wrap gap-1.5">
            {prefectures.map(([code, metres]) => (
              <li key={code}>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full font-normal"
                  onClick={() => select({ kind: 'prefecture', code }, true)}
                >
                  <span lang={lang}>{prefectureName(data, code, lang)}</span>
                  <span className="text-muted-foreground tabular-nums">{distanceText(metres)}</span>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {places.length > 0 && (
        <Section title="Places reached" count={places.length}>
          <ul>
            {places.map(({ list, item }) => (
              <li key={`${list.id}/${item.id}`}>
                <LinkRow
                  onClick={() => {
                    if (useStore.getState().list !== list.id) chooseList(list.id);
                    select({ kind: 'item', list: list.id, id: item.id }, true);
                  }}
                >
                  <StatusIcon status={item.status} />
                  <span>
                    <Name name={item.name} only />
                  </span>
                  <span className="text-xs text-muted-foreground" lang={lang}>
                    {nameIn(list.title, lang)}
                  </span>
                </LinkRow>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {route && (
        <Section title="Route">
          <LinkRow onClick={() => select({ kind: 'route', id: route.id }, true)}>
            <span>{routeName(route)}</span>
            <RowEnd>{t('done {count} times', { count: route.count })}</RowEnd>
          </LinkRow>
        </Section>
      )}
      {activity.link && (
        <p className="mt-5">
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={activity.link} target="_blank" rel="noopener" />}
          >
            {t('View on Strava')} <ExternalLinkIcon data-icon="inline-end" />
          </Button>
        </p>
      )}
    </>
  );
};

const TypeSplit = ({ byType }: { byType: Record<string, number | undefined> }) => {
  const entries = Object.entries(byType)
    .filter((entry): entry is [string, number] => Boolean(entry[1]))
    .sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, metres]) => sum + metres, 0);
  if (!total) return null;
  return (
    <div>
      <SplitBar
        className="mb-2"
        label={entries
          .map(([type, metres]) => `${typeLabel(type)} ${percent(metres, total)}`)
          .join(', ')}
        parts={entries.map(([type, metres]) => ({
          key: type,
          share: metres / total,
          color: typeColorOf(type),
        }))}
      />
      <ul className="grid grid-cols-2 gap-y-0.5">
        {entries.map(([type, metres]) => (
          <li key={type} className="flex items-center gap-2 text-compact">
            <span
              className="size-3.5 flex-none rounded-sm"
              style={{ background: typeColorOf(type) }}
            />
            {typeLabel(type)}
            <span className="text-muted-foreground tabular-nums">
              {distanceText(metres, 0)} · {percent(metres, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const PrefectureDetail = ({ data, code }: { data: Data; code: string }) => {
  const lang = useLang();
  const filters = useStore((state) => state.filters);
  const feature = data.prefectureByCode.get(code);
  if (!feature) return <Empty>{t('Unknown prefecture.')}</Empty>;
  const derived = derive(data, filters);
  const p = { ...feature.properties, ...figuresOf(data, derived, code) };
  const stats = derived.activityIds ? undefined : data.stats.byPrefecture[code];
  const region = REGIONS.find((entry) => entry.id === p.region);
  const lists = data.lists
    .map((list) => ({ list, items: list.items.filter((item) => item.prefectures.includes(code)) }))
    .filter((entry) => entry.items.length > 0 && entry.list.kind === 'point');
  // What is left here across every list, highest first; a place on several lists is named once.
  const seen = new Set<string>();
  const left = lists
    .flatMap(({ list, items }) => items.map((item) => ({ list, item })))
    .filter(({ item }) => {
      if (item.status === 'done' || seen.has(item.placeId ?? item.id)) return false;
      seen.add(item.placeId ?? item.id);
      return true;
    })
    .sort((a, b) => (b.item.elevationM ?? 0) - (a.item.elevationM ?? 0));
  return (
    <>
      <Header
        eyebrow={region ? <Name name={region} sub="font-normal" /> : t('Prefecture')}
        title={nameIn(p, lang)}
        lang={lang}
        subtitle={subName(p, lang)}
      />
      {derived.activityIds && (
        <p className="mt-3 rounded-md bg-muted px-3 py-1.5">
          {t('Counting only the activities that match the filters.')}
        </p>
      )}
      {p.activities === 0 ? (
        <Empty className="mt-3">
          {derived.activityIds ? t('No matching activities here.') : t('No activities here yet.')}
        </Empty>
      ) : (
        <Facts
          rows={[
            ['Activities', String(p.activities)],
            ['Days out', String(p.days)],
            ['Distance', distanceText(p.distanceM)],
            ['Climb', heightText(p.gainM)],
            ...(stats ? [['Moving time', duration(stats.movingS)] as [string, string]] : []),
          ]}
        />
      )}
      {p.activities > 0 && (
        <Section title="By activity type">
          <TypeSplit byType={p.byType} />
        </Section>
      )}
      {lists.length > 0 && (
        <Section title="Lists with places here">
          <ul>
            {lists.map(({ list, items }) => {
              const done = items.filter((item) => item.status === 'done').length;
              return (
                <li key={list.id}>
                  <LinkRow onClick={() => chooseList(list.id, code)}>
                    <span>
                      <Name name={list.title} />
                    </span>
                    <RowEnd>
                      {done} / {items.length}
                    </RowEnd>
                    <MiniBar share={done / items.length} />
                  </LinkRow>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {left.length > 0 && (
        <Section title="Still to do here" count={left.length}>
          <ul>
            {left.slice(0, 12).map(({ list, item }) => (
              <li key={`${list.id}/${item.id}`}>
                <LinkRow onClick={() => select({ kind: 'item', list: list.id, id: item.id }, true)}>
                  <StatusIcon status={item.status} size={16} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">
                      <Name name={item.name} />
                    </span>
                    <span className="truncate text-xs text-muted-foreground" lang={lang}>
                      {nameIn(list.title, lang)}
                    </span>
                  </span>
                  {item.elevationM !== undefined && <RowEnd>{heightText(item.elevationM)}</RowEnd>}
                </LinkRow>
              </li>
            ))}
          </ul>
          {left.length > 12 && (
            <Note className="mt-1">{t('and {count} more', { count: left.length - 12 })}</Note>
          )}
        </Section>
      )}
    </>
  );
};

const RouteDetail = ({ data, id }: { data: Data; id: string }) => {
  const route = data.routeById.get(id);
  if (!route) return <Empty>{t('This route is not published.')}</Empty>;
  const activities = route.activities
    .map((activityId) => data.activityById.get(activityId))
    .filter((activity): activity is ActivityRecord => Boolean(activity))
    .sort((a, b) => b.date.localeCompare(a.date));
  const varies = route.maxDistanceM > route.minDistanceM * 1.05;
  const parent = route.variantOf ? data.routeById.get(route.variantOf) : undefined;
  return (
    <>
      <Header
        eyebrow={
          <span
            className="inline-flex items-center gap-1.5"
            style={{ color: TYPE_COLORS[route.type] }}
          >
            <TypeIcon type={route.type} />
            <span className="text-muted-foreground">
              {t('{type} route', { type: typeLabel(route.type) })}
            </span>
          </span>
        }
        title={routeName(route)}
        badge={
          <Pill tint={STATUS_TINT.done}>
            {t('Done {count} times', { count: route.count })}
            {route.reversed ? t(', {count} the other way', { count: route.reversed }) : ''}
          </Pill>
        }
      />
      <Facts
        rows={[
          [
            'Distance',
            varies
              ? `${distanceText(route.minDistanceM)} – ${distanceText(route.maxDistanceM)}`
              : distanceText(route.maxDistanceM),
          ],
          [
            varies ? 'Best pace' : 'Fastest',
            varies ? paceOrSpeed(route.type, 1000, route.bestPaceS) : duration(route.fastestS),
          ],
          [
            varies ? 'Median pace' : 'Median',
            varies ? paceOrSpeed(route.type, 1000, route.medianPaceS) : duration(route.medianS),
          ],
          ['First', date(route.first)],
          ['Latest', date(route.latest)],
        ]}
      />
      <RouteTimes route={route} activities={activities} />
      {parent && (
        // The link sits where the language puts the name: before 版 in Japanese, after "of" in English.
        <p className="mt-2 text-xs">
          {t('A shorter version of {route}')
            .split(/(\{route\})/)
            .map((part) =>
              part === '{route}' ? (
                <Button
                  key="route"
                  variant="link"
                  className="h-auto p-0 text-xs"
                  onClick={() => select({ kind: 'route', id: parent.id }, true)}
                >
                  {routeName(parent)}
                </Button>
              ) : (
                part
              ),
            )}
        </p>
      )}
      <Section title="Every time" count={activities.length}>
        <Timeline activities={activities} empty="None." timed />
      </Section>
    </>
  );
};

/** The detail for whatever is selected, with a way back to the list. */
/**
 * The item before and after this one, in the order the list shows them (filters and regions as
 * in the pane), for stepping through a list without going back to it.
 */
export const Details = ({ data, selection }: { data: Data; selection: Selection }) => {
  const lang = useLang();
  const listId = useStore((state) => state.list);
  const active = data.listById.get(listId);
  const list = selection.kind === 'item' ? data.listById.get(selection.list) : undefined;
  const item =
    selection.kind === 'item'
      ? list?.items.find((candidate) => candidate.id === selection.id)
      : undefined;
  const { previous, next } = useNeighbours(data, list, item?.id);
  const go = (to: ListItem | undefined) => {
    if (to && list) select({ kind: 'item', list: list.id, id: to.id }, true);
  };
  // A sideways swipe on a touch screen steps to the next or previous item, as the buttons do.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  return (
    <article
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') swipe.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? next : previous);
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div className="-mt-2 mb-3 -ml-2 flex items-center gap-1">
        <Button
          variant="ghost"
          className="min-w-0 flex-1 justify-start"
          onClick={() => select(null)}
        >
          <ChevronLeftIcon data-icon="inline-start" />
          <span className="truncate" lang={active ? lang : undefined}>
            {active ? nameIn(active.title, lang) : t('Back')}
          </span>
          <Kbd className="max-md:hidden">Esc</Kbd>
        </Button>
      </div>
      {selection.kind === 'item' &&
        (list && item ? (
          list.kind === 'route' ? (
            <RouteItemDetail data={data} list={list} item={item} />
          ) : (
            <PlaceDetail data={data} list={list} item={item} />
          )
        ) : (
          <Empty>{t('This item is not in the list.')}</Empty>
        ))}
      {selection.kind === 'activity' && <ActivityDetail data={data} id={selection.id} />}
      {selection.kind === 'prefecture' && <PrefectureDetail data={data} code={selection.code} />}
      {selection.kind === 'route' && <RouteDetail data={data} id={selection.id} />}
    </article>
  );
};

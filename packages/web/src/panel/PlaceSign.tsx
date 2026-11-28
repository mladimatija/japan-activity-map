import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { Data, List, ListItem } from '../data.ts';
import { groupByRegion, visibleItems } from '../lists.ts';
import { nameIn, otherLang, subName, useLang } from '../names.tsx';
import { select, useStore } from '../store.ts';
import { t } from '../i18n.ts';

/** The items before and after one, in the order the list shows them (regions, then filters). */
export const useNeighbours = (data: Data, list: List | undefined, id: string | undefined) => {
  const filters = useStore((state) => state.filters);
  if (!list || !id) return {};
  const order = groupByRegion(data, list, visibleItems(data, list, filters)).flatMap(
    (group) => group.items,
  );
  const at = order.findIndex((entry) => entry.id === id);
  return at < 0 ? {} : { previous: order[at - 1], next: order[at + 1] };
};

const STEP =
  'flex min-h-11 min-w-0 items-center gap-1.5 px-2.5 outline-none hover:bg-cloth-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0';

/**
 * The head of a list's place or stage, laid out like a station sign (駅名標): its number, its
 * name in both languages, and on the cloth bar under it the ones before and after it, which the
 * bar steps to (as a sideways swipe does).
 */
export const PlaceSign = ({
  data,
  list,
  item,
  badge,
}: {
  data: Data;
  list: List;
  item: ListItem;
  badge?: ReactNode;
}) => {
  const lang = useLang();
  const { previous, next } = useNeighbours(data, list, item.id);
  const go = (to: ListItem | undefined) => {
    if (to) select({ kind: 'item', list: list.id, id: to.id }, true);
  };
  const number =
    list.kind === 'route'
      ? list.items.length > 1
        ? t('Section {number}', { number: item.order })
        : null
      : t('No. {number}', { number: item.order });
  const sub = subName(item.name, lang);
  // The first reading where a list gives several: "りしりざん（りしりふじ）", "…・…".
  const reading = item.kana?.split(/[（(・]/)[0];
  return (
    <header>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="px-4 pt-3 pb-3.5">
          <div className="flex items-center justify-between gap-3">
            {number && (
              <span className="flex-none rounded-sm bg-cloth px-1.5 py-0.5 font-mono text-xs font-medium text-cloth-foreground tabular-nums">
                {number}
              </span>
            )}
            <span
              lang={lang}
              className="min-w-0 truncate font-mono text-xs tracking-wide text-muted-foreground uppercase"
            >
              {nameIn(list.title, lang)}
            </span>
          </div>
          {reading && (
            <p
              lang="ja"
              className="mt-2.5 -mb-1.5 text-center text-xs tracking-[0.2em] text-muted-foreground"
            >
              {reading}
            </p>
          )}
          <h2
            data-detail-title=""
            tabIndex={-1}
            lang={lang}
            className="mt-2.5 rounded-sm text-center font-title text-2xl leading-tight font-bold text-balance outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:text-3xl"
          >
            {nameIn(item.name, lang)}
          </h2>
          {sub && (
            <p
              className="mt-1 text-center font-title text-row text-muted-foreground"
              lang={otherLang(lang)}
            >
              {sub}
            </p>
          )}
        </div>
        {(previous || next) && (
          <nav
            aria-label={t('Before and after')}
            className="grid grid-cols-2 text-compact surface-cloth"
          >
            <button
              type="button"
              disabled={!previous}
              aria-label={
                previous
                  ? t('Previous: {name}', { name: nameIn(previous.name, lang) })
                  : t('Previous')
              }
              onClick={() => go(previous)}
              className={STEP}
            >
              <ChevronLeftIcon />
              {previous && (
                <>
                  <span className="font-mono text-xs text-muted-foreground">{previous.order}</span>
                  <span className="truncate font-title" lang={lang}>
                    {nameIn(previous.name, lang)}
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              disabled={!next}
              aria-label={next ? t('Next: {name}', { name: nameIn(next.name, lang) }) : t('Next')}
              onClick={() => go(next)}
              className={`${STEP} justify-end border-l border-cloth-border text-right`}
            >
              {next && (
                <>
                  <span className="truncate font-title" lang={lang}>
                    {nameIn(next.name, lang)}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{next.order}</span>
                </>
              )}
              <ChevronRightIcon />
            </button>
          </nav>
        )}
      </div>
      {badge && <div className="mt-2.5 flex flex-wrap gap-1.5">{badge}</div>}
    </header>
  );
};

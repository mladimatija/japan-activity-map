import { useMemo } from 'react';

import { Eyebrow, Headline, NameTitle } from '../components/app.tsx';
import { contours } from '../contours.ts';
import type { List } from '../data.ts';
import { distanceText, percent } from '../format.ts';
import { progressOf } from '../lists.ts';
import { t } from '../i18n.ts';

/** The pattern's own box; the cover crops it to whatever shape the pane gives it. */
const BOX = { width: 400, height: 220 };

/** Digit runs of up to three stand upright in a vertical line (縦中横), as Japanese sets them. */
const upright = (text: string) =>
  text.split(/(\d+)/).map((part, at) =>
    /^\d{1,3}$/.test(part) ? (
      <span key={`${at}-${part}`} className="[text-combine-upright:all]">
        {part}
      </span>
    ) : (
      part
    ),
  );

/**
 * The list's Japanese name on a light slip (題箋), set vertically like the label on a stamp book.
 * It stays Japanese in English, as a book keeps its title on the spine; long names wrap into a
 * second column. The title beside it already says the name, so readers skip it.
 */
const TitleSlip = ({ text }: { text: string }) => (
  <p
    aria-hidden
    lang="ja"
    className="relative max-h-44 self-start border border-slip-foreground bg-slip px-1 py-2.5 font-title text-base leading-[1.7] font-bold tracking-[0.12em] text-slip-foreground shadow-sm outline outline-offset-2 outline-slip [writing-mode:vertical-rl]"
  >
    {upright(text)}
  </p>
);

/**
 * The top of a list, on indigo cloth printed with contour lines of its own: what kind of list,
 * its name in both languages, and how far along. The bar or stamp grid follows it on the page.
 */
export const ListCover = ({ list }: { list: List }) => {
  const lines = useMemo(() => contours(list.id, BOX.width, BOX.height), [list.id]);
  const { done, total, share } = progressOf(list);
  return (
    <header className="relative -mx-4 grid grid-cols-[minmax(0,1fr)_auto] gap-4 overflow-hidden px-4 pt-4 pb-3 surface-cloth md:-mx-5 md:px-5">
      <svg
        aria-hidden
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        preserveAspectRatio="xMidYMid slice"
        className="pointer-events-none absolute inset-0 size-full fill-none stroke-cloth-border"
      >
        {lines.map((line) => (
          <path
            key={line.level}
            d={line.d}
            strokeWidth={line.major ? 1.6 : 0.9}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="relative min-w-0">
        <Eyebrow>
          {list.kind === 'route'
            ? t('Route list')
            : t('{count} places', { count: list.items.length })}
        </Eyebrow>
        <NameTitle id="list-title" name={list.title} />
        <div className="mt-5">
          <Headline
            value={list.kind === 'route' ? distanceText(done, 1) : done}
            of={
              list.kind === 'route'
                ? t('of {total}', { total: distanceText(total, 0) })
                : `/ ${total}`
            }
            share={percent(share, 1)}
          />
        </div>
      </div>
      {list.title.ja && <TitleSlip text={list.title.ja} />}
    </header>
  );
};

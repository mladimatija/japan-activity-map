import { useEffect, useRef } from 'react';

import type { Data } from '../data.ts';
import type { Page } from '../store.ts';
import { ComparePage } from './ComparePage.tsx';
import { GoalsPage } from './GoalsPage.tsx';
import { RepeatsPage } from './RepeatsPage.tsx';
import { StatsPage } from './StatsPage.tsx';

/** The chart pages, loaded only when one is opened so the map starts without them. */
const Pages = ({ data, page }: { data: Data; page: Exclude<Page, 'map'> }) => {
  const root = useRef<HTMLDivElement>(null);
  // A new page starts at its top, with focus on its heading.
  useEffect(() => {
    root.current?.parentElement?.scrollTo({ top: 0 });
    root.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [page]);
  return (
    <div ref={root}>
      {page === 'stats' ? (
        <StatsPage data={data} />
      ) : page === 'goals' ? (
        <GoalsPage data={data} />
      ) : page === 'repeats' ? (
        <RepeatsPage data={data} />
      ) : (
        <ComparePage data={data} />
      )}
    </div>
  );
};
export default Pages;

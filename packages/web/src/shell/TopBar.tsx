import { ListFilterIcon } from 'lucide-react';

import { Badge } from '../components/ui/badge.tsx';
import { Toggle } from '../components/ui/toggle.tsx';
import type { Data } from '../data.ts';
import { filterCount } from '../filters.ts';
import { useStore } from '../store.ts';
import { SealMark } from '../components/app.tsx';
import { DemoBadge, DemoStrip } from './DemoBadge.tsx';
import { LayersMenu } from './LayersMenu.tsx';
import { ListPicker } from './ListPicker.tsx';
import { PageNav } from './PageNav.tsx';
import { PrefsMenu } from './PrefsMenu.tsx';
import { Search } from './Search.tsx';
import { t } from '../i18n.ts';

/** Opens the filter panel in the pane (full height on a phone); again, back to the list. */
const FilterButton = () => {
  const open = useStore((state) => state.view === 'filters' && !state.selection);
  const count = useStore((state) => filterCount(state.filters));
  return (
    <Toggle
      variant="cloth"
      size="lg"
      pressed={open}
      aria-label={count ? t('Filters, {count} on', { count }) : t('Filters')}
      onPressedChange={() =>
        useStore.setState({
          view: open ? 'list' : 'filters',
          selection: null,
          sheet: open ? 'half' : 'full',
        })
      }
    >
      <ListFilterIcon />
      <span className="hidden md:inline">{t('Filters')}</span>
      {count > 0 && (
        <Badge
          className="bg-cloth-foreground text-cloth tabular-nums group-aria-pressed/toggle:bg-cloth group-aria-pressed/toggle:text-cloth-foreground"
          aria-hidden="true"
        >
          {count}
        </Badge>
      )}
    </Toggle>
  );
};

/**
 * The one bar every view shares, on indigo cloth (the masthead): the seal and the site's name, what
 * you are looking at, how to find something, and the map's layers.
 */
export const TopBar = ({ data }: { data: Data }) => (
  <div className="relative z-10 min-w-0 bg-cloth text-cloth-foreground">
    <header className="flex h-14 min-w-0 items-center gap-2 border-b border-cloth-border px-2 md:gap-3 md:pr-3 md:pl-4">
      <SealMark className="hidden md:block" />
      <h1 className="-ml-0.5 hidden max-w-40 truncate font-title text-lg font-semibold md:block">
        {data.meta.site.title}
      </h1>
      {data.meta.demo && <DemoBadge />}
      <ListPicker data={data} />
      <PageNav />
      <Search data={data} />
      <FilterButton />
      <LayersMenu data={data} />
      {/* On a phone there is no room for it here: names and units are in the layers menu. */}
      <PrefsMenu className="hidden md:inline-flex" />
    </header>
    {data.meta.demo && <DemoStrip />}
  </div>
);

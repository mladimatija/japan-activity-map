import {
  ChartColumnIcon,
  ChevronDownIcon,
  Columns2Icon,
  type LucideIcon,
  MapIcon,
  Repeat2Icon,
  TargetIcon,
} from 'lucide-react';

import { Button } from '../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.tsx';
import { type Page, useStore } from '../store.ts';
import { t } from '../i18n.ts';

const PAGES: { page: Page; label: string; Icon: LucideIcon }[] = [
  { page: 'map', label: 'Map', Icon: MapIcon },
  { page: 'stats', label: 'Statistics', Icon: ChartColumnIcon },
  { page: 'goals', label: 'Goals', Icon: TargetIcon },
  { page: 'repeats', label: 'Repeats', Icon: Repeat2Icon },
  { page: 'compare', label: 'Compare', Icon: Columns2Icon },
];

const go = (page: Page) =>
  useStore.setState({ page, selection: page === 'map' ? useStore.getState().selection : null });

/**
 * Map, and the chart pages under one named menu ("Insights"), so every page is called by its name
 * at any width: the menu's button says which one is open. On phones, one menu holds them all.
 */
export const PageNav = () => {
  const page = useStore((state) => state.page);
  const current = PAGES.find((entry) => entry.page === page) ?? PAGES[0];
  const charts = PAGES.filter((entry) => entry.page !== 'map');
  const onChart = page !== 'map';
  // Text tabs the height of the bar, the open page underlined in the cloth's ink.
  const TAB =
    'h-14 rounded-none border-x-0 border-y-2 border-transparent px-3 aria-[current=page]:border-b-cloth-foreground aria-[current=page]:text-cloth-foreground';
  return (
    <>
      <nav className="hidden items-center self-stretch md:flex" aria-label={t('Pages')}>
        <Button
          variant="cloth-ghost"
          size="lg"
          className={TAB}
          aria-current={page === 'map' ? 'page' : undefined}
          onClick={() => go('map')}
        >
          <MapIcon />
          {t('Map')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="cloth-ghost"
                size="lg"
                className={TAB}
                aria-current={onChart ? 'page' : undefined}
              />
            }
          >
            {onChart && current ? <current.Icon /> : <ChartColumnIcon />}
            {onChart && current ? t(current.label) : t('Insights')}
            <ChevronDownIcon className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" align="start">
            <DropdownMenuRadioGroup
              value={onChart ? page : ''}
              onValueChange={(value: Page) => go(value)}
            >
              {charts.map(({ page: target, label, Icon }) => (
                <DropdownMenuRadioItem key={target} value={target} closeOnClick>
                  <Icon />
                  {t(label)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="cloth"
              size="lg"
              className="gap-1 px-2 md:hidden"
              aria-label={t('Page: {page}', { page: t(current?.label ?? '') })}
            />
          }
        >
          {current && <current.Icon />}
          <ChevronDownIcon className="text-cloth-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-44">
          <DropdownMenuRadioGroup value={page} onValueChange={(value: Page) => go(value)}>
            {PAGES.map(({ page: target, label, Icon }) => (
              <DropdownMenuRadioItem key={target} value={target} closeOnClick>
                <Icon />
                {t(label)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

import { SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
} from '../components/ui/combobox.tsx';
import { InputGroupAddon } from '../components/ui/input-group.tsx';
import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import { useLang } from '../names.tsx';
import { buildIndex, type Entry, KIND_LABELS, search } from '../search.ts';
import { select, useStore } from '../store.ts';
import { t } from '../i18n.ts';

/** Opens what a result points at: places switch to their list first. */
const openEntry = (entry: Entry): void => {
  if (entry.list && useStore.getState().list !== entry.list)
    useStore.setState((state) => ({
      list: entry.list ?? state.list,
      filters: { ...state.filters, status: [], in: null },
    }));
  select(entry.selection, true);
};

/**
 * One box for places, prefectures, routes and activities, as a combobox: arrows move through the
 * results, Enter opens one, Esc closes. `/` focuses it from anywhere. The results are ours (see
 * search.ts), so the combobox does no filtering of its own.
 */
export const Search = ({ data }: { data: Data }) => {
  const lang = useLang();
  const index = useMemo(() => buildIndex(data, lang), [data, lang]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(
    () => search(index, query).map((group) => ({ value: group.kind, items: group.entries })),
    [index, query],
  );
  const showing = open && query.trim().length > 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]');
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      role="search"
      className={cn(
        'relative min-w-0 flex-1 md:max-w-120',
        // On a phone the open search covers the bar, so the results have its full width.
        showing && 'max-md:absolute max-md:inset-x-2 max-md:z-30',
      )}
    >
      <Combobox<Entry>
        items={groups}
        filter={null}
        inputValue={query}
        onInputValueChange={(value, details) => {
          // Choosing a result would put its name in the box; the box empties instead.
          if (details.reason !== 'item-press') setQuery(value);
        }}
        value={null}
        onValueChange={(entry) => {
          if (!entry) return;
          openEntry(entry);
          setQuery('');
          setOpen(false);
          input.current?.blur();
        }}
        itemToStringLabel={(entry) => entry.title}
        isItemEqualToValue={(a, b) => a.key === b.key}
        open={showing}
        onOpenChange={setOpen}
        autoHighlight
      >
        <ComboboxInput
          ref={input}
          showTrigger={false}
          showClear={query.length > 0}
          type="search"
          placeholder={t('Search peaks, places, prefectures, activities')}
          aria-label={t('Search')}
          className="h-10 w-full bg-muted/50 has-[input:focus-visible]:bg-background [&_input]:[&::-webkit-search-cancel-button]:hidden max-md:[&_input]:placeholder:text-transparent"
        >
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
        </ComboboxInput>
        {/* Phones: the results take the rest of the screen under the box. */}
        <ComboboxContent className="max-h-[min(70vh,520px)] min-w-[min(320px,calc(100vw-16px))] max-md:h-(--available-height) max-md:max-h-none">
          <ComboboxEmpty>{t('Nothing matches “{query}”.', { query })}</ComboboxEmpty>
          <ComboboxList
            aria-label={t('Search results')}
            className="max-h-[min(70vh,520px)] max-md:max-h-full"
          >
            {(group: { value: Entry['kind']; items: Entry[] }) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{t(KIND_LABELS[group.value])}</ComboboxLabel>
                <ComboboxCollection>
                  {(entry: Entry) => (
                    <ComboboxItem
                      key={entry.key}
                      value={entry}
                      className="flex-col items-start gap-0 pr-2"
                    >
                      <span lang={entry.lang}>{entry.title}</span>
                      <span className="text-xs text-muted-foreground">{entry.detail}</span>
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
};

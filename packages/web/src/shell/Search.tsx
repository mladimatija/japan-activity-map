import { ArrowLeftIcon, SearchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import { Button } from '../components/ui/button.tsx';
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
import { isMobile, useIsMobile } from '../hooks/use-mobile.ts';
import { useLang } from '../names.tsx';
import { buildIndex, type Entry, KIND_LABELS, search } from '../search.ts';
import { showOnMap, useStore } from '../store.ts';
import { t } from '../i18n.ts';

/** Opens what a result points at, on the map: places switch to their list first. */
const openEntry = (entry: Entry): void => {
  if (entry.list && useStore.getState().list !== entry.list)
    useStore.setState((state) => ({
      list: entry.list ?? state.list,
      filters: { ...state.filters, status: [], in: null },
    }));
  // From a chart page too: the detail and the map are where a result is shown.
  showOnMap(entry.selection);
};

/**
 * One box for places, prefectures, routes and activities, as a combobox: arrows move through the
 * results, Enter opens one, Esc closes. `/` focuses it from anywhere. The results are ours (see
 * search.ts), so the combobox does no filtering of its own.
 *
 * On a phone the bar has no room for a box: it is a button, and the search opens over the whole
 * screen, with the keyboard up and the results below.
 */
export const Search = ({ data }: { data: Data }) => {
  const lang = useLang();
  const index = useMemo(() => buildIndex(data, lang), [data, lang]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  // The open search is a history entry of its own, so a phone's Back closes it like a detail.
  const entry = useRef(false);
  const afterBack = useRef<(() => void) | null>(null);
  const expand = () => {
    // Focused in the same tap, so the phone's keyboard comes up with it.
    flushSync(() => setExpanded(true));
    input.current?.focus();
    history.pushState({ jamSearch: true }, '');
    entry.current = true;
  };
  const shut = () => {
    setExpanded(false);
    setQuery('');
    setOpen(false);
  };
  /** Closes the search, then does `then`; leaving its history entry first, where it has one. */
  const close = (then: () => void = () => opener.current?.focus()) => {
    if (!entry.current) {
      shut();
      then();
      return;
    }
    afterBack.current = then;
    history.back();
  };
  useEffect(() => {
    const onBack = () => {
      if (!entry.current) return;
      entry.current = false;
      shut();
      afterBack.current?.();
      afterBack.current = null;
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);
  const groups = useMemo(
    () => search(index, query).map((group) => ({ value: group.kind, items: group.entries })),
    [index, query],
  );
  const showing = open && query.trim().length > 0;

  // While the search covers the screen, the page under it is out of reach of Tab and of screen
  // readers; a window widened past phone size has the box in the bar again.
  const covering = mobile && expanded;
  useEffect(() => {
    if (!mobile && expanded) close(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only uses setters and refs
  }, [mobile, expanded]);
  useEffect(() => {
    const page = document.getElementById('root');
    if (!covering || !page) return undefined;
    page.inert = true;
    return () => {
      page.inert = false;
    };
  }, [covering]);

  // Esc closes the results first (the combobox does that), then the phone's search screen.
  useEffect(() => {
    if (!expanded || showing) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // In the capture phase: the box keeps Esc to itself otherwise.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only uses setters and refs
  }, [expanded, showing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable]');
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (isMobile() && !input.current) expand();
        else input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- expand only uses setters and refs
  }, []);

  const box = (
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
        input.current?.blur();
        close(() => openEntry(entry));
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
        className="h-10 w-full border-cloth-border bg-cloth-accent text-cloth-foreground shadow-none dark:bg-cloth-accent has-[input:focus-visible]:bg-background has-[input:focus-visible]:text-foreground [&_input]:placeholder:text-cloth-muted-foreground has-[input:focus-visible]:[&_input]:placeholder:text-muted-foreground [&_input]:[&::-webkit-search-cancel-button]:hidden [&_svg]:text-cloth-muted-foreground has-[input:focus-visible]:[&_svg]:text-muted-foreground"
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
  );

  if (!mobile)
    return (
      <div role="search" className="relative min-w-0 flex-1 md:max-w-120">
        {box}
      </div>
    );
  return (
    <>
      <Button
        ref={opener}
        variant="cloth"
        size="icon-lg"
        aria-label={t('Search')}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        onClick={expand}
      >
        <SearchIcon />
      </Button>
      {expanded &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('Search')}
            className="fixed inset-0 z-40 flex flex-col bg-background"
          >
            <div role="search" className="flex h-14 flex-none items-center gap-1 border-b px-2">
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label={t('Close search')}
                onClick={() => close()}
              >
                <ArrowLeftIcon />
              </Button>
              <div className="min-w-0 flex-1">{box}</div>
            </div>
            {!showing && (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t('Places, prefectures, routes and activities, by name or date.')}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
};

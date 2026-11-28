import { ChevronDownIcon } from 'lucide-react';

import { CompletionSeal } from '../components/app.tsx';
import { Button } from '../components/ui/button.tsx';
import { Progress } from '../components/ui/progress.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.tsx';
import type { Data, List } from '../data.ts';
import { distanceText, percent, THEME_LABELS } from '../format.ts';
import { cn } from '../lib/utils.ts';
import { finishedOf, progressOf } from '../lists.ts';
import { Name, nameIn, useLang } from '../names.tsx';
import { chooseList, useStore } from '../store.ts';
import { t } from '../i18n.ts';

const completionText = (list: List) => {
  const { done, total } = progressOf(list);
  return list.kind === 'route'
    ? t('{done} of {total}', { done: distanceText(done, 1), total: distanceText(total, 0) })
    : `${done} / ${total}`;
};

/** A small bar for how far along something is; decorative unless labelled. */
export const MiniBar = ({
  share,
  label,
  className,
}: {
  share: number;
  label?: string;
  className?: string;
}) => (
  <Progress
    value={Math.min(100, Math.max(share > 0 ? 3 : 0, share * 100))}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className={cn(
      'w-14 flex-none gap-0 [&_[data-slot=progress-indicator]]:bg-status-done',
      className,
    )}
  />
);

/** The active list, and a menu of every list grouped by theme with how far along each is. */
export const ListPicker = ({ data }: { data: Data }) => {
  const active = useStore((state) => state.list);
  const list = data.listById.get(active);
  const lang = useLang();
  const themes = [...new Set(data.lists.map((entry) => entry.theme))];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="cloth"
            size="lg"
            className="min-w-0 flex-1 justify-between md:w-60 md:flex-none"
          />
        }
      >
        <span
          className="truncate font-title text-base font-semibold"
          lang={list ? lang : undefined}
        >
          {list ? nameIn(list.title, lang) : t('Choose a list')}
        </span>
        {list && (
          <span className="ml-auto hidden font-mono text-xs text-cloth-muted-foreground tabular-nums md:inline">
            {completionText(list)}
          </span>
        )}
        <ChevronDownIcon className="text-cloth-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        collisionAvoidance={{ fallbackAxisSide: 'none' }}
        className="max-h-[min(75vh,640px)] w-[min(400px,calc(100vw-16px))]"
      >
        <DropdownMenuRadioGroup value={active} onValueChange={(value: string) => chooseList(value)}>
          {themes.map((theme, at) => (
            <DropdownMenuGroup key={theme}>
              {at > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{THEME_LABELS[theme] ?? theme}</DropdownMenuLabel>
              {data.lists
                .filter((entry) => entry.theme === theme)
                .map((entry) => {
                  const { share } = progressOf(entry);
                  return (
                    <DropdownMenuRadioItem
                      key={entry.id}
                      value={entry.id}
                      closeOnClick
                      className="items-start gap-3"
                    >
                      <span className="min-w-0 flex-1">
                        <Name name={entry.title} />
                      </span>
                      <span className="grid flex-none grid-cols-[auto_auto] items-center gap-x-2 gap-y-1 text-right text-xs tabular-nums">
                        <span>{completionText(entry)}</span>
                        {finishedOf(entry) ? (
                          <CompletionSeal small className="justify-self-end" />
                        ) : (
                          <span className="text-muted-foreground">{percent(share, 1)}</span>
                        )}
                        <MiniBar share={share} className="col-span-2 w-full" />
                      </span>
                    </DropdownMenuRadioItem>
                  );
                })}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

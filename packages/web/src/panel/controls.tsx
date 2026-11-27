import { type ReactNode, useId } from 'react';

import { Dot } from '../components/app.tsx';
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
  ComboboxTrigger,
} from '../components/ui/combobox.tsx';
import { Field, FieldLabel, FieldTitle } from '../components/ui/field.tsx';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx';
import { Slider } from '../components/ui/slider.tsx';
import { Switch } from '../components/ui/switch.tsx';
import type { Range } from '../filters.ts';
import { rangeText } from '../format.ts';
import { t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';

interface Option<T extends string | number> {
  value: T;
  label: string;
  /** What the menu shows, when more than the label (a name with its Japanese beside it). */
  content?: ReactNode;
  /** What a search matches, when more than the label (both names, the region). */
  search?: string;
  count?: number;
  dot?: string;
}

/** A facet's label (and, for a range, its current value beside it). */
export const FacetLabel = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <FieldTitle id={id} className="text-xs text-muted-foreground">
    {children}
  </FieldTitle>
);

/** Longer than this, a dropdown gets a search box. */
const SEARCH_FROM = 6;

/** "Any", as an option of a one-at-a-time dropdown with a search box. */
const ANY = '\u0000any';

/** The searchable dropdown's button, drawn like the plain one's. */
const TRIGGER =
  'border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 touch-target flex h-9 w-full items-center justify-between gap-1.5 rounded-md border bg-transparent py-2 pr-2 pl-2.5 text-sm shadow-xs outline-none focus-visible:ring-3';

/**
 * A facet as a dropdown. With `multiple`, any number of options can be on at once and a result
 * matches any of them; without, one at a time, and "Any" clears it (unless `required`). Each option
 * shows how many results it would give with the other filters as they are; one with none is dimmed
 * but can still be chosen. `groups` heads the options (prefectures by region). More than five
 * options get a search box.
 */
export const ChoiceField = <T extends string | number>({
  label,
  options,
  groups,
  chosen,
  onChange,
  multiple = true,
  required = false,
  placeholder,
}: {
  label: string;
  options?: Option<T>[];
  groups?: { id: string; label: ReactNode; options: Option<T>[] }[];
  chosen: readonly T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  /** One at a time, with no "Any" to go back to (a saved view to open). */
  required?: boolean;
  /** What the button says when nothing is chosen; "Any" by default. */
  placeholder?: string;
}) => {
  const id = useId();
  const all = groups ? groups.flatMap((group) => group.options) : (options ?? []);
  // In the menu's order, whatever order they were picked in.
  const on = all.filter((option) => chosen.includes(option.value));
  const first = on[0];
  // The button names what is on: one with its colour, several as a list, every one as "All".
  const summary =
    on.length === 0 ? (
      (placeholder ?? t('Any'))
    ) : on.length === all.length && all.length > 1 ? (
      t('All')
    ) : on.length === 1 && first ? (
      <>
        {first.dot && <Dot color={first.dot} />}
        <span className="truncate">{first.label}</span>
      </>
    ) : (
      <span className="truncate">{on.map((option) => option.label).join(', ')}</span>
    );
  const dim = (option: Option<T>) =>
    option.count === 0 && !chosen.includes(option.value) && 'text-muted-foreground';
  const row = (option: Option<T>) => (
    <>
      {option.dot && <Dot color={option.dot} />}
      {/* A long name wraps, up to two lines. */}
      <span className="line-clamp-2 min-w-0 flex-1">{option.content ?? option.label}</span>
      {option.count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">{option.count}</span>
      )}
    </>
  );
  const heading = (
    <FieldLabel htmlFor={id} className="text-xs font-normal text-muted-foreground">
      {t(label)}
    </FieldLabel>
  );

  if (all.length >= SEARCH_FROM) {
    const any: Option<T> = { value: ANY as T, label: t('Any') };
    const clearable = !multiple && !required;
    const labels = new Map(groups?.map((group) => [group.id, group.label]));
    const items = groups
      ? [
          ...(clearable ? [{ value: '', items: [any] }] : []),
          ...groups.map((group) => ({ value: group.id, items: group.options })),
        ]
      : [...(clearable ? [any] : []), ...all];
    const matches = (option: Option<T>, query: string) => {
      const words = query.trim().toLowerCase();
      if (!words) return true;
      return option.value !== ANY && (option.search ?? option.label).toLowerCase().includes(words);
    };
    const item = (option: Option<T>) => (
      <ComboboxItem key={String(option.value)} value={option} className={cn(dim(option))}>
        {row(option)}
      </ComboboxItem>
    );
    const shared = {
      items,
      filter: matches,
      itemToStringLabel: (option: Option<T>) => option.label,
      isItemEqualToValue: (a: Option<T>, b: Option<T>) => a.value === b.value,
      autoHighlight: true,
    };
    const body = (
      <>
        <ComboboxTrigger id={id} className={TRIGGER}>
          <span
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5 text-left',
              on.length === 0 && 'text-muted-foreground',
            )}
          >
            {summary}
          </span>
        </ComboboxTrigger>
        {/* As wide as the button, never past it; long names wrap. */}
        <ComboboxContent
          aria-label={t(label)}
          className="w-(--anchor-width) min-w-(--anchor-width)"
        >
          <ComboboxInput
            showTrigger={false}
            placeholder={t('Search')}
            aria-label={t('Search {label}', { label: t(label).toLowerCase() })}
          />
          <ComboboxEmpty>{t('Nothing matches.')}</ComboboxEmpty>
          <ComboboxList aria-label={t(label)}>
            {groups
              ? (group: { value: string; items: Option<T>[] }) => (
                  <ComboboxGroup key={group.value} items={group.items}>
                    {labels.get(group.value) && (
                      <ComboboxLabel>{labels.get(group.value)}</ComboboxLabel>
                    )}
                    <ComboboxCollection>{item}</ComboboxCollection>
                  </ComboboxGroup>
                )
              : item}
          </ComboboxList>
        </ComboboxContent>
      </>
    );
    return (
      <Field className="gap-1.5">
        {heading}
        {multiple ? (
          <Combobox
            multiple
            value={on}
            onValueChange={(next: Option<T>[]) => onChange(next.map((option) => option.value))}
            {...shared}
          >
            {body}
          </Combobox>
        ) : (
          <Combobox
            value={first ?? (clearable ? any : null)}
            onValueChange={(next: Option<T> | null) =>
              onChange(!next || next.value === ANY ? [] : [next.value])
            }
            {...shared}
          >
            {body}
          </Combobox>
        )}
      </Field>
    );
  }

  const item = (option: Option<T>) => (
    <SelectItem
      key={String(option.value)}
      value={option.value}
      label={option.label}
      className={cn(dim(option))}
    >
      {row(option)}
    </SelectItem>
  );
  const menu = (
    <>
      <SelectTrigger id={id} className="w-full">
        <SelectValue className={cn('min-w-0', on.length === 0 && 'text-muted-foreground')}>
          {() => summary}
        </SelectValue>
      </SelectTrigger>
      {/* Below the button and as wide as it; long names wrap. */}
      <SelectContent alignItemWithTrigger={false} align="start">
        {!multiple && !required && (
          <SelectItem value={null} label={t('Any')}>
            {t('Any')}
          </SelectItem>
        )}
        {groups
          ? groups.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.options.map(item)}
              </SelectGroup>
            ))
          : all.map(item)}
      </SelectContent>
    </>
  );
  return (
    <Field className="gap-1.5">
      {heading}
      {multiple ? (
        <Select multiple value={[...chosen]} onValueChange={(next: T[]) => onChange(next)}>
          {menu}
        </Select>
      ) : (
        <Select
          value={chosen[0] ?? null}
          onValueChange={(next: T | null) => onChange(next === null ? [] : [next])}
        >
          {menu}
        </Select>
      )}
    </Field>
  );
};

/** An on-or-off facet, with what it does underneath and how many results it would give. */
export const SwitchField = ({
  label,
  hint,
  count,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => {
  const id = useId();
  return (
    <Field orientation="horizontal" className="items-center justify-between gap-3">
      <span className="flex min-w-0 flex-col gap-0.5">
        <FieldLabel htmlFor={id} className="text-sm font-normal">
          {t(label)}
          {count !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
          )}
        </FieldLabel>
        <span id={`${id}-hint`} className="text-xs text-muted-foreground">
          {t(hint)}
        </span>
      </span>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-hint`}
      />
    </Field>
  );
};

/** The stop nearest a value, for placing a thumb when a link holds a value between stops. */
const nearest = (stops: readonly number[], value: number) =>
  stops.reduce(
    (best, stop, i) => (Math.abs(stop - value) < Math.abs((stops[best] ?? 0) - value) ? i : best),
    0,
  );

/**
 * A two-thumb range over a set of stops (so a long tail, like 0–300 km, still has fine steps at
 * the low end). Both ends at their limits mean no filter; one end at its limit leaves that side open.
 */
export const RangeField = ({
  label,
  stops,
  range,
  format,
  onChange,
}: {
  label: string;
  stops: readonly number[];
  range: Range;
  format: (value: number) => string;
  onChange: (next: Range) => void;
}) => {
  const id = useId();
  const last = stops.length - 1;
  const low = range.min === null ? 0 : nearest(stops, range.min);
  const high = range.max === null ? last : nearest(stops, range.max);
  const text = rangeText(range, format);
  return (
    <Field className="gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <FacetLabel id={id}>{t(label)}</FacetLabel>
        <output className="text-compact tabular-nums" aria-live="polite">
          {text}
        </output>
      </div>
      <Slider
        aria-labelledby={id}
        className="px-1"
        min={0}
        max={last}
        step={1}
        value={[low, high]}
        onValueChange={(value) => {
          const [lowIndex = 0, highIndex = last] = Array.isArray(value) ? value : [value, value];
          onChange({
            min: lowIndex <= 0 ? null : (stops[lowIndex] ?? null),
            max: highIndex >= last ? null : (stops[highIndex] ?? null),
          });
        }}
        getAriaLabel={(index) => `${t(label)}, ${index === 0 ? t('lowest') : t('highest')}`}
        getAriaValueText={(_formatted, value, index) =>
          index === 0 && value === 0
            ? t('No lower limit')
            : index === 1 && value === last
              ? t('No upper limit')
              : format(stops[value] ?? 0)
        }
      />
    </Field>
  );
};

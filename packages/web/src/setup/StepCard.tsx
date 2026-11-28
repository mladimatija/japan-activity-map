import { lazy, Suspense, useId } from 'react';

import { Button } from '../components/ui/button.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '../components/ui/field.tsx';
import { Input } from '../components/ui/input.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { Textarea } from '../components/ui/textarea.tsx';
import { isJa, t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';
import type { SetupApi, ShownStep } from './api.ts';
import { GpxDrop } from './GpxDrop.tsx';
import { SETUP_JA } from './i18n-ja-setup.ts';
import { ZoneList } from './ZoneList.tsx';

const ZonePicker = lazy(() => import('./ZonePicker.tsx'));

/** A message from the server's checks: in Japanese when there is one, as it came otherwise. */
export const said = (text: string): string => (isJa() ? (SETUP_JA[text] ?? text) : text);

/** An option's label in the current language; a label that is the value itself (hike, 256) stays. */
const optionLabel = (option: { value: unknown; label: string }): string =>
  option.label === String(option.value) ? option.label : t(option.label);

const asText = (value: unknown): string =>
  value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value, null, 2);

export interface StepProps {
  step: ShownStep;
  /** What the page holds for this step; undefined when untouched. */
  answer: unknown;
  answers: Record<string, unknown>;
  error?: string;
  mapStyle: string;
  onAnswer: (id: string, value: unknown) => void;
  /** Sends a file to the GPX folder; without it the step that offers a drop shows its text only. */
  onUpload?: SetupApi['upload'] | undefined;
}

const Help = ({ step }: { step: ShownStep }) =>
  step.help ? <FieldDescription>{t(step.help)}</FieldDescription> : null;

const Problem = ({ error }: { error?: string }) =>
  error ? <FieldError>{said(error)}</FieldError> : null;

/** One step as the control its kind calls for. */
export const StepCard = ({
  step,
  answer,
  answers,
  error,
  mapStyle,
  onAnswer,
  onUpload,
}: StepProps) => {
  const id = useId();
  const value = answer ?? step.value;
  const set = (next: unknown) => onAnswer(step.id, next);

  if (step.kind === 'info')
    return (
      <Field>
        <FieldTitle>{t(step.title)}</FieldTitle>
        <Help step={step} />
        {step.id === 'gpx.files' && onUpload && <GpxDrop onUpload={onUpload} />}
      </Field>
    );

  if (step.kind === 'confirm')
    return (
      <Field orientation="horizontal" className="items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-1">
          <FieldLabel htmlFor={id}>{t(step.title)}</FieldLabel>
          <Help step={step} />
          <Problem error={error} />
        </span>
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => set(checked)} />
      </Field>
    );

  if (step.kind === 'choice')
    return (
      <Field>
        <FieldTitle>{t(step.title)}</FieldTitle>
        <Help step={step} />
        <div role="radiogroup" aria-label={t(step.title)} className="flex flex-col gap-1.5">
          {(step.options ?? []).map((option) => {
            const chosen = option.value === value;
            return (
              <Button
                key={String(option.value)}
                role="radio"
                aria-checked={chosen}
                variant="outline"
                onClick={() => set(option.value)}
                className={cn(
                  'h-auto min-h-11 flex-col items-start gap-0.5 px-3 py-2 text-left whitespace-normal',
                  chosen && 'border-primary bg-accent text-accent-foreground',
                )}
              >
                <span className="font-semibold">{optionLabel(option)}</span>
                {option.help && (
                  <span className="text-xs font-normal text-muted-foreground">
                    {t(option.help)}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
        <Problem error={error} />
      </Field>
    );

  if (step.kind === 'multi') {
    const chosen = Array.isArray(value) ? (value as unknown[]) : [];
    return (
      <Field>
        <FieldTitle>{t(step.title)}</FieldTitle>
        <Help step={step} />
        <table className="w-full text-compact">
          <tbody>
            {(step.options ?? []).map((option, index) => (
              <tr key={String(option.value)} className="border-b border-border last:border-0">
                <td className="w-8 py-2 align-top">
                  <Checkbox
                    id={`${id}-${index}`}
                    checked={chosen.includes(option.value)}
                    onCheckedChange={(checked) =>
                      set(
                        (step.options ?? [])
                          .map((item) => item.value)
                          .filter((item) =>
                            item === option.value ? checked === true : chosen.includes(item),
                          ),
                      )
                    }
                  />
                </td>
                <td className="py-2">
                  <label htmlFor={`${id}-${index}`} className="font-semibold">
                    {optionLabel(option)}
                  </label>
                  {option.help && <p className="text-xs text-muted-foreground">{t(option.help)}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Problem error={error} />
      </Field>
    );
  }

  if (step.kind === 'location')
    return (
      <Field>
        <FieldTitle>{t('Home location to hide')}</FieldTitle>
        <FieldDescription>
          {t(
            'Click the map where your home is. Every published track loses the part near that point. Skip it and tracks show where they start.',
          )}
        </FieldDescription>
        <Suspense
          fallback={<p className="text-xs text-muted-foreground">{t('Loading the map…')}</p>}
        >
          <ZonePicker
            mapStyle={mapStyle}
            centre={(answer as { lat: number; lon: number } | undefined) ?? null}
            radiusM={Number(answers['privacy.radius'] ?? 500)}
            onCentre={(centre) => set(centre ?? '')}
            onRadius={(radius) => onAnswer('privacy.radius', radius)}
          />
        </Suspense>
        <Problem error={error} />
      </Field>
    );

  if (step.kind === 'zones')
    return (
      <Field>
        <FieldTitle>{t(step.title)}</FieldTitle>
        <Help step={step} />
        <ZoneList
          mapStyle={mapStyle}
          zones={(Array.isArray(value) ? value : []) as Parameters<typeof ZoneList>[0]['zones']}
          onChange={set}
        />
        <Problem error={error} />
      </Field>
    );

  if (step.kind === 'json')
    return (
      <Field>
        <FieldLabel htmlFor={id}>{t(step.title)}</FieldLabel>
        <Help step={step} />
        <Textarea
          id={id}
          rows={4}
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={error ? true : undefined}
          value={asText(value)}
          onChange={(event) => set(event.target.value)}
        />
        <Problem error={error} />
      </Field>
    );

  const secret = step.sensitive === 'secret';
  // The terminal needs to be told how to type a day; a calendar does not.
  const title =
    step.kind === 'date' ? t(step.title).replace(/\s*[(（]YYYY-MM-DD[)）]\s*$/, '') : t(step.title);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{title}</FieldLabel>
      <Help step={step} />
      <Input
        id={id}
        // A day is picked from the browser's own calendar, which also keeps it to real days.
        type={
          step.kind === 'secret'
            ? 'password'
            : step.kind === 'number'
              ? 'number'
              : step.kind === 'date'
                ? 'date'
                : 'text'
        }
        inputMode={step.kind === 'number' ? 'decimal' : undefined}
        // A secret is typed fresh each time: the browser is asked not to keep or offer it.
        autoComplete={secret ? 'off' : undefined}
        placeholder={step.stored ? t('Stored. Leave empty to keep it.') : undefined}
        aria-invalid={error ? true : undefined}
        value={asText(value)}
        onChange={(event) =>
          set(
            step.kind === 'number' && event.target.value !== ''
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      <Problem error={error} />
    </Field>
  );
};

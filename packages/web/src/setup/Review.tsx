import { lazy, Suspense, useEffect, useState } from 'react';

import { Button } from '../components/ui/button.tsx';
import { Checkbox } from '../components/ui/checkbox.tsx';
import { t } from '../i18n.ts';
import type { MergeCandidate, PreviewTracks, SetupApi, SetupState } from './api.ts';
import { said } from './StepCard.tsx';

const PreviewMap = lazy(() => import('./PreviewMap.tsx'));

/**
 * The review files the commands wrote (new and uncertain matches, routes to merge), shown as
 * text with a box to tick when read. The ticks are for the reader: nothing depends on them.
 */
export const Review = ({
  api,
  reviews,
  initial,
  initialMerges,
  mapStyle,
  onNext,
}: {
  api: SetupApi;
  reviews: SetupState['reviews'];
  /** For the render check: a file already open, and candidates without asking the server. */
  initial?: { name: string; text: string };
  initialMerges?: MergeCandidate[];
  mapStyle?: string;
  onNext: () => void;
}) => {
  const [open, setOpen] = useState(initial);
  const [read, setRead] = useState<string[]>([]);
  const [merges, setMerges] = useState<MergeCandidate[]>(initialMerges ?? []);
  const [mergeNote, setMergeNote] = useState<string>();
  const [preview, setPreview] = useState<PreviewTracks | 'none' | 'working'>();
  useEffect(() => {
    if (initialMerges) return;
    void api
      .merges()
      .then(setMerges)
      .catch(() => undefined);
  }, [api, initialMerges]);
  const merge = async (index: number) => {
    try {
      setMerges(await api.merge(index));
      setMergeNote(undefined);
    } catch (error) {
      setMergeNote(error instanceof Error ? error.message : String(error));
    }
  };
  // The preview is written by a command of its own, then read back: it never leaves this machine.
  const showPreview = async () => {
    setPreview('working');
    try {
      await api.run('zones-preview');
      // The command is quick; its file is there a moment after it starts.
      for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const tracks = await api.preview();
        if (tracks) {
          setPreview(tracks);
          return;
        }
      }
      setPreview('none');
    } catch {
      setPreview('none');
    }
  };
  const merged = merges.filter((candidate) => candidate.merged).length;
  const show = async (name: string) => {
    try {
      setOpen({ name, text: await api.review(name) });
    } catch {
      setOpen({ name, text: t('This file could not be read.') });
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('No review files yet. They appear after matching and route grouping have run.')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border bg-card">
          {reviews.map((file) => (
            <li key={file.name} className="flex min-h-11 flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{file.name}</span>
                <span className="block text-xs text-muted-foreground">{said(file.what)}</span>
              </span>
              <label className="flex items-center gap-2 text-compact">
                <Checkbox
                  checked={read.includes(file.name)}
                  onCheckedChange={(checked) =>
                    setRead((before) =>
                      checked === true
                        ? [...before, file.name]
                        : before.filter((name) => name !== file.name),
                    )
                  }
                />
                {t('I have read this')}
              </label>
              <Button variant="outline" size="sm" onClick={() => void show(file.name)}>
                {t('Open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <section aria-label={open.name} className="rounded-lg border bg-card px-3 py-2.5">
          <h3 className="text-compact font-semibold">{open.name}</h3>
          <pre className="mt-2 max-h-96 overflow-auto text-xs whitespace-pre-wrap">{open.text}</pre>
        </section>
      )}
      {merges.length > 0 && (
        <section aria-label={t('Routes that look like one route')} className="flex flex-col gap-2">
          <h3 className="text-compact font-semibold">{t('Routes that look like one route')}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              'Merging writes the pair to config/routes.jsonc. It takes effect when routes are grouped and the site is built again.',
            )}
          </p>
          <ul className="divide-y divide-border rounded-lg border bg-card">
            {merges.map((candidate) => (
              <li
                key={candidate.index}
                className="flex min-h-11 flex-wrap items-center gap-3 px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">
                    {candidate.routes.map((route) => `${route.name} (${route.count}×)`).join(' + ')}
                  </span>
                  <span className="block text-xs text-muted-foreground">{candidate.reason}</span>
                </span>
                {candidate.merged ? (
                  <span className="text-compact text-muted-foreground">{t('Merged')}</span>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => void merge(candidate.index)}>
                    {t('Merge')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {mergeNote && <p className="text-compact text-destructive">{said(mergeNote)}</p>}
          {merged > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('Run `pnpm jam routes` and `pnpm jam build` again for the merged routes to show.')}
            </p>
          )}
        </section>
      )}
      <section aria-label={t('What the privacy zones cut')} className="flex flex-col gap-2">
        <h3 className="text-compact font-semibold">{t('What the privacy zones cut')}</h3>
        <p className="text-xs text-muted-foreground">
          {t(
            'Your tracks as they would be published: where a line stops short, a zone begins. The file stays on this machine.',
          )}
        </p>
        {preview === undefined || preview === 'none' ? (
          <>
            {preview === 'none' && (
              <p className="text-compact text-muted-foreground">
                {t('No preview could be made. Sync and match activities first.')}
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void showPreview()}
            >
              {t('Show the cut tracks on a map')}
            </Button>
          </>
        ) : preview === 'working' ? (
          <p className="text-compact text-muted-foreground">{t('Working…')}</p>
        ) : (
          <Suspense
            fallback={<p className="text-compact text-muted-foreground">{t('Working…')}</p>}
          >
            <PreviewMap mapStyle={mapStyle ?? ''} tracks={preview} />
          </Suspense>
        )}
      </section>
      <Button className="self-start" onClick={onNext}>
        {t('Next')}
      </Button>
    </div>
  );
};

import { type DragEvent, useRef, useState } from 'react';

import { Button } from '../components/ui/button.tsx';
import { t } from '../i18n.ts';
import { cn } from '../lib/utils.ts';
import type { SetupApi } from './api.ts';
import { said } from './StepCard.tsx';

type Sent =
  | { state: 'sending'; name: string }
  | { state: 'saved'; name: string; files: number }
  | { state: 'failed'; reason: string };

/**
 * A place to drop, or choose, a .zip or .gpx file for the GPX import. The file goes to the local
 * setup server, which saves it in the folder the import reads; nothing is kept in the page.
 */
export const GpxDrop = ({ onUpload }: { onUpload: SetupApi['upload'] }) => {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [sent, setSent] = useState<Sent[]>([]);

  const send = async (files: FileList | null) => {
    for (const file of files ?? []) {
      if (!/\.(zip|gpx)$/i.test(file.name)) {
        setSent((before) => [
          ...before,
          { state: 'failed', reason: 'Only a .zip or .gpx file is taken.' },
        ]);
        continue;
      }
      setSent((before) => [...before, { state: 'sending', name: file.name }]);
      let result: Sent;
      try {
        const saved = await onUpload(file);
        result = { state: 'saved', name: saved.saved, files: saved.files };
      } catch (error) {
        result = { state: 'failed', reason: error instanceof Error ? error.message : '' };
      }
      setSent((before) => [
        ...before.filter((item) => !(item.state === 'sending' && item.name === file.name)),
        result,
      ]);
    }
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    void send(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cn(
        'flex flex-col items-start gap-2 rounded-md border border-dashed border-border p-4 text-sm',
        over && 'border-primary bg-accent text-accent-foreground',
      )}
    >
      <p>{t('Drop a .zip or .gpx file here, or choose one.')}</p>
      <input
        ref={input}
        type="file"
        accept=".zip,.gpx"
        multiple
        hidden
        onChange={(event) => {
          void send(event.target.files);
          event.target.value = '';
        }}
      />
      <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
        {t('Choose a file')}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t(
          'It is saved in the GPX folder on this computer and imported when the plan runs. Up to 512 MB; put a larger export into the folder yourself.',
        )}
      </p>
      <ul aria-live="polite" className="flex flex-col gap-1 text-xs">
        {sent.map((item, index) => (
          <li
            // The list only grows or swaps one entry, so the position names it.
            key={index}
            className={cn(item.state === 'failed' && 'text-destructive')}
          >
            {item.state === 'sending'
              ? t('Sending {name}…', { name: item.name })
              : item.state === 'saved'
                ? t('Saved {name}: {count} GPX files.', { name: item.name, count: item.files })
                : said(item.reason) || t('The file was not taken.')}
          </li>
        ))}
      </ul>
    </div>
  );
};

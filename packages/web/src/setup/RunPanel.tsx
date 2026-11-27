import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx';
import { Badge } from '../components/ui/badge.tsx';
import { Button } from '../components/ui/button.tsx';
import { Spinner } from '../components/ui/spinner.tsx';
import { t } from '../i18n.ts';
import type { PlanAction, SetupApi } from './api.ts';
import { said } from './StepCard.tsx';
import { Progress } from '../components/ui/progress.tsx';

export type RunStatus = 'waiting' | 'running' | 'done' | 'failed' | 'skipped';

const STATUS_TEXT: Record<RunStatus, string> = {
  waiting: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export interface RunPanelProps {
  api: SetupApi;
  plan: PlanAction[];
  /** The granted Strava scope, for the badge beside the sign-in. */
  scope: string | null;
  /** For the render check: statuses and lines to show without running anything. */
  initial?: { status?: Record<string, RunStatus>; lines?: string[]; authorizeUrl?: string };
  onFinished: () => void;
}

/** The plan as rows, run one after another, with each command's output as it arrives. */
export const RunPanel = ({ api, plan, scope, initial, onFinished }: RunPanelProps) => {
  const [status, setStatus] = useState<Record<string, RunStatus>>(initial?.status ?? {});
  const [lines, setLines] = useState<string[]>(initial?.lines ?? []);
  const [authorizeUrl, setAuthorizeUrl] = useState(initial?.authorizeUrl);
  const [busy, setBusy] = useState(false);
  // How long the running step has taken, so a slow one is seen to be alive.
  const [elapsed, setElapsed] = useState(0);
  const [stopNote, setStopNote] = useState<string>();
  // How far the running step says it has got, when it knows (downloads, tracks, matching).
  const [progress, setProgress] = useState<{ done: number; total: number; what: string }>();
  useEffect(() => {
    if (!busy) return undefined;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, status]);
  const ended = useRef<((code: number) => void) | undefined>(undefined);

  useEffect(
    () =>
      api.events((event) => {
        if (event.type === 'log') setLines((before) => [...before.slice(-800), event.line]);
        else if (event.type === 'progress')
          setProgress(event.done >= event.total ? undefined : event);
        else if (event.type === 'start') setProgress(undefined);
        else if (event.type === 'authorize') setAuthorizeUrl(event.url);
        else if (event.type === 'end') {
          setProgress(undefined);
          ended.current?.(event.code);
        }
      }),
    [api],
  );

  const stateOf = (action: PlanAction): RunStatus =>
    status[action.id] ?? (action.skip ? 'skipped' : 'waiting');

  const runFrom = async (first: number) => {
    setBusy(true);
    for (const action of plan.slice(first)) {
      if (action.skip || status[action.id] === 'done') continue;
      setStatus((before) => ({ ...before, [action.id]: 'running' }));
      const code = await new Promise<number>((resolve) => {
        ended.current = resolve;
        api.run(action.id).catch(() => resolve(1));
      });
      setStatus((before) => ({ ...before, [action.id]: code === 0 ? 'done' : 'failed' }));
      if (code !== 0) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setAuthorizeUrl(undefined);
  };

  const failedAt = plan.findIndex((action) => stateOf(action) === 'failed');
  const allDone = plan.every((action) => ['done', 'skipped'].includes(stateOf(action)));
  return (
    <div className="flex flex-col gap-3">
      <ol className="divide-y divide-border rounded-lg border bg-card">
        {plan.map((action, index) => {
          const state = stateOf(action);
          return (
            <li key={action.id} className="flex min-h-11 flex-col gap-1 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-compact text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 font-semibold">{t(action.title)}</span>
                {state === 'running' && (
                  <>
                    <span className="text-compact text-muted-foreground tabular-nums">
                      {t('{seconds} s', { seconds: elapsed })}
                    </span>
                    <Spinner />
                  </>
                )}
                <Badge variant={state === 'failed' ? 'destructive' : 'outline'}>
                  {t(STATUS_TEXT[state])}
                </Badge>
              </div>
              {state === 'running' && progress && (
                <Progress
                  value={(progress.done / progress.total) * 100}
                  aria-label={t(action.title)}
                  className="items-center gap-2"
                >
                  <span className="text-compact text-muted-foreground tabular-nums">
                    {progress.done} / {progress.total} {progress.what}
                  </span>
                </Progress>
              )}
              <code className="text-xs break-all text-muted-foreground">{action.command}</code>
              <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                {action.network && <span>{t('Uses the network.')}</span>}
                {action.browser && <span>{t('Opens a browser tab.')}</span>}
                {action.slow && <span>{t('Can be slow: {how}.', { how: said(action.slow) })}</span>}
                {action.skip && <span>{t('Left out: {why}.', { why: said(action.skip) })}</span>}
                {action.id === 'strava-auth' && (
                  <span>
                    {scope
                      ? t('Signed in. Granted: {scope}.', { scope })
                      : t('Not signed in to Strava yet.')}
                  </span>
                )}
              </div>
              {action.id === 'strava-auth' && state === 'running' && authorizeUrl && (
                <a
                  className="text-sm font-semibold text-primary underline"
                  href={authorizeUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Open the Strava sign-in page')}
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {failedAt >= 0 && (
        <Alert variant="destructive">
          <AlertTitle>{t('A step failed.')}</AlertTitle>
          <AlertDescription>
            {t('Read its output below, fix what it says, then continue from that step.')}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {!allDone && (
          <Button disabled={busy} onClick={() => void runFrom(Math.max(failedAt, 0))}>
            {failedAt >= 0 ? t('Continue from the failed step') : t('Run these now')}
          </Button>
        )}
        {busy && (
          <Button
            variant="outline"
            onClick={() =>
              void api
                .stop()
                .then(() => setStopNote(undefined))
                .catch((error: unknown) =>
                  setStopNote(error instanceof Error ? error.message : String(error)),
                )
            }
          >
            {t('Stop this step')}
          </Button>
        )}
        <Button variant={allDone ? 'default' : 'outline'} disabled={busy} onClick={onFinished}>
          {allDone ? t('Next') : t('Skip running')}
        </Button>
      </div>
      {stopNote && <p className="text-compact text-muted-foreground">{said(stopNote)}</p>}
      <p className="text-xs text-muted-foreground">
        {t(
          'A stopped step leaves what it had finished (downloaded sources, synced pages); running it again carries on.',
        )}{' '}
        {t('One command runs at a time. Close other `jam` commands while this runs.')}
      </p>
      <details className="rounded-lg border bg-card px-3 py-2" open={lines.length > 0}>
        <summary className="min-h-6 cursor-pointer text-compact font-semibold">
          {t('Output ({count} lines)', { count: lines.length })}
        </summary>
        <pre className="mt-2 max-h-80 overflow-auto text-xs whitespace-pre-wrap">
          {lines.join('\n')}
        </pre>
      </details>
    </div>
  );
};

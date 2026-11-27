import { Progress } from '../components/ui/progress.tsx';
import { useLoading } from '../lazy.ts';
import { t } from '../i18n.ts';

/** How far loading has got: "Loading tracks · 3 of 5", then "Tracks loaded". */
const useLoadingLabel = () => {
  const { total, done, what } = useLoading();
  if (total === 0) return null;
  const finished = done >= total;
  const label =
    what === 'route'
      ? finished
        ? t('Route loaded')
        : t('Loading the route…')
      : finished
        ? t('Tracks loaded')
        : t('Loading tracks · {done} of {total}', { done, total });
  return { label, finished, share: total ? Math.max(8, (done / total) * 100) : null };
};

/** A thin line across the top of the map while tracks or a route are loading. */
export const LoadingLine = () => {
  const loading = useLoadingLabel();
  if (!loading || loading.finished) return null;
  return (
    <Progress
      value={loading.share}
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-20 gap-0 [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none [&_[data-slot=progress-track]]:bg-transparent"
    />
  );
};

/** The same as a short note, read out politely by screen readers; placed by its parent. */
export const LoadingNote = () => {
  const loading = useLoadingLabel();
  if (!loading) return null;
  return (
    <p
      role="status"
      className="rounded-full bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm ring-1 ring-foreground/10"
    >
      {loading.label}
    </p>
  );
};

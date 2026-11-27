import { Badge } from '../components/ui/badge.tsx';
import { t } from '../i18n.ts';

/**
 * Says the site is showing made-up data (`jam demo` sets `demo` in meta.json). Beside the title on
 * a wide screen; on a phone, where the bar is full, a pill on the bar's lower edge.
 */
export const DemoBadge = () => (
  <Badge
    variant="outline"
    className="border-input bg-muted text-foreground max-md:pointer-events-none max-md:absolute max-md:bottom-0 max-md:left-1/2 max-md:z-20 max-md:-translate-x-1/2 max-md:translate-y-1/2"
    title={t('These activities are made up, to show what the site does.')}
  >
    {t('Demo data')}
  </Badge>
);

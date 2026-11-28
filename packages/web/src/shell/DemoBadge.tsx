import { Badge } from '../components/ui/badge.tsx';
import { t } from '../i18n.ts';

const WHY = 'These activities are made up, to show what the site does.';

/** Says the site is showing made-up data (`jam demo` sets `demo` in meta.json): beside the title. */
export const DemoBadge = () => (
  <Badge
    variant="outline"
    className="hidden border-input bg-muted text-foreground md:inline-flex"
    title={t(WHY)}
  >
    {t('Demo data')}
  </Badge>
);

/** The same on a phone, where the bar is full: a slim strip under it, in the page's flow. */
export const DemoStrip = () => (
  <p
    className="border-b bg-muted py-0.5 text-center text-xs text-muted-foreground md:hidden"
    title={t(WHY)}
  >
    {t('Demo data')}
  </p>
);

import { useEffect, useRef } from 'react';

import { Badge } from '../components/ui/badge.tsx';
import { t } from '../i18n.ts';

const WHY = 'These activities are made up, to show what the site does.';

/** Says the site is showing made-up data (`jam demo` sets `demo` in meta.json): beside the title. */
export const DemoBadge = () => (
  <Badge
    variant="outline"
    className="hidden border-cloth-border bg-cloth-accent text-cloth-foreground md:inline-flex"
    title={t(WHY)}
  >
    {t('Demo data')}
  </Badge>
);

let extra = 0;

/** What the strip adds to the top bar's height, in pixels: 0 without it, and on wide screens. */
export const barExtra = (): number => extra;

/**
 * The same on a phone, where the bar is full: a slim strip under it, in the page's flow. Its
 * height is published (`--bar-extra`, `barExtra()`) so the sheet at its full stop ends under it.
 */
export const DemoStrip = () => {
  const strip = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const measure = () => {
      extra = strip.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty('--bar-extra', `${extra}px`);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      extra = 0;
      document.documentElement.style.removeProperty('--bar-extra');
    };
  }, []);
  return (
    <p
      ref={strip}
      className="border-b bg-muted py-0.5 text-center text-xs text-muted-foreground md:hidden"
    >
      <strong className="font-medium text-foreground">{t('Demo data')}</strong>
      <span aria-hidden="true"> · </span>
      {t('made-up activities')}
    </p>
  );
};

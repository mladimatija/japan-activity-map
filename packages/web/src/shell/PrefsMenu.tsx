import { ChevronDownIcon } from 'lucide-react';

import { Button } from '../components/ui/button.tsx';
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
import { cn } from '../lib/utils.ts';
import { type Lang, LANGS, setLang, setUnits, useStore } from '../store.ts';
import { t } from '../i18n.ts';
import { type Units, UNITS } from '../units.ts';
import { LANG_LABELS } from './LangSwitch.tsx';
import { UNIT_LABELS } from './UnitsSwitch.tsx';

/**
 * Names in and units, in one menu at the end of the masthead: both are set once and rarely
 * changed, so the bar shows only what they are ("EN · km"). On a phone they are in the layers menu.
 */
export const PrefsMenu = ({ className }: { className?: string }) => {
  const lang = useStore((state) => state.lang);
  const units = useStore((state) => state.units);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="cloth-ghost"
            size="lg"
            className={cn('gap-1 px-2.5 font-mono text-xs', className)}
            aria-label={t('Names and units')}
          />
        }
      >
        <span lang={lang}>{LANG_LABELS[lang].label}</span>
        <span aria-hidden="true">·</span>
        <span>{UNIT_LABELS[units].label}</span>
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Names in')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={lang} onValueChange={(value: Lang) => setLang(value)}>
            {LANGS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} lang={option} closeOnClick>
                {LANG_LABELS[option].own}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Units')}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={units} onValueChange={(value: Units) => setUnits(value)}>
            {UNITS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                {t(UNIT_LABELS[option].name)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

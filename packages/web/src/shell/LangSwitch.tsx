import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { type Lang, LANGS, setLang, useStore } from '../store.ts';
import { t } from '../i18n.ts';

const LANG_LABELS: Record<Lang, { label: string; name: string }> = {
  en: { label: 'EN', name: 'EN, English' },
  ja: { label: '日本語', name: '日本語, Japanese' },
};

/**
 * Which language names are shown in first: places, lists and routes keep the other language
 * beside or under it. The interface itself stays in English.
 */
export const LangSwitch = ({ className }: { className?: string }) => {
  const lang = useStore((state) => state.lang);
  return (
    <ToggleGroup
      className={className}
      variant="outline"
      spacing={0}
      value={[lang]}
      onValueChange={(value) => {
        // Pressing the language already on leaves the group empty; keep it on.
        const next = LANGS.find((option) => option !== lang && value.includes(option));
        if (next) setLang(next);
      }}
      aria-label={t('Names in')}
    >
      {LANGS.map((option) => (
        <ToggleGroupItem
          key={option}
          value={option}
          aria-label={LANG_LABELS[option].name}
          title={t('Names in {language}', {
            language: LANG_LABELS[option].name.split(', ')[1] ?? '',
          })}
          lang={option}
          className="px-3 font-semibold"
        >
          {LANG_LABELS[option].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import { setUnits, useStore } from '../store.ts';
import { t } from '../i18n.ts';
import { type Units, UNITS } from '../units.ts';

const UNIT_LABELS: Record<Units, { label: string; name: string }> = {
  metric: { label: 'km', name: 'Kilometres and metres' },
  imperial: { label: 'mi', name: 'Miles and feet' },
};

/** Metric or imperial: every distance, height, pace and speed on the site follows it. */
export const UnitsSwitch = ({ className }: { className?: string }) => {
  const units = useStore((state) => state.units);
  return (
    <ToggleGroup
      className={className}
      variant="outline"
      spacing={0}
      value={[units]}
      onValueChange={(value) => {
        // Pressing the units already on leaves the group empty; keep them on.
        const next = UNITS.find((option) => option !== units && value.includes(option));
        if (next) setUnits(next);
      }}
      aria-label={t('Units')}
    >
      {UNITS.map((option) => (
        <ToggleGroupItem
          key={option}
          value={option}
          aria-label={t(UNIT_LABELS[option].name)}
          title={t(UNIT_LABELS[option].name)}
          className="px-3 font-semibold"
        >
          {UNIT_LABELS[option].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

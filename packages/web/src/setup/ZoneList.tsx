import { lazy, Suspense, useState } from 'react';

import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { t } from '../i18n.ts';
import { heightText } from '../format.ts';

const ZonePicker = lazy(() => import('./ZonePicker.tsx'));

/** A zone as the page knows it: stored ones have no position here, only a label and a radius. */
export interface ListedZone {
  label: string;
  radiusM: number;
  lat?: number;
  lon?: number;
  /** Set for a zone already in the file: the server fills its position back in. */
  keep?: boolean;
}

/**
 * The zone editor of full setup: stored zones are listed by label and can be removed; a new one is
 * placed on the map. Positions of stored zones never reach the page.
 */
export const ZoneList = ({
  zones,
  mapStyle,
  onChange,
}: {
  zones: ListedZone[];
  mapStyle: string;
  onChange: (zones: ListedZone[]) => void;
}) => {
  const [label, setLabel] = useState('');
  const [centre, setCentre] = useState<{ lat: number; lon: number } | null>(null);
  const [radius, setRadius] = useState(500);
  const listed = zones.map((zone) =>
    zone.lat === undefined && zone.keep === undefined ? { ...zone, keep: true } : zone,
  );
  const taken = listed.some((zone) => zone.label === label.trim());
  return (
    <div className="flex flex-col gap-3">
      {listed.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('No privacy zones yet.')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border">
          {listed.map((zone) => (
            <li key={zone.label} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-semibold">{zone.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {heightText(zone.radiusM)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(listed.filter((item) => item.label !== zone.label))}
              >
                {t('Remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
        <p className="text-compact font-semibold">{t('Add a zone')}</p>
        <Input
          aria-label={t('Label, for example home')}
          placeholder={t('Label, for example home')}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Suspense
          fallback={<p className="text-xs text-muted-foreground">{t('Loading the map…')}</p>}
        >
          <ZonePicker
            mapStyle={mapStyle}
            centre={centre}
            radiusM={radius}
            onCentre={setCentre}
            onRadius={setRadius}
          />
        </Suspense>
        <Button
          variant="outline"
          className="self-start"
          disabled={!centre || label.trim() === '' || taken}
          onClick={() => {
            if (!centre) return;
            onChange([...listed, { label: label.trim(), ...centre, radiusM: radius }]);
            setLabel('');
            setCentre(null);
          }}
        >
          {t('Add this zone')}
        </Button>
        {taken && <p className="text-xs text-destructive">{t('A zone has that label already.')}</p>}
      </div>
    </div>
  );
};

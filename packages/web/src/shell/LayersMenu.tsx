import { LayersIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../components/ui/button.tsx';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '../components/ui/drawer.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx';
import { useIsMobile } from '../hooks/use-mobile.ts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.tsx';
import { Switch } from '../components/ui/switch.tsx';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group.tsx';
import type { Data } from '../data.ts';
import { cn } from '../lib/utils.ts';
import { type Layers, type PrefectureFill, setLayer, type TrackStyle, useStore } from '../store.ts';
import { LangSwitch } from './LangSwitch.tsx';
import { UnitsSwitch } from './UnitsSwitch.tsx';
import { roughly } from '../format.ts';
import { localized, t } from '../i18n.ts';

const TRACK_STYLES: TrackStyle[] = ['type', 'heat'];

const FILLS: { value: PrefectureFill; label: string }[] = localized([
  { value: 'status', label: 'Visited or not' },
  { value: 'activities', label: 'Number of activities' },
  { value: 'days', label: 'Days out' },
  { value: 'distance', label: 'Distance' },
  { value: 'gain', label: 'Climb' },
]);

const Section = ({
  title,
  className,
  children,
}: {
  title: ReactNode;
  className?: string;
  children: ReactNode;
}) => (
  <section className={cn('flex flex-col gap-1 py-3 first:pt-1 last:pb-1', className)}>
    <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">
      {typeof title === 'string' ? t(title) : title}
    </h2>
    {children}
  </section>
);

const LayerSwitch = ({
  layer,
  label,
  hint,
}: {
  layer: keyof Layers;
  label: string;
  hint?: ReactNode;
}) => {
  const on = useStore((state) => state.layers[layer]);
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-1 hover:bg-muted">
      <span className="flex flex-col">
        <span>{t(label)}</span>
        {hint && (
          <span className="text-xs text-muted-foreground">
            {typeof hint === 'string' ? t(hint) : hint}
          </span>
        )}
      </span>
      <Switch checked={on} onCheckedChange={(checked) => setLayer(layer, checked)} />
    </label>
  );
};

/** What is on the map and how prefectures are coloured. What the colours mean is in the map key. */
export const LayersMenu = ({ data }: { data: Data }) => {
  const mobile = useIsMobile();
  const trigger = (
    <Button variant="cloth" size="lg" className="max-md:px-2.5 md:ml-auto" aria-label={t('Layers')}>
      <LayersIcon />
      <span className="hidden md:inline">{t('Layers')}</span>
    </Button>
  );
  // Phones: a sheet from the bottom, as tall as it needs.
  if (mobile)
    return (
      <Drawer>
        <DrawerTrigger render={trigger} />
        <DrawerContent aria-label={t('Map layers')}>
          <DrawerHeader className="pb-1">
            <DrawerTitle>{t('Layers')}</DrawerTitle>
          </DrawerHeader>
          <div className="divide-y overflow-y-auto px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <LayersContent data={data} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  return (
    <Popover>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="end"
        // Taller than the space below: scroll, rather than move beside the button.
        collisionAvoidance={{ fallbackAxisSide: 'none' }}
        aria-label={t('Map layers')}
        className="max-h-(--available-height) w-[min(340px,calc(100vw-16px))] gap-0 divide-y overflow-y-auto p-2"
      >
        <LayersContent data={data} />
      </PopoverContent>
    </Popover>
  );
};

const LayersContent = ({ data }: { data: Data }) => {
  const layers = useStore((state) => state.layers);
  const fill = useStore((state) => state.prefectureFill);
  const trackStyle = useStore((state) => state.trackStyle);
  const list = useStore((state) => data.listById.get(state.list));
  const terrain = Boolean(data.meta.map.terrain);
  return (
    <>
      {/* On a phone the top bar has no room for the language switch, so it lives here. */}
      <Section title="Names in" className="md:hidden">
        <LangSwitch className="px-2" />
      </Section>
      <Section title="Units" className="md:hidden">
        <UnitsSwitch className="px-2" />
      </Section>
      <Section title="On the map">
        {list?.kind === 'point' && (
          <LayerSwitch layer="places" label="List places" hint="Pins for the active list" />
        )}
        <LayerSwitch layer="tracks" label="My tracks" hint="Every published activity" />
        {layers.tracks && (
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            className="mx-2 mb-1"
            aria-label={t('Draw tracks')}
            value={[trackStyle]}
            onValueChange={(value) => {
              const next = TRACK_STYLES.find(
                (style) => style !== trackStyle && value.includes(style),
              );
              if (next) useStore.setState({ trackStyle: next });
            }}
          >
            <ToggleGroupItem value="type">{t('By type')}</ToggleGroupItem>
            <ToggleGroupItem value="heat">{t('Heatmap')}</ToggleGroupItem>
          </ToggleGroup>
        )}
        <LayerSwitch layer="routes" label="My routes" hint="Routes done more than once" />
        <LayerSwitch layer="prefectures" label="Prefectures" />
        <LayerSwitch
          layer="tiles"
          label="Explorer tiles"
          hint={
            <>{t('Squares of about {size} a track has passed through', { size: roughly(2000) })}</>
          }
        />
        {terrain && <LayerSwitch layer="hillshade" label="Hillshade" />}
        {terrain && <LayerSwitch layer="relief" label="3D relief" hint="Tilts the map" />}
      </Section>

      {layers.prefectures && (
        <Section title="Colour prefectures by">
          <Select
            items={FILLS}
            value={fill}
            onValueChange={(value: PrefectureFill | null) =>
              value && useStore.setState({ prefectureFill: value })
            }
          >
            <SelectTrigger className="mx-2 mb-1" aria-label={t('Colour prefectures by')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="w-auto min-w-(--anchor-width) whitespace-nowrap">
              {FILLS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      )}
    </>
  );
};

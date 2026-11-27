// MapLibre looks for its worker beside its own file, which bundling moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature } from 'geojson';
import { useMemo, useRef, useState } from 'react';
import { Layer, Map as MapGL, type MapRef, Source } from 'react-map-gl/maplibre';

import { Button } from '../components/ui/button.tsx';
import { Input } from '../components/ui/input.tsx';
import { Slider } from '../components/ui/slider.tsx';
import { heightText } from '../format.ts';
import { mapLocale, t } from '../i18n.ts';
import { statusHex, WHITE } from '../map/palette.ts';

// MapLibre cannot read CSS tokens: the zone is drawn in the palette's own grey.
const ZONE_COLOR = statusHex(false).none;

interface Centre {
  lat: number;
  lon: number;
}

const circle = (centre: Centre, radiusM: number) => {
  const ring: [number, number][] = [];
  const latDegrees = radiusM / 111_320;
  const lonDegrees = latDegrees / Math.cos((centre.lat * Math.PI) / 180);
  for (let step = 0; step <= 64; step++) {
    const angle = (step / 64) * 2 * Math.PI;
    ring.push([
      centre.lon + lonDegrees * Math.cos(angle),
      centre.lat + latDegrees * Math.sin(angle),
    ]);
  }
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [ring] },
  };
};

/**
 * A privacy zone placed by hand: a click sets the centre, the slider the radius. The position lives
 * in the page's memory only (props and state): nothing is written to the browser's storage, and no
 * address is looked up.
 */
const ZonePicker = ({
  mapStyle,
  centre,
  radiusM,
  onCentre,
  onRadius,
}: {
  mapStyle: string;
  centre: Centre | null;
  radiusM: number;
  onCentre: (centre: Centre | null) => void;
  onRadius: (radiusM: number) => void;
}) => {
  const shape = useMemo(() => (centre ? circle(centre, radiusM) : null), [centre, radiusM]);
  // The centre as a dot of its own: zoomed out, a zone a few hundred metres wide is under a pixel.
  const dot = useMemo<Feature | null>(
    () =>
      centre
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: [centre.lon, centre.lat] },
          }
        : null,
    [centre],
  );
  const map = useRef<MapRef>(null);
  // The same place as text, for pasting from a map app, and for a browser that cannot draw the map.
  const [typed, setTyped] = useState<string>();
  const text = typed ?? (centre ? `${centre.lat}, ${centre.lon}` : '');
  const take = (value: string) => {
    setTyped(value);
    const match = /^\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)\s*$/.exec(value);
    const [lat, lon] = match ? [Number(match[1]), Number(match[2])] : [Number.NaN, Number.NaN];
    if (lat >= 20 && lat <= 46 && lon >= 122 && lon <= 154) {
      onCentre({ lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) });
      setTyped(undefined);
      // A typed place is shown: the map goes there, close enough to see the zone.
      const view = map.current?.getMap();
      view?.flyTo({ center: [lon, lat], zoom: Math.max(view.getZoom(), 13) });
    } else if (value.trim() === '') onCentre(null);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="h-80 overflow-hidden rounded-lg border">
        <MapGL
          ref={map}
          workerUrl={workerUrl}
          locale={mapLocale()}
          mapStyle={mapStyle}
          initialViewState={{ longitude: 138, latitude: 37.5, zoom: 4.2 }}
          minZoom={3}
          maxZoom={18}
          cursor="crosshair"
          onClick={(event) => {
            setTyped(undefined);
            onCentre({
              lat: Number(event.lngLat.lat.toFixed(5)),
              lon: Number(event.lngLat.lng.toFixed(5)),
            });
          }}
        >
          {shape && (
            <Source id="zone" type="geojson" data={shape}>
              <Layer
                id="zone-fill"
                type="fill"
                paint={{ 'fill-color': ZONE_COLOR, 'fill-opacity': 0.35 }}
              />
              <Layer
                id="zone-edge"
                type="line"
                paint={{ 'line-color': ZONE_COLOR, 'line-width': 2 }}
              />
            </Source>
          )}
          {dot && (
            <Source id="zone-centre" type="geojson" data={dot}>
              <Layer
                id="zone-centre"
                type="circle"
                paint={{
                  'circle-radius': 5,
                  'circle-color': ZONE_COLOR,
                  'circle-stroke-color': WHITE,
                  'circle-stroke-width': 2,
                }}
              />
            </Source>
          )}
        </MapGL>
      </div>
      <Input
        aria-label={t('Or type the place: latitude, longitude')}
        placeholder={t('Or type the place: latitude, longitude')}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(event) => take(event.target.value)}
      />
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-compact">{t('Radius')}</span>
        <Slider
          min={100}
          max={2000}
          step={50}
          value={[radiusM]}
          onValueChange={(next) => onRadius(Array.isArray(next) ? (next[0] ?? radiusM) : next)}
          getAriaLabel={() => t('Radius')}
        />
        <span className="w-16 shrink-0 text-right text-compact tabular-nums">
          {heightText(radiusM)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {centre
          ? t(
              'Tracks are cut within about {distance} of the point you clicked. The centre is moved at random before it is used, so the cut does not point at your door.',
              { distance: heightText(radiusM) },
            )
          : t('No place chosen yet. Zoom in and click the map.')}
      </p>
      {centre && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setTyped(undefined);
            onCentre(null);
          }}
        >
          {t('Clear the place')}
        </Button>
      )}
    </div>
  );
};

export default ZonePicker;

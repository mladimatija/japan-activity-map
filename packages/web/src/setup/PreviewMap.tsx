// MapLibre looks for its worker beside its own file, which bundling moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useMemo } from 'react';
import { Layer, Map as MapGL, Source } from 'react-map-gl/maplibre';

import { mapLocale } from '../i18n.ts';
import { mapColors } from '../map/palette.ts';
import type { PreviewTracks } from './api.ts';

const TRACK_COLOR = mapColors(false).accent;

/** Every number pair in the tracks, to frame the map on them. */
const boundsOf = (tracks: PreviewTracks): [[number, number], [number, number]] | undefined => {
  let box: [number, number, number, number] | undefined;
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    const [lon, lat] = value as unknown[];
    if (typeof lon === 'number' && typeof lat === 'number')
      box = box
        ? [
            Math.min(box[0], lon),
            Math.min(box[1], lat),
            Math.max(box[2], lon),
            Math.max(box[3], lat),
          ]
        : [lon, lat, lon, lat];
    else for (const item of value) walk(item);
  };
  for (const feature of tracks.features) walk(feature.geometry.coordinates);
  return box
    ? [
        [box[0], box[1]],
        [box[2], box[3]],
      ]
    : undefined;
};

/**
 * The tracks as they would be published, cut at the privacy zones: where a line stops short is
 * where a zone begins. The zones themselves are not drawn, and nothing here leaves this machine
 * (the base map's tiles are asked for, as on any map).
 */
const PreviewMap = ({ mapStyle, tracks }: { mapStyle: string; tracks: PreviewTracks }) => {
  const bounds = useMemo(() => boundsOf(tracks), [tracks]);
  return (
    <div className="h-80 overflow-hidden rounded-lg border">
      <MapGL
        workerUrl={workerUrl}
        locale={mapLocale()}
        mapStyle={mapStyle}
        initialViewState={
          bounds
            ? { bounds, fitBoundsOptions: { padding: 24 } }
            : { longitude: 138, latitude: 37.5, zoom: 4.2 }
        }
        minZoom={3}
        maxZoom={18}
      >
        <Source id="preview" type="geojson" data={tracks as never}>
          <Layer
            id="preview-lines"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{ 'line-color': TRACK_COLOR, 'line-width': 2.5, 'line-opacity': 0.8 }}
          />
        </Source>
      </MapGL>
    </div>
  );
};

export default PreviewMap;

// The map's own layers, a group per kind of thing drawn. Each group is a component only so the
// map itself stays readable: they hold no state, and their order here is the order on the map.
import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification } from 'maplibre-gl';
import { Layer, Source } from 'react-map-gl/maplibre';

import { graticule } from './graticule.ts';

import type { ReferenceRouteFile } from '../data.ts';
import { tracksByYear } from '../lazy.ts';
import type { State } from '../store.ts';
import { MASK_ID, type useBaseStyle } from './baseStyle.ts';
import { EMPTY } from './useMapSources.ts';
import {
  BLACK,
  type mapColors,
  NEAR_BLACK,
  REFERENCE_LINE_COLOR,
  type statusHex,
  TYPE_COLORS,
  UNKNOWN_TYPE_COLOR,
  WHITE,
} from './palette.ts';

export const visible = (on: boolean) => (on ? 'visible' : 'none');

export const CLUSTER_RADIUS = [
  'interpolate',
  ['linear'],
  ['get', 'point_count'],
  2,
  14,
  50,
  26,
] as unknown as ExpressionSpecification;

export const typeColor: ExpressionSpecification = [
  'match',
  ['get', 'type'],
  ...Object.entries(TYPE_COLORS).flat(),
  UNKNOWN_TYPE_COLOR,
] as unknown as ExpressionSpecification;

export const selected = (on: number | string, off: number | string): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  on,
  off,
];

/** A prefecture fill opacity, stronger for the selected and the hovered one. */
export const emphasis = (base: number): ExpressionSpecification => [
  'case',
  ['boolean', ['feature-state', 'selected'], false],
  Math.min(1, base * 2),
  ['boolean', ['feature-state', 'hover'], false],
  Math.min(1, base * 1.5),
  base,
];

/** Prefectures: the filled shapes, explorer tiles, the selected one in detail, and borders from the base map. */
export const PrefectureLayers = ({
  base,
  borders,
  detailed,
  fill,
  ink,
  layers,
  outline,
  prefectureColor,
  prefectures,
  status,
  tiles,
}: {
  base: NonNullable<ReturnType<typeof useBaseStyle>>;
  borders: NonNullable<ReturnType<typeof useBaseStyle>>['borders'];
  detailed: boolean;
  fill: State['prefectureFill'];
  ink: ReturnType<typeof mapColors>;
  layers: State['layers'];
  outline: FeatureCollection;
  prefectureColor: ExpressionSpecification;
  prefectures: FeatureCollection;
  status: ReturnType<typeof statusHex>;
  tiles: FeatureCollection;
}) => (
  <>
    <Source id="prefectures" type="geojson" data={prefectures} promoteId="code">
      <Layer
        id="prefectures-fill"
        // Under the base map's water and labels, so the coast and place names stay crisp.
        beforeId={base.water}
        type="fill"
        layout={{ visibility: visible(layers.prefectures) }}
        paint={{
          'fill-color': prefectureColor,
          // Strong enough to read across Japan, gone by the zoom where its simplified shape
          // would no longer match the base map. It sits under the base map's water, so the
          // coast is always the map's own.
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            emphasis(fill === 'status' ? 0.2 : 0.5),
            8,
            emphasis(fill === 'status' ? 0.1 : 0.25),
            10,
            // The selected one keeps a tint closer in, so a small prefecture still shows.
            selected(fill === 'status' ? 0.12 : 0.2, 0),
          ],
        }}
      />
      <Layer
        id="prefectures-line"
        beforeId={base.labels}
        type="line"
        layout={{ visibility: visible(layers.prefectures) }}
        paint={{
          'line-color': selected(ink.strong, ink.line),
          'line-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            3,
            ['boolean', ['feature-state', 'hover'], false],
            2,
            0.6,
          ],
          // The simplified outline, only while zoomed out; closer in, the tiles' own lines. The
          // selected one stays outlined at every zoom: zooming to it must not hide it.
          'line-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            6,
            selected(1, 0.7),
            7.5,
            selected(1, 0),
          ],
        }}
      />
    </Source>
    {/* Explorer tiles: a wash on each ticked square, and the largest filled square outlined. */}
    <Source id="tiles" type="geojson" data={tiles}>
      <Layer
        id="tiles-fill"
        beforeId={base.labels}
        type="fill"
        filter={['==', ['get', 'part'], 'tile']}
        paint={{
          'fill-color': status.done,
          'fill-opacity': 0.22,
          'fill-outline-color': ink.halo,
        }}
      />
      <Layer
        id="tiles-square"
        beforeId={base.labels}
        type="line"
        filter={['==', ['get', 'part'], 'square']}
        paint={{ 'line-color': ink.strong, 'line-width': 2.5 }}
      />
    </Source>
    {/* The selected prefecture in detail, lit as the simplified one would be (see `selected`).
        Its land borders are outlined at every zoom. Its coast is outlined only while zoomed
        out, and the tint fades closer in, where its coastline and the base map's (from other
        surveys) part by a few metres: there the base map's own coast shows the edge. */}
    <Source id="prefecture-outline" type="geojson" data={outline}>
      <Layer
        id="prefecture-outline-fill"
        beforeId={base.water}
        type="fill"
        filter={['!=', ['get', 'part'], 'border']}
        layout={{ visibility: visible(layers.prefectures) }}
        paint={{
          'fill-color': prefectureColor,
          'fill-opacity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            5,
            Math.min(1, (fill === 'status' ? 0.2 : 0.5) * 2),
            8,
            Math.min(1, (fill === 'status' ? 0.1 : 0.25) * 2),
            10,
            fill === 'status' ? 0.12 : 0.2,
            13,
            fill === 'status' ? 0.12 : 0.2,
            14.5,
            0,
          ],
        }}
      />
      <Layer
        id="prefecture-outline-coast"
        beforeId={base.labels}
        type="line"
        filter={['!=', ['get', 'part'], 'border']}
        layout={{ visibility: visible(layers.prefectures), 'line-join': 'round' }}
        paint={{
          'line-color': ink.strong,
          'line-width': 3,
          'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 1, 11.5, 0],
        }}
      />
      <Layer
        id="prefecture-outline-line"
        beforeId={base.labels}
        type="line"
        filter={['==', ['get', 'part'], 'border']}
        layout={{
          visibility: visible(layers.prefectures),
          'line-join': 'round',
          'line-cap': 'round',
        }}
        paint={{ 'line-color': ink.strong, 'line-width': 3 }}
      />
    </Source>
    {/* Closer in, prefecture borders and the coast come from the base map's own tiles, so they
        sit exactly on its drawing: its boundary lines between prefectures, and the edge of its
        sea, the coastline. Under the mask, like the rest of the base map, so foreign coasts stay hidden. */}
    {borders &&
      (
        [
          [
            'prefectures-border',
            'boundary',
            // Maritime stretches included: where a border runs on across a bay or strait.
            ['==', ['to-number', ['get', 'admin_level']], 4],
          ],
          ['prefectures-coast', 'water', ['==', ['get', 'class'], 'ocean']],
        ] as const
      ).map(([id, sourceLayer, filter]) => (
        <Layer
          key={id}
          id={id}
          // Under the mask, like the rest of the base map, so foreign borders and coasts stay hidden.
          beforeId={MASK_ID}
          type="line"
          source={borders}
          source-layer={sourceLayer}
          minzoom={6}
          filter={filter as unknown as ExpressionSpecification}
          layout={{ visibility: visible(layers.prefectures), 'line-join': 'round' }}
          paint={{
            'line-color': ink.line,
            'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 12, 2],
            // With a prefecture selected in detail, its border is drawn from the same survey as
            // its outline; the base map's (another survey, metres apart) steps back close in,
            // where the two would show as two lines.
            'line-opacity':
              detailed && id === 'prefectures-border'
                ? ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 0.8, 11, 0.8, 12, 0]
                : ['interpolate', ['linear'], ['zoom'], 6, 0, 7.5, 0.8],
          }}
        />
      ))}
  </>
);

/** The activity tracks, a source per year so each arrives on its own. */
export const TrackLayers = ({
  ink,
  layers,
  trackFilter,
  trackStyle,
  years,
}: {
  ink: ReturnType<typeof mapColors>;
  layers: State['layers'];
  trackFilter: ExpressionSpecification;
  trackStyle: State['trackStyle'];
  years: number[];
}) => (
  <>
    {years.map((year) => (
      <Source
        key={year}
        id={`tracks-${year}`}
        type="geojson"
        data={(tracksByYear.get(year) as unknown as FeatureCollection | undefined) ?? EMPTY}
        promoteId="id"
      >
        <Layer
          id={`tracks-${year}`}
          type="line"
          layout={{
            visibility: visible(layers.tracks),
            'line-join': 'round',
            'line-cap': 'round',
          }}
          filter={
            trackStyle === 'heat'
              ? (['all', trackFilter, ['==', ['get', 'heatmap'], true]] as ExpressionSpecification)
              : trackFilter
          }
          paint={
            trackStyle === 'heat'
              ? {
                  // Faint alone, brighter where paths repeat.
                  'line-color': ink.heat,
                  'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2, 14, 3.5],
                  'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.22],
                  'line-blur': 0.6,
                }
              : {
                  'line-color': typeColor,
                  'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 4, 1.6],
                  'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.65],
                }
          }
        />
      </Source>
    ))}
  </>
);

/** Repeated routes, and the reference route of the open list with what has been covered. */
export const RouteLayers = ({
  covered,
  ink,
  layers,
  reference,
  routes,
  status,
  font,
}: {
  covered: FeatureCollection;
  ink: ReturnType<typeof mapColors>;
  layers: State['layers'];
  reference: ReferenceRouteFile | undefined;
  routes: FeatureCollection;
  status: ReturnType<typeof statusHex>;
  font: { 'text-font'?: string[] };
}) => (
  <>
    <Source id="routes" type="geojson" data={routes} promoteId="id">
      <Layer
        id="routes-line"
        type="line"
        layout={{
          visibility: visible(layers.routes),
          'line-join': 'round',
          'line-cap': 'round',
        }}
        paint={{
          'line-color': typeColor,
          'line-width': ['interpolate', ['linear'], ['get', 'count'], 2, 2.5, 20, 9],
          'line-opacity': 0.75,
        }}
      />
      <Layer
        id="routes-count"
        type="symbol"
        layout={{
          visibility: visible(layers.routes),
          'symbol-placement': 'line',
          'text-field': ['concat', ['to-string', ['get', 'count']], '×'],
          'text-size': 12,
          ...font,
        }}
        paint={{
          'text-color': ink.text,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.5,
        }}
      />
    </Source>

    <Source
      id="reference"
      type="geojson"
      data={(reference as unknown as FeatureCollection | undefined) ?? EMPTY}
      promoteId="id"
    >
      <Layer
        id="reference-line"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{
          'line-color': REFERENCE_LINE_COLOR,
          'line-width': selected(6, 3),
          'line-dasharray': [2, 1.5],
          'line-opacity': selected(1, 0.8),
        }}
      />
    </Source>
    <Source id="reference-covered" type="geojson" data={covered} promoteId="id">
      <Layer
        id="reference-covered"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{ 'line-color': status.done, 'line-width': 4.5 }}
      />
    </Source>
  </>
);

/** The selected activity or route, and the point its profile is at. */
export const SelectionLayers = ({
  ink,
  shape,
}: {
  ink: ReturnType<typeof mapColors>;
  shape: FeatureCollection;
}) => (
  <>
    {/* The selected activity or route, over everything but the pins, whatever layers are on. */}
    <Source id="selection" type="geojson" data={shape}>
      <Layer
        id="selection-casing"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{ 'line-color': ink.halo, 'line-width': 8, 'line-opacity': 0.9 }}
      />
      <Layer
        id="selection-line"
        type="line"
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{ 'line-color': typeColor, 'line-width': 4.5 }}
      />
    </Source>

    {/* The point or part of the open activity that its profile, splits or the pointer is at. */}
    <Source id="track-cursor" type="geojson" data={EMPTY}>
      <Layer
        id="track-cursor-part"
        type="line"
        filter={['==', ['geometry-type'], 'LineString']}
        layout={{ 'line-join': 'round', 'line-cap': 'round' }}
        paint={{ 'line-color': ink.strong, 'line-width': 5 }}
      />
      <Layer
        id="track-cursor-point"
        type="circle"
        filter={['==', ['geometry-type'], 'Point']}
        paint={{
          'circle-radius': 6,
          'circle-color': typeColor,
          'circle-stroke-color': ink.halo,
          'circle-stroke-width': 2.5,
        }}
      />
    </Source>
  </>
);

const GRATICULE = graticule();

/**
 * The graticule, over the sea and land and under place names: main lines always, the odd degrees
 * from zoom 7, each with its figure along it.
 */
export const GraticuleLayers = ({
  color,
  halo,
  font,
  before,
}: {
  color: string;
  halo: string;
  font: { 'text-font'?: string[] };
  before?: string;
}) => (
  <Source id="graticule" type="geojson" data={GRATICULE}>
    <Layer
      id="graticule-main"
      type="line"
      beforeId={before}
      filter={['==', ['get', 'major'], true]}
      paint={{ 'line-color': color, 'line-width': 0.6, 'line-opacity': 0.55 }}
    />
    <Layer
      id="graticule-fine"
      type="line"
      beforeId={before}
      minzoom={7}
      filter={['==', ['get', 'major'], false]}
      paint={{ 'line-color': color, 'line-width': 0.5, 'line-opacity': 0.4 }}
    />
    <Layer
      id="graticule-figures"
      type="symbol"
      beforeId={before}
      filter={['==', ['get', 'major'], true]}
      layout={{
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'text-field': ['get', 'label'],
        'text-size': 10,
        'text-offset': [0, -0.7],
        ...font,
      }}
      paint={{ 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1 }}
    />
  </Source>
);

/** The list's places: clusters, pins and labels. */
export const PlaceLayers = ({
  ink,
  layers,
  places,
  status,
  font,
}: {
  ink: ReturnType<typeof mapColors>;
  layers: State['layers'];
  places: FeatureCollection;
  status: ReturnType<typeof statusHex>;
  font: { 'text-font'?: string[] };
}) => (
  <>
    <Source
      id="places"
      type="geojson"
      data={places}
      promoteId="id"
      cluster
      // Tight clusters: most pins stay visible at the national view, so rows can light them.
      clusterRadius={18}
      clusterMaxZoom={6}
      clusterProperties={{ done: ['+', ['get', 'done']] }}
    >
      <Layer
        id="places-cluster"
        type="circle"
        filter={['has', 'point_count']}
        layout={{ visibility: visible(layers.places) }}
        paint={{
          'circle-color': ink.halo,
          'circle-radius': CLUSTER_RADIUS,
          'circle-stroke-color': status.none,
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.92,
        }}
      />
      {/* The share done, as a disc whose area matches it. */}
      <Layer
        id="places-cluster-done"
        type="circle"
        filter={['all', ['has', 'point_count'], ['>', ['get', 'done'], 0]]}
        layout={{ visibility: visible(layers.places) }}
        paint={{
          'circle-color': status.done,
          'circle-radius': [
            '*',
            CLUSTER_RADIUS,
            ['sqrt', ['/', ['get', 'done'], ['get', 'point_count']]],
          ] as unknown as ExpressionSpecification,
          'circle-opacity': 0.85,
        }}
      />
      <Layer
        id="places-cluster-count"
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          visibility: visible(layers.places),
          'text-field': ['to-string', ['get', 'point_count']],
          'text-size': 12,
          'text-allow-overlap': true,
          ...font,
        }}
        paint={{ 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.5 }}
      />
      <Layer
        id="places-halo"
        type="circle"
        filter={['!', ['has', 'point_count']]}
        layout={{ visibility: visible(layers.places) }}
        paint={{
          'circle-radius': 16,
          'circle-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ink.strong,
            ink.accent,
          ],
          'circle-opacity': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            0.22,
            ['boolean', ['feature-state', 'hover'], false],
            0.2,
            0,
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            2,
            ['boolean', ['feature-state', 'hover'], false],
            2,
            0,
          ],
          'circle-stroke-color': [
            'case',
            ['boolean', ['feature-state', 'selected'], false],
            ink.strong,
            ink.accent,
          ],
        }}
      />
      {/* A larger, invisible target than the pin itself: 44 px across, easy to tap. */}
      <Layer
        id="places-hit"
        type="circle"
        filter={['!', ['has', 'point_count']]}
        layout={{ visibility: visible(layers.places) }}
        paint={{ 'circle-radius': 22, 'circle-color': BLACK, 'circle-opacity': 0 }}
      />
      <Layer
        id="places-point"
        type="symbol"
        filter={['!', ['has', 'point_count']]}
        layout={{
          visibility: visible(layers.places),
          'icon-image': ['concat', 'status-', ['get', 'status']],
          // Bigger for places visited more often.
          'icon-size': ['interpolate', ['linear'], ['get', 'visits'], 0, 0.8, 1, 0.95, 5, 1.3],
          'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 9, ['get', 'name']],
          'text-size': 12,
          ...font,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        }}
        paint={{
          'text-color': ink.text,
          'text-halo-color': ink.halo,
          'text-halo-width': 1.5,
        }}
      />
      {/* A count badge on places visited more than once. */}
      <Layer
        id="places-count"
        type="symbol"
        filter={['all', ['!', ['has', 'point_count']], ['>', ['get', 'visits'], 1]]}
        layout={{
          visibility: visible(layers.places),
          'text-field': ['to-string', ['get', 'visits']],
          'text-size': 10,
          ...font,
          'text-offset': [0.95, -0.95],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        }}
        paint={{
          'text-color': WHITE,
          'text-halo-color': NEAR_BLACK,
          'text-halo-width': 2,
        }}
      />
    </Source>
  </>
);

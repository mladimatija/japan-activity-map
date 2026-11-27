import type { FeatureCollection } from 'geojson';
// MapLibre looks for its worker beside its own file, which bundling moves; point it at the real file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibre } from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapGL, {
  AttributionControl,
  Layer,
  type MapLayerMouseEvent,
  type MapRef,
  NavigationControl,
  ScaleControl,
  Source,
} from 'react-map-gl/maplibre';

import { cn } from '../lib/utils.ts';
import { Loading } from '../components/app.tsx';
import type { Data } from '../data.ts';
import { getHover, getPan, setHover, subscribeHover, subscribePan } from '../hover.ts';
import { referenceByList, useLoaded } from '../lazy.ts';
import { sheetHeight } from '../panel/Pane.tsx';
import { type Selection, select, useStore } from '../store.ts';
import { HoverTip, showTip } from './HoverTip.tsx';
import { useBaseStyle, useReveal } from './baseStyle.ts';
import { useViewport } from './viewport.ts';
import { useMapSources } from './useMapSources.ts';
import {
  PlaceLayers,
  PrefectureLayers,
  RouteLayers,
  SelectionLayers,
  TrackLayers,
  visible,
} from './MapLayers.tsx';
import { mapColors, STATUSES, statusHex, statusIcon } from './palette.ts';
import { mapLocale, t } from '../i18n.ts';
import { isMobile } from '../hooks/use-mobile.ts';
import {
  getTrackCursor,
  pathBetween,
  pointTrack,
  positionAt,
  releaseTrack,
  samplesOf,
  subscribeTrackCursor,
} from '../profile.ts';
import { clampPaneWidth, usePaneWidth } from '../prefs.ts';

/** Roughly the map's size: the window less the top bar, and less the pane on wide screens. */
const mapSize = () => ({
  width: Math.max(
    1,
    window.innerWidth - (isMobile() ? 0 : clampPaneWidth(usePaneWidth.getState().width)),
  ),
  height: Math.max(1, window.innerHeight - 56),
});

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latitudeOf = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;

/** Grows bounds (never shrinks them) on one axis until their shape on screen matches `aspect`. */
const matchAspect = (
  [west, south, east, north]: [number, number, number, number],
  aspect: number,
): [number, number, number, number] => {
  const width = ((east - west) * Math.PI) / 180;
  const y0 = mercatorY(south);
  const y1 = mercatorY(north);
  const height = y1 - y0;
  if (width / height > aspect) {
    const grow = (width / aspect - height) / 2;
    return [west, Math.max(-80, latitudeOf(y0 - grow)), east, Math.min(80, latitudeOf(y1 + grow))];
  }
  const grow = ((height * aspect - width) / 2) * (180 / Math.PI);
  return [Math.max(-180, west - grow), south, Math.min(180, east + grow), north];
};

/** The compact credits start folded: open, they cover part of a phone's map. */
export const collapseAttribution = (map: MapLibre): void => {
  const element = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
  element?.classList.remove('maplibregl-compact-show');
  element?.removeAttribute('open');
};

/** Room around what the camera frames: clear of the bottom sheet on phones. */
const cameraPadding = (stop: 'peek' | 'half') =>
  isMobile()
    ? { top: 24, bottom: sheetHeight(stop) + 16, left: 24, right: 24 }
    : { top: 48, bottom: 48, left: 48, right: 48 };

/** The first view on a phone: Kyushu to Hokkaido; Okinawa is a pan away. */
const MAIN_ISLANDS: LngLatBoundsLike = [
  [129.3, 30.9],
  [145.9, 45.6],
];

/** The first view: Japan from Yonaguni to Nemuro, with Okinawa and the Ogasawara islands. */
export const JAPAN: LngLatBoundsLike = [
  [122.9, 24.0],
  [146.0, 45.6],
];

/** Which source and feature id show the selection, for feature-state highlighting. */
const targetOf = (
  selection: Selection | null,
  data: Data,
): { source: string; id: string } | undefined => {
  if (!selection) return undefined;
  if (selection.kind === 'prefecture') return { source: 'prefectures', id: selection.code };
  if (selection.kind === 'item')
    return {
      source: data.listById.get(selection.list)?.kind === 'route' ? 'reference' : 'places',
      id: selection.id,
    };
  // Activities and routes are drawn by the selection overlay, so they show whatever layers are on.
  return undefined;
};

/** Pixels around a click or tap that still count as hitting a thin line. */
const HIT_PX = 6;
/** How near the open activity's track the pointer finds its place along the profile. */
const TRACK_PX = 16;

const LAYER_PRIORITY = [
  'places-point',
  'places-hit',
  'places-cluster',
  'routes-line',
  'reference-covered',
  'reference-line',
  'tracks',
  'prefectures-fill',
];

const rank = (layer: string) => {
  const index = LAYER_PRIORITY.indexOf(layer.replace(/-\d{4}$/, ''));
  return index === -1 ? LAYER_PRIORITY.length : index;
};

export const MapView = ({ data, dark }: { data: Data; dark: boolean }) => {
  const mapRef = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  // Hidden until the first complete frame: before then, the sea and land tiles arrive in patches.
  const { shown, style: revealStyle, reveal } = useReveal();
  // The base map's own failures (its style, glyphs or tiles): said once, quietly, since the
  // tracks and lists still work without it.
  const [mapProblem, setMapProblem] = useState(false);
  const mapErrors = useRef(0);
  // The base map's style, fetched and made ready for Japan before the map draws its first frame
  // (the mask in the style's own sea colour, foreign labels filtered out), so nothing flashes.
  const styleUrl =
    dark && data.meta.map.darkStyleUrl ? data.meta.map.darkStyleUrl : data.meta.map.styleUrl;
  const base = useBaseStyle(styleUrl, data.mask);
  // Labels use a font the base map's style serves; MapLibre's default font may not exist there.
  const font = base?.font ?? {};
  // The base map's vector source with its boundary lines, for prefecture borders drawn from the
  // tiles themselves when zoomed in.
  const borders = base?.borders;
  // The view lock follows the window's shape: widened on its short axis so a tall phone (or a
  // wide monitor) can still zoom out far enough to see all of Japan. The extra room is covered sea.
  const [viewport, setViewport] = useState(() => mapSize());
  useEffect(() => {
    const onResize = () => setViewport(mapSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const viewLock = useMemo(
    () => matchAspect(data.meta.map.bounds, viewport.width / Math.max(1, viewport.height)),
    [data, viewport],
  );
  const listId = useStore((state) => state.list);
  const selection = useStore((state) => state.selection);
  const layers = useStore((state) => state.layers);
  const units = useStore((state) => state.units);
  const fill = useStore((state) => state.prefectureFill);
  const loaded = useLoaded();
  const focus = useStore((state) => state.focus);
  const filters = useStore((state) => state.filters);
  const trackStyle = useStore((state) => state.trackStyle);
  const page = useStore((state) => state.page);
  const terrain = data.meta.map.terrain;
  // Label colours follow the base map: a dark style only when one is configured and asked for.
  const darkMap = dark && Boolean(data.meta.map.darkStyleUrl);
  const status = statusHex(darkMap);
  const ink = mapColors(darkMap);

  const {
    list,
    places,
    prefectures,
    routes,
    covered,
    reference,
    shape,
    tiles,
    outline,
    detailed,
    trackFilter,
    prefectureColor,
  } = useMapSources(data, status.done);
  const years = data.meta.trackYears;
  // Status markers are drawn once per style; a style change (light and dark) asks for them again.
  const addIcons = useCallback(
    (map: MapLibre) => {
      for (const each of STATUSES) {
        const name = `status-${each}`;
        if (!map.hasImage(name))
          map.addImage(name, statusIcon(each, 48, darkMap), { pixelRatio: 2 });
      }
    },
    [darkMap],
  );

  // Highlight through feature state: selecting never rebuilds a layer. A style change (light and
  // dark) recreates the sources and drops their state, so the current highlight is applied again.
  const target = useRef<{ source: string; id: string } | undefined>(undefined);
  const applyHighlight = useCallback((map: MapLibre, next: typeof target.current) => {
    const set = (where: typeof target.current, value: boolean) => {
      if (where && map.getSource(where.source)) map.setFeatureState(where, { selected: value });
    };
    set(target.current, false);
    set(next, true);
    target.current = next;
  }, []);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    // With the detailed outline drawn, the simplified shape is not lit as well.
    if (map && ready) applyHighlight(map, detailed ? undefined : targetOf(selection, data));
  }, [selection, data, ready, loaded, listId, applyHighlight, detailed]);

  // The item under the pointer, in the list or on the map, is lit on the map too (no re-render).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    // Rows of places light their pin; rows of activities light their track.
    const sourceOf = (id: string) => {
      const year = data.activityById.get(id)?.trackYear;
      return year === undefined ? 'places' : `tracks-${year}`;
    };
    let lit: string | null = null;
    const apply = () => {
      const next = getHover();
      for (const [id, on] of [
        [lit, false],
        [next, true],
      ] as const) {
        if (!id) continue;
        const source = sourceOf(id);
        if (map.getSource(source)) map.setFeatureState({ source, id }, { hover: on });
      }
      lit = next;
    };
    apply();
    return subscribeHover(apply);
  }, [ready, listId, filters, data, loaded]);

  // Stepping through the list with the arrow keys brings the item into view without opening it
  // (the map moves only when it is off screen).
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    return subscribePan(() => {
      const id = getPan();
      const at = id
        ? data.listById.get(listId)?.items.find((candidate) => candidate.id === id)?.at
        : undefined;
      if (at && !map.getBounds().contains(at))
        map.easeTo({ center: at, padding: cameraPadding('half') });
    });
  }, [ready, listId, data]);

  // The point (or part) of the open activity's track that its profile or splits point at.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    const draw = () => {
      const source = map.getSource('track-cursor') as GeoJSONSource | undefined;
      if (!source) return;
      const { id, d, range } = getTrackCursor();
      const activity = id ? data.activityById.get(id) : undefined;
      const samples = activity ? samplesOf(activity) : null;
      const features: FeatureCollection['features'] = [];
      if (activity && samples && range)
        features.push({
          type: 'Feature',
          properties: { type: activity.type },
          geometry: { type: 'LineString', coordinates: pathBetween(samples, range[0], range[1]) },
        });
      if (activity && samples && d !== null)
        features.push({
          type: 'Feature',
          properties: { type: activity.type },
          geometry: { type: 'Point', coordinates: positionAt(samples, d) },
        });
      void source.setData({ type: 'FeatureCollection', features });
    };
    draw();
    return subscribeTrackCursor(draw);
  }, [ready, data]);

  // The map stays mounted while a chart page is open; back on the map it takes its size again.
  useEffect(() => {
    if (page === 'map') mapRef.current?.getMap().resize();
  }, [page]);

  // Move the camera when the panel asks for it (map clicks select without moving). From a chart
  // page this waits until the map is shown again.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready || !focus || !selection || page !== 'map') return;
    map.resize();
    useStore.setState({ focus: false });
    // Keep the target clear of the sheet on phones (a detail opens it at half height). While the
    // map is still hidden (an address that opens a detail) it jumps there, so it shows sooner.
    const padding = cameraPadding('half');
    const animate = shown;
    if (selection.kind === 'item') {
      const item = data.listById
        .get(selection.list)
        ?.items.find((candidate) => candidate.id === selection.id);
      if (item?.at)
        map.flyTo({ center: item.at, zoom: Math.max(map.getZoom(), 11), padding, animate });
      else {
        const feature = referenceByList
          .get(selection.list)
          ?.features.find((candidate) => candidate.properties.id === selection.id);
        const box = feature ? boundsOf(feature.geometry.coordinates.flat()) : undefined;
        if (box) map.fitBounds(box, { padding, maxZoom: 14, animate });
      }
    } else if (selection.kind === 'activity') {
      const box = data.activityById.get(selection.id)?.bbox;
      if (box) map.fitBounds([box[0], box[1], box[2], box[3]], { padding, maxZoom: 15, animate });
    } else if (selection.kind === 'route') {
      const box = boundsOf(data.routeById.get(selection.id)?.line.flat() ?? []);
      if (box) map.fitBounds(box, { padding, maxZoom: 15, animate });
    } else {
      const geometry = data.prefectureByCode.get(selection.code)?.geometry;
      const points = geometry
        ? geometry.type === 'Polygon'
          ? geometry.coordinates.flat()
          : geometry.coordinates.flat(2)
        : [];
      const box = boundsOf(points);
      if (box) map.fitBounds(box, { padding, maxZoom: 10, animate });
    }
  }, [focus, selection, data, ready, page, shown]);

  // A page asked to show something on the map (the largest square of tiles): go there once.
  const fit = useStore((state) => state.fit);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready || !fit || page !== 'map') return;
    map.resize();
    useStore.setState({ fit: null });
    map.fitBounds(fit, { padding: cameraPadding('peek'), maxZoom: 13 });
  }, [fit, ready, page]);

  // 3D terrain only shows when the map is tilted: tilt when it is switched on, flatten when off.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready || !terrain) return;
    if (layers.relief && map.getPitch() < 10) map.easeTo({ pitch: 55, duration: 800 });
    if (!layers.relief && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
  }, [layers.relief, ready, terrain]);

  const interactive = [
    ...(layers.prefectures ? ['prefectures-fill'] : []),
    ...(layers.places && list?.kind === 'point'
      ? ['places-cluster', 'places-point', 'places-hit']
      : []),
    ...(list?.kind === 'route' ? ['reference-line', 'reference-covered'] : []),
    ...(layers.tracks ? years.map((year) => `tracks-${year}`) : []),
    ...(layers.routes ? ['routes-line'] : []),
  ];

  /** What is under a point, with a few pixels of slack so thin lines can be hit, best first. */
  const featuresAt = useCallback(
    (event: MapLayerMouseEvent) => {
      const map = mapRef.current?.getMap();
      if (!map) return [];
      const { x, y } = event.point;
      const available = interactive.filter((id) => map.getLayer(id));
      if (available.length === 0) return [];
      return map
        .queryRenderedFeatures(
          [
            [x - HIT_PX, y - HIT_PX],
            [x + HIT_PX, y + HIT_PX],
          ],
          { layers: available },
        )
        .sort((a, b) => rank(a.layer.id) - rank(b.layer.id));
    },
    // The list of layers is the only thing this depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [interactive.join(',')],
  );

  const onClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const feature = featuresAt(event)[0];
      if (!feature) {
        select(null);
        return;
      }
      const id = String(feature.properties.id ?? feature.properties.code ?? '');
      const layer = feature.layer.id;
      if (layer === 'places-cluster') {
        const source = mapRef.current?.getMap().getSource('places') as GeoJSONSource | undefined;
        void source?.getClusterExpansionZoom(Number(feature.properties.cluster_id)).then((zoom) => {
          mapRef.current?.getMap().easeTo({
            center:
              feature.geometry.type === 'Point'
                ? (feature.geometry.coordinates as [number, number])
                : undefined,
            zoom,
          });
        });
      } else if (
        layer === 'places-point' ||
        layer === 'places-hit' ||
        layer.startsWith('reference')
      )
        select({ kind: 'item', list: listId, id });
      else if (layer === 'routes-line') select({ kind: 'route', id });
      else if (layer.startsWith('tracks')) select({ kind: 'activity', id });
      else if (layer === 'prefectures-fill')
        select({ kind: 'prefecture', code: String(feature.properties.code) });
    },
    [listId, featuresAt],
  );

  // Near the open activity's track, the pointer finds its place along the profile: the nearest
  // point on the track, measured on screen.
  const pointAlongTrack = useCallback(
    (event: MapLayerMouseEvent) => {
      const map = mapRef.current?.getMap();
      const activity =
        selection?.kind === 'activity' ? data.activityById.get(selection.id) : undefined;
      const samples = activity ? samplesOf(activity) : null;
      if (!map || !activity || !samples) return;
      const { x, y } = event.point;
      const screen = samples.map((sample) => map.project([sample.lon, sample.lat]));
      let best = TRACK_PX ** 2;
      let found: number | undefined;
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i] as (typeof samples)[number];
        const b = samples[i + 1] as (typeof samples)[number];
        const p = screen[i] as { x: number; y: number };
        const q = screen[i + 1] as { x: number; y: number };
        if (a.stretch !== b.stretch) continue;
        const length = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
        const share =
          length > 0
            ? Math.max(0, Math.min(1, ((x - p.x) * (q.x - p.x) + (y - p.y) * (q.y - p.y)) / length))
            : 0;
        const distance =
          (p.x + (q.x - p.x) * share - x) ** 2 + (p.y + (q.y - p.y) * share - y) ** 2;
        if (distance < best) {
          best = distance;
          found = a.d + (b.d - a.d) * share;
        }
      }
      if (found === undefined) releaseTrack('map');
      else pointTrack(activity.id, found, 'map');
    },
    [selection, data],
  );

  // Hover outline on prefectures, and a pointer over anything clickable.
  const hovered = useRef<string | undefined>(undefined);
  const [cursor, setCursor] = useState('grab');
  const hover = useCallback((code: string | undefined) => {
    const map = mapRef.current?.getMap();
    if (!map || code === hovered.current) return;
    if (hovered.current && map.getSource('prefectures'))
      map.setFeatureState({ source: 'prefectures', id: hovered.current }, { hover: false });
    if (code) map.setFeatureState({ source: 'prefectures', id: code }, { hover: true });
    hovered.current = code;
  }, []);
  const onMove = useCallback(
    (event: MapLayerMouseEvent) => {
      const features = featuresAt(event);
      setCursor(
        features.some((feature) => feature.layer.id !== 'prefectures-fill') ? 'pointer' : 'grab',
      );
      const code = features.find((feature) => feature.layer.id === 'prefectures-fill')?.properties
        .code as string | undefined;
      hover(code);
      // A tooltip for the place or prefecture under the pointer, if that is what is on top.
      const top = features[0];
      const onPlace =
        (top?.layer.id === 'places-point' || top?.layer.id === 'places-hit') &&
        top.geometry.type === 'Point';
      setHover(onPlace ? String(top.properties.id) : null);
      if (onPlace)
        showTip({
          kind: 'place',
          list: listId,
          id: String(top.properties.id),
          at: (top.geometry as { coordinates: number[] }).coordinates as [number, number],
        });
      else if (top?.layer.id === 'prefectures-fill' && code)
        showTip({ kind: 'prefecture', code, at: [event.lngLat.lng, event.lngLat.lat] });
      else showTip(null);
      pointAlongTrack(event);
    },
    [featuresAt, hover, listId, pointAlongTrack],
  );

  // The base map and terrain credit themselves through their sources; the lists' and boundaries'
  // sources ask for longer wording, which is in the panel's Sources section.
  const credits = [`<a href="#" class="jam-sources">${t('List and boundary sources')}</a>`];
  if (!base)
    return (
      <div className="absolute inset-0" role="region" aria-label={t('Map of Japan')} aria-busy>
        <Loading className="absolute inset-0 justify-center text-sm">
          {t('Loading the map…')}
        </Loading>
      </div>
    );

  return (
    <div
      className={cn(
        'absolute inset-0',
        // MapLibre's own controls: rounded like the rest, and above the sheet on a phone.
        '[&_.maplibregl-ctrl-group]:rounded-md [&_.maplibregl-ctrl-group]:shadow-sm',
        'max-md:[&_.maplibregl-ctrl-bottom-right]:bottom-(--sheet-height) [&_.maplibregl-ctrl-bottom-right]:transition-[bottom] [&_.maplibregl-ctrl-bottom-right]:duration-250 motion-reduce:[&_.maplibregl-ctrl-bottom-right]:transition-none',
      )}
      // The sea colour shows until the map's first complete frame fades in over it.
      style={{ backgroundColor: base.sea }}
      role="region"
      aria-label={t('Map of Japan')}
      aria-busy={!shown}
    >
      {!shown && (
        // Said on the sea colour while the first frame is on its way, so the wait is not a blank.
        <Loading className="absolute inset-0 z-10 justify-center text-sm text-foreground/70">
          {t('Loading the map…')}
        </Loading>
      )}
      {mapProblem && (
        <p
          role="status"
          className="absolute top-3 left-1/2 z-10 w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-md bg-background/95 px-3 py-2 text-compact text-foreground shadow-sm ring-1 ring-foreground/10"
        >
          {t(
            'The base map did not load fully. Your tracks and lists still work; load the page again to retry.',
          )}
        </p>
      )}
      <MapGL
        workerUrl={workerUrl}
        onError={(event) => {
          console.warn(event.error);
          mapErrors.current += 1;
          // Before the first frame it is the style or a source; later, one lost tile is not news.
          if (!shown || mapErrors.current >= 8) setMapProblem(true);
        }}
        // Set when the map is made; a language switch later keeps MapLibre's own labels as they were.
        locale={mapLocale()}
        ref={mapRef}
        mapStyle={base.style}
        style={revealStyle}
        initialViewState={{
          bounds: isMobile() ? MAIN_ISLANDS : JAPAN,
          fitBoundsOptions: { padding: cameraPadding('peek') },
        }}
        // The view lock (maxBounds) is what stops zooming out; this only keeps the globe away.
        minZoom={2.5}
        maxZoom={18}
        // The view cannot be moved or zoomed out past Japan and its band of sea.
        maxBounds={viewLock}
        renderWorldCopies={false}
        attributionControl={false}
        interactiveLayerIds={interactive}
        cursor={cursor}
        onClick={onClick}
        onMouseMove={onMove}
        onMouseOut={() => {
          releaseTrack('map');
          hover(undefined);
          setCursor('grab');
          showTip(null);
          setHover(null);
        }}
        onMoveStart={() => showTip(null)}
        onMoveEnd={(event) => {
          const bounds = event.target.getBounds();
          useViewport.setState({
            bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          });
        }}
        onLoad={(event) => {
          const map = event.target;
          const bounds = map.getBounds();
          useViewport.setState({
            bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          });
          // For poking at the map from the browser console while developing.
          if (import.meta.env.DEV) Object.assign(window, { jamMap: map });
          addIcons(map);
          map.once('idle', () => collapseAttribution(map));
          reveal(map);
          map.on('styleimagemissing', () => addIcons(map));
          map.on('style.load', () => {
            addIcons(map);
            hovered.current = undefined;
            // The sources come back once the new style has loaded them.
            map.once('idle', () => {
              const current = target.current;
              target.current = undefined;
              applyHighlight(map, current);
            });
          });
          setReady(true);
        }}
        terrain={layers.relief && terrain ? { source: 'terrain', exaggeration: 1.3 } : undefined}
      >
        <NavigationControl position="top-right" />
        <ScaleControl position="bottom-right" unit={units} />
        <AttributionControl position="bottom-right" compact customAttribution={credits} />

        {/* Two sources from the same tiles: MapLibre works best with separate ones for 3D terrain
            and for hillshade. Their credit comes from the source and shows while they are in use. */}
        {terrain && <Source id="terrain" type="raster-dem" {...demSource(terrain)} />}
        {terrain && (
          <Source id="hillshade-dem" type="raster-dem" {...demSource(terrain)}>
            <Layer
              id="hillshade"
              // Under the base map's water, so the sea and lakes cover it: the elevation tiles
              // include the seabed, whose shading would show tile edges.
              beforeId={base.water}
              type="hillshade"
              layout={{ visibility: visible(layers.hillshade) }}
              paint={{
                'hillshade-exaggeration': 0.35,
                'hillshade-shadow-color': ink.hillshade.shadow,
                'hillshade-highlight-color': ink.hillshade.highlight,
                'hillshade-accent-color': ink.hillshade.accent,
              }}
            />
          </Source>
        )}

        <PrefectureLayers
          base={base}
          borders={borders}
          detailed={detailed}
          fill={fill}
          ink={ink}
          layers={layers}
          outline={outline}
          prefectureColor={prefectureColor}
          prefectures={prefectures}
          status={status}
          tiles={tiles}
        />

        <TrackLayers
          ink={ink}
          layers={layers}
          trackFilter={trackFilter}
          trackStyle={trackStyle}
          years={years}
        />

        <RouteLayers
          font={font}
          covered={covered}
          ink={ink}
          layers={layers}
          reference={reference}
          routes={routes}
          status={status}
        />

        <SelectionLayers ink={ink} shape={shape} />

        <PlaceLayers font={font} ink={ink} layers={layers} places={places} status={status} />
        <HoverTip data={data} />
      </MapGL>
    </div>
  );
};

/** Our layers that belong under the base map's labels, bottom first. */
/** The raster-dem source settings from meta.json. */
const demSource = (terrain: NonNullable<Data['meta']['map']['terrain']>) => ({
  ...(terrain.url ? { url: terrain.url } : {}),
  ...(terrain.tiles ? { tiles: terrain.tiles } : {}),
  encoding: terrain.encoding,
  tileSize: terrain.tileSize,
  ...(terrain.maxzoom ? { maxzoom: terrain.maxzoom } : {}),
  ...(terrain.attribution ? { attribution: terrain.attribution } : {}),
});

const boundsOf = (points: number[][]): [number, number, number, number] | undefined => {
  if (points.length === 0) return undefined;
  let box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of points) {
    if (lon === undefined || lat === undefined) continue;
    box = [
      Math.min(box[0], lon),
      Math.min(box[1], lat),
      Math.max(box[2], lon),
      Math.max(box[3], lat),
    ];
  }
  return Number.isFinite(box[0]) ? box : undefined;
};

import { WHITE } from './palette.ts';
import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  Map as MapLibre,
  StyleSpecification,
} from 'maplibre-gl';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Data } from '../data.ts';

/** The layer and source that cover everything outside Japan and its band of sea. */
export const MASK_ID = 'japan-mask';

/** A map shows by then even if its first frame never completes (tiles failing). */
const REVEAL_MS = 6000;

/**
 * Keeps a map hidden until its first complete frame and then fades it in, so the sea and land
 * tiles never show arriving in patches. Pass `reveal` the map once it has loaded; put `style` on
 * the map and the style's sea colour behind it.
 */
export const useReveal = (): {
  shown: boolean;
  style: CSSProperties;
  reveal: (map: MapLibre) => void;
} => {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reveal = useCallback((map: MapLibre) => {
    map.once('idle', () => setShown(true));
    timer.current = setTimeout(() => setShown(true), REVEAL_MS);
  }, []);
  return { shown, style: { opacity: shown ? 1 : 0, transition: 'opacity 250ms ease-out' }, reveal };
};

/** A base map style, made ready for the map's first frame, and what our layers need from it. */
export interface BaseStyle {
  style: StyleSpecification | string;
  /** Its first label layer: our layers that sit under place names go just before it. */
  labels?: string;
  /** Its first water fill: the hillshade and the prefecture colours go under the sea and lakes. */
  water?: string;
  /** A regular font its glyph server has, for our own labels. */
  font: { 'text-font'?: string[] };
  /** Its vector source with OpenMapTiles boundary lines, for drawing prefecture borders. */
  borders?: string;
  /** Its sea colour, which also covers everything outside Japan: what shows before the map. */
  sea?: string;
}

/** Japan and its band of sea: the holes in the mask, as one shape. */
export const japanArea = (mask: Data['mask']): GeoJSON.MultiPolygon => {
  const rings = mask.features[0]?.geometry.coordinates.slice(1) ?? [];
  return { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) };
};

const COLOUR = /^(#|rgb|hsl)/;

/** A colour from a paint value: as is, the last of an expression's colours, or a zoom stop's. */
const colourOf = (value: unknown): string | undefined => {
  if (typeof value === 'string') return COLOUR.test(value) ? value : undefined;
  const parts = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && 'stops' in value && Array.isArray(value.stops)
      ? value.stops.flat()
      : [];
  return parts
    .filter((part): part is string => typeof part === 'string' && COLOUR.test(part))
    .at(-1);
};

const isWater = (layer: LayerSpecification) =>
  layer.type === 'fill' && 'source-layer' in layer && layer['source-layer'] === 'water';

/** The regular weight of the fonts the style's labels use (the first is often an italic). */
const fontOf = (layers: LayerSpecification[]): BaseStyle['font'] => {
  const fonts = layers
    .map((layer) => (layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined))
    .filter(
      (value): value is string[] =>
        Array.isArray(value) && value.length > 0 && value.every((part) => typeof part === 'string'),
    );
  const chosen =
    fonts.find((value) => value.some((font) => /regular/i.test(font))) ??
    fonts.find((value) => !value.some((font) => /italic/i.test(font))) ??
    fonts[0];
  return chosen ? { 'text-font': chosen } : {};
};

/**
 * The base style as the map should first draw it, so nothing flashes and then changes: outside
 * Japan covered in the style's own sea colour, under its labels (a coastal name reaching out over
 * the sea is not cut off), and only the labels inside Japan's area kept, so foreign names never show.
 */
export const prepareStyle = (style: StyleSpecification, mask: Data['mask']): BaseStyle => {
  const water = style.layers.find(isWater);
  const background = style.layers.find((layer) => layer.type === 'background');
  const sea =
    colourOf(water?.type === 'fill' ? water.paint?.['fill-color'] : undefined) ??
    colourOf(
      background?.type === 'background' ? background.paint?.['background-color'] : undefined,
    ) ??
    WHITE;
  const within = ['within', japanArea(mask)] as unknown as ExpressionSpecification;
  // Prefecture borders (admin level 4) are drawn by the map itself, from these same tiles, so it can
  // stand them down where it draws a selected prefecture's own border; the style's copy goes.
  const notPrefecture = [
    '!=',
    ['to-number', ['get', 'admin_level']],
    4,
  ] as unknown as ExpressionSpecification;
  const layers = style.layers.map((layer): LayerSpecification => {
    if (
      layer.type === 'line' &&
      'source-layer' in layer &&
      layer['source-layer'] === 'boundary' &&
      (!layer.filter || JSON.stringify(layer.filter).includes('["get"'))
    )
      return {
        ...layer,
        filter: (layer.filter
          ? ['all', layer.filter, notPrefecture]
          : notPrefecture) as FilterSpecification,
      };
    if (layer.type !== 'symbol' || JSON.stringify(layer.filter ?? null).includes('"within"'))
      return layer;
    const filter = (layer.filter ? ['all', layer.filter, within] : within) as FilterSpecification;
    return { ...layer, filter };
  });
  const firstLabel = layers.findIndex((layer) => layer.type === 'symbol');
  const maskLayer: LayerSpecification = {
    id: MASK_ID,
    type: 'fill',
    source: MASK_ID,
    paint: { 'fill-color': sea, 'fill-antialias': false },
  };
  if (firstLabel < 0) layers.push(maskLayer);
  else layers.splice(firstLabel, 0, maskLayer);
  const boundary = style.layers.find(
    (layer) => 'source-layer' in layer && layer['source-layer'] === 'boundary',
  );
  return {
    style: {
      ...style,
      sources: {
        ...style.sources,
        [MASK_ID]: { type: 'geojson', data: mask as unknown as GeoJSON.FeatureCollection },
      },
      layers,
    },
    labels: layers[firstLabel + 1]?.id,
    water: water?.id,
    font: fontOf(style.layers),
    borders: boundary && 'source' in boundary ? boundary.source : undefined,
    sea,
  };
};

/** Addresses in a style can be relative to the style's own; the map gets the style as an object. */
const absolute = (style: StyleSpecification, base: string): StyleSpecification => {
  const resolve = (address: string) =>
    /^[a-z][a-z\d+.-]*:/i.test(address)
      ? address
      : new URL(address, base).href.replaceAll('%7B', '{').replaceAll('%7D', '}');
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, source]) => [
      id,
      {
        ...source,
        ...('url' in source && typeof source.url === 'string' ? { url: resolve(source.url) } : {}),
        ...('tiles' in source && Array.isArray(source.tiles)
          ? { tiles: source.tiles.map(resolve) }
          : {}),
      },
    ]),
  ) as StyleSpecification['sources'];
  return {
    ...style,
    sources,
    ...(style.glyphs ? { glyphs: resolve(style.glyphs) } : {}),
    ...(typeof style.sprite === 'string'
      ? { sprite: resolve(style.sprite) }
      : Array.isArray(style.sprite)
        ? { sprite: style.sprite.map((entry) => ({ ...entry, url: resolve(entry.url) })) }
        : {}),
  };
};

const styles = new Map<string, Promise<StyleSpecification | undefined>>();

/** A style file, fetched once per address; undefined when it cannot be had. */
const fetchStyle = (url: string): Promise<StyleSpecification | undefined> => {
  let style = styles.get(url);
  if (!style) {
    style = fetch(url)
      .then((response) =>
        response.ok ? (response.json() as Promise<StyleSpecification>) : undefined,
      )
      .then((json) => (json ? absolute(json, url) : undefined))
      .catch(() => undefined);
    styles.set(url, style);
    // A failure is not kept: the next mount (a reload of the map, the other mode) tries again.
    void style.then((got) => {
      if (!got) styles.delete(url);
    });
  }
  return style;
};

/**
 * The base map style at `url`, prepared for Japan (see `prepareStyle`); undefined while it loads.
 * If the file cannot be fetched here, the address itself, for MapLibre to try and report.
 */
export const useBaseStyle = (url: string, mask: Data['mask']): BaseStyle | undefined => {
  const [loaded, setLoaded] = useState<{ url: string; style: StyleSpecification | undefined }>();
  useEffect(() => {
    let current = true;
    void fetchStyle(url).then((style) => {
      if (current) setLoaded({ url, style });
    });
    return () => {
      current = false;
    };
  }, [url]);
  return useMemo(() => {
    if (loaded?.url !== url) return undefined;
    return loaded.style ? prepareStyle(loaded.style, mask) : { style: url, font: {} };
  }, [loaded, url, mask]);
};

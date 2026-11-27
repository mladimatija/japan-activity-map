// What the map draws, worked out from the data, the filters and the selection: one GeoJSON
// collection per source, and the expressions that colour and filter them.
import type { FeatureCollection } from 'geojson';
import type { ExpressionSpecification } from 'maplibre-gl';
import { useMemo } from 'react';

import type { Data } from '../data.ts';
import { type Derived, derive, figuresOf } from '../filters.ts';
import { outlineByCode, referenceByList, tracksByYear, useLoaded } from '../lazy.ts';
import { visibleItems } from '../lists.ts';
import { nameIn, routeName, useLang } from '../names.tsx';
import { type Selection, useStore } from '../store.ts';
import { coverageOf, coverageShapes } from '../tiles.ts';
import { CLEAR, METRIC_SCALE } from './palette.ts';

/** A source with nothing in it yet. */
export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Class lower bounds for a prefecture metric: quantiles of the non-zero values, so the colours spread out. */
const breaks = (values: number[]): number[] => {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  // Lower bounds of up to seven classes; the first is the smallest non-zero value.
  const classes = METRIC_SCALE.length;
  const out: number[] = [sorted[0] ?? 0];
  for (let i = 1; i < classes; i++) {
    const value =
      sorted[Math.min(sorted.length - 1, Math.floor((i / classes) * sorted.length))] ?? 0;
    if (value > (out.at(-1) ?? 0)) out.push(value);
  }
  return out;
};

/** Class breaks for a prefecture metric ('activities', 'days', 'distanceM' or 'gainM') as shown now. */
export const prefectureBreaks = (data: Data, derived: Derived, metric: string): number[] =>
  breaks(
    data.prefectures.features.map((feature) =>
      Number(
        (figuresOf(data, derived, feature.properties.code) as unknown as Record<string, number>)[
          metric
        ] ?? 0,
      ),
    ),
  );

/** The selected activity's track or route's line, drawn on top whatever layers are on. */
export const selectionShape = (selection: Selection | null, data: Data): FeatureCollection => {
  if (selection?.kind === 'route') {
    const route = data.routeById.get(selection.id);
    if (route)
      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { type: route.type },
            geometry: { type: 'MultiLineString', coordinates: route.line },
          },
        ],
      };
  }
  if (selection?.kind === 'activity') {
    const year = data.activityById.get(selection.id)?.trackYear;
    const feature =
      year === undefined
        ? undefined
        : tracksByYear
            .get(year)
            ?.features.find((candidate) => candidate.properties.id === selection.id);
    if (feature)
      return {
        type: 'FeatureCollection',
        features: [feature as unknown as FeatureCollection['features'][number]],
      };
  }
  return EMPTY;
};

/** Every source's data and the prefecture colouring, kept up to date with the store. */
export const useMapSources = (data: Data, doneColor: string) => {
  const listId = useStore((state) => state.list);
  const selection = useStore((state) => state.selection);
  const layers = useStore((state) => state.layers);
  const fill = useStore((state) => state.prefectureFill);
  const filters = useStore((state) => state.filters);
  const loaded = useLoaded();
  const lang = useLang();
  const derived = derive(data, filters);
  const list = data.listById.get(listId);
  const places = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      // The same items the list shows: its status and prefecture filters apply to the pins too.
      features: (list?.kind === 'point' ? visibleItems(data, list, filters) : [])
        .filter((item) => item.at)
        .map((item) => ({
          type: 'Feature',
          properties: {
            id: item.id,
            status: item.status,
            visits: derived.visits(item),
            name: nameIn(item.name, lang),
            done: item.status === 'done' ? 1 : 0,
          },
          geometry: { type: 'Point', coordinates: item.at as [number, number] },
        })),
    }),
    [data, list, filters, derived, lang],
  );
  // Prefecture figures follow the activity filters, and prefecture filters leave the others blank.
  const prefectures = useMemo<FeatureCollection>(() => {
    if (!derived.activityIds && !derived.matching)
      return data.prefectures as unknown as FeatureCollection;
    return {
      type: 'FeatureCollection',
      features: data.prefectures.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          ...figuresOf(data, derived, feature.properties.code),
          match: !derived.matching || derived.matching.has(feature.properties.code) ? 1 : 0,
        },
      })),
    } as unknown as FeatureCollection;
  }, [data, derived]);
  // Grouped routes with at least one matching activity.
  const routeIds = useMemo(
    () =>
      derived.activityIds
        ? new Set(
            data.routes
              .filter((route) => route.activities.some((id) => derived.activityIds?.has(id)))
              .map((route) => route.id),
          )
        : null,
    [data, derived],
  );
  const trackFilter = useMemo(
    () =>
      derived.activityIds
        ? (['in', ['get', 'id'], ['literal', [...derived.activityIds]]] as ExpressionSpecification)
        : // MapLibre wants an expression, not undefined, to clear a filter.
          (['boolean', true] as ExpressionSpecification),
    [derived],
  );
  const reference = list?.kind === 'route' ? referenceByList.get(list.id) : undefined;
  const covered = useMemo<FeatureCollection>(
    () =>
      reference
        ? {
            type: 'FeatureCollection',
            features: reference.features.map((feature) => ({
              type: 'Feature',
              properties: { id: feature.properties.id },
              geometry: { type: 'MultiLineString', coordinates: feature.properties.coveredLines },
            })),
          }
        : EMPTY,
    // `loaded` changes when the file arrives: the files live outside React (lazy.ts).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [reference, loaded],
  );
  const routes = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: data.routes
        .filter((route) => !routeIds || routeIds.has(route.id))
        .map((route) => ({
          type: 'Feature',
          properties: {
            id: route.id,
            count: route.count,
            name: routeName(route, lang),
            type: route.type,
          },
          geometry: { type: 'MultiLineString', coordinates: route.line },
        })),
    }),
    [data, routeIds, lang],
  );
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- `loaded`: as above
  const shape = useMemo(() => selectionShape(selection, data), [selection, data, loaded]);
  // Explorer tiles of the activities the filters keep, worked out only while the layer is on.
  const tiles = useMemo<FeatureCollection>(
    () => (layers.tiles ? coverageShapes(coverageOf(derived.activities)) : EMPTY),
    // `loaded` changes as each year of tracks arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers.tiles, derived, loaded],
  );
  // The selected prefecture's detailed outline, once it has loaded: drawn in place of its
  // simplified shape, so the highlight follows the real border however far the map is zoomed in.
  const outline = useMemo<FeatureCollection>(() => {
    if (selection?.kind !== 'prefecture') return EMPTY;
    const file = outlineByCode.get(selection.code);
    const figures = prefectures.features.find(
      (feature) => feature.properties?.code === selection.code,
    )?.properties;
    return file && figures
      ? {
          type: 'FeatureCollection',
          // The figures colour the tint; `part` tells the area from the land borders.
          features: file.features.map((feature) => ({
            ...feature,
            properties: { ...figures, part: feature.properties.part },
          })),
        }
      : EMPTY;
    // `loaded` changes when the outline arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, prefectures, loaded]);
  const detailed = outline.features.length > 0;
  const metric = fill === 'distance' ? 'distanceM' : fill === 'gain' ? 'gainM' : fill;
  const metricBreaks = useMemo(
    () => (fill === 'status' ? [] : prefectureBreaks(data, derived, metric)),
    [data, derived, fill, metric],
  );
  const metricColor: ExpressionSpecification =
    fill === 'status' || metricBreaks.length === 0
      ? ['case', ['>', ['get', 'activities'], 0], doneColor, CLEAR]
      : ([
          'step',
          ['get', metric],
          CLEAR,
          ...metricBreaks.flatMap((value, i) => [value, METRIC_SCALE[i] ?? METRIC_SCALE.at(-1)]),
        ] as unknown as ExpressionSpecification);
  // Prefectures the prefecture filters leave out are not coloured.
  const prefectureColor: ExpressionSpecification = [
    'case',
    ['==', ['get', 'match'], 0],
    CLEAR,
    metricColor,
  ];

  return {
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
  };
};

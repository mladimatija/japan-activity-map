/** Minimal GeoJSON types (RFC 7946), enough for the project's files. Coordinates are [lon, lat]. */
export type Position = [number, number] | [number, number, number];

export interface PointGeometry {
  type: 'Point';
  coordinates: Position;
}
export interface LineStringGeometry {
  type: 'LineString';
  coordinates: Position[];
}
export interface MultiLineStringGeometry {
  type: 'MultiLineString';
  coordinates: Position[][];
}
export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: Position[][];
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: Position[][][];
}
export type Geometry =
  | PointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry;

export interface Feature<G extends Geometry | null = Geometry | null, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
}

export interface FeatureCollection<F extends Feature = Feature, M = unknown> {
  type: 'FeatureCollection';
  /** Foreign member (allowed by RFC 7946) carrying list metadata. */
  metadata?: M;
  features: F[];
}

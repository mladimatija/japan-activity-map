/**
 * The graticule a survey map prints: a line of latitude and of longitude at every whole degree
 * around Japan, each carrying its figure ("36°N", "138°E"). Even degrees are the main lines, shown
 * at every zoom; the odd ones join them closer in.
 */
const WEST = 122;
const EAST = 154;
const SOUTH = 20;
const NORTH = 46;

export const graticule = (): GeoJSON.FeatureCollection<
  GeoJSON.LineString,
  { label: string; major: boolean }
> => {
  const line = (coordinates: [number, number][], label: string, degree: number) => ({
    type: 'Feature' as const,
    properties: { label, major: degree % 2 === 0 },
    geometry: { type: 'LineString' as const, coordinates },
  });
  const features = [];
  for (let lon = WEST; lon <= EAST; lon++)
    features.push(
      line(
        [
          [lon, SOUTH],
          [lon, NORTH],
        ],
        `${lon}°E`,
        lon,
      ),
    );
  for (let lat = SOUTH; lat <= NORTH; lat++)
    features.push(
      line(
        [
          [WEST, lat],
          [EAST, lat],
        ],
        `${lat}°N`,
        lat,
      ),
    );
  return { type: 'FeatureCollection', features };
};

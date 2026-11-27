/**
 * Geometry on [lon, lat] positions that the command line and the site both need. One copy, so a
 * distance means the same thing where it is computed and where it is shown.
 */
type LonLat = readonly number[];

/** Mean radius of the Earth, in metres. */
export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres between two [lon, lat] positions. */
export const distanceM = (a: LonLat, b: LonLat): number => {
  const [lon1 = 0, lat1 = 0] = a;
  const [lon2 = 0, lat2 = 0] = b;
  const h =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The length of a line in metres. */
export const lengthM = (line: readonly LonLat[]): number => {
  let total = 0;
  for (let i = 1; i < line.length; i++)
    total += distanceM(line[i - 1] as LonLat, line[i] as LonLat);
  return total;
};

/** Points along the line no further apart than `stepM`, keeping the original vertices. */
export const densify = (line: readonly LonLat[], stepM: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    const [lon = 0, lat = 0] = line[i] as LonLat;
    const previous = line[i - 1];
    if (previous) {
      const [fromLon = 0, fromLat = 0] = previous;
      const pieces = Math.ceil(distanceM(previous, [lon, lat]) / stepM);
      for (let k = 1; k < pieces; k++) {
        const t = k / pieces;
        out.push([fromLon + (lon - fromLon) * t, fromLat + (lat - fromLat) * t]);
      }
    }
    out.push([lon, lat]);
  }
  return out;
};

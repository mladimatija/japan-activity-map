/** Decodes a Google encoded polyline (Strava's summary track) to [lon, lat] pairs. */
export const decodePolyline = (encoded: string, precision = 5): [number, number][] => {
  const factor = 10 ** precision;
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= encoded.length) throw new Error('polyline ends in the middle of a value');
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lon / factor, lat / factor]);
  }
  return points;
};

/** The reverse, for the fake server used in development. */
export const encodePolyline = (points: [number, number][], precision = 5): string => {
  const factor = 10 ** precision;
  let out = '';
  let lastLat = 0;
  let lastLon = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const [lon, lat] of points) {
    const la = Math.round(lat * factor);
    const lo = Math.round(lon * factor);
    put(la - lastLat);
    put(lo - lastLon);
    lastLat = la;
    lastLon = lo;
  }
  return out;
};

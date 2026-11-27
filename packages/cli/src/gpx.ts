/** A point of a GPX track or route. */
export interface GpxPoint {
  lon: number;
  lat: number;
  ele?: number;
  /** ISO 8601, as in the file. */
  time?: string;
}

export interface Gpx {
  /** One list per track segment, or per route, with at least two points each. */
  segments: GpxPoint[][];
}

const attribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(tag)?.[1];
const child = (body: string, name: string) =>
  new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(body)?.[1];

const points = (xml: string, tag: 'trkpt' | 'rtept'): GpxPoint[] => {
  const out: GpxPoint[] = [];
  const pattern = new RegExp(`<${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  for (const match of xml.matchAll(pattern)) {
    const lat = Number(attribute(match[1] ?? '', 'lat'));
    const lon = Number(attribute(match[1] ?? '', 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const body = match[2] ?? '';
    const ele = Number(child(body, 'ele'));
    const time = child(body, 'time');
    out.push({
      lon,
      lat,
      ...(Number.isFinite(ele) && child(body, 'ele') !== undefined ? { ele } : {}),
      ...(time ? { time } : {}),
    });
  }
  return out;
};

/**
 * Reads the tracks (and routes, for files that only have those) of a GPX file. Waypoints are
 * ignored. Throws when the file has no line with at least two points.
 */
export const parseGpx = (xml: string): Gpx => {
  if (!/<gpx\b/.test(xml)) throw new Error('not a GPX file (no <gpx> element)');
  const segments: GpxPoint[][] = [];
  for (const segment of xml.matchAll(/<trkseg\b[^>]*>([\s\S]*?)<\/trkseg>/g)) {
    const line = points(segment[1] ?? '', 'trkpt');
    if (line.length >= 2) segments.push(line);
  }
  if (segments.length === 0) {
    for (const route of xml.matchAll(/<rte\b[^>]*>([\s\S]*?)<\/rte>/g)) {
      const line = points(route[1] ?? '', 'rtept');
      if (line.length >= 2) segments.push(line);
    }
  }
  if (segments.length === 0) throw new Error('no track or route with at least two points');
  return { segments };
};

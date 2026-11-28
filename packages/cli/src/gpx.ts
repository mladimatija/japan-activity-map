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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** Text of an element as written: CDATA unwrapped, the five XML entities and numeric ones read. */
const text = (raw: string | undefined): string | undefined => {
  if (raw === undefined) return undefined;
  const value = raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, name: string) => {
      if (!name.startsWith('#')) return ENTITIES[name.toLowerCase()] ?? whole;
      const code =
        name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    })
    .trim();
  return value === '' ? undefined : value;
};
const element = (body: string, name: string) =>
  text(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body)?.[1]);

/** What a GPX file says about itself, apart from its points. */
export interface GpxInfo {
  /** The file's own name: from its metadata, else its first track or route. */
  name?: string;
  /** The first track's `<type>`, as written. */
  type?: string;
  /** The time in the file's metadata, as written. */
  time?: string;
}

/** The name, type and metadata time of a GPX file; each left out when the file has none. */
export const gpxInfo = (xml: string): GpxInfo => {
  // An author, link or copyright inside the metadata has a name or text of its own: not the file's.
  const metadata = (/<metadata\b[^>]*>([\s\S]*?)<\/metadata>/.exec(xml)?.[1] ?? '').replace(
    /<(author|link|copyright)\b[^>]*>[\s\S]*?<\/\1>/g,
    '',
  );
  // A track's own elements come before its segments; looking no further keeps point data out.
  const heads = [...xml.matchAll(/<(trk|rte)\b[^>]*>([\s\S]*?)(?:<trkseg\b|<rtept\b|<\/\1>)/g)].map(
    (match) => match[2] ?? '',
  );
  // GPX 1.0 keeps the file's name and time at the top, before the first waypoint, route or track.
  const top = /<gpx\b[^>]*>([\s\S]*?)(?:<(?:metadata|wpt|rte|trk)\b|<\/gpx>)/.exec(xml)?.[1] ?? '';
  const name =
    element(metadata, 'name') ??
    element(top, 'name') ??
    heads.map((head) => element(head, 'name')).find(Boolean);
  const type = heads.map((head) => element(head, 'type')).find(Boolean);
  const time = element(metadata, 'time') ?? element(top, 'time');
  return { ...(name ? { name } : {}), ...(type ? { type } : {}), ...(time ? { time } : {}) };
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

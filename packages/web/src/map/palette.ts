/**
 * Okabe–Ito colours, which stay distinct for the common kinds of colour blindness. Status is also
 * shown by shape (filled, ring, cross, half, dot), so nothing depends on colour alone.
 */
const STATUS_HEX = {
  // Done is the site's indigo, a step lighter than the buttons so it reads as data; the other
  // four are Okabe–Ito. Checked as a set for colour-blind separation in both modes.
  light: { done: '#3647A3', partial: '#56B4E9', dns: '#D55E00', want: '#E69F00', none: '#8C8C8C' },
  dark: { done: '#5A69DC', partial: '#56B4E9', dns: '#D55E00', want: '#E69F00', none: '#8C8C8C' },
} as const;

/** Status colours for the page: the CSS tokens of index.css, so they follow light and dark. */
export const STATUS_COLORS = {
  done: 'var(--status-done)',
  partial: 'var(--status-partial)',
  dns: 'var(--status-dns)',
  want: 'var(--status-want)',
  none: 'var(--status-none)',
} as const;

/** Status colours for the map and the canvas, which cannot read CSS tokens. */
export const statusHex = (dark: boolean) => STATUS_HEX[dark ? 'dark' : 'light'];

export const TYPE_COLORS: Record<string, string> = {
  hike: '#009E73',
  trail_run: '#E69F00',
  run: '#D55E00',
  walk: '#CC79A7',
  ride: '#0072B2',
};

/** A type's colour, or a neutral grey for one the palette does not know. */
export const typeColorOf = (type: string): string => TYPE_COLORS[type] ?? UNKNOWN_TYPE_COLOR;

/** Chart series, in a fixed order: Okabe–Ito with two extras, as on the map. */
export const SERIES_COLORS = [
  '#0072B2',
  '#E69F00',
  '#009E73',
  '#D55E00',
  '#CC79A7',
  '#56B4E9',
  '#B8A000',
  '#7f7f7f',
];

/**
 * What the map draws that is not data: MapLibre's paint properties cannot read the CSS tokens of
 * index.css, so the few colours it needs are named here, per light and dark base map. Hex values
 * are written in this file and index.css only (pnpm check:web fails on one anywhere else).
 */
const MAP_COLORS = {
  light: {
    /** Labels the map draws itself, their halo, quiet lines, and the strongest ink. */
    text: '#222222',
    halo: '#ffffff',
    line: '#555555',
    strong: '#000000',
    /** What the pointer is over: the page's indigo (--primary). */
    accent: '#2f3f8f',
    /** Tracks drawn as a heat of repeats. */
    heat: '#d4361b',
    hillshade: { shadow: '#5b5f66', highlight: '#ffffff', accent: '#6b6f76' },
  },
  dark: {
    text: '#f2f2f7',
    halo: '#1c1c1e',
    line: '#a1a1aa',
    strong: '#ffffff',
    accent: '#a3aef0',
    heat: '#ffb000',
    hillshade: { shadow: '#000000', highlight: '#3a3a3c', accent: '#000000' },
  },
} as const;

export const mapColors = (dark: boolean) => MAP_COLORS[dark ? 'dark' : 'light'];

/** The base map's own greys dyed indigo (map/dye.ts): a hue in OKLCH, and how much colour to add. */
export interface MapDye {
  /** The page's indigo: --cloth and --primary sit at about 270°. */
  hue: number;
  /** Land, parks, towns: a cast, no more. */
  land: number;
  /** Sea, lakes and rivers: plainly indigo. */
  water: number;
}

/**
 * The default base maps (OpenFreeMap's Positron and Dark) are greys, so they take the site's dye:
 * Positron a faint cool cast with indigo water, Dark the night indigo of the page. A style of
 * one's own keeps its colours.
 */
const MAP_DYE: Record<'light' | 'dark', MapDye> = {
  light: { hue: 268, land: 0.005, water: 0.03 },
  dark: { hue: 271, land: 0.05, water: 0.06 },
};
const DYED_STYLE = /^https:\/\/tiles\.openfreemap\.org\/styles\/(positron|dark)\/?$/;

/** The dye for a base map at `url`: the default styles only. */
export const mapDye = (url: string, dark: boolean): MapDye | undefined =>
  DYED_STYLE.test(url) ? MAP_DYE[dark ? 'dark' : 'light'] : undefined;

/** A type the palette does not know, a reference route's line, and plain white and near-black. */
export const UNKNOWN_TYPE_COLOR = '#666666';
export const REFERENCE_LINE_COLOR = '#8c8c8c';
export const WHITE = '#ffffff';
export const NEAR_BLACK = '#111111';
export const BLACK = '#000000';
export const CLEAR = 'rgba(0,0,0,0)';
/** The inside of a pin that is not filled with its status colour. */
const PIN_FILL = 'rgba(255,255,255,0.9)';

/** A sequential scale (cividis-like), readable with any colour vision, for prefecture metrics. */
export const METRIC_SCALE = [
  '#fde725',
  '#a0da39',
  '#4ac16d',
  '#1fa187',
  '#277f8e',
  '#365c8d',
  '#46327e',
];

export type Status = keyof typeof STATUS_COLORS;
export const STATUSES: Status[] = ['done', 'partial', 'dns', 'want', 'none'];

/** Draws the status markers once, as images the map's symbol layer can use. Returns RGBA pixels. */
export const statusIcon = (
  status: Status,
  size = 32,
  dark = false,
): { width: number; height: number; data: Uint8ClampedArray } => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No 2D canvas');
  const c = size / 2;
  const r = size * 0.34;
  const color = statusHex(dark)[status];
  g.lineWidth = size * 0.1;
  g.strokeStyle = WHITE;
  g.fillStyle = color;
  const circle = (radius: number) => {
    g.beginPath();
    g.arc(c, c, radius, 0, Math.PI * 2);
  };
  if (status === 'done') {
    circle(r);
    g.fill();
    g.stroke();
  } else if (status === 'want') {
    circle(r);
    g.fillStyle = PIN_FILL;
    g.fill();
    g.lineWidth = size * 0.14;
    g.strokeStyle = color;
    g.stroke();
  } else if (status === 'partial') {
    circle(r);
    g.fillStyle = PIN_FILL;
    g.fill();
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, r, Math.PI / 2, (Math.PI * 3) / 2);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    circle(r);
    g.lineWidth = size * 0.08;
    g.strokeStyle = color;
    g.stroke();
  } else if (status === 'dns') {
    const d = r * 0.85;
    g.lineCap = 'round';
    for (const [width, stroke] of [
      [size * 0.26, '#ffffff'],
      [size * 0.14, color],
    ] as const) {
      g.lineWidth = width;
      g.strokeStyle = stroke;
      g.beginPath();
      g.moveTo(c - d, c - d);
      g.lineTo(c + d, c + d);
      g.moveTo(c + d, c - d);
      g.lineTo(c - d, c + d);
      g.stroke();
    }
  } else {
    circle(r * 0.55);
    g.fill();
    g.lineWidth = size * 0.07;
    g.stroke();
  }
  const image = g.getImageData(0, 0, size, size);
  return { width: size, height: size, data: image.data };
};

/** The same markers as data URLs, for the legend and the panel. */
export const statusIconUrl = (status: Status, size = 32): string => {
  const { data, width, height } = statusIcon(status, size);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas
    .getContext('2d')
    ?.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  return canvas.toDataURL();
};

/**
 * Dyes a base map's greys the site's indigo (藍染). Each colour keeps its lightness, so land, water,
 * parks and towns stay as far apart as their style drew them, and takes the dye's hue with a
 * little colour (OKLCH, so the lightness the eye sees does not move). For the default base maps
 * (palette.ts, `mapDye`); a style of one's own keeps its colours.
 */

type Rgba = [red: number, green: number, blue: number, alpha: number];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** A CSS colour as MapLibre styles write them (hex, rgb(), rgba(), hsl(), hsla()); else undefined. */
export const parseColour = (text: string): Rgba | undefined => {
  const value = text.trim().toLowerCase();
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/.exec(value)?.[1];
  if (hex) {
    const digits =
      hex.length <= 4 ? hex.split('').map((digit) => digit + digit) : (hex.match(/../g) ?? []);
    const [red = 0, green = 0, blue = 0, alpha = 255] = digits.map((pair) => parseInt(pair, 16));
    return [red / 255, green / 255, blue / 255, alpha / 255];
  }
  const call = /^(rgba?|hsla?)\s*\((.*)\)$/.exec(value);
  if (!call) return undefined;
  const [kind = '', body = ''] = call.slice(1);
  const tokens = body.split(/[\s,/]+/).filter(Boolean);
  // A percentage is a fraction; a plain rgb() channel counts to 255, everything else to 1.
  const number = (token: string | undefined, whole: number) =>
    token === undefined
      ? 1
      : token.endsWith('%')
        ? Number(token.slice(0, -1)) / 100
        : Number(token) / whole;
  const channel = kind.startsWith('rgb') ? 255 : 1;
  const [first, second, third, alpha] = [
    kind.startsWith('rgb') ? number(tokens[0], 255) : Number(tokens[0]),
    number(tokens[1], channel),
    number(tokens[2], channel),
    number(tokens[3], 1),
  ];
  if (tokens.length < 3 || [first, second, third, alpha].some(Number.isNaN)) return undefined;
  if (kind.startsWith('rgb')) return [first, second, third, alpha];
  // hsl(): hue in degrees, saturation and lightness as fractions.
  const hue = (((first % 360) + 360) % 360) / 60;
  const chroma = (1 - Math.abs(2 * third - 1)) * second;
  const x = chroma * (1 - Math.abs((hue % 2) - 1));
  const [red, green, blue] =
    hue < 1
      ? [chroma, x, 0]
      : hue < 2
        ? [x, chroma, 0]
        : hue < 3
          ? [0, chroma, x]
          : hue < 4
            ? [0, x, chroma]
            : hue < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const lift = third - chroma / 2;
  return [red + lift, green + lift, blue + lift, alpha];
};

const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel: number) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

/** OKLab's lightness of an sRGB colour (0–1). */
export const lightnessOf = ([red, green, blue]: Rgba): number => {
  const [r, g, b] = [red, green, blue].map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
};

/** sRGB from OKLCH, each channel clipped into range. */
const fromOklch = (lightness: number, chroma: number, hue: number): [number, number, number] => {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((channel) => clamp(fromLinear(channel))) as [number, number, number];
};

const hexOf = (channel: number) =>
  Math.round(clamp(channel) * 255)
    .toString(16)
    .padStart(2, '0');

/** One colour dyed: its lightness kept, the hue and chroma given. Anything else comes back as is. */
export const dyeColour = (text: string, hue: number, chroma: number): string => {
  const colour = parseColour(text);
  if (!colour) return text;
  const [red, green, blue] = fromOklch(lightnessOf(colour), chroma, hue);
  const alpha = colour[3] < 1 ? hexOf(colour[3]) : '';
  return `#${hexOf(red)}${hexOf(green)}${hexOf(blue)}${alpha}`;
};

/** Every colour inside a paint value (a string, an expression, zoom stops) dyed; the rest kept. */
export const dyeValue = (value: unknown, hue: number, chroma: number): unknown =>
  typeof value === 'string'
    ? dyeColour(value, hue, chroma)
    : Array.isArray(value)
      ? value.map((part) => dyeValue(part, hue, chroma))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, part]) => [key, dyeValue(part, hue, chroma)]),
          )
        : value;

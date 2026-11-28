/**
 * A link that opens a place in a maps app, for directions to a peak or the start of a route. The
 * site itself asks nothing of any maps service: the link is only followed when it is clicked.
 */

export type MapsPlatform = 'apple' | 'android' | 'other';

/** Which maps app a link should be written for, from the browser's own description of itself. */
export const mapsPlatform = (): MapsPlatform => {
  if (typeof navigator === 'undefined') return 'other';
  const agent = navigator.userAgent;
  if (/Android/i.test(agent)) return 'android';
  // An iPad says "Macintosh" these days; a Mac has Apple Maps too, so both go the same way.
  if (/iPhone|iPad|iPod|Macintosh/i.test(agent)) return 'apple';
  return 'other';
};

/**
 * The link for a place: Apple Maps on Apple devices, the phone's own choice of maps app on
 * Android (a `geo:` address), Google Maps in a browser elsewhere. Undefined for a position that
 * is not one.
 */
export const mapsUrl = (
  position: readonly number[] | undefined,
  label: string,
  platform: MapsPlatform = mapsPlatform(),
): string | undefined => {
  const [lon, lat] = position ?? [];
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return undefined;
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  // Brackets too: on Android the label sits inside a pair of them.
  const name = encodeURIComponent(label.trim()).replaceAll('(', '%28').replaceAll(')', '%29');
  if (platform === 'apple') return `https://maps.apple.com/?ll=${at}&q=${name || at}`;
  if (platform === 'android') return `geo:${at}?q=${at}${name ? `(${name})` : ''}`;
  return `https://www.google.com/maps/search/?api=1&query=${at}`;
};

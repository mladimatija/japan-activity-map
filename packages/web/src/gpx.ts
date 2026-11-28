/**
 * A route as a GPX file, to take along in a navigation app: the reference line of a route on a
 * list, as drawn on the map. Nothing of yours is in it, only the route and where its line is from.
 */

const escapeXml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export interface GpxTrack {
  name: string;
  /** One or more pieces, each a run of [lon, lat]. */
  lines: readonly (readonly (readonly number[])[])[];
}

/** A GPX 1.1 document: one `<trk>` per track, one `<trkseg>` per piece of its line. */
export const routeGpx = (
  tracks: readonly GpxTrack[],
  meta: {
    name: string;
    /** Who the line is owed to, such as "© OpenStreetMap contributors". */ credit?: string;
  },
): string => {
  const body = tracks
    .map((track) => {
      const segments = track.lines
        .filter((line) => line.length >= 2)
        .map(
          (line) =>
            `<trkseg>${line
              .map(
                ([lon, lat]) =>
                  `<trkpt lat="${(lat ?? 0).toFixed(6)}" lon="${(lon ?? 0).toFixed(6)}"/>`,
              )
              .join('')}</trkseg>`,
        )
        .join('');
      return segments ? `<trk><name>${escapeXml(track.name)}</name>${segments}</trk>` : '';
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="japan-activity-map" xmlns="http://www.topografix.com/GPX/1/1">',
    `<metadata><name>${escapeXml(meta.name)}</name>${meta.credit ? `<desc>${escapeXml(meta.credit)}</desc>` : ''}</metadata>`,
    body,
    '</gpx>',
    '',
  ].join('\n');
};

/** A file name from a route's name: its letters and digits in any script, nothing a disk refuses. */
export const gpxFileName = (name: string): string => {
  const safe = name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${safe || 'route'}.gpx`;
};

/** Hands the file to the browser: the share sheet on a phone that has one for files, a download elsewhere. */
export const saveGpx = async (fileName: string, gpx: string): Promise<void> => {
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' });
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    // Closing the share sheet without choosing an app is an answer too: nothing is saved instead.
    await navigator.share({ files: [file], title: fileName }).catch(() => undefined);
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
};

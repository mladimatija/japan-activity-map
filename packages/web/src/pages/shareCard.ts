import { t } from '../i18n.ts';

/** What a year's card says: the figures, already written out in the reader's language. */
export interface YearCard {
  year: number;
  title: string;
  rows: [label: string, value: string][];
  /** A line of names under the figures (new places), when there is one. */
  note?: string;
  /** Made-up data (`jam demo`): the card says so, so a shared picture cannot pass for real. */
  demo?: boolean;
}

/** A design token's value as the page has it now (light or dark), for drawing on a canvas. */
const token = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** The site's faces (index.css): the sans for labels, the condensed cut for the year and figures. */
const REST = "'Hiragino Sans', 'Noto Sans JP', system-ui, -apple-system, 'Segoe UI', sans-serif";
const FONT = `'IBM Plex Sans Variable', ${REST}`;
const FIGURE = `'IBM Plex Sans Condensed', ${REST}`;

/** The year as a square picture, 1080 px, for sharing: the year, the figures and the site's name. */
const draw = ({ year, title, rows, note, demo }: YearCard): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  const ink = token('--foreground');
  const quiet = token('--muted-foreground');
  c.fillStyle = token('--background');
  c.fillRect(0, 0, 1080, 1080);
  c.fillStyle = token('--primary');
  c.textBaseline = 'alphabetic';
  c.font = `700 200px ${FIGURE}`;
  c.fillText(String(year), 80, 270);
  c.font = `400 40px ${FONT}`;
  c.fillStyle = quiet;
  c.fillText(title, 86, 340);
  if (demo) {
    c.font = `600 34px ${FONT}`;
    c.textAlign = 'right';
    c.fillText(t('Demo data'), 1000, 130);
    c.textAlign = 'left';
  }
  let y = 440;
  for (const [label, value] of rows) {
    c.strokeStyle = token('--border');
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(80, y - 58);
    c.lineTo(1000, y - 58);
    c.stroke();
    c.font = `400 40px ${FONT}`;
    c.fillStyle = quiet;
    c.textAlign = 'left';
    c.fillText(label, 80, y);
    c.font = `600 48px ${FIGURE}`;
    c.fillStyle = ink;
    c.textAlign = 'right';
    c.fillText(value, 1000, y);
    y += 92;
  }
  c.textAlign = 'left';
  if (note) {
    c.font = `400 32px ${FONT}`;
    c.fillStyle = quiet;
    // One line, cut with an ellipsis where it would run off the card.
    let text = note;
    while (text.length > 4 && c.measureText(text).width > 920)
      text = `${text.slice(0, -2).trimEnd()}…`;
    c.fillText(text, 80, Math.min(y + 4, 1010));
  }
  return canvas;
};

/**
 * Shares the year's card where the device has a share sheet that takes pictures (phones), and
 * saves it as a PNG otherwise.
 */
export const shareYear = async (card: YearCard): Promise<void> => {
  // A canvas draws only with fonts already loaded: ask for the two it uses, and draw regardless.
  await Promise.all([
    document.fonts.load(`700 200px ${FIGURE}`),
    document.fonts.load(`600 48px ${FIGURE}`),
    document.fonts.load(`400 40px ${FONT}`),
  ]).catch(() => undefined);
  const canvas = draw(card);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `${card.year}.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    // Closing the share sheet without sharing is an answer too: nothing is saved instead.
    await navigator
      .share({ files: [file], title: t('{year} in review', { year: card.year }) })
      .catch(() => undefined);
    return;
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
};

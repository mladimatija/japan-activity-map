/**
 * Contour lines for a list's cover, the pattern dyed into the cloth: a smooth field of hills,
 * seeded by the list's id so each list keeps its own, cut into levels with marching squares. Pure
 * and deterministic, so a server render draws the same lines as the browser.
 */
export interface Contour {
  /** The level, from 1 (lowest) up: a stable key. */
  level: number;
  /** Every fourth level is an index contour, drawn heavier, as on a survey map. */
  major: boolean;
  /** The line as SVG path data, in the box's own units. */
  d: string;
}

/** FNV-1a: the seed text as a 32-bit number. */
const hash = (text: string): number => {
  let value = 2166136261;
  for (const char of text) {
    value ^= char.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

/** A small linear congruential generator: the same numbers for the same seed, in [0, 1). */
const random = (seed: number): (() => number) => {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const point = (x: number, y: number) => `${x.toFixed(1)},${y.toFixed(1)}`;

/** The contour lines of a `width` × `height` box, sampled every `cell` units. */
export const contours = (
  seed: string,
  width: number,
  height: number,
  { cell = 6, levels = 10 }: { cell?: number; levels?: number } = {},
): Contour[] => {
  const next = random(hash(seed));
  const size = Math.max(width, height);
  const hills = Array.from({ length: 6 }, () => ({
    x: next() * width,
    y: next() * height * 1.3 - height * 0.15,
    spread: (0.12 + next() * 0.3) * size,
    rise: 0.5 + next(),
  }));
  const phase = next() * Math.PI * 2;
  const heightAt = (x: number, y: number) => {
    let value = 0.16 * Math.sin(x / (width / 9) + phase) * Math.cos(y / (height / 5));
    for (const hill of hills) {
      const dx = x - hill.x;
      const dy = y - hill.y;
      value += hill.rise * Math.exp(-(dx * dx + dy * dy) / (2 * hill.spread * hill.spread));
    }
    return value;
  };

  const columns = Math.ceil(width / cell) + 1;
  const rows = Math.ceil(height / cell) + 1;
  const grid = new Float64Array(columns * rows);
  let low = Infinity;
  let high = -Infinity;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < columns; i++) {
      const value = heightAt(Math.min(i * cell, width), Math.min(j * cell, height));
      grid[j * columns + i] = value;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }

  const lines: Contour[] = [];
  for (let level = 1; level <= levels; level++) {
    const cut = low + ((high - low) * level) / (levels + 1);
    let d = '';
    for (let j = 0; j < rows - 1; j++)
      for (let i = 0; i < columns - 1; i++) {
        // The cell's corners: top left, top right, bottom right, bottom left.
        const a = grid[j * columns + i] ?? 0;
        const b = grid[j * columns + i + 1] ?? 0;
        const c = grid[(j + 1) * columns + i + 1] ?? 0;
        const e = grid[(j + 1) * columns + i] ?? 0;
        const corners =
          (a > cut ? 8 : 0) | (b > cut ? 4 : 0) | (c > cut ? 2 : 0) | (e > cut ? 1 : 0);
        if (corners === 0 || corners === 15) continue;
        const x = i * cell;
        const y = j * cell;
        const right = Math.min(x + cell, width);
        const bottom = Math.min(y + cell, height);
        const top = () => point(x + ((right - x) * (cut - a)) / (b - a), y);
        const east = () => point(right, y + ((bottom - y) * (cut - b)) / (c - b));
        const south = () => point(x + ((right - x) * (cut - e)) / (c - e), bottom);
        const west = () => point(x, y + ((bottom - y) * (cut - a)) / (e - a));
        const line = (from: string, to: string) => {
          d += `M${from}L${to}`;
        };
        switch (corners) {
          case 1:
          case 14:
            line(west(), south());
            break;
          case 2:
          case 13:
            line(south(), east());
            break;
          case 3:
          case 12:
            line(west(), east());
            break;
          case 4:
          case 11:
            line(top(), east());
            break;
          case 6:
          case 9:
            line(top(), south());
            break;
          case 7:
          case 8:
            line(west(), top());
            break;
          case 5:
            line(west(), top());
            line(south(), east());
            break;
          case 10:
            line(top(), east());
            line(west(), south());
            break;
        }
      }
    if (d) lines.push({ level, major: level % 4 === 0, d });
  }
  return lines;
};

import type { Position } from '@jam/core';

import { distanceM } from './geo.ts';

type Line = [number, number][];

/** A line made of pieces (a highway with a sea crossing is two), measured along its length. */
interface Chain {
  lines: Line[];
  /** Distance along the chain at each vertex of each piece, in metres. */
  at: number[][];
  lengthM: number;
}

export const chainOf = (lines: Line[]): Chain => {
  let total = 0;
  const at = lines.map((line) =>
    line.map((point, i) => {
      const previous = line[i - 1];
      if (previous) total += distanceM(previous, point);
      return total;
    }),
  );
  return { lines, at, lengthM: total };
};

/** The nearest point of the chain to `point`: how far along it, and how far from it. */
export const project = (chain: Chain, point: Position): { alongM: number; offM: number } => {
  const [lon0, lat0] = point;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  let best = { alongM: 0, offM: Infinity };
  chain.lines.forEach((line, l) => {
    const at = chain.at[l] ?? [];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!a || !b) continue;
      const ax = (a[0] - lon0) * kx;
      const ay = (a[1] - lat0) * ky;
      const dx = (b[0] - a[0]) * kx;
      const dy = (b[1] - a[1]) * ky;
      const squared = dx * dx + dy * dy;
      const t = squared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared));
      const off = Math.hypot(ax + t * dx, ay + t * dy);
      if (off < best.offM) {
        const start = at[i - 1] ?? 0;
        best = { alongM: start + t * ((at[i] ?? start) - start), offM: off };
      }
    }
  });
  return best;
};

/** The part of the chain from `fromM` to `toM` along it, as one line per piece it touches. */
export const slice = (chain: Chain, fromM: number, toM: number): Line[] => {
  const out: Line[] = [];
  chain.lines.forEach((line, l) => {
    const at = chain.at[l] ?? [];
    const piece: Line = [];
    const interpolate = (i: number, m: number): [number, number] => {
      const a = line[i - 1] as [number, number];
      const b = line[i] as [number, number];
      const start = at[i - 1] ?? 0;
      const span = (at[i] ?? start) - start;
      const t = span === 0 ? 0 : (m - start) / span;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    };
    for (let i = 0; i < line.length; i++) {
      const m = at[i] ?? 0;
      const point = line[i] as [number, number];
      const previous = at[i - 1];
      if (i > 0 && previous !== undefined) {
        if (previous < fromM && m > fromM) piece.push(interpolate(i, fromM));
        if (previous < toM && m > toM) {
          piece.push(interpolate(i, toM));
          break;
        }
      }
      if (m >= fromM && m <= toM) piece.push(point);
      if (m > toM) break;
    }
    if (piece.length >= 2) out.push(piece);
  });
  return out;
};

/**
 * The longest run of items whose positions along the line never go back in their listed order
 * (twin towns that share an article share a position).
 * A post town whose coordinates are wrong lands out of order and is left out, instead of
 * reordering the rest.
 */
export const inOrder = <T extends { alongM: number }>(items: T[]): { kept: T[]; dropped: T[] } => {
  const length = items.map(() => 1);
  const previous = items.map(() => -1);
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (
        (items[j]?.alongM ?? 0) <= (items[i]?.alongM ?? 0) &&
        (length[j] ?? 0) + 1 > (length[i] ?? 0)
      ) {
        length[i] = (length[j] ?? 0) + 1;
        previous[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < items.length; i++)
    if (end < 0 || (length[i] ?? 0) > (length[end] ?? 0)) end = i;
  const keep = new Set<number>();
  for (let i = end; i >= 0; i = previous[i] ?? -1) keep.add(i);
  return {
    kept: items.filter((_, i) => keep.has(i)),
    dropped: items.filter((_, i) => !keep.has(i)),
  };
};

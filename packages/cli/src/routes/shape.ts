import type { Position } from '@jam/core';

import { cellOf, cellSizeM, densify, distanceM, lengthM } from '../match/geometry.ts';

/** What grouping compares: the ordered grid cells a track passes through, and its ends. */
export interface Shape {
  /** Cells in the order the track visits them, without consecutive repeats. */
  cells: number[];
  set: Set<number>;
  start: Position;
  end: Position;
  distanceM: number;
}

export const shapeOf = (
  line: Position[],
  zoom: number,
  distance?: number | null,
): Shape | undefined => {
  const first = line[0];
  const last = line.at(-1);
  if (!first || !last || line.length < 2) return undefined;
  const cells: number[] = [];
  for (const point of densify(line, cellSizeM(zoom, first[1]) / 3)) {
    const cell = cellOf(point, zoom);
    if (cells.at(-1) !== cell) cells.push(cell);
  }
  return {
    cells,
    set: new Set(cells),
    start: first,
    end: last,
    distanceM: distance && distance > 0 ? distance : lengthM(line),
  };
};

export const shapeFromCells = (
  cells: number[],
  start: Position,
  end: Position,
  distance: number,
): Shape => ({ cells, set: new Set(cells), start, end, distanceM: distance });

/** The cell, or one of its eight neighbours, is in the set: tolerates GPS drift across a cell edge. */
const near = (set: ReadonlySet<number>, cell: number, zoom: number): boolean => {
  if (set.has(cell)) return true;
  const n = 2 ** zoom;
  const x = Math.floor(cell / n);
  const y = cell - x * n;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      if ((dx || dy) && set.has((x + dx) * n + (y + dy))) return true;
  return false;
};

/** Share of a's cells that lie on or next to b. */
export const coverOf = (a: Shape, b: Shape, zoom: number): number => {
  if (a.set.size === 0) return 0;
  let shared = 0;
  for (const cell of a.set) if (near(b.set, cell, zoom)) shared++;
  return shared / a.set.size;
};

/** How alike two shapes are: the smaller of the two shares, so a short track inside a long one scores low. */
export const similarity = (a: Shape, b: Shape, zoom: number) =>
  Math.min(coverOf(a, b, zoom), coverOf(b, a, zoom));

/**
 * Whether `track` runs the representative's way round or the other. Each track cell is placed at
 * its position along the representative; the steps between positions vote. On a loop a step
 * across the start counts as the short way round.
 */
export const isReversed = (
  track: Shape,
  representative: Shape,
  zoom: number,
  loop: boolean,
): boolean => {
  const index = new Map<number, number>();
  representative.cells.forEach((cell, i) => {
    if (!index.has(cell)) index.set(cell, i);
  });
  const n = 2 ** zoom;
  const positionOf = (cell: number): number | undefined => {
    const direct = index.get(cell);
    if (direct !== undefined) return direct;
    const x = Math.floor(cell / n);
    const y = cell - x * n;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const found = index.get((x + dx) * n + (y + dy));
        if (found !== undefined) return found;
      }
    return undefined;
  };
  const length = representative.cells.length;
  let vote = 0;
  let previous: number | undefined;
  for (const cell of track.cells) {
    const position = positionOf(cell);
    if (position === undefined) continue;
    if (previous !== undefined && position !== previous) {
      let step = position - previous;
      if (loop && Math.abs(step) > length / 2) step -= Math.sign(step) * length;
      vote += Math.sign(step);
    }
    previous = position;
  }
  return vote < 0;
};

/** Ends match the route either way round, within the tolerances. */
export const endsMatch = (
  track: Shape,
  route: Shape,
  startToleranceM: number,
  endToleranceM: number,
): 'same' | 'swapped' | undefined => {
  if (
    distanceM(track.start, route.start) <= startToleranceM &&
    distanceM(track.end, route.end) <= endToleranceM
  )
    return 'same';
  if (
    distanceM(track.start, route.end) <= endToleranceM &&
    distanceM(track.end, route.start) <= startToleranceM
  )
    return 'swapped';
  return undefined;
};

export const isLoop = (shape: Shape, toleranceM: number) =>
  distanceM(shape.start, shape.end) <= toleranceM;

/**
 * Length of distinct street a track covers: laps and retraced stretches count once, and so does a
 * return leg drifting into the next cell. Cells are taken in order and counted only when no counted
 * cell is next to them, which keeps about every other cell along a street; doubling that gives a
 * rough length. It is only ever compared with another track's, measured the same way.
 */
const footprints = new WeakMap<Shape, Map<number, number>>();

export const footprintM = (shape: Shape, zoom: number): number => {
  const cached = footprints.get(shape)?.get(zoom);
  if (cached !== undefined) return cached;
  const value = countFootprint(shape, zoom);
  footprints.set(shape, (footprints.get(shape) ?? new Map<number, number>()).set(zoom, value));
  return value;
};

const countFootprint = (shape: Shape, zoom: number): number => {
  const n = 2 ** zoom;
  const counted = new Set<number>();
  for (const cell of shape.cells) {
    const x = Math.floor(cell / n);
    const y = cell - x * n;
    let near = false;
    for (let dx = -1; dx <= 1 && !near; dx++)
      for (let dy = -1; dy <= 1 && !near; dy++) near = counted.has((x + dx) * n + (y + dy));
    if (!near) counted.add(cell);
  }
  return counted.size * 2 * cellSizeM(zoom, shape.start[1]);
};

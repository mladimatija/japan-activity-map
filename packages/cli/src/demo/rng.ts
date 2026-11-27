/**
 * A small seeded random generator (mulberry32) for the demo data: the same seed gives the same
 * numbers on every machine, so a demo history can be made again exactly. Never Math.random().
 */
export interface Rng {
  /** A number from 0 up to, not including, 1. */
  next(): number;
  /** A number from `min` up to, not including, `max`. */
  range(min: number, max: number): number;
  /** A whole number from `min` to `max`, both included. */
  int(min: number, max: number): number;
  /** True with probability `p`. */
  chance(p: number): boolean;
  /** One of the items; throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** One of the items, each as likely as its weight. */
  weighted<T>(items: readonly (readonly [T, number])[]): T;
  /** Roughly normal, mean 0 and standard deviation 1 (sum of uniforms). */
  gauss(): number;
  /** A generator of its own for a named part, so adding draws in one part leaves the others as they were. */
  fork(label: string): Rng;
}

/** A 32-bit hash of a string (FNV-1a), to turn labels into seeds. */
export const hashText = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const createRng = (seed: number): Rng => {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    weighted: (items) => {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let at = next() * total;
      for (const [item, weight] of items) {
        at -= weight;
        if (at < 0) return item;
      }
      return (items.at(-1) as (typeof items)[number])[0];
    },
    gauss: () => (next() + next() + next() + next() - 2) * Math.sqrt(3),
    fork: (label) => createRng((seed ^ hashText(label)) >>> 0),
  };
  return rng;
};

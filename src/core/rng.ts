import type { Rng } from './types';

/**
 * Deterministic mulberry32 PRNG. Pure (a function of its seed), so the core
 * stays reproducible — the bot uses it only to break ties among equally-scored
 * moves, never to choose among unequal ones.
 */
export const makeRng = (seed: number): Rng => {
  let a = seed >>> 0;
  return {
    next: (): number => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
};

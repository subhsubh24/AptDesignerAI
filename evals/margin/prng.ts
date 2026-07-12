/**
 * Tiny deterministic PRNG (mulberry32) for reproducible fuzz/randomized eval
 * cases. A fixed seed → the same "random" matrix every run, so a cost-per-outcome
 * measurement is comparable across runs and a fuzz regression is reproducible.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a deterministic element from `xs` using rng in [0,1). */
export function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length) % xs.length];
}

/** Deterministic integer in [lo, hi]. */
export function int(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

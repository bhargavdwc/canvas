/**
 * High-performance deterministic spatial hashing and PRNG utilities.
 * Uses integer bit-mixing to guarantee 100% reproducible results
 * across all coordinates without floating-point drift or Math.random().
 */

export const WORLD_ENVIRONMENT_SEED = 0x5f3759df;

/**
 * 32-bit integer finalizer (SplitMix32 / Murmur-style mixing).
 * Returns an unsigned 32-bit integer [0, 2^32 - 1].
 */
export function hash32(x: number, y: number, seed = WORLD_ENVIRONMENT_SEED): number {
  let h = (seed ^ Math.imul(x | 0, 0x9e3779b9) ^ Math.imul(y | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Returns a deterministic float in [0, 1) for a 2D integer coordinate.
 */
export function hash2DFloat(x: number, y: number, seed = WORLD_ENVIRONMENT_SEED): number {
  return hash32(x, y, seed) / 4294967296;
}

/**
 * Simple, fast deterministic PRNG sequence initialized with an integer seed.
 */
export class DeterministicPRNG {
  private state: number;

  constructor(seed: number) {
    this.state = (seed | 0) || 0x12345678;
  }

  /** Returns next pseudo-random float in [0, 1). */
  next(): number {
    // Xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  /** Returns pseudo-random float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns pseudo-random integer in [min, max] inclusive. */
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Returns true with the given probability [0, 1]. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Chooses random item from an array. */
  choice<T>(items: readonly T[]): T {
    const idx = Math.floor(this.next() * items.length);
    return items[idx]!;
  }
}

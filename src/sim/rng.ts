/**
 * Deterministic PRNG based on mulberry32.
 *
 * Determinism: given the same seed, `createRng` produces exactly the same
 * sequence of outputs every time, on every machine and every run, because
 * the generator is a pure function of its internal 32-bit state (no
 * dependence on wall-clock time, Math.random, or any other external
 * entropy source). This is essential for a simulation that needs to be
 * replayable: record the seed, replay the same events.
 */

export function createRng(seed: number) {
  let state = seed >>> 0;

  function next(): number {
    // mulberry32 step
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(min: number, max: number): number {
    const lo = Math.ceil(min);
    const hi = Math.floor(max);
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('pick: items must be non-empty');
    }
    const index = int(0, items.length - 1);
    // noUncheckedIndexedAccess: index is guaranteed in range by int(),
    // but TypeScript still sees this as T | undefined, so assert.
    return items[index] as T;
  }

  function getState(): number {
    return state;
  }

  return { next, int, pick, state: getState };
}

export type Rng = ReturnType<typeof createRng>;

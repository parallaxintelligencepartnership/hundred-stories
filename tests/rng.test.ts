import { describe, expect, it } from 'vitest';
import { createRng } from '../src/sim/rng';

describe('createRng', () => {
  it('same seed gives identical 100-number sequences', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('int stays within bounds over 1000 draws', () => {
    const rng = createRng(999);
    for (let i = 0; i < 1000; i++) {
      const value = rng.int(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
    }
  });

  it('pick returns a member of the input array', () => {
    const rng = createRng(42);
    const items = ['a', 'b', 'c', 'd'] as const;
    for (let i = 0; i < 50; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });
});

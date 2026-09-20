// The sim runs for everyone; the screen samples one in four so a full lobby reads
// as busy rather than as a swarm. This covers which ids make the cut.

import { describe, expect, it } from 'vitest';
import { CROWD_ONE_IN, inCrowd } from '../../src/render/renderer';
import type { Sim } from '../../src/sim/types';

function simWithId(id: number): Sim {
  return { id } as Sim;
}

describe('inCrowd', () => {
  it('draws ids 0, 4 and 8', () => {
    expect(inCrowd(simWithId(0))).toBe(true);
    expect(inCrowd(simWithId(4))).toBe(true);
    expect(inCrowd(simWithId(8))).toBe(true);
  });

  it('skips ids 1, 2, 3 and 5', () => {
    expect(inCrowd(simWithId(1))).toBe(false);
    expect(inCrowd(simWithId(2))).toBe(false);
    expect(inCrowd(simWithId(3))).toBe(false);
    expect(inCrowd(simWithId(5))).toBe(false);
  });

  it('keeps exactly one in four across a run of ids', () => {
    let count = 0;
    for (let id = 1; id <= 400; id++) if (inCrowd(simWithId(id))) count++;
    expect(count).toBe(400 / CROWD_ONE_IN);
  });
});

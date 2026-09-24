// The sim runs for everyone; the screen samples one in four so a full lobby reads
// as busy rather than as a swarm. This covers which ids make the cut, and that the picker
// offers only the sims the screen actually drew.

import { describe, expect, it } from 'vitest';
import { CROWD_ONE_IN, PICK_RADIUS_TILES, inCrowd, pickSimAt } from '../../src/render/renderer';
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

// A tap must never select a sim the crowd sample left out: the panel would open on a
// person the screen never drew. pickSimAt is the picker's rule, pulled out of the
// renderer closure so it can be tested without a GPU.
describe('pickSimAt', () => {
  function walker(id: number, floor: number, x: number): Sim {
    return { id, floor: 0, pos: { floor, x }, inCarId: null, state: 'walking' } as unknown as Sim;
  }

  it('picks a drawn sim under the tap', () => {
    const sims = [walker(4, 3, 120)];
    expect(pickSimAt(sims, 3, 120.2)?.id).toBe(4);
  });

  it('never picks a sim the crowd sample skipped, even right under the tap', () => {
    const sims = [walker(5, 3, 120), walker(6, 3, 120), walker(7, 3, 120)];
    expect(pickSimAt(sims, 3, 120)).toBeNull();
  });

  it('picks the drawn sim beside a skipped one standing on the same tile', () => {
    const sims = [walker(9, 3, 120), walker(8, 3, 120)];
    expect(pickSimAt(sims, 3, 120)?.id).toBe(8);
  });

  it('ignores a sim on another floor, out of reach, or inside a car', () => {
    expect(pickSimAt([walker(4, 2, 120)], 3, 120)).toBeNull();
    expect(pickSimAt([walker(4, 3, 120 + PICK_RADIUS_TILES + 0.1)], 3, 120)).toBeNull();
    const riding = { ...walker(4, 3, 120), state: 'riding' } as Sim;
    expect(pickSimAt([riding], 3, 120)).toBeNull();
  });

  it('takes the newest drawn sim when two overlap', () => {
    const sims = [walker(4, 3, 120), walker(12, 3, 120.4), walker(8, 3, 119.8)];
    expect(pickSimAt(sims, 3, 120)?.id).toBe(12);
  });

  it('with sample false, picks a sim the crowd sample would have skipped', () => {
    const sims = [walker(5, 3, 120)];
    expect(pickSimAt(sims, 3, 120, false)?.id).toBe(5);
  });
});

// Package 8b: the tower's recurring characters are few, so each is always drawn and can always
// be picked: the guards at their posts, the collectors, the VIP and the thief.
describe('recurring characters', () => {
  function person(id: number, kind: Sim['kind']): Sim {
    return { id, kind, pos: { floor: 3, x: 120 }, inCarId: null, state: 'walking' } as unknown as Sim;
  }

  it('draws every guard, collector, VIP and thief, whatever their id', () => {
    for (const kind of ['guard', 'collector', 'vip', 'thief'] as const) {
      for (const id of [1, 2, 3, 5]) expect(inCrowd(person(id, kind)), `${kind} ${id}`).toBe(true);
    }
  });

  it('keeps everyone else, housekeepers included, in the one in four sample', () => {
    for (const kind of ['worker', 'staff', 'visitor', 'shopper'] as const) {
      expect(inCrowd(person(1, kind)), kind).toBe(false);
      expect(inCrowd(person(4, kind)), kind).toBe(true);
    }
  });

  it('lets a tap pick a guard the sample would have skipped', () => {
    expect(pickSimAt([person(7, 'guard')], 3, 120)?.id).toBe(7);
  });
});

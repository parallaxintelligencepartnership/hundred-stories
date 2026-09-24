import { describe, expect, it } from 'vitest';
import { LOOK_KEYS, personIdentity, personName, VOICE_KEYS } from '../../src/sim/identity';
import { createWorld } from '../../src/sim/world';

describe('person identity', () => {
  it('is stable for a seed and an id, and differs across seeds', () => {
    const a = personIdentity(7, 42, 'worker');
    expect(personIdentity(7, 42, 'worker')).toEqual(a);
    const names = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) names.add(personIdentity(seed, 42, 'worker').name);
    expect(names.size).toBeGreaterThan(10);
  });

  it('gives a two word name, a look key 0 to 7 and a voice key 0 to 2', () => {
    for (let id = 1; id <= 500; id++) {
      const who = personIdentity(3, id, 'guest');
      expect(who.name.split(' ')).toHaveLength(2);
      expect(who.lookKey).toBeGreaterThanOrEqual(0);
      expect(who.lookKey).toBeLessThan(LOOK_KEYS);
      expect(who.voiceKey).toBeGreaterThanOrEqual(0);
      expect(who.voiceKey).toBeLessThan(VOICE_KEYS);
    }
  });

  it('spreads names and voices across a crowd', () => {
    const names = new Set<string>();
    const voices = new Set<number>();
    for (let id = 1; id <= 400; id++) {
      const who = personIdentity(11, id, 'worker');
      names.add(who.name);
      voices.add(who.voiceKey);
    }
    expect(names.size).toBeGreaterThan(300);
    expect(voices.size).toBe(VOICE_KEYS);
  });

  it('keeps the name when only the kind is unknown, so a person who left keeps it', () => {
    expect(personIdentity(5, 99, 'resident').name).toBe(personName(5, 99));
    expect(personIdentity(5, 99, 'staff').name).toBe(personName(5, 99));
  });

  it('never touches the world rng', () => {
    const world = createWorld(9);
    const before = world.rng.state();
    for (let id = 1; id < 100; id++) personIdentity(world.seed, id, 'worker');
    expect(world.rng.state()).toBe(before);
  });
});

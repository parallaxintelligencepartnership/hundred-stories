// world.longWaits counts hall waits over five minutes per game hour for the goals card. It is
// a display counter like structureVersion: it must never reach a save or the hash.
import { describe, expect, it } from 'vitest';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { createWorld, longWaitsInHour, recordLongWait } from '../../src/sim/world';

describe('long wait ring', () => {
  it('counts per absolute hour and forgets a slot the ring has lapped', () => {
    const world = createWorld(3);
    world.time.minute = 10 * 60 + 5;
    recordLongWait(world);
    recordLongWait(world);
    world.time.minute = 11 * 60;
    recordLongWait(world);
    expect(longWaitsInHour(world, 10)).toBe(2);
    expect(longWaitsInHour(world, 11)).toBe(1);
    expect(longWaitsInHour(world, 9)).toBe(0);

    world.time.minute = (10 + 24) * 60; // the same slot a day later starts from zero
    recordLongWait(world);
    expect(longWaitsInHour(world, 34)).toBe(1);
    expect(longWaitsInHour(world, 10)).toBe(0);
  });

  it('is neither saved nor hashed', () => {
    const world = createWorld(5);
    const hashBefore = hashWorld(world);
    const saveBefore = serialize(world);

    world.time.minute = 7 * 60;
    for (let i = 0; i < 13; i++) recordLongWait(world);
    world.time.minute = 6 * 60; // put the clock back so only the counter differs
    expect(longWaitsInHour(world, 7)).toBe(13);

    expect(hashWorld(world)).toBe(hashBefore);
    expect(serialize(world)).toBe(saveBefore);
    expect(serialize(world)).not.toContain('longWaits');

    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(longWaitsInHour(loaded.world, 7)).toBe(0);
  });
});

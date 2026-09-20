// world.log is capped at 2000 entries so the game never grows a save without bound, but the
// UI needs to tell new lines from old after the cap kicks in. logTotal is the counter that
// never gets trimmed.
import { describe, expect, it } from 'vitest';
import { createWorld, log } from '../../src/sim/world';
import { serialize, deserialize } from '../../src/sim/save';

describe('world.logTotal', () => {
  it('keeps counting past the 2,000 entry cap on world.log', () => {
    const world = createWorld(1);
    for (let i = 0; i < 2050; i += 1) log(world, `entry ${i}`);
    expect(world.log.length).toBe(2000);
    expect(world.logTotal).toBe(2050);
  });

  it('round trips logTotal through serialize/deserialize', () => {
    const world = createWorld(2);
    for (let i = 0; i < 2050; i += 1) log(world, `entry ${i}`);
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.logTotal).toBe(2050);
  });

  it('falls back to the log length when an older save has no logTotal key', () => {
    const world = createWorld(3);
    for (let i = 0; i < 10; i += 1) log(world, `entry ${i}`);
    const parsed = JSON.parse(serialize(world));
    delete parsed.logTotal;
    const result = deserialize(JSON.stringify(parsed));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.logTotal).toBe(result.world.log.length);
    expect(result.world.logTotal).toBe(10);
  });
});

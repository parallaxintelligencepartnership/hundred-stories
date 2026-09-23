// The status bar's two baselines are set at the quarter and day boundaries by the tick.
import { describe, expect, it } from 'vitest';
import { SCHEDULES } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import { createWorld } from '../../src/sim/world';

describe('status bar baselines', () => {
  it('a new game starts with its opening cash and zero people as the baselines', () => {
    const world = createWorld(1);
    expect(world.quarterStartCash).toBe(world.cash);
    expect(world.dayStartPopulation).toBe(0);
  });

  it('snapshots population at 00:00 and cash after the quarter settles', () => {
    const world = createWorld(1);
    world.quarterStartCash = null;
    world.dayStartPopulation = null;
    world.time.minute = 1440; // 00:00 on day 1
    world.population = 7;
    tick(world);
    expect(world.quarterStartCash).toBe(null); // midnight is a day boundary only
    expect(world.dayStartPopulation).toBe(world.population);

    // Day 3 is day 0 of the next quarter; the quarter settles at its start minute.
    world.time.minute = 3 * 1440 + SCHEDULES.quarterStartMinuteOfDay;
    world.cash = 777_000;
    tick(world);
    expect(world.quarterStartCash).toBe(world.cash);
    expect(world.dayStartPopulation).not.toBe(null);
  });
});

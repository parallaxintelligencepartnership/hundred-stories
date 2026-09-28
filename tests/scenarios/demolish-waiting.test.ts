/**
 * A shaft demolished under somebody waiting for it (audit 2026-09-28, lane B S4).
 *
 * A sim already on its way out never gives up (there is nothing left to abandon), and the
 * hall call retry returned early on a missing shaft, so it stood at the doors forever.
 */
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import type { Sim } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun, runMinutes } from './helpers';

describe('a shaft demolished under a waiting sim', () => {
  it('lets a sim on the way out stop waiting on it', () => {
    const world = createWorld(3);
    world.cash = 50_000_000;
    buildTower(world, [
      ...lobbyRun(100, 260),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 },
      { kind: 'shaft.build', shaft: 'standard', x: 240, floorMin: 1, floorMax: 4 },
      { kind: 'build', room: 'office', floor: 2, x: 160 },
      { kind: 'build', room: 'office', floor: 3, x: 160 },
      { kind: 'build', room: 'fastFood', floor: 4, x: 160 },
    ]);
    const a = [...world.shafts.values()][0]!;
    let victim: Sim | null = null;
    for (let i = 0; i < 3 * 1440 && !victim; i++) {
      runMinutes(world, 1);
      victim =
        [...world.sims.values()].find(
          (s) =>
            s.state === 'waiting' && s.exiting === true && s.pos.floor === 4 &&
            s.route[0]?.kind === 'ride' && s.route[0].shaftId === a.id &&
            a.cars.every((c) => c.passengers.length === 0),
        ) ?? null;
    }
    expect(victim).not.toBeNull();
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: a.id }).ok).toBe(true);
    runMinutes(world, 18);
    const after = world.sims.get(victim!.id);
    const stillOnA = after !== undefined && after.state === 'waiting' && after.route[0]?.kind === 'ride' && after.route[0].shaftId === a.id;
    expect(stillOnA).toBe(false);
  });
});

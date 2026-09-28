/**
 * Cockroaches in a hotel built before housekeeping (audit 2026-09-28, lane C S1).
 *
 * Nothing set by hand: four singles run with no housekeeping until a room infests on its
 * own, then the player builds housekeeping. Every single is clear within three days.
 */
import { describe, expect, it } from 'vitest';

import { clockOf } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildRow, buildTower, lobbyRun, runMinutes } from './helpers';

describe('housekeeping built after the cockroaches moved in', () => {
  it('clears every room within three days', () => {
    const world = createWorld(12345);
    buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 6 }]);
    world.stars = 2;
    world.cash = 50_000_000;
    buildTower(world, buildRow('hotelSingle', 2, [225, 230, 235, 240]));
    const singles = [...world.rooms.values()].filter((r) => r.kind === 'hotelSingle');
    let day = 0;
    while (!singles.some((r) => r.infested) && day < 12) {
      runMinutes(world, (361 - clockOf(world.time.minute).minuteOfDay + 1440) % 1440 || 1440);
      day += 1;
    }
    expect(singles.some((r) => r.infested)).toBe(true);
    world.stars = 2; // the probe's player: stars fall back with a small population
    buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 205 }]);
    const from = world.log.length;
    runMinutes(world, 3 * 1440);
    expect(singles.filter((r) => r.infested)).toEqual([]);
    expect(world.log.slice(from).some((l) => l.text.includes('the cockroaches are gone'))).toBe(true);
  });
});

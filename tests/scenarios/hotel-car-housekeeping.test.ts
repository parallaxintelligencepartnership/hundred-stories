// Elevator toggle diagnosis F1: a car kept for hotel guests must still carry the hotel's own
// housekeepers. Staff who serve a rider group ride that group's cars as its own riders, so a
// hotel whose only car is set to Hotel guests keeps its rooms clean and keeps booking.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { findRoute } from '../../src/sim/routing';
import { tick } from '../../src/sim/tick';
import type { Car, Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildRow, buildTower, lobbyRun, onlyShaft } from './helpers';

/** Lobby, one standard shaft 1 to 3, housekeeping on floor 2, three hotel singles on floor 3. */
function hotelTower(): World {
  const world = createWorld(12345);
  world.cash = 50_000_000;
  buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 3 }]);
  world.stars = 2;
  buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 205 }, ...buildRow('hotelSingle', 3, [205, 209, 213])]);
  return world;
}

function setServes(world: World, serves: Car['serves']): void {
  const car = onlyShaft(world).cars[0] as Car;
  const result = applyCommand(world, { kind: 'shaft.setCarServes', shaftId: car.shaftId, carId: car.id, serves });
  expect(result.ok).toBe(true);
}

describe('F1: a Hotel guests car carries the hotel staff', () => {
  it('cleans the rooms and keeps booking over four days when the only car is set to Hotel guests', () => {
    const world = hotelTower();
    setServes(world, 'hotel');
    const singles = [...world.rooms.values()].filter((r) => r.kind === 'hotelSingle') as Room[];
    const guestsLateOn = new Set<number>();
    let keeperRides = 0;
    for (let i = 0; i < 4 * 1440; i++) {
      tick(world);
      const car = onlyShaft(world).cars[0] as Car;
      for (const id of car.passengers) if (world.sims.get(id)?.kind === 'staff') keeperRides++;
      if (world.time.minute >= 2 * 1440) {
        for (const room of singles) for (const id of room.tenants) if (world.sims.get(id)?.kind === 'guest') guestsLateOn.add(id);
      }
    }
    const cleans = world.log.filter((l) => l.text.startsWith('Housekeeping cleaned')).length;
    expect(keeperRides).toBeGreaterThan(0);
    expect(cleans).toBeGreaterThan(0);
    expect(singles.filter((r) => r.dirty).length).toBeLessThan(singles.length);
    expect(guestsLateOn.size).toBeGreaterThan(0); // the hotel still books on days three and four
  });

  it('plans service staff onto the cars of the groups they work for, and nobody else', () => {
    const world = hotelTower();
    setServes(world, 'hotel');
    const from = { floor: 1, x: 150 };
    const to = { floor: 3, x: 207 };
    // Housekeepers plan as hotel riders; guards and collectors (work in every room) plan on every car.
    expect(findRoute(world, from, to, { staff: true, riderClass: 'hotel' })).not.toBeNull();
    expect(findRoute(world, from, to, { staff: true, riderClass: 'other' })).not.toBeNull();
    // A shopper or resident is still not planned onto a dedicated car, and a worker not onto a hotel car.
    expect(findRoute(world, from, to, { riderClass: 'other' })).toBeNull();
    expect(findRoute(world, from, to, { riderClass: 'office' })).toBeNull();
    setServes(world, 'office');
    expect(findRoute(world, from, to, { staff: true, riderClass: 'hotel' })).toBeNull(); // housekeepers do not work in offices
    expect(findRoute(world, from, to, { staff: true, riderClass: 'other' })).not.toBeNull();
  });
});

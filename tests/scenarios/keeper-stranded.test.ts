// Elevator toggle diagnosis F3: a housekeeper cleaning when its way home goes must never be
// parked in the hotel room for good. It keeps trying; once a route exists again it goes back
// to work, and if none comes back (the only shaft demolished) it leaves the tower.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { tick } from '../../src/sim/tick';
import type { Car, Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildRow, buildTower, lobbyRun, onlyShaft } from './helpers';

function hotelTower(): { world: World; office: Room } {
  const world = createWorld(12345);
  world.cash = 50_000_000;
  buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 3 }]);
  world.stars = 2;
  buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 205 }, ...buildRow('hotelSingle', 3, [205, 209, 213])]);
  const office = [...world.rooms.values()].find((r) => r.kind === 'housekeeping') as Room;
  return { world, office };
}

function setServes(world: World, serves: Car['serves']): void {
  const car = onlyShaft(world).cars[0] as Car;
  const result = applyCommand(world, { kind: 'shaft.setCarServes', shaftId: car.shaftId, carId: car.id, serves });
  expect(result.ok).toBe(true);
}

/** Tick until a housekeeper is inside a hotel room, and return it with that room's id. */
function keeperMidClean(world: World, office: Room): { keeper: Sim; roomId: number } {
  for (let i = 0; i < 5 * 1440; i++) {
    tick(world);
    const keeper = [...world.sims.values()].find((s) => s.kind === 'staff' && s.inRoomId !== null && s.inRoomId !== office.id);
    if (keeper) return { keeper, roomId: keeper.inRoomId as number };
  }
  throw new Error('no housekeeper ever went to clean');
}

describe('F3: a housekeeper whose way home is switched off', () => {
  it('is back at work within a day once the car is switched to Office staff and back', () => {
    const { world, office } = hotelTower();
    const { keeper, roomId } = keeperMidClean(world, office);
    setServes(world, 'office');
    for (let i = 0; i < 60; i++) tick(world);
    setServes(world, 'any');
    let backInOffice = false;
    for (let i = 0; i < 1440 && !backInOffice; i++) {
      tick(world);
      backInOffice = world.sims.get(keeper.id)?.inRoomId === office.id;
    }
    expect(backInOffice).toBe(true);
    expect(world.sims.get(keeper.id)?.inRoomId).not.toBe(roomId);
  });

  it('leaves the tower within a day when no route ever comes back', () => {
    const { world, office } = hotelTower();
    const { keeper, roomId } = keeperMidClean(world, office);
    // The only shaft goes: a car kept for somebody else still carries the keeper when free.
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: onlyShaft(world).id }).ok).toBe(true);
    for (let i = 0; i < 1440; i++) tick(world);
    const after = world.sims.get(keeper.id);
    expect(after?.inRoomId ?? null).not.toBe(roomId);
    expect(after).toBeUndefined();
    // The office hires a replacement, so housekeeping is not left a keeper short.
    expect(office.tenants.length).toBeGreaterThan(0);
    expect(office.tenants).not.toContain(keeper.id);
  });

  it('cleans the room once, however many times it retries for a way home (P5-A3)', () => {
    const { world, office } = hotelTower();
    const { keeper, roomId } = keeperMidClean(world, office);
    const logged = world.logTotal;
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: onlyShaft(world).id }).ok).toBe(true);
    let retries = 0;
    let stay = keeper.stayUntil;
    for (let i = 0; i < 1440 && world.sims.has(keeper.id); i++) {
      tick(world);
      const now = world.sims.get(keeper.id)?.stayUntil ?? null;
      if (now !== null && now !== stay) retries += 1;
      stay = now;
    }
    expect(retries).toBeGreaterThan(2); // it did retry, each a pass through the clean
    const since = world.log.slice(Math.max(0, world.log.length - (world.logTotal - logged)));
    const cleans = since.filter((e) => e.roomId === roomId && e.text.startsWith('Housekeeping cleaned a hotel room'));
    expect(cleans.length).toBeLessThanOrEqual(1);
  });
});

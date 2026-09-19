import { beforeEach, describe, expect, it } from 'vitest';
import { evaluateRoom, noisyNeighborsOf, tickEvaluation } from '../../src/sim/evaluation';
import { EVAL, NOISE, ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '../../src/sim/world';

// Rooms and sims are built by hand per the brief: build.ts and people.ts are
// owned by other agents and must not be depended on here.
function place(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    ...extra,
  };
  addRoom(world, room);
  return room;
}

function tenant(world: World, room: Room, stress: number): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind: room.kind === 'office' ? 'worker' : 'resident',
    homeRoomId: room.id,
    pos: { floor: room.floor, x: room.x },
    inCarId: null,
    inRoomId: room.id,
    route: [],
    state: 'inRoom',
    stress,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  room.tenants.push(sim.id);
  room.occupancy += 1;
  return sim;
}

let world: World;
beforeEach(() => {
  world = createWorld(20260918);
  place(world, 'lobby', 1, 100);
});

describe('room eval', () => {
  it('a quiet room with no noise and no stress scores 1', () => {
    const office = place(world, 'office', 3, 100);
    tickEvaluation(world);
    expect(office.eval).toBe(1);
  });

  it('a room that is not quiet scores 1 even sitting on top of the noise', () => {
    const shop = place(world, 'shop', 3, 100);
    place(world, 'fastFood', 3, 112);
    place(world, 'cinema', 2, 100);
    tickEvaluation(world);
    expect(shop.eval).toBe(1);
  });

  it('fast food exactly at the fast food to office range still bothers the office', () => {
    const office = place(world, 'office', 3, 100);
    place(world, 'fastFood', 3, 100 + ROOMS.office.width + NOISE.fastFoodToOfficeTiles);
    tickEvaluation(world);
    expect(noisyNeighborsOf(world, office)).toHaveLength(1);
    expect(office.eval).toBeCloseTo(1 - EVAL.noisePenaltyPerNeighbor, 10);
  });

  it('fast food one tile past the range leaves the office alone', () => {
    const office = place(world, 'office', 3, 100);
    place(world, 'fastFood', 3, 100 + ROOMS.office.width + NOISE.fastFoodToOfficeTiles + 1);
    tickEvaluation(world);
    expect(noisyNeighborsOf(world, office)).toHaveLength(0);
    expect(office.eval).toBe(1);
  });

  it('a restaurant next door does not bother an office, only fast food does', () => {
    const office = place(world, 'office', 3, 100);
    place(world, 'restaurant', 3, 109);
    tickEvaluation(world);
    expect(office.eval).toBe(1);
  });

  it('commercial noise exactly at the hotel and condo range bothers a condo', () => {
    const condo = place(world, 'condo', 3, 100);
    place(world, 'restaurant', 3, 100 + ROOMS.condo.width + NOISE.commercialToHotelOrCondoTiles);
    tickEvaluation(world);
    expect(condo.eval).toBeCloseTo(1 - EVAL.noisePenaltyPerNeighbor, 10);
  });

  it('commercial noise one tile past the range leaves the condo alone', () => {
    const condo = place(world, 'condo', 3, 100);
    place(world, 'restaurant', 3, 100 + ROOMS.condo.width + NOISE.commercialToHotelOrCondoTiles + 1);
    tickEvaluation(world);
    expect(condo.eval).toBe(1);
  });

  it('a shop within range bothers a hotel room', () => {
    const suite = place(world, 'hotelSuite', 4, 200);
    place(world, 'shop', 4, 200 + ROOMS.hotelSuite.width + NOISE.commercialToHotelOrCondoTiles);
    tickEvaluation(world);
    expect(suite.eval).toBeCloseTo(1 - EVAL.noisePenaltyPerNeighbor, 10);
  });

  it('an office within range bothers a condo', () => {
    const condo = place(world, 'condo', 5, 100);
    place(world, 'office', 5, 100 + ROOMS.condo.width + NOISE.officeToHotelOrCondoTiles);
    tickEvaluation(world);
    expect(condo.eval).toBeCloseTo(1 - EVAL.noisePenaltyPerNeighbor, 10);
  });

  it('an office next to another office is not noise', () => {
    const office = place(world, 'office', 5, 100);
    place(world, 'office', 5, 109);
    tickEvaluation(world);
    expect(office.eval).toBe(1);
  });

  it('a noisy room directly below with overlapping x counts as a neighbor', () => {
    const office = place(world, 'office', 3, 100);
    place(world, 'fastFood', 2, 96);
    tickEvaluation(world);
    expect(noisyNeighborsOf(world, office)).toHaveLength(1);
    expect(office.eval).toBeCloseTo(1 - EVAL.noisePenaltyPerNeighbor, 10);
  });

  it('a noisy room directly below with no x overlap does not count', () => {
    const office = place(world, 'office', 3, 100);
    place(world, 'fastFood', 2, 200);
    tickEvaluation(world);
    expect(office.eval).toBe(1);
  });

  it('tenant stress costs stressWeight times the average', () => {
    const office = place(world, 'office', 3, 100);
    tenant(world, office, 0.5);
    tenant(world, office, 0.1);
    tickEvaluation(world);
    expect(office.eval).toBeCloseTo(1 - EVAL.stressWeight * 0.3, 10);
  });

  it('a dirty hotel room loses the dirty penalty', () => {
    const room = place(world, 'hotelTwin', 6, 100, { dirty: true });
    tickEvaluation(world);
    expect(room.eval).toBeCloseTo(1 - EVAL.dirtyPenalty, 10);
  });

  it('an infested hotel room bottoms out at zero', () => {
    const room = place(world, 'hotelSingle', 6, 100, { infested: true });
    tickEvaluation(world);
    expect(room.eval).toBe(0);
  });

  it('evaluateRoom does not mutate the room it scores', () => {
    const office = place(world, 'office', 3, 100, { eval: 0.5 });
    expect(evaluateRoom(world, office)).toBe(1);
    expect(office.eval).toBe(0.5);
  });
});

describe('tenants leaving', () => {
  function unhappyOffice(): Room {
    const office = place(world, 'office', 3, 100);
    tenant(world, office, 0.3);
    tenant(world, office, 0.3);
    place(world, 'fastFood', 2, 100); // below, x overlap
    place(world, 'fastFood', 4, 100); // above, x overlap
    place(world, 'fastFood', 3, 84); // same floor, touching
    return office;
  }

  it('the first hour below the threshold only starts the clock', () => {
    const office = unhappyOffice();
    tickEvaluation(world);
    expect(office.eval).toBeLessThan(EVAL.leaveThreshold);
    expect(office.lowEvalSinceMinute).toBe(world.time.minute);
    expect(office.vacant).toBe(false);
  });

  it('an eval that recovers clears the clock', () => {
    const office = unhappyOffice();
    tickEvaluation(world);
    expect(office.lowEvalSinceMinute).not.toBeNull();
    for (const id of [...world.rooms.keys()]) {
      const room = world.rooms.get(id) as Room;
      if (room.kind === 'fastFood') world.rooms.delete(id);
    }
    world.floorIndex.rooms.clear();
    for (const room of world.rooms.values()) {
      for (let f = room.floor; f < room.floor + room.height; f++) {
        const list = world.floorIndex.rooms.get(f) ?? [];
        list.push(room);
        world.floorIndex.rooms.set(f, list);
      }
    }
    tickEvaluation(world);
    expect(office.lowEvalSinceMinute).toBeNull();
  });

  it('tenants stay one minute short of the leave window', () => {
    const office = unhappyOffice();
    tickEvaluation(world);
    const start = world.time.minute;
    world.time.minute = start + EVAL.leaveAfterMinutes - 1;
    tickEvaluation(world);
    expect(office.tenants).toHaveLength(2);
    expect(office.vacant).toBe(false);
  });

  it('tenants leave once the window is up, with a reason that names the cause and the floor', () => {
    const office = unhappyOffice();
    const leavers = office.tenants.map((id) => world.sims.get(id) as Sim);
    tickEvaluation(world);
    world.time.minute = (office.lowEvalSinceMinute as number) + EVAL.leaveAfterMinutes;
    tickEvaluation(world);

    expect(office.tenants).toHaveLength(0);
    expect(office.vacant).toBe(true);
    expect(office.lowEvalSinceMinute).toBeNull();
    for (const sim of leavers) {
      expect(sim.state).toBe('leaving');
      expect(sim.leaveReason).toBe('Too noisy next to the fast food on floor 3.');
    }
    expect(world.stats.tenantsLeftReasons['Too noisy next to the fast food on floor 3.']).toBe(2);
    expect(world.log.some((entry) => entry.text === 'Too noisy next to the fast food on floor 3.')).toBe(true);
  });

  it('a condo goes back on sale when its residents leave', () => {
    const condo = place(world, 'condo', 3, 100);
    tenant(world, condo, 1);
    place(world, 'restaurant', 3, 116);
    tickEvaluation(world);
    world.time.minute = (condo.lowEvalSinceMinute as number) + EVAL.leaveAfterMinutes;
    tickEvaluation(world);
    expect(condo.vacant).toBe(true);
    expect(condo.tenants).toHaveLength(0);
  });

  it('a hotel room keeps its rentable state when the guests walk out', () => {
    const room = place(world, 'hotelSingle', 6, 100, { infested: true });
    const guest = tenant(world, room, 0);
    tickEvaluation(world);
    world.time.minute = (room.lowEvalSinceMinute as number) + EVAL.leaveAfterMinutes;
    tickEvaluation(world);
    expect(room.vacant).toBe(false);
    expect(room.tenants).toHaveLength(0);
    expect(guest.leaveReason).toBe('Cockroaches in the single room on floor 6.');
  });

  it('the biggest penalty writes the reason, so a filthy room blames housekeeping', () => {
    const room = place(world, 'hotelTwin', 6, 100, { dirty: true });
    tenant(world, room, 0.3); // stress penalty 0.18
    place(world, 'fastFood', 6, 109); // one noisy neighbor, 0.2
    tickEvaluation(world);
    expect(room.eval).toBeLessThan(EVAL.leaveThreshold);
    world.time.minute = (room.lowEvalSinceMinute as number) + EVAL.leaveAfterMinutes;
    tickEvaluation(world);
    expect(room.tenants).toHaveLength(0);
    expect(world.stats.tenantsLeftReasons['Nobody cleaned the twin room on floor 6.']).toBe(1);
  });

  it('a tower where everyone waits blames the elevators', () => {
    const office = place(world, 'office', 9, 100);
    tenant(world, office, 1);
    place(world, 'fastFood', 9, 109);
    tickEvaluation(world);
    world.time.minute = (office.lowEvalSinceMinute as number) + EVAL.leaveAfterMinutes;
    tickEvaluation(world);
    expect(world.stats.tenantsLeftReasons['Too long waiting for an elevator on floor 9.']).toBe(1);
  });
});

// A car's rider setting means "those riders first" (Matt, 2026-09-29): the chosen riders get
// priority, and everyone else still plans on the car and rides it when it is free. So a floor
// whose only car is kept for somebody else keeps its people, a housekeeper cut off by a
// demolition goes back to work or leaves so a replacement is hired, and guards ride any car.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { requestHallCall } from '../../src/sim/elevators';
import { SHAFTS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import { riderClassOf } from '../../src/sim/types';
import type { Car, Room, Shaft, Sim, SimKind, World } from '../../src/sim/types';
import { addShaft, addSim, allocId, createWorld } from '../../src/sim/world';
import { buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching, simsOfKind } from './helpers';

function setServes(world: World, serves: Car['serves']): void {
  const car = onlyShaft(world).cars[0] as Car;
  const result = applyCommand(world, { kind: 'shaft.setCarServes', shaftId: car.shaftId, carId: car.id, serves });
  expect(result.ok).toBe(true);
}

function only(world: World, kind: Room['kind']): Room {
  const room = roomsMatching(world, kind)[0];
  if (!room) throw new Error(`no ${kind}`);
  return room;
}

describe('F2: a condo whose only car is set to Office staff', () => {
  it('sells, keeps its residents over four days, and they ride the car', () => {
    const world = createWorld(11);
    world.cash = 50_000_000;
    buildTower(world, [
      ...lobbyRun(100, 159),
      { kind: 'build', room: 'condo', floor: 2, x: 100 },
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 2 },
    ]);
    setServes(world, 'office');
    const condo = only(world, 'condo');
    const riders = new Set<number>();
    let soldAt: number | null = null;
    for (let i = 0; i < 4 * 1440; i++) {
      tick(world);
      const car = onlyShaft(world).cars[0] as Car;
      for (const id of car.passengers) if (world.sims.get(id)?.kind === 'resident') riders.add(id);
      if (soldAt === null && !condo.vacant) soldAt = world.time.minute;
      if (soldAt !== null) expect(condo.vacant, `vacated at minute ${world.time.minute}`).toBe(false);
    }
    expect(soldAt).not.toBeNull();
    expect(condo.tenants).toHaveLength(3);
    expect(riders.size).toBeGreaterThan(0);
    expect(world.log.some((e) => /no way in/.test(e.text))).toBe(false);
  });
});

/** Lobby, one standard shaft 1 to 3, housekeeping on floor 2, three hotel singles on floor 3. */
function hotelTower(): { world: World; office: Room } {
  const world = createWorld(12345);
  world.cash = 50_000_000;
  buildTower(world, [...lobbyRun(150, 243), { kind: 'shaft.build', shaft: 'standard', x: 160, floorMin: 1, floorMax: 3 }]);
  world.stars = 2;
  buildTower(world, [{ kind: 'build', room: 'housekeeping', floor: 2, x: 205 }, ...buildRow('hotelSingle', 3, [205, 209, 213])]);
  return { world, office: only(world, 'housekeeping') };
}

/** Tick until a housekeeper is on its way (walking or at the doors, not aboard) with the given floor and goal. */
function keeperOnTheWay(world: World, floor: number, toOffice: boolean, office: Room): Sim {
  for (let i = 0; i < 5 * 1440; i++) {
    tick(world);
    const shaft = onlyShaft(world);
    if (shaft.cars.some((c) => c.passengers.length > 0)) continue;
    const keeper = [...world.sims.values()].find((s) => {
      if (s.kind !== 'staff' || s.inCarId !== null || s.pos.floor !== floor) return false;
      if (s.state !== 'walking' && s.state !== 'waiting') return false;
      if (!s.route.some((l) => l.kind === 'ride')) return false;
      const enter = s.route.find((l) => l.kind === 'enter');
      return enter !== undefined && enter.kind === 'enter' && (enter.roomId === office.id) === toOffice;
    });
    if (keeper) return keeper;
  }
  throw new Error('no housekeeper was ever on that way');
}

function demolishShaft(world: World): void {
  const shaft = onlyShaft(world);
  const result = applyCommand(world, { kind: 'shaft.demolish', shaftId: shaft.id });
  expect(result).toEqual({ ok: true });
}

describe('a housekeeper whose way is demolished under it', () => {
  it('goes back to housekeeping when a way there still exists', () => {
    const { world, office } = hotelTower();
    const keeper = keeperOnTheWay(world, 2, false, office);
    demolishShaft(world);
    let back = false;
    for (let i = 0; i < 120 && !back; i++) {
      tick(world);
      back = world.sims.get(keeper.id)?.inRoomId === office.id;
    }
    expect(back).toBe(true);
    expect(office.tenants).toContain(keeper.id);
  });

  it('leaves the tower, and the office hires a replacement, when no way back exists', () => {
    const { world, office } = hotelTower();
    const keeper = keeperOnTheWay(world, 3, true, office);
    demolishShaft(world);
    for (let i = 0; i < 1440; i++) tick(world);
    expect(world.sims.get(keeper.id)).toBeUndefined();
    expect(office.tenants).not.toContain(keeper.id);
    expect(office.tenants.length).toBeGreaterThan(0);
    for (const id of office.tenants) expect(world.sims.get(id)?.state).not.toBe('outside');
  });
});

describe('a guard on a dedicated car', () => {
  it('rides the only car, set to Hotel guests, from floor to floor on patrol', () => {
    const world = createWorld(11);
    world.stars = 3;
    world.cash = 500_000_000;
    const script = [...lobbyRun(90, 200), { kind: 'shaft.build' as const, shaft: 'standard' as const, x: 150, floorMin: 1, floorMax: 4 }];
    for (let f = 2; f <= 4; f++) script.push(...buildRow('office', f, [100]));
    script.push({ kind: 'build', room: 'security', floor: 2, x: 152 });
    buildTower(world, script);
    setServes(world, 'hotel');
    const rides = new Map<number, Set<number>>(); // guard id -> floors it got off on
    const aboard = new Map<number, number>(); // guard id -> floor it boarded on
    for (let i = 0; i < 2 * 1440; i++) {
      tick(world);
      const car = onlyShaft(world).cars[0] as Car;
      for (const guard of simsOfKind(world, 'guard')) {
        if (guard.inCarId === car.id) {
          if (!aboard.has(guard.id)) aboard.set(guard.id, guard.pos.floor);
        } else if (aboard.has(guard.id)) {
          const from = aboard.get(guard.id) as number;
          aboard.delete(guard.id);
          if (guard.pos.floor !== from) {
            let set = rides.get(guard.id);
            if (!set) rides.set(guard.id, (set = new Set()));
            set.add(guard.pos.floor);
          }
        }
      }
    }
    const floors = new Set<number>();
    for (const set of rides.values()) for (const f of set) floors.add(f);
    expect(rides.size).toBeGreaterThan(0);
    expect(floors.size).toBeGreaterThan(1);
  });
});

/** A waiting rider at the doors of this shaft, hall call lit, walking off at the far end. */
function waiter(world: World, shaft: Shaft, kind: SimKind, from: number, to: number): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind,
    homeRoomId: null,
    pos: { floor: from, x: shaft.x },
    inCarId: null,
    inRoomId: null,
    route: [
      { kind: 'ride', shaftId: shaft.id, fromFloor: from, toFloor: to },
      { kind: 'walk', toX: shaft.x },
    ],
    state: 'waiting',
    stress: 0,
    waitStart: world.time.minute,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  requestHallCall(world, shaft.id, from, to > from ? 1 : -1, riderClassOf(kind));
  return sim;
}

describe('a kept car that always has its own riders coming (owner question 1)', () => {
  it('still carries a worker waiting on its way, instead of leaving them to give up', () => {
    const world = createWorld(5);
    world.time.minute = 17 * 60; // a weekday evening
    const stops = new Set<number>();
    for (let f = 1; f <= 10; f++) stops.add(f);
    const shaft: Shaft = {
      id: allocId(world),
      kind: 'standard',
      x: 150,
      width: SHAFTS.standard.width,
      floorMin: 1,
      floorMax: 10,
      stops,
      homeFloor: 1,
      cars: [],
      hallCalls: new Map(),
    };
    shaft.cars.push({
      id: allocId(world),
      shaftId: shaft.id,
      y: 1,
      dir: 0,
      state: 'idle',
      doorTimer: 0,
      idleSince: null,
      passengers: [],
      calls: new Set(),
      serves: 'hotel',
      range: null,
    });
    addShaft(world, shaft);
    world.routingDirty = true;

    // A guest arrives at the lobby for the top floor every 20 minutes, so the car always has
    // a call of its own; half an hour in, a worker on floor 5 wants the lobby.
    let worker: Sim | null = null;
    let boardedAfter = -1;
    for (let t = 0; t < 120; t++) {
      if (t % 20 === 0) waiter(world, shaft, 'guest', 1, 10);
      if (t === 30) worker = waiter(world, shaft, 'worker', 5, 1);
      tick(world);
      if (worker && boardedAfter < 0 && worker.inCarId !== null) boardedAfter = t - 30;
    }
    expect(worker?.leaveReason ?? null).toBeNull();
    expect(boardedAfter).toBeGreaterThanOrEqual(0);
    expect(boardedAfter).toBeLessThanOrEqual(25);
  });
});

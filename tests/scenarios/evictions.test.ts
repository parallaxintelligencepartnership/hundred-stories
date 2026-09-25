// Audit 2026-09-25 B S4 and B S5: when a room is lost to demolition, fire or a bomb, its
// tenants are taken out of wherever they are. Out of another room: that room gets the seat
// back, so occupancy always matches the people really inside. Out of a car: the rider gets
// off at the car's next door opening and walks out, never left aboard in name only.

import { afterEach, describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { requestHallCall } from '../../src/sim/elevators';
import { EVENT_TEST_HOOKS, handleEventCommand, resetEventTestHooks, startBomb, startFire } from '../../src/sim/events';
import { tick, tickMany } from '../../src/sim/tick';
import type { Room, Sim, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { buildTower, lobbyRun, onlyShaft } from './helpers';

afterEach(() => resetEventTestHooks());

/** Rooms whose occupancy differs from the people whose inRoomId is that room (guards and collectors never count). */
function phantomRooms(world: World): string[] {
  const real = new Map<number, number>();
  for (const sim of world.sims.values()) {
    if (sim.inRoomId === null || sim.kind === 'guard' || sim.kind === 'collector') continue;
    real.set(sim.inRoomId, (real.get(sim.inRoomId) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const room of world.rooms.values()) {
    const inside = real.get(room.id) ?? 0;
    if (room.occupancy !== inside) out.push(`${room.kind} ${room.id} occupancy ${room.occupancy} real ${inside}`);
  }
  return out;
}

/** Five offices on floor 2, a fast food on floor 3, one shaft: workers go up for lunch. */
function lunchTower(): { world: World; offices: Room[]; fastFood: Room } {
  const world = createWorld(11);
  world.cash = 50_000_000;
  world.stars = 3;
  buildTower(world, [
    ...lobbyRun(100, 199),
    ...[100, 109, 118, 127, 136].map((x) => ({ kind: 'build' as const, room: 'office' as const, floor: 2, x })),
    { kind: 'build', room: 'fastFood', floor: 3, x: 100 },
    { kind: 'shaft.build', shaft: 'standard', x: 197, floorMin: 1, floorMax: 3 },
  ]);
  const offices = [...world.rooms.values()].filter((r) => r.kind === 'office');
  const fastFood = [...world.rooms.values()].find((r) => r.kind === 'fastFood') as Room;
  return { world, offices, fastFood };
}

/** Run until a tenant sits in the fast food, optionally from an office nobody is in. */
function untilTenantAtLunch(world: World, offices: Room[], fastFood: Room, emptyOffice: boolean): { office: Room; sim: Sim } {
  for (let i = 0; i < 4 * 1440; i++) {
    tick(world);
    for (const office of offices) {
      if (emptyOffice && office.occupancy !== 0) continue;
      for (const id of office.tenants) {
        const sim = world.sims.get(id);
        if (sim && sim.state === 'inRoom' && sim.inRoomId === fastFood.id) return { office, sim };
      }
    }
  }
  throw new Error('no tenant ever sat in the fast food');
}

describe('B S4: occupancy matches the people inside after a room is lost', () => {
  it('fire: a tenant at lunch when their office burns leaves no phantom in the fast food', () => {
    const { world, offices, fastFood } = lunchTower();
    const { office, sim } = untilTenantAtLunch(world, offices, fastFood, false);
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' }).ok).toBe(true);
    expect(world.rooms.has(office.id)).toBe(false);
    expect(sim.inRoomId).toBeNull();
    expect(phantomRooms(world)).toEqual([]);
    tickMany(world, 60);
    expect(phantomRooms(world)).toEqual([]);
  });

  it('bomb: a tenant at lunch when their office is destroyed leaves no phantom in the fast food', () => {
    const { world, offices, fastFood } = lunchTower();
    const { office, sim } = untilTenantAtLunch(world, offices, fastFood, false);
    EVENT_TEST_HOOKS.target.bomb = office.id;
    startBomb(world);
    const bomb = world.events.find((e) => e.kind === 'bomb');
    if (!bomb || bomb.kind !== 'bomb') throw new Error('no bomb');
    bomb.detonateAt = world.time.minute;
    tick(world);
    expect(world.rooms.has(office.id)).toBe(false);
    expect(world.rooms.has(fastFood.id)).toBe(true);
    expect(sim.inRoomId).toBeNull();
    expect(phantomRooms(world)).toEqual([]);
  });

  it('fire: a housekeeper cleaning when the housekeeping office burns leaves no phantom guest', () => {
    const world = createWorld(11);
    world.cash = 50_000_000;
    world.stars = 2;
    buildTower(world, [
      ...lobbyRun(100, 199),
      ...[100, 104, 108, 112, 116, 120].map((x) => ({ kind: 'build' as const, room: 'hotelSingle' as const, floor: 2, x })),
      { kind: 'build', room: 'housekeeping', floor: 3, x: 100 },
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
    ]);
    const office = [...world.rooms.values()].find((r) => r.kind === 'housekeeping') as Room;
    let keeper: Sim | undefined;
    for (let i = 0; i < 4 * 1440 && !keeper; i++) {
      tick(world);
      keeper = [...world.sims.values()].find((s) => s.kind === 'staff' && s.state === 'inRoom' && s.inRoomId !== office.id);
    }
    if (!keeper) throw new Error('no keeper ever cleaned');
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(world);
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' }).ok).toBe(true);
    expect(phantomRooms(world)).toEqual([]);
  });

  it('demolish: a condo or office demolished while its tenant is out heals within the hour', () => {
    // The demolish command itself lives in build.ts (another package); until it frees the
    // seat directly, the hourly recount in people.ts puts the count right.
    const world = createWorld(11);
    world.cash = 50_000_000;
    world.stars = 3;
    buildTower(world, [
      ...lobbyRun(100, 199),
      ...[100, 116, 132, 148, 164].map((x) => ({ kind: 'build' as const, room: 'condo' as const, floor: 2, x })),
      { kind: 'build', room: 'restaurant', floor: 3, x: 100 },
      { kind: 'shaft.build', shaft: 'standard', x: 197, floorMin: 1, floorMax: 3 },
    ]);
    const condos = [...world.rooms.values()].filter((r) => r.kind === 'condo');
    const restaurant = [...world.rooms.values()].find((r) => r.kind === 'restaurant') as Room;
    const { office: condo } = untilTenantAtLunch(world, condos, restaurant, true);
    expect(applyCommand(world, { kind: 'demolish', roomId: condo.id }).ok).toBe(true);
    tickMany(world, 60);
    expect(phantomRooms(world)).toEqual([]);
  });
});

describe('B S5: a rider whose room burns mid ride', () => {
  it('gets off at the next door opening and is gone within 30 minutes, never aboard in name only', () => {
    const world = createWorld(11);
    world.cash = 50_000_000;
    buildTower(world, [
      ...lobbyRun(100, 159),
      ...[2, 3, 4, 5].map((floor) => ({ kind: 'build' as const, room: 'office' as const, floor, x: 100 })),
      { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 },
    ]);
    const shaft = onlyShaft(world);
    const car = shaft.cars[0];
    if (!car) throw new Error('no car');
    const office5 = [...world.rooms.values()].find((r) => r.kind === 'office' && r.floor === 5) as Room;
    // Quiet: no other office ever leases, so nobody else calls the car.
    for (const room of world.rooms.values()) if (room.kind === 'office') room.vacant = false;
    const sim: Sim = {
      id: world.nextId++,
      kind: 'worker',
      homeRoomId: office5.id,
      pos: { floor: 3, x: 150 },
      inCarId: null,
      inRoomId: null,
      route: [
        { kind: 'ride', shaftId: shaft.id, fromFloor: 3, toFloor: 5 },
        { kind: 'walk', toX: 104 },
        { kind: 'enter', roomId: office5.id },
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
    world.sims.set(sim.id, sim);
    office5.tenants.push(sim.id);
    requestHallCall(world, shaft.id, 3, 1, 'office');
    for (let i = 0; i < 10 && sim.state !== 'riding'; i++) tick(world);
    tick(world);
    expect(sim.state).toBe('riding');

    EVENT_TEST_HOOKS.target.fire = office5.id;
    startFire(world);
    expect(handleEventCommand(world, { kind: 'fire.callHelicopter' }).ok).toBe(true);

    const notRiding = (): number[] => car.passengers.filter((id) => world.sims.get(id)?.state !== 'riding');
    expect(notRiding()).toEqual([]);
    let goneAfter: number | null = null;
    for (let i = 1; i <= 30; i++) {
      tick(world);
      expect(notRiding()).toEqual([]);
      if (!world.sims.has(sim.id)) {
        goneAfter = i;
        break;
      }
    }
    expect(goneAfter).not.toBeNull();
    expect(car.passengers).not.toContain(sim.id);
  });
});

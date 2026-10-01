// Housekeeping and the rooms it can reach (game readiness review 2026-10-01, F5 and F6).
// F5: one dirty hotel room with no route from the office held up every keeper, so a later room
// that could be reached was never cleaned either. Now a keeper takes the first room it can reach,
// the rooms nobody can reach are listed for the UI, and a warn line names their floors once a day.
// F6: the six keepers standing in their own office counted as "People are inside." and blocked
// its demolition almost all day. Now the room's own staff go with it; tenants and guests still block.

import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { hotelRoomsHousekeepingCannotReach } from '../../src/sim/people';
import { ECONOMY, ROOMS, SCHEDULES } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import { tick } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import type { Room, Shaft, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { atOnDay, buildTower, lobbyRun, onlyShaft, roomsMatching } from './helpers';

/** Every seat whose sim is gone or not riding, and every rider not in its car's list. */
function seatProblems(world: World): string[] {
  const out: string[] = [];
  const cars = new Map<number, Shaft['cars'][number]>();
  for (const shaft of world.shafts.values()) {
    for (const car of shaft.cars) {
      cars.set(car.id, car);
      for (const id of car.passengers) {
        const sim = world.sims.get(id);
        if (!sim) out.push(`car ${car.id}: seat for removed sim ${id}`);
        else if (sim.state !== 'riding') out.push(`car ${car.id}: sim ${id} aboard but ${sim.state}`);
        else if (sim.inCarId !== car.id) out.push(`car ${car.id}: sim ${id} has inCarId ${sim.inCarId}`);
      }
    }
  }
  for (const sim of world.sims.values()) {
    if (sim.inCarId !== null && !cars.get(sim.inCarId)?.passengers.includes(sim.id)) out.push(`sim ${sim.id} in car ${sim.inCarId} but not seated`);
  }
  return out;
}

/** Rooms whose occupancy differs from the people really inside (guards and collectors never count). */
function phantomRooms(world: World): string[] {
  const real = new Map<number, number>();
  for (const sim of world.sims.values()) {
    if (sim.inRoomId === null || sim.kind === 'guard' || sim.kind === 'collector') continue;
    real.set(sim.inRoomId, (real.get(sim.inRoomId) ?? 0) + 1);
  }
  return [...world.rooms.values()].filter((r) => r.occupancy !== (real.get(r.id) ?? 0)).map((r) => `${r.kind} ${r.id} ${r.occupancy}`);
}

/** Shaft 1 to 4; housekeeping on 2; single A on 3 (built first, so the lower id); single B on 4. */
function hotelTower(): { world: World; a: Room; b: Room; shaft: Shaft } {
  const world = createWorld(5);
  world.cash = 50_000_000;
  world.stars = 2;
  buildTower(world, [
    ...lobbyRun(90, 200),
    { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 4 },
    { kind: 'build', room: 'housekeeping', floor: 2, x: 100 },
    { kind: 'build', room: 'hotelSingle', floor: 3, x: 100 },
    { kind: 'build', room: 'hotelSingle', floor: 4, x: 100 },
  ]);
  const a = roomsMatching(world, 'hotelSingle', { floor: 3 })[0] as Room;
  const b = roomsMatching(world, 'hotelSingle', { floor: 4 })[0] as Room;
  return { world, a, b, shaft: onlyShaft(world) };
}

function warnLinesSince(world: World, total0: number): { minute: number; text: string }[] {
  return world.log.slice(Math.max(0, world.log.length - (world.logTotal - total0))).filter((l) => l.level === 'warn' && /^Housekeeping/.test(l.text));
}

describe('housekeeping takes the rooms it can reach (F5)', () => {
  it('an earlier dirty room with no route does not stop the keepers cleaning a later one', () => {
    const { world, a, b, shaft } = hotelTower();
    expect(a.id).toBeLessThan(b.id);
    // Guests check in and out by themselves; find the first morning both rooms are left dirty.
    let day = 1;
    for (; day < 20; day++) {
      atOnDay(world, day, 9, 59);
      if (a.dirty && b.dirty) break;
    }
    expect(a.dirty && b.dirty).toBe(true);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: false }).ok).toBe(true);
    expect(hotelRoomsHousekeepingCannotReach(world).map((r) => r.id)).toEqual([a.id]);

    const total0 = world.logTotal;
    let bCleanedAt: number | null = null;
    // Two whole days with floor 3 cut off.
    for (let i = 0; i < 2 * 1440; i++) {
      tick(world);
      if (bCleanedAt === null && !b.dirty && !b.infested) bCleanedAt = world.time.minute;
    }
    expect(bCleanedAt).not.toBeNull();
    expect(clockOf(bCleanedAt as number).minuteOfDay).toBeLessThan(12 * 60); // the same morning
    expect(a.dirty || a.infested).toBe(true);

    // One warn line a day, at the start of the shift, naming floor 3 in plain words.
    const lines = warnLinesSince(world, total0);
    expect(lines.map((l) => l.text)).toEqual([
      'Housekeeping could not reach the hotel rooms on floor 3.',
      'Housekeeping could not reach the hotel rooms on floor 3.',
    ]);
    for (const l of lines) expect(clockOf(l.minute).minuteOfDay).toBe(SCHEDULES.housekeeping.start);
    expect(new Set(lines.map((l) => Math.floor(l.minute / 1440))).size).toBe(2);

    // The stop comes back: the room is cleaned and the line stops.
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 3, stops: true }).ok).toBe(true);
    expect(hotelRoomsHousekeepingCannotReach(world)).toEqual([]);
    const total1 = world.logTotal;
    let aCleaned = false;
    for (let i = 0; i < 1440 && !aCleaned; i++) {
      tick(world);
      aCleaned = !a.dirty && !a.infested;
    }
    expect(aCleaned).toBe(true);
    expect(warnLinesSince(world, total1)).toEqual([]);
  });

  it('lists nothing with no housekeeping office, and nothing while every dirty room is reachable', () => {
    const { world, a, b } = hotelTower();
    a.dirty = true; // seeded: the list reads the flag only
    b.dirty = true;
    expect(hotelRoomsHousekeepingCannotReach(world)).toEqual([]);

    const bare = createWorld(5);
    bare.cash = 50_000_000;
    bare.stars = 2;
    buildTower(bare, [
      ...lobbyRun(90, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: 1, floorMax: 3 },
      { kind: 'build', room: 'hotelSingle', floor: 2, x: 100 },
      { kind: 'build', room: 'hotelSingle', floor: 3, x: 100 },
    ]);
    for (const room of roomsMatching(bare, 'hotelSingle')) room.dirty = true;
    expect(hotelRoomsHousekeepingCannotReach(bare)).toEqual([]);
  });
});

describe('a housekeeping office can be demolished with its keepers inside (F6)', () => {
  /** Housekeeping, security and the recycling center underground, hotel rooms and offices above. */
  function staffTower(): World {
    const world = createWorld(9);
    world.cash = 500_000_000;
    world.stars = 3;
    buildTower(world, [
      ...lobbyRun(0, 200),
      { kind: 'shaft.build', shaft: 'standard', x: 190, floorMin: -2, floorMax: 5 },
      { kind: 'build', room: 'parkingSpace', floor: -1, x: 100 },
      { kind: 'build', room: 'recycling', floor: -2, x: 10 },
      { kind: 'build', room: 'housekeeping', floor: -1, x: 40 },
      { kind: 'build', room: 'security', floor: -1, x: 60 },
      ...[100, 104, 108, 112, 116, 120, 124, 128].map((x) => ({ kind: 'build' as const, room: 'hotelSingle' as const, floor: 2, x })),
      ...[100, 109, 118].map((x) => ({ kind: 'build' as const, room: 'office' as const, floor: 3, x })),
      ...[100, 109, 118].map((x) => ({ kind: 'build' as const, room: 'office' as const, floor: 4, x })),
    ]);
    return world;
  }

  function demolishOnClone(world: World): { world: World; ok: boolean; reason?: string; refund: number; insideBefore: number; officeId: number } {
    const loaded = deserialize(serialize(world));
    if (!loaded.ok) throw new Error(loaded.reason);
    const w = loaded.world;
    const office = roomsMatching(w, 'housekeeping')[0] as Room;
    const insideBefore = office.occupancy;
    const cash0 = w.cash;
    const res = applyCommand(w, { kind: 'demolish', roomId: office.id });
    return { world: w, ok: res.ok, ...(res.ok ? {} : { reason: res.reason }), refund: w.cash - cash0, insideBefore, officeId: office.id };
  }

  it('an idle office goes, keepers and all, with the 25% refund and nothing left behind', () => {
    const world = staffTower();
    // Night and an idle morning: every keeper is in the office.
    const tries: number[] = [];
    for (const [day, hour] of [[0, 7], [1, 3], [2, 23]] as const) {
      atOnDay(world, day, hour, 0);
      const r = demolishOnClone(world);
      tries.push(r.insideBefore);
      expect(r.insideBefore).toBe(ROOMS.housekeeping.capacity);
      expect(r.reason).toBeUndefined();
      expect(r.ok).toBe(true);
      expect(r.refund).toBe(Math.round(ROOMS.housekeeping.cost * ECONOMY.demolishRefundFraction));
      const w = r.world;
      expect(w.rooms.has(r.officeId)).toBe(false);
      expect([...w.sims.values()].filter((s) => s.kind === 'staff')).toEqual([]);
      expect([...w.sims.values()].filter((s) => s.homeRoomId === r.officeId)).toEqual([]);
      expect(seatProblems(w)).toEqual([]);
      expect(phantomRooms(w)).toEqual([]);
      for (let i = 0; i < 120; i++) {
        tick(w);
        expect(seatProblems(w)).toEqual([]);
      }
      expect(phantomRooms(w)).toEqual([]);
      expect([...w.sims.values()].filter((s) => s.kind === 'staff')).toEqual([]);
    }
    expect(tries).toHaveLength(3);
  });

  it('keepers out cleaning go with the office too, out of the hotel rooms they stood in', () => {
    const world = staffTower();
    let tried = 0;
    for (let i = 0; i < 4 * 1440 && tried < 20; i++) {
      tick(world);
      const office = roomsMatching(world, 'housekeeping')[0] as Room;
      const out = office.tenants.map((id) => world.sims.get(id)).filter((s) => s && s.inRoomId !== office.id).length;
      if (out === 0 || world.time.minute % 7 !== 0) continue;
      tried++;
      const r = demolishOnClone(world);
      expect(r.ok).toBe(true);
      expect(seatProblems(r.world)).toEqual([]);
      expect(phantomRooms(r.world)).toEqual([]);
      expect([...r.world.sims.values()].filter((s) => s.kind === 'staff')).toEqual([]);
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('a room with tenants, guests or visitors inside is still refused', () => {
    const world = staffTower();
    atOnDay(world, 0, 11, 0);
    const office = roomsMatching(world, 'office').find((r) => r.occupancy > 0) as Room;
    expect(office).toBeDefined();
    expect(applyCommand(world, { kind: 'demolish', roomId: office.id })).toEqual({ ok: false, reason: 'People are inside.' });
    // A guest asleep in a hotel room at night.
    atOnDay(world, 1, 2, 0);
    const booked = roomsMatching(world, 'hotelSingle').find((r) => r.occupancy > 0) as Room;
    expect(booked).toBeDefined();
    expect(applyCommand(world, { kind: 'demolish', roomId: booked.id })).toEqual({ ok: false, reason: 'People are inside.' });
  });
});

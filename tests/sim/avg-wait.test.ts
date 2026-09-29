/**
 * stats.avgWaitMinutes is the whole hall wait of riders who boarded a car, from the first
 * call to boarding (decision 2026-09-28, review of ccc0f7e I1 and A2).
 *
 * The reroute after three silent retries restarts waitStart so the next hall places its own
 * call; before the fix the boarding recorded only that last stretch, so no wait of 18 minutes
 * or more was ever averaged. A give-up and a climb by the stairs board nothing and count nothing.
 *
 * The tower: a ground lobby, shaft B (1-3) whose stop at floor 3 is switched off, shaft A (1-3)
 * with its car idle at the lobby, and a shop on floor 3. A shopper is set waiting at B for
 * floor 3; B's car never takes it there, so at 18 minutes routing sends it to A, which it boards.
 */
import { describe, expect, it } from 'vitest';

import { ROOMS, STRESS } from '../../src/sim/rules';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import { tickMany } from '../../src/sim/tick';
import type { Leg, Room, RoomKind, Shaft, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

function room(world: World, kind: RoomKind, floor: number, x: number): Room {
  const r = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  } as unknown as Room;
  addRoom(world, r);
  return r;
}

function shaft(world: World, x: number, lo: number, hi: number, skip: number | null): Shaft {
  const id = allocId(world);
  const stops = new Set<number>();
  for (let f = lo; f <= hi; f++) if (f !== skip) stops.add(f);
  const s = {
    id, kind: 'standard', x, width: 4, floorMin: lo, floorMax: hi, stops, homeFloor: lo, hallCalls: new Map(),
    cars: [{ id: allocId(world), shaftId: id, y: lo, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null }],
  } as unknown as Shaft;
  addShaft(world, s);
  return s;
}

function shopper(world: World, x: number, route: Leg[], shop: Room): Sim {
  const sim = {
    id: allocId(world), kind: 'shopper', homeRoomId: null, pos: { floor: 1, x }, inCarId: null, inRoomId: null,
    route, state: 'walking', stress: 0, waitStart: null,
    schedule: [{ minuteOfDay: 0, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: shop.id }, stayMinutes: 400 }],
    nextScheduleIndex: 1, stayUntil: null, wallet: 1000, leaveReason: null,
  } as unknown as Sim;
  addSim(world, sim);
  return sim;
}

/** 3 AM on day 0: no shopper, diner or worker spawns before the shop opens at ten. */
function tower() {
  const world = createWorld(7);
  for (let x = 100; x <= 200; x += ROOMS.lobby.width) room(world, 'lobby', 1, x);
  const b = shaft(world, 150, 1, 3, 3);
  const a = shaft(world, 170, 1, 3, null);
  const shop = room(world, 'shop', 3, 180);
  tickMany(world, 3 * 60 - world.time.minute);
  return { world, a, b, shop };
}

function rideB() {
  const { world, a, b, shop } = tower();
  const sim = shopper(world, 150, [{ kind: 'ride', shaftId: b.id, fromFloor: 1, toFloor: 3 }, { kind: 'enter', roomId: shop.id }], shop);
  return { world, a, b, shop, sim };
}

/** Minute by minute until the sim sits in a car; the minute it boarded, or null. */
function untilBoarded(world: World, sim: Sim, limit: number): number | null {
  for (let i = 0; i < limit; i++) {
    tickMany(world, 1);
    const live = world.sims.get(sim.id);
    if (live && live.inCarId !== null) return world.time.minute;
  }
  return null;
}

describe('stats.avgWaitMinutes averages the whole hall wait', () => {
  it('a rider rerouted at 18 minutes records the full wait from its first call when it boards', () => {
    const { world, a, sim } = rideB();
    const firstCall = world.time.minute + 1;
    const boarded = untilBoarded(world, sim, 60);
    expect(boarded).not.toBeNull();
    const live = world.sims.get(sim.id)!;
    expect(live.inCarId).toBe(a.cars[0]!.id); // the reroute took it to A
    expect(world.stats.waitsCounted).toBe(1);
    expect(world.stats.avgWaitMinutes).toBeGreaterThanOrEqual(18);
    expect(world.stats.avgWaitMinutes).toBeGreaterThanOrEqual(boarded! - firstCall - 1);
    expect(live.firstWaitStart).toBeUndefined(); // boarding ends the carried wait
  });

  it('the carried first minute survives a save and load between the reroute and boarding', () => {
    const { world, sim } = rideB();
    for (let i = 0; i < 40 && world.sims.get(sim.id)!.firstWaitStart === undefined; i++) tickMany(world, 1);
    const carried = world.sims.get(sim.id)!.firstWaitStart;
    expect(carried).toBeTypeOf('number');
    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.sims.get(sim.id)!.firstWaitStart).toBe(carried);
    expect(hashWorld(loaded.world)).toBe(hashWorld(world));
    untilBoarded(world, sim, 30);
    untilBoarded(loaded.world, loaded.world.sims.get(sim.id)!, 30);
    expect(loaded.world.stats.avgWaitMinutes).toBe(world.stats.avgWaitMinutes);
    expect(world.stats.avgWaitMinutes).toBeGreaterThanOrEqual(18);
  });

  it('a save without the field loads, and a bad value is refused', () => {
    const { world } = rideB();
    const data = JSON.parse(serialize(world));
    expect(data.sims.every((s: Record<string, unknown>) => !('firstWaitStart' in s))).toBe(true);
    expect(deserialize(JSON.stringify(data)).ok).toBe(true);
    data.sims[0].firstWaitStart = 'soon';
    const bad = deserialize(JSON.stringify(data));
    expect(bad.ok).toBe(false);
  });

  it('a give-up boards nothing and counts nothing', () => {
    const { world, sim } = rideB();
    tickMany(world, 2);
    expect(sim.state).toBe('waiting');
    sim.stress = STRESS.giveUp - STRESS.perWaitingMinute / 2;
    tickMany(world, 30);
    expect(sim.leaveReason ?? sim.state).not.toBe('waiting');
    expect(world.stats.waitsCounted).toBe(0);
    expect(world.stats.avgWaitMinutes).toBe(0);
  });

  it('a climb by the stairs waits for no car and counts nothing', () => {
    const { world, shop } = tower();
    const stairs = room(world, 'stairs', 1, 120);
    const sim = shopper(world, 110, [
      { kind: 'walk', toX: 124 },
      { kind: 'stairs', roomId: stairs.id, fromFloor: 1, toFloor: 3 } as unknown as Leg,
      { kind: 'walk', toX: 184 },
      { kind: 'enter', roomId: shop.id },
    ], shop);
    tickMany(world, 30);
    expect(world.sims.get(sim.id)?.inRoomId).toBe(shop.id);
    expect(world.stats.waitsCounted).toBe(0);
    expect(world.stats.avgWaitMinutes).toBe(0);
  });
});

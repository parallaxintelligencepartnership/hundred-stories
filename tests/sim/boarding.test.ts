/**
 * Boarding (audit 2026-09-28, lane B S3 and S5).
 *
 * A wait ends when the sim boards.
 * waitStart used to survive boarding, so at a transfer floor the second wait never placed
 * its hall call (beginWait only calls when waitStart is null) and a VIP's wait was measured
 * from the first lobby wait, which rated a fair trip poor.
 */
import { describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { startVip } from '../../src/sim/events';
import { findRoute } from '../../src/sim/routing';
import { ROOMS } from '../../src/sim/rules';
import { tickMany } from '../../src/sim/tick';
import type { Room, RoomKind, Shaft, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

function room(world: World, kind: RoomKind, floor: number, x: number): Room {
  const r: Room = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  } as Room;
  addRoom(world, r);
  return r;
}

function shaft(world: World, x: number, lo: number, hi: number, y: number): Shaft {
  const id = allocId(world);
  const stops = new Set<number>();
  for (let f = lo; f <= hi; f++) stops.add(f);
  const s = {
    id, kind: 'standard', x, width: 4, floorMin: lo, floorMax: hi, stops, homeFloor: lo, hallCalls: new Map(),
    cars: [{ id: allocId(world), shaftId: id, y, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null }],
  } as unknown as Shaft;
  addShaft(world, s);
  return s;
}

describe('waiting at a transfer floor', () => {
  it('calls the second car the minute the rider starts waiting for it', () => {
    const world = createWorld(5);
    for (let x = 100; x <= 140; x++) room(world, 'lobby', 1, x);
    shaft(world, 150, 1, 7, 1);
    const b = shaft(world, 170, 7, 12, 7); // its car stands idle at the transfer floor
    const shop = room(world, 'shop', 12, 200);
    const legs = findRoute(world, { floor: 1, x: 150 }, { floor: 12, x: 206 })!;
    const sim = {
      id: allocId(world), kind: 'shopper', homeRoomId: null, pos: { floor: 1, x: 150 }, inCarId: null, inRoomId: null,
      route: [...legs, { kind: 'enter', roomId: shop.id }], state: 'walking', stress: 0, waitStart: null,
      schedule: [{ minuteOfDay: 0, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: shop.id }, stayMinutes: 400 }],
      nextScheduleIndex: 1, stayUntil: null, wallet: 1000, leaveReason: null,
    } as unknown as Sim;
    addSim(world, sim);
    tickMany(world, 3 * 60 - world.time.minute);
    // Before the fix the rider stood at floor 7 beside an idle car until the six minute
    // hall call retry; now the call goes in with the wait and the idle car opens at once.
    let reached7: number | null = null;
    let boardedB: number | null = null;
    for (let i = 0; i < 60 && sim.state !== 'inRoom'; i++) {
      tickMany(world, 1);
      if (reached7 === null && sim.pos.floor === 7 && Math.abs(sim.pos.x - b.x) <= b.width + 1) {
        reached7 = world.time.minute;
        // The wait at B is its own: no clock carried over from the lobby.
        if (sim.state === 'waiting') expect(sim.waitStart).toBe(world.time.minute);
      }
      if (boardedB === null && sim.inCarId === b.cars[0]!.id) boardedB = world.time.minute;
    }
    expect(reached7).not.toBeNull();
    expect(boardedB).not.toBeNull();
    expect(boardedB! - reached7!).toBeLessThanOrEqual(1);
    expect(sim.state).toBe('inRoom');
  });

  it('rates a VIP fair when every real wait on a transfer trip is short', () => {
    const world = createWorld(5);
    world.cash = 50_000_000;
    for (let x = 100; x <= 140; x++) room(world, 'lobby', 1, x);
    shaft(world, 104, 1, 7, 1);
    shaft(world, 120, 7, 12, 7);
    room(world, 'hotelSuite', 12, 130);
    startVip(world);
    const ev = world.events.find((e) => e.kind === 'vip') as unknown as { phase: string; longestWait: number; simId: number };
    expect(ev).toBeDefined();
    const sim = world.sims.get(ev.simId)!;
    let run = 0;
    let longestRun = 0;
    while (world.events.includes(ev as never) && world.time.minute < 4 * 1440) {
      tickMany(world, 1);
      if (ev.phase !== 'notice' && sim.state === 'waiting') longestRun = Math.max(longestRun, ++run);
      else run = 0;
    }
    expect(longestRun).toBeLessThanOrEqual(8);
    expect(ev.longestWait).toBeLessThanOrEqual(8);
    expect(world.stats.vipRating).toBe('fair');
  });
});

describe('a stop turned off while the doors stand open there', () => {
  it('shuts the doors and boards nobody at that floor', () => {
    const world = createWorld(5);
    for (let x = 100; x <= 140; x++) room(world, 'lobby', 1, x);
    const s = shaft(world, 150, 1, 6, 3);
    const car = s.cars[0]!;
    car.state = 'doorsOpen';
    car.doorTimer = 3;
    const shop = room(world, 'shop', 5, 160);
    const sim = {
      id: allocId(world), kind: 'shopper', homeRoomId: null, pos: { floor: 3, x: 150 }, inCarId: null, inRoomId: null,
      route: [{ kind: 'ride', shaftId: s.id, fromFloor: 3, toFloor: 5 }, { kind: 'enter', roomId: shop.id }], state: 'waiting',
      stress: 0, waitStart: world.time.minute, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 1000, leaveReason: null,
    } as unknown as Sim;
    addSim(world, sim);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: s.id, floor: 3, stops: false }).ok).toBe(true);
    tickMany(world, 1);
    expect(sim.inCarId).toBeNull();
    expect(car.passengers).not.toContain(sim.id);
  });
});

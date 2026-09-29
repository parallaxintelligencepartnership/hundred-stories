/**
 * A wait ends when the sim is sent away or its shaft is demolished (audit 2026-09-28 lane B S3
 * and S4; review F1: removing either `waitStart = null` passed every sim test).
 *
 * beginWait places a hall call only when waitStart is null, so a clock left over from the
 * abandoned wait means the exit leg's wait calls no car: the rider stands beside the doors
 * until the six-minute retry. Here the rider waits at floor 7 for shaft B (7-12); the way out
 * is shaft A (1-7), whose car stands idle at the lobby, so only the rider can call it.
 */
import { describe, expect, it } from 'vitest';

import { sendAway } from '../../src/sim/people';
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

/** A shopper standing at shaft B's doors on floor 7, waiting since three minutes ago. */
function setUp() {
  const world = createWorld(5);
  for (let x = 100; x <= 140; x++) room(world, 'lobby', 1, x);
  const a = shaft(world, 150, 1, 7, 1);
  const b = shaft(world, 170, 7, 12, 12);
  const shop = room(world, 'shop', 12, 200);
  tickMany(world, 3 * 60 - world.time.minute);
  const sim = {
    id: allocId(world), kind: 'shopper', homeRoomId: null, pos: { floor: 7, x: 170 }, inCarId: null, inRoomId: null,
    route: [{ kind: 'ride', shaftId: b.id, fromFloor: 7, toFloor: 12 }, { kind: 'enter', roomId: shop.id }],
    state: 'waiting', stress: 0, waitStart: world.time.minute - 3,
    schedule: [{ minuteOfDay: 0, days: ['weekday', 'weekend'], goal: { kind: 'room', roomId: shop.id }, stayMinutes: 400 }],
    nextScheduleIndex: 1, stayUntil: null, wallet: 1000, leaveReason: null,
  } as unknown as Sim;
  addSim(world, sim);
  return { world, a, b, sim };
}

/** Tick by tick until the sim waits at A on floor 7: the tick's minute, its wait clock and A's call. */
function waitAtA(world: World, a: Shaft, sim: Sim) {
  for (let i = 0; i < 30; i++) {
    const minute = world.time.minute;
    tickMany(world, 1);
    const atA = sim.state === 'waiting' && sim.pos.floor === 7 && sim.route[0]?.kind === 'ride' && sim.route[0].shaftId === a.id;
    if (atA) return { minute, waitStart: sim.waitStart, calledDown: (a.hallCalls.get(7)?.down.size ?? 0) > 0, carMoving: a.cars[0]!.state !== 'idle' };
  }
  return null;
}

describe('a wait that is abandoned ends with it', () => {
  it('sent away while waiting: the walk out calls its own car the minute it starts waiting', () => {
    const { world, a, sim } = setUp();
    sendAway(world, sim, 'test');
    expect(sim.waitStart).toBeNull();
    const at = waitAtA(world, a, sim);
    expect(at).not.toBeNull();
    expect(at!.waitStart).toBe(at!.minute);
    expect(at!.calledDown || at!.carMoving).toBe(true);
  });

  it('shaft demolished while waiting: the walk out calls its own car the minute it starts waiting', () => {
    const { world, a, b, sim } = setUp();
    world.shafts.delete(b.id);
    const at = waitAtA(world, a, sim);
    expect(at).not.toBeNull();
    expect(at!.waitStart).toBe(at!.minute);
    expect(at!.calledDown || at!.carMoving).toBe(true);
  });
});

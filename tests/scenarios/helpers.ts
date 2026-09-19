/**
 * Scenario helpers: drive a world the way a player would.
 *
 * Every room and shaft here goes in through applyCommand, so the scenarios exercise
 * the same validation, cash and logging path the UI uses. Nothing is hand built.
 */

import { applyCommand } from '../../src/sim/build';
import { tickMany } from '../../src/sim/tick';
import { clockOf } from '../../src/sim/types';
import type { Command, Id, Room, RoomKind, Shaft, Sim, SimKind, World } from '../../src/sim/types';

const MINUTES_PER_DAY = 1440;

function describeCommand(cmd: Command): string {
  switch (cmd.kind) {
    case 'build':
      return `build ${cmd.room} on floor ${cmd.floor} at x ${cmd.x}`;
    case 'shaft.build':
      return `build ${cmd.shaft} shaft at x ${cmd.x} floors ${cmd.floorMin} to ${cmd.floorMax}`;
    default:
      return JSON.stringify(cmd);
  }
}

/** Apply a build script in order. Any refusal is a test failure, with the reason. */
export function buildTower(world: World, script: readonly Command[]): void {
  for (let i = 0; i < script.length; i++) {
    const cmd = script[i] as Command;
    const result = applyCommand(world, cmd);
    if (!result.ok) {
      throw new Error(`Command ${i + 1} of ${script.length} refused: ${describeCommand(cmd)} -> ${result.reason}`);
    }
  }
}

/** Run whole game days. */
export function runDays(world: World, days: number): void {
  tickMany(world, days * MINUTES_PER_DAY);
}

/** Run minutes. */
export function runMinutes(world: World, minutes: number): void {
  tickMany(world, minutes);
}

/**
 * Advance to the next time of day. When the world already sits on that minute
 * nothing happens, so `at` is safe to call twice in a row.
 */
export function at(world: World, hour: number, minute = 0): void {
  const target = hour * 60 + minute;
  const now = clockOf(world.time.minute).minuteOfDay;
  tickMany(world, (target - now + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

/** Advance to a time of day on a later day: `at` plus whole days. */
export function atOnDay(world: World, dayIndex: number, hour: number, minute = 0): void {
  const target = dayIndex * MINUTES_PER_DAY + hour * 60 + minute;
  if (target < world.time.minute) throw new Error(`That moment already passed: minute ${target} is behind ${world.time.minute}.`);
  tickMany(world, target - world.time.minute);
}

export function countSims(world: World, kind: SimKind): number {
  let count = 0;
  for (const sim of world.sims.values()) if (sim.kind === kind) count += 1;
  return count;
}

export function simsOfKind(world: World, kind: SimKind): Sim[] {
  const out: Sim[] = [];
  for (const sim of world.sims.values()) if (sim.kind === kind) out.push(sim);
  return out;
}

export interface RoomFilter {
  floor?: number;
  vacant?: boolean;
  dirty?: boolean;
  /** true for occupancy > 0, false for occupancy === 0 */
  occupied?: boolean;
  /** true for tenants.length > 0, false for none */
  tenanted?: boolean;
}

export function countRooms(world: World, kind: RoomKind, opts: RoomFilter = {}): number {
  return roomsMatching(world, kind, opts).length;
}

export function roomsMatching(world: World, kind: RoomKind, opts: RoomFilter = {}): Room[] {
  const out: Room[] = [];
  for (const room of world.rooms.values()) {
    if (room.kind !== kind) continue;
    if (opts.floor !== undefined && room.floor !== opts.floor) continue;
    if (opts.vacant !== undefined && room.vacant !== opts.vacant) continue;
    if (opts.dirty !== undefined && room.dirty !== opts.dirty) continue;
    if (opts.occupied !== undefined && room.occupancy > 0 !== opts.occupied) continue;
    if (opts.tenanted !== undefined && room.tenants.length > 0 !== opts.tenanted) continue;
    out.push(room);
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

// ---------------------------------------------------------------------------
// Script builders
// ---------------------------------------------------------------------------

/**
 * A run of ground lobby segments, skipping tiles reserved for elevator shafts.
 *
 * build.ts refuses a shaft that crosses a room, and a lobby segment that crosses a
 * shaft, so a shaft standing inside the lobby run needs its four tiles left clear.
 */
export function lobbyRun(fromX: number, toX: number, reserved: readonly (readonly [number, number])[] = []): Command[] {
  const out: Command[] = [];
  for (let x = fromX; x <= toX; x++) {
    if (reserved.some(([lo, hi]) => x >= lo && x <= hi)) continue;
    out.push({ kind: 'build', room: 'lobby', floor: 1, x });
  }
  return out;
}

export function buildRow(room: RoomKind, floor: number, xs: readonly number[]): Command[] {
  return xs.map((x) => ({ kind: 'build', room, floor, x }) as Command);
}

/** The only shaft in the world, for tests that add cars to it. */
export function onlyShaft(world: World): Shaft {
  const shafts = [...world.shafts.values()];
  if (shafts.length !== 1) throw new Error(`Expected exactly one shaft, found ${shafts.length}.`);
  return shafts[0] as Shaft;
}

export function averageStress(sims: readonly Sim[]): number {
  if (sims.length === 0) return 0;
  return sims.reduce((total, sim) => total + sim.stress, 0) / sims.length;
}

export function roomById(world: World, id: Id): Room {
  const room = world.rooms.get(id);
  if (!room) throw new Error(`No room with id ${id}.`);
  return room;
}

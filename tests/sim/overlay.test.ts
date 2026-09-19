// Connectors overlay rooms: stairs, escalators and elevator shafts share tiles with
// rooms in both directions, but never with each other. See docs/DESIGN.md section 2.
import { describe, expect, it } from 'vitest';

import { applyCommand, canBuild, canBuildShaft } from '../../src/sim/build';
import { evaluateRoom, noisyNeighborsOf } from '../../src/sim/evaluation';
import { createWorld } from '../../src/sim/world';
import type { CommandResult, Room, RoomKind, Star, ShaftKind, World } from '../../src/sim/types';

const OK: CommandResult = { ok: true };

function makeWorld(cash = 8_000_000, stars: Star = 3): World {
  const world = createWorld(7);
  world.cash = cash;
  world.stars = stars;
  return world;
}

function build(world: World, room: RoomKind, floor: number, x: number): CommandResult {
  return applyCommand(world, { kind: 'build', room, floor, x });
}

function buildShaft(world: World, shaft: ShaftKind, x: number, floorMin: number, floorMax: number): CommandResult {
  return applyCommand(world, { kind: 'shaft.build', shaft, x, floorMin, floorMax });
}

function lobby(world: World, from = 100, count = 120): void {
  for (let i = 0; i < count; i++) expect(build(world, 'lobby', 1, from + i)).toEqual(OK);
}

function roomOfKind(world: World, kind: RoomKind): Room {
  const room = [...world.rooms.values()].find((r) => r.kind === kind);
  expect(room).toBeDefined();
  return room as Room;
}

describe('connectors rise into empty air', () => {
  it('builds a shaft from the lobby to floor 5 with nothing above the lobby', () => {
    const world = makeWorld();
    lobby(world, 100, 10);
    expect(buildShaft(world, 'standard', 104, 1, 5)).toEqual(OK);
    const shaft = [...world.shafts.values()][0];
    expect(shaft?.floorMin).toBe(1);
    expect(shaft?.floorMax).toBe(5);
  });

  it('lets a room stand beside a shaft on a floor only the shaft reaches', () => {
    const world = makeWorld();
    lobby(world, 100, 10);
    expect(buildShaft(world, 'standard', 104, 1, 5)).toEqual(OK);
    // Floor 2 has no room at all, only the shaft: the shaft tiles are floor enough.
    expect(build(world, 'office', 3, 120)).toEqual(OK);
  });

  it('still refuses a shaft on floor 0 and outside the tower', () => {
    const world = makeWorld();
    expect(canBuildShaft(world, 'standard', 100, 0, 5)).toEqual({ ok: false, reason: 'That floor does not exist.' });
    expect(canBuildShaft(world, 'standard', 100, 1, 101)).toEqual({ ok: false, reason: 'That floor does not exist.' });
    expect(canBuildShaft(world, 'standard', 100, -11, 1)).toEqual({ ok: false, reason: 'That floor does not exist.' });
    expect(canBuildShaft(world, 'standard', 100, 5, 5)).toEqual({
      ok: false,
      reason: 'An elevator must serve at least two floors.',
    });
    expect(canBuildShaft(world, 'standard', 373, 1, 5)).toEqual({
      ok: false,
      reason: 'That does not fit inside the tower.',
    });
  });
});

describe('connectors overlay rooms', () => {
  it('builds a shaft over an office and leaves the office untouched', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 150)).toEqual(OK);
    const office = roomOfKind(world, 'office');
    const before = { ...office };
    expect(buildShaft(world, 'standard', 152, 1, 6)).toEqual(OK);
    expect(world.rooms.get(office.id)).toEqual(before);
  });

  it('builds an office over a shaft column', () => {
    const world = makeWorld();
    lobby(world);
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(build(world, 'office', 2, 146)).toEqual(OK);
    expect(roomOfKind(world, 'office').x).toBe(146);
  });

  it('builds stairs over an office and an office over stairs', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 150)).toEqual(OK);
    expect(build(world, 'office', 3, 150)).toEqual(OK);
    expect(build(world, 'stairs', 2, 152)).toEqual(OK);
    expect(build(world, 'escalator', 2, 200)).toEqual(OK);
    expect(build(world, 'office', 2, 198)).toEqual(OK);
  });
});

describe('connectors never overlap connectors', () => {
  it('refuses stairs over stairs', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'stairs', 2, 150)).toEqual(OK);
    expect(canBuild(world, 'stairs', 2, 154)).toEqual({ ok: false, reason: 'Something is already there.' });
    expect(canBuild(world, 'escalator', 3, 154)).toEqual({ ok: false, reason: 'Something is already there.' });
    expect(canBuild(world, 'stairs', 2, 158).ok).toBe(true);
  });

  it('refuses a shaft over stairs and stairs over a shaft', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'stairs', 2, 150)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 152, 1, 6)).toEqual({ ok: false, reason: 'Something is already there.' });

    expect(buildShaft(world, 'standard', 200, 1, 6)).toEqual(OK);
    expect(canBuild(world, 'stairs', 2, 198)).toEqual({ ok: false, reason: 'An elevator is in the way.' });
    expect(canBuild(world, 'escalator', 2, 198)).toEqual({ ok: false, reason: 'An elevator is in the way.' });
  });

  it('refuses a shaft over a shaft', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 152, 5, 20)).toEqual({ ok: false, reason: 'An elevator is in the way.' });
  });

  it('refuses an extension through stairs but lets one pass through a room', () => {
    const world = makeWorld();
    lobby(world);
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = [...world.shafts.values()][0];
    expect(shaft).toBeDefined();
    expect(build(world, 'office', 2, 146)).toEqual(OK);
    expect(build(world, 'stairs', 11, 148)).toEqual(OK);
    const blocked = applyCommand(world, { kind: 'shaft.extend', shaftId: shaft!.id, floorMin: 1, floorMax: 12 });
    expect(blocked).toEqual({ ok: false, reason: 'Something is already there.' });
    // An office on floor 13 is no obstacle at all.
    expect(build(world, 'office', 13, 148)).toEqual(OK);
    expect(applyCommand(world, { kind: 'shaft.extend', shaftId: shaft!.id, floorMin: 1, floorMax: 10 }).ok).toBe(false);
  });
});

describe('a connector overhead changes nothing about a room', () => {
  it('keeps evaluation, noise neighbors and occupancy out of the connector', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 150)).toEqual(OK); // gets the stairs
    expect(build(world, 'office', 2, 170)).toEqual(OK); // gets the elevator
    const offices = [...world.rooms.values()].filter((r) => r.kind === 'office');
    expect(offices).toHaveLength(2);
    const before = offices.map((r) => ({
      eval: evaluateRoom(world, r),
      noisy: noisyNeighborsOf(world, r).length,
    }));

    expect(build(world, 'stairs', 2, 151)).toEqual(OK);
    expect(buildShaft(world, 'standard', 172, 1, 6)).toEqual(OK);

    offices.forEach((room, i) => {
      expect(evaluateRoom(world, room)).toBe(before[i]?.eval);
      expect(noisyNeighborsOf(world, room).length).toBe(before[i]?.noisy);
      expect(room.tenants).toEqual([]);
      expect(room.occupancy).toBe(0);
    });
    const stairs = roomOfKind(world, 'stairs');
    expect(stairs.tenants).toEqual([]);
    expect(evaluateRoom(world, stairs)).toBe(1);
  });
});

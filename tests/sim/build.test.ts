import { describe, expect, it, vi } from 'vitest';

import { applyCommand, canBuild, canBuildShaft, canExtendShaft } from '../../src/sim/build';
import { LIMITS, PLURAL_LABELS, ROOMS, SHAFTS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import { addRoom, allocId, createWorld } from '../../src/sim/world';
import type { CommandResult, Room, RoomKind, Shaft, ShaftKind, Star, World } from '../../src/sim/types';

// economy.ts is still a stub, so the tests run against a minimal spend:
// it deducts the amount and refuses when the world cannot afford it.
vi.mock('../../src/sim/economy', () => ({
  spend: (world: World, amount: number, _what: string): CommandResult => {
    if (world.cash < amount) return { ok: false, reason: 'Not enough cash.' };
    world.cash -= amount;
    return { ok: true };
  },
  onQuarterStart: () => {},
  recordVisit: () => {},
  recordHotelNight: () => {},
  recordCondoSale: () => {},
}));

const mocks = vi.hoisted(() => ({
  handleEventCommand: vi.fn(
    (_world: World, _cmd: { kind: 'bomb.pay' | 'fire.callHelicopter' }): CommandResult => ({ ok: true }),
  ),
}));

vi.mock('../../src/sim/events', () => ({
  tickEvents: () => {},
  handleEventCommand: mocks.handleEventCommand,
}));

const OK: CommandResult = { ok: true };

function makeWorld(cash = 8_000_000, stars: Star = 1): World {
  const world = createWorld(42);
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

/** Lobby segments on floor 1, so floor 2 has support and sims have a ground lobby. */
function lobby(world: World, from = 100, count = 6): void {
  for (let i = 0; i < count; i++) expect(build(world, 'lobby', 1, from + i)).toEqual(OK);
}

function onlyShaft(world: World): Shaft {
  const shafts = [...world.shafts.values()];
  expect(shafts).toHaveLength(1);
  return shafts[0] as Shaft;
}

function reasonOf(result: CommandResult): string {
  return result.ok ? '' : result.reason;
}

describe('build: star gate and cash', () => {
  it('refuses a room above the current star rating', () => {
    const world = makeWorld();
    lobby(world);
    expect(canBuild(world, 'skyLobby', 15, 100)).toEqual({ ok: false, reason: 'Needs 3 stars.' });
  });

  it('refuses a shaft above the current star rating', () => {
    const world = makeWorld();
    expect(canBuildShaft(world, 'express', 200, 1, 20)).toEqual({ ok: false, reason: 'Needs 3 stars.' });
  });

  it('refuses a room the tower cannot afford, naming the price', () => {
    const world = makeWorld(10_000);
    lobby(world, 100, 1);
    expect(build(world, 'office', 2, 100)).toEqual({
      ok: false,
      reason: 'Not enough cash. Offices cost $40,000.',
    });
  });

  it('refuses an elevator the tower cannot afford, naming the price', () => {
    const world = makeWorld(10_000);
    expect(buildShaft(world, 'standard', 200, 1, 10)).toEqual({
      ok: false,
      reason: 'Not enough cash. Elevators cost $200,000.',
    });
  });

  it('never lets cash go negative from building', () => {
    const world = makeWorld(10_000);
    expect(build(world, 'lobby', 1, 100)).toEqual(OK);
    expect(build(world, 'lobby', 1, 101)).toEqual(OK);
    expect(world.cash).toBe(0);
    const refused = build(world, 'lobby', 1, 102);
    expect(refused.ok).toBe(false);
    expect(world.cash).toBe(0);
    expect(world.rooms.size).toBe(2);
  });
});

describe('build: bounds and placement', () => {
  it('refuses a room that runs past the right edge of the tower', () => {
    const world = makeWorld();
    lobby(world);
    const x = LIMITS.towerWidth - ROOMS.office.width + 1;
    expect(canBuild(world, 'office', 2, x).ok).toBe(false);
    expect(canBuild(world, 'office', 2, -1).ok).toBe(false);
  });

  it('refuses floors outside the tower and floor 0', () => {
    const world = makeWorld();
    lobby(world);
    expect(canBuild(world, 'office', LIMITS.maxFloor + 1, 100).ok).toBe(false);
    expect(canBuild(world, 'office', 0, 100).ok).toBe(false);
    expect(canBuild(world, 'parkingSpace', LIMITS.minFloor - 1, 100).ok).toBe(false);
  });

  it('refuses an above ground room underground', () => {
    const world = makeWorld();
    lobby(world);
    const result = canBuild(world, 'office', -1, 100);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('Offices must go above ground.');
  });

  it('refuses an underground room above ground', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    const result = canBuild(world, 'parkingRamp', 2, 100);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('Parking ramps must go underground.');
  });

  it('puts the lobby only on floor 1', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const result = canBuild(world, 'lobby', 3, 100);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('The lobby goes on floor 1.');
  });
});

describe('build: sky lobby', () => {
  it('refuses a sky lobby on a floor that is not a sky lobby floor', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    for (let f = 2; f <= 17; f++) expect(build(world, 'office', f, 100)).toEqual(OK);
    const result = canBuild(world, 'skyLobby', 16, 200);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('Sky lobbies go on floors');
  });

  it('builds a sky lobby on a listed floor with a three floor footprint', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    for (let f = 2; f <= 14; f++) expect(build(world, 'office', f, 100)).toEqual(OK);
    // over the floor 14 office, so it rests on it
    expect(build(world, 'skyLobby', 15, 104)).toEqual(OK);
    const sky = [...world.rooms.values()].find((r) => r.kind === 'skyLobby');
    expect(sky?.height).toBe(3);
    for (const f of [15, 16, 17]) {
      expect(world.floorIndex.rooms.get(f)?.some((r) => r.id === sky?.id)).toBe(true);
    }
    // the middle of the footprint is occupied
    expect(reasonOf(canBuild(world, 'office', 16, 100))).toBe('Something is already there.');
  });
});

describe('build: overlap and support', () => {
  it('refuses a room that overlaps another room', () => {
    const world = makeWorld();
    lobby(world, 100, 12); // under both offices
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    expect(canBuild(world, 'office', 2, 104)).toEqual({ ok: false, reason: 'Something is already there.' });
    expect(build(world, 'office', 2, 109)).toEqual(OK);
  });

  it('lets a room stand over an elevator shaft column', () => {
    const world = makeWorld();
    lobby(world, 100, 63); // on to 162, under every office tried here
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    // the office runs from 146 to 154, across the shaft columns 150 to 153: the shaft overlays it
    expect(canBuild(world, 'office', 2, 146).ok).toBe(true);
    expect(canBuild(world, 'office', 2, 154).ok).toBe(true);
    // a connector is the one thing that may not share the column
    expect(canBuild(world, 'stairs', 2, 146)).toEqual({ ok: false, reason: 'An elevator is in the way.' });
  });

  it('lets a shaft pass through rooms of every kind', () => {
    const world = makeWorld();
    lobby(world, 100, 30); // on to 129, under the stairs at 120
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    // the office on floor 2 is no obstacle, and neither are the lobby segments on floor 1
    expect(canBuildShaft(world, 'standard', 102, 1, 6).ok).toBe(true);
    expect(canBuildShaft(world, 'standard', 102, -1, 1).ok).toBe(true);
    // stairs are, they are a connector too
    expect(build(world, 'stairs', 2, 120)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 122, 1, 6)).toEqual({ ok: false, reason: 'Something is already there.' });
  });

  it('lets a shaft run through a lobby run', () => {
    const world = makeWorld();
    for (let x = 150; x <= 200; x++) expect(build(world, 'lobby', 1, x)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 176, 1, 6).ok).toBe(true);
    expect(buildShaft(world, 'standard', 176, 1, 6)).toEqual(OK);
    expect(onlyShaft(world).x).toBe(176);
    // the lobby segments are untouched
    expect(world.floorIndex.rooms.get(1)).toHaveLength(51);
  });

  it('lets a lobby segment and a sky lobby be built on shaft tiles', () => {
    const world = makeWorld(8_000_000, 3);
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(build(world, 'lobby', 1, 151)).toEqual(OK);
    expect(world.floorIndex.rooms.get(1)?.some((r) => r.x === 151)).toBe(true);
    // every other kind may stand on those tiles too, the shaft overlays them
    expect(build(world, 'lobby', 1, 100)).toEqual(OK);
    expect(canBuild(world, 'office', 2, 149).ok).toBe(true);

    expect(buildShaft(world, 'express', 200, 1, 20)).toEqual(OK);
    for (let f = 2; f <= 15; f++) expect(build(world, 'office', f, 100)).toEqual(OK);
    expect(build(world, 'skyLobby', 15, 200)).toEqual(OK);
    const sky = [...world.rooms.values()].find((r) => r.kind === 'skyLobby');
    expect(sky?.x).toBe(200);
  });

  it('stacks a stairwell: a flight may start where the last one reaches', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    expect(build(world, 'stairs', 1, 100)).toEqual(OK);
    // a new flight starting on the floor the last one reaches is fine, even directly above it
    expect(canBuild(world, 'stairs', 2, 100).ok).toBe(true);
    expect(build(world, 'stairs', 2, 100)).toEqual(OK);
  });

  it('lets an escalator start on the floor a stairs flight reaches', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    expect(build(world, 'stairs', 1, 100)).toEqual(OK);
    expect(canBuild(world, 'escalator', 2, 104).ok).toBe(true);
  });

  it('still refuses two connectors sharing a base floor', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'stairs', 1, 100)).toEqual(OK);
    expect(canBuild(world, 'stairs', 1, 104)).toEqual({ ok: false, reason: 'Something is already there.' });
  });

  it('still refuses a shaft over a stacked stairwell', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'stairs', 1, 100)).toEqual(OK);
    expect(build(world, 'stairs', 2, 100)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 100, 1, 3)).toEqual({ ok: false, reason: 'Something is already there.' });
  });

  it('refuses a shaft that overlaps another shaft', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(canBuildShaft(world, 'standard', 152, 5, 20)).toEqual({ ok: false, reason: 'An elevator is in the way.' });
    expect(canBuildShaft(world, 'standard', 154, 5, 20).ok).toBe(true);
  });

  it('needs a room on the floor below when building above ground', () => {
    const world = makeWorld();
    lobby(world);
    expect(canBuild(world, 'office', 3, 200)).toEqual({ ok: false, reason: 'Build a floor below this one first.' });
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    expect(build(world, 'office', 3, 100)).toEqual(OK);
  });

  it('needs the ground lobby for floor -1 and a room above for deeper floors', () => {
    const world = makeWorld(8_000_000, 3);
    expect(canBuild(world, 'parkingSpace', -1, 100)).toEqual({
      ok: false,
      reason: 'Build a floor below this one first.',
    });
    lobby(world);
    expect(build(world, 'parkingSpace', -1, 100)).toEqual(OK);
    expect(canBuild(world, 'parkingSpace', -3, 100).ok).toBe(false);
    expect(build(world, 'parkingSpace', -2, 100)).toEqual(OK);
    expect(build(world, 'parkingSpace', -3, 100)).toEqual(OK);
  });

  it('hangs a tall basement from the floor over its top, not its own top floor (audit A S3)', () => {
    const world = makeWorld(50_000_000, 5);
    lobby(world, 100, 60);
    for (const x of [100, 116, 132]) expect(build(world, 'parkingRamp', -1, x)).toEqual(OK);
    // recycling at B3 covers B3 and B2 and hangs from the ramps on B1
    expect(canBuild(world, 'recycling', -3, 100)).toEqual(OK);
    // the metro at B4 covers B4 to B2 and hangs from the same ramps
    expect(canBuild(world, 'metro', -4, 100)).toEqual(OK);
    // a one floor parking space at B3 still needs B2 built over it
    expect(canBuild(world, 'parkingSpace', -3, 100)).toEqual({
      ok: false,
      reason: 'Build a floor below this one first.',
    });
  });

  it('refuses a multi floor underground room that would cross floor 0', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world);
    expect(build(world, 'parkingSpace', -1, 100)).toEqual(OK);
    expect(canBuild(world, 'recycling', -1, 200).ok).toBe(false);
  });
});

describe('build: counts and limits', () => {
  it('refuses more rooms than maxCount allows', () => {
    const world = makeWorld(8_000_000, 3);
    expect(ROOMS.recycling.maxCount).toBe(1);
    lobby(world);
    expect(build(world, 'parkingSpace', -1, 100)).toEqual(OK);
    expect(build(world, 'recycling', -2, 10)).toEqual(OK);
    const result = canBuild(world, 'recycling', -2, 60);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('only one recycling center');
  });

  it('refuses more shafts than maxShafts allows', () => {
    const world = makeWorld(20_000_000);
    for (let i = 0; i < LIMITS.maxShafts; i++) {
      expect(buildShaft(world, 'standard', i * 5, 1, 4)).toEqual(OK);
    }
    expect(world.shafts.size).toBe(LIMITS.maxShafts);
    const result = canBuildShaft(world, 'standard', 300, 1, 4);
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain(`only ${LIMITS.maxShafts}`);
  });

  it('refuses a shaft longer than its span limit and counts floor 0 as missing', () => {
    const world = makeWorld(20_000_000);
    const span = SHAFTS.standard.maxSpan as number;
    expect(canBuildShaft(world, 'standard', 150, 1, span).ok).toBe(true);
    const tooLong = canBuildShaft(world, 'standard', 150, 1, span + 1);
    expect(tooLong.ok).toBe(false);
    expect(reasonOf(tooLong)).toBe('Elevators can span only 30 floors.');
    // floor 0 does not exist, so -1 to 29 is still 30 floors
    expect(canBuildShaft(world, 'standard', 150, -1, span - 1).ok).toBe(true);
    expect(canBuildShaft(world, 'standard', 150, -1, span).ok).toBe(false);
  });

  it('lets an express elevator span the whole tower', () => {
    const world = makeWorld(20_000_000, 3);
    expect(SHAFTS.express.maxSpan).toBeNull();
    expect(canBuildShaft(world, 'express', 150, 1, 90).ok).toBe(true);
  });
});

describe('shafts: stops, cars and home floor', () => {
  it('builds a standard shaft with a stop on every floor and one car', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect([...shaft.stops].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(shaft.cars).toHaveLength(1);
    expect(shaft.cars[0]?.shaftId).toBe(shaft.id);
    expect(shaft.hallCalls.size).toBe(0);
    expect(shaft.homeFloor).toBe(1);
  });

  it('skips floor 0 in the default stops and homes underground shafts on floor 1', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, -3, 5)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect([...shaft.stops].sort((a, b) => a - b)).toEqual([-3, -2, -1, 1, 2, 3, 4, 5]);
    expect(shaft.homeFloor).toBe(1);
  });

  it('homes a shaft that starts above the ground on its lowest floor', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 12, 30)).toEqual(OK);
    expect(onlyShaft(world).homeFloor).toBe(12);
  });

  it('stops an express elevator only at lobbies and underground floors', () => {
    const world = makeWorld(20_000_000, 3);
    expect(buildShaft(world, 'express', 200, -2, 20)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect([...shaft.stops].sort((a, b) => a - b)).toEqual([-2, -1, 1, 15]);
  });

  it('refuses an express stop on an ordinary floor', () => {
    const world = makeWorld(20_000_000, 3);
    expect(buildShaft(world, 'express', 200, 1, 20)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 7, stops: true })).toEqual({
      ok: false,
      reason: 'Express elevators stop only at lobbies and underground floors.',
    });
    expect(shaft.stops.has(7)).toBe(false);
  });

  it('allows an express stop on a sky lobby floor and on a standard shaft anywhere', () => {
    const world = makeWorld(20_000_000, 3);
    expect(buildShaft(world, 'express', 200, 1, 20)).toEqual(OK);
    const express = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: express.id, floor: 15, stops: false })).toEqual(OK);
    expect(express.stops.has(15)).toBe(false);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: express.id, floor: 15, stops: true })).toEqual(OK);
    expect(express.stops.has(15)).toBe(true);

    expect(buildShaft(world, 'standard', 150, 1, 20)).toEqual(OK);
    const standard = [...world.shafts.values()].find((s) => s.kind === 'standard') as Shaft;
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: standard.id, floor: 7, stops: false })).toEqual(OK);
    expect(standard.stops.has(7)).toBe(false);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: standard.id, floor: 7, stops: true })).toEqual(OK);
    expect(standard.stops.has(7)).toBe(true);
    expect(world.floorIndex.shafts.get(7)?.some((s) => s.id === standard.id)).toBe(true);
  });

  it('refuses a stop on a floor the shaft does not reach', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const result = applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 11, stops: true });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('That floor is not on this elevator.');
  });

  it('sets the home floor only to a floor the elevator stops at', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 6, stops: false })).toEqual(OK);
    const refused = applyCommand(world, { kind: 'shaft.setHome', shaftId: shaft.id, floor: 6 });
    expect(refused.ok).toBe(false);
    expect(reasonOf(refused)).toBe('The home floor must be a stop.');
    expect(applyCommand(world, { kind: 'shaft.setHome', shaftId: shaft.id, floor: 5 })).toEqual(OK);
    expect(shaft.homeFloor).toBe(5);
  });

  it('extends a shaft, keeping the stops the player changed and adding defaults', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.setStop', shaftId: shaft.id, floor: 5, stops: false })).toEqual(OK);
    expect(applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 20 })).toEqual(OK);
    expect(shaft.floorMax).toBe(20);
    expect(shaft.stops.has(5)).toBe(false);
    for (const f of [1, 4, 6, 10, 11, 15, 20]) expect(shaft.stops.has(f)).toBe(true);
    expect(world.floorIndex.shafts.get(20)?.some((s) => s.id === shaft.id)).toBe(true);
  });

  it('refuses an extension that shrinks the shaft or overruns the span', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const shrink = applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 8 });
    expect(shrink.ok).toBe(false);
    expect(reasonOf(shrink)).toBe('You can only extend an elevator, not shrink it.');
    const tooLong = applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 40 });
    expect(tooLong.ok).toBe(false);
    expect(reasonOf(tooLong)).toBe('Elevators can span only 30 floors.');
    expect(shaft.floorMax).toBe(10);
  });

  it('refuses an extension into a connector and passes through rooms', () => {
    const world = makeWorld();
    lobby(world);
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    for (let f = 2; f <= 12; f++) expect(build(world, 'office', f, 100)).toEqual(OK);
    // an office in the shaft columns, just above the top of the shaft, is overlaid
    expect(build(world, 'office', 11, 148)).toEqual(OK);
    expect(applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 11 })).toEqual(OK);
    // stairs in the columns above are not
    expect(build(world, 'stairs', 12, 148)).toEqual(OK);
    const result = applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 13 });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('Something is already there.');
  });

  it('adds cars up to the limit and charges for each one', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const before = world.cash;
    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual(OK);
    expect(world.cash).toBe(before - SHAFTS.standard.carCost);
    expect(shaft.cars).toHaveLength(2);
    expect(shaft.cars[1]?.id).not.toBe(shaft.cars[0]?.id);
    while (shaft.cars.length < SHAFTS.standard.maxCars) {
      expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual(OK);
    }
    const result = applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain(`${SHAFTS.standard.maxCars} cars`);
    expect(shaft.cars).toHaveLength(SHAFTS.standard.maxCars);
  });

  it('refuses to remove the last car or a car with people in it', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const last = applyCommand(world, { kind: 'shaft.removeCar', shaftId: shaft.id });
    expect(last.ok).toBe(false);
    expect(reasonOf(last)).toBe('An elevator needs at least one car.');

    expect(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toEqual(OK);
    shaft.cars[1]?.passengers.push(99);
    const busy = applyCommand(world, { kind: 'shaft.removeCar', shaftId: shaft.id });
    expect(busy.ok).toBe(false);
    expect(reasonOf(busy)).toBe('People are inside.');
    expect(shaft.cars).toHaveLength(2);

    shaft.cars[1]?.passengers.splice(0, 1);
    expect(applyCommand(world, { kind: 'shaft.removeCar', shaftId: shaft.id })).toEqual(OK);
    expect(shaft.cars).toHaveLength(1);
  });
});

describe('room.setRent', () => {
  it('accepts every step from 50 to 150 on an office', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office');
    if (!office) throw new Error('no office');
    for (let rent = 50; rent <= 150; rent += 10) {
      expect(applyCommand(world, { kind: 'room.setRent', roomId: office.id, rent })).toEqual(OK);
      expect(office.rent).toBe(rent);
    }
  });

  it('refuses rent out of range or off the step', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office');
    if (!office) throw new Error('no office');
    for (const rent of [45, 160, 105]) {
      const result = applyCommand(world, { kind: 'room.setRent', roomId: office.id, rent });
      expect(result.ok).toBe(false);
      expect(reasonOf(result)).toBe('Rent must be between 50% and 150% in steps of 10%.');
      expect(office.rent).toBe(100);
    }
  });

  it('refuses rent on a room kind that has no rent', () => {
    const world = makeWorld(20_000_000, 3);
    lobby(world);
    expect(build(world, 'shop', 2, 100)).toEqual(OK);
    const shop = [...world.rooms.values()].find((r) => r.kind === 'shop');
    if (!shop) throw new Error('no shop');
    const result = applyCommand(world, { kind: 'room.setRent', roomId: shop.id, rent: 50 });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('This room has no rent to set.');
  });

  it('refuses rent on a room that does not exist', () => {
    const world = makeWorld();
    const result = applyCommand(world, { kind: 'room.setRent', roomId: 999, rent: 50 });
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toBe('No such room.');
  });
});

describe('demolish', () => {
  it('refuses to demolish a room with people inside', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office');
    if (!office) throw new Error('office missing');
    office.occupancy = 3;
    expect(applyCommand(world, { kind: 'demolish', roomId: office.id })).toEqual({
      ok: false,
      reason: 'People are inside.',
    });
    expect(world.rooms.has(office.id)).toBe(true);
  });

  it('demolishes a vacant room, removes its tenants and refunds nothing', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office');
    if (!office) throw new Error('office missing');
    const tenant = {
      id: 9_001,
      kind: 'worker' as const,
      homeRoomId: office.id,
      pos: { floor: 1, x: 100 },
      inCarId: null,
      inRoomId: null,
      route: [],
      state: 'outside' as const,
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: null,
      wallet: 0,
      leaveReason: null,
    };
    world.sims.set(tenant.id, tenant);
    office.tenants = [tenant.id];
    const cash = world.cash;
    expect(applyCommand(world, { kind: 'demolish', roomId: office.id })).toEqual(OK);
    expect(world.rooms.has(office.id)).toBe(false);
    expect(world.sims.has(tenant.id)).toBe(false);
    expect(tenant.state).toBe('gone');
    expect(world.cash).toBe(cash);
    expect(world.floorIndex.rooms.get(2) ?? []).toHaveLength(0);
  });

  it('refuses to demolish a shaft while a car carries passengers', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    shaft.cars[0]?.passengers.push(77);
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: shaft.id })).toEqual({
      ok: false,
      reason: 'Wait until the cars are empty.',
    });
    expect(world.shafts.has(shaft.id)).toBe(true);
  });

  it('demolishes an empty shaft with no refund', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const cash = world.cash;
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: shaft.id })).toEqual(OK);
    expect(world.shafts.size).toBe(0);
    expect(world.cash).toBe(cash);
    expect(world.floorIndex.shafts.get(5) ?? []).toHaveLength(0);
  });

  it('refuses to demolish something that is not there', () => {
    const world = makeWorld();
    expect(applyCommand(world, { kind: 'demolish', roomId: 404 }).ok).toBe(false);
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: 404 }).ok).toBe(false);
  });
});

describe('logging, previews and delegation', () => {
  it('writes a log line on every successful command', () => {
    const world = makeWorld();
    lobby(world, 100, 1);
    expect(world.log).toHaveLength(1);
    expect(world.log[0]?.text).toContain('Built');
    expect(world.log[0]?.minute).toBe(world.time.minute);

    expect(build(world, 'office', 2, 100)).toEqual(OK);
    expect(world.log).toHaveLength(2);
    expect(world.log[1]?.text).toBe('Built an office on floor 2.');

    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    expect(world.log).toHaveLength(3);
    expect(world.log[2]?.text).toContain('elevator');
  });

  it('writes no log line and spends nothing when a command is refused', () => {
    const world = makeWorld();
    expect(build(world, 'office', 2, 100).ok).toBe(false);
    expect(world.log).toHaveLength(0);
    expect(world.cash).toBe(8_000_000);
  });

  it('canBuild and canBuildShaft never mutate the world', () => {
    const world = makeWorld();
    lobby(world);
    const cash = world.cash;
    const rooms = world.rooms.size;
    const logLines = world.log.length;
    expect(canBuild(world, 'office', 2, 100).ok).toBe(true);
    expect(canBuildShaft(world, 'standard', 150, 1, 10).ok).toBe(true);
    expect(world.cash).toBe(cash);
    expect(world.rooms.size).toBe(rooms);
    expect(world.shafts.size).toBe(0);
    expect(world.log).toHaveLength(logLines);
  });

  it('hands bomb and fire commands to events.ts', () => {
    const world = makeWorld();
    mocks.handleEventCommand.mockClear();
    expect(applyCommand(world, { kind: 'bomb.pay' })).toEqual(OK);
    expect(applyCommand(world, { kind: 'fire.callHelicopter' })).toEqual(OK);
    expect(mocks.handleEventCommand).toHaveBeenCalledTimes(2);
    expect(mocks.handleEventCommand.mock.calls[0]?.[1]).toEqual({ kind: 'bomb.pay' });
    expect(mocks.handleEventCommand.mock.calls[1]?.[1]).toEqual({ kind: 'fire.callHelicopter' });
  });

  it('records new rooms as vacant, clean and unlit by fire', () => {
    const world = makeWorld();
    lobby(world);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office');
    expect(office?.vacant).toBe(true);
    expect(office?.dirty).toBe(false);
    expect(office?.infested).toBe(false);
    expect(office?.onFire).toBe(false);
    expect(office?.occupancy).toBe(0);
    expect(office?.tenants).toEqual([]);
    expect(office?.builtAtMinute).toBe(world.time.minute);
    expect(office?.lowEvalSinceMinute).toBeNull();
    expect(world.routingDirty).toBe(true);
  });
});

describe('canExtendShaft', () => {
  it('says yes to a reach upward, and charges nothing for it', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const cash = world.cash;
    expect(canExtendShaft(world, shaft.id, 1, 16)).toEqual(OK);
    expect(applyCommand(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 16 })).toEqual(OK);
    expect(world.cash).toBe(cash); // the shaft's price covered every floor it will ever serve
  });

  it('says yes to a reach below ground', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(canExtendShaft(world, shaft.id, -3, 10)).toEqual(OK);
  });

  it('refuses to shrink, and refuses a span past the limit', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(reasonOf(canExtendShaft(world, shaft.id, 2, 10))).toBe('You can only extend an elevator, not shrink it.');
    expect(reasonOf(canExtendShaft(world, shaft.id, 1, 9))).toBe('You can only extend an elevator, not shrink it.');
    expect(reasonOf(canExtendShaft(world, shaft.id, 1, 40))).toBe('Elevators can span only 30 floors.');
  });

  it('refuses a reach through stairs, and refuses a shaft that is gone', () => {
    const world = makeWorld();
    lobby(world);
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    for (let f = 2; f <= 12; f++) expect(build(world, 'office', f, 100)).toEqual(OK);
    expect(build(world, 'stairs', 11, 148)).toEqual(OK);
    expect(reasonOf(canExtendShaft(world, shaft.id, 1, 12))).toBe('Something is already there.');
    expect(reasonOf(canExtendShaft(world, shaft.id + 99, 1, 12))).toBe('That elevator is gone.');
  });

  it('leaves the shaft exactly as it was: asking is not doing', () => {
    const world = makeWorld();
    expect(buildShaft(world, 'standard', 150, 1, 10)).toEqual(OK);
    const shaft = onlyShaft(world);
    const lines = world.log.length;
    expect(canExtendShaft(world, shaft.id, 1, 16)).toEqual(OK);
    expect(shaft.floorMax).toBe(10);
    expect(world.log.length).toBe(lines);
  });
});

describe('structural support', () => {
  const AIR = 'Nothing is holding this up. Build under it first.';

  function roomAtSpot(world: World, kind: RoomKind, floor: number, x: number): Room {
    const room = [...world.rooms.values()].find((r) => r.kind === kind && r.floor === floor && r.x === x);
    if (!room) throw new Error(`${kind} on ${floor} at ${x} missing`);
    return room;
  }

  it('lets one room overhang the floor below, and refuses a second room out on the air', () => {
    const world = makeWorld();
    lobby(world, 100, 6); // floor 1 tiles 100 to 105
    // the office runs 104 to 112: two tiles over the lobby, the rest overhangs
    expect(build(world, 'office', 2, 104)).toEqual(OK);
    // 113 to 121 has nothing at all under it on floor 1
    expect(canBuild(world, 'office', 2, 113)).toEqual({ ok: false, reason: AIR });
    expect(build(world, 'office', 2, 113)).toEqual({ ok: false, reason: AIR });
    expect(world.rooms.size).toBe(7);
    // floor 3 over the overhanging office is held up by it
    expect(build(world, 'office', 3, 110)).toEqual(OK);
  });

  it('counts an elevator shaft passing the floor below as support', () => {
    const world = makeWorld();
    lobby(world, 100, 6);
    expect(buildShaft(world, 'standard', 200, 1, 6)).toEqual(OK);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    // 196 to 204 overlaps the shaft column 200 to 203 on floor 1
    expect(build(world, 'office', 2, 196)).toEqual(OK);
    expect(canBuild(world, 'office', 2, 250)).toEqual({ ok: false, reason: AIR });
  });

  it('checks a multi floor room under its bottom floor', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world, 100, 6);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    // a party hall on floors 3 and 4 over the office is fine; one off to the side is not
    expect(build(world, 'partyHall', 3, 100)).toEqual(OK);
    expect(canBuild(world, 'partyHall', 3, 200)).toEqual({ ok: false, reason: AIR });
  });

  it('refuses a demolition that would strand a room above, and allows it once that room is gone', () => {
    const world = makeWorld();
    lobby(world, 100, 6);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    expect(build(world, 'office', 3, 100)).toEqual(OK);
    const lower = roomAtSpot(world, 'office', 2, 100);
    const upper = roomAtSpot(world, 'office', 3, 100);
    const refused = { ok: false, reason: 'Something above rests on this. Remove that first.' };
    expect(applyCommand(world, { kind: 'demolish', roomId: lower.id })).toEqual(refused);
    expect(world.rooms.has(lower.id)).toBe(true);
    // one of six lobby tiles can go: the office still has five under it
    const lobbyTile = roomAtSpot(world, 'lobby', 1, 100);
    expect(applyCommand(world, { kind: 'demolish', roomId: lobbyTile.id })).toEqual(OK);
    expect(applyCommand(world, { kind: 'demolish', roomId: upper.id })).toEqual(OK);
    expect(applyCommand(world, { kind: 'demolish', roomId: lower.id })).toEqual(OK);
  });

  it('refuses to demolish a shaft that is the only thing holding a room up', () => {
    const world = makeWorld();
    lobby(world, 100, 6);
    expect(buildShaft(world, 'standard', 200, 1, 6)).toEqual(OK);
    expect(build(world, 'office', 2, 100)).toEqual(OK);
    expect(build(world, 'office', 2, 196)).toEqual(OK);
    const shaft = onlyShaft(world);
    expect(applyCommand(world, { kind: 'shaft.demolish', shaftId: shaft.id })).toEqual({
      ok: false,
      reason: 'Something above rests on this. Remove that first.',
    });
    expect(world.shafts.has(shaft.id)).toBe(true);
  });

  it('mirrors the rule underground: deeper floors hang from the structure above', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world, 100, 6);
    // basement 1 keeps the lobby rule: any ground lobby will do, wherever it is
    expect(build(world, 'parkingSpace', -1, 200)).toEqual(OK);
    expect(build(world, 'parkingSpace', -2, 202)).toEqual(OK); // 202 to 205 under 200 to 203
    expect(canBuild(world, 'parkingSpace', -2, 250)).toEqual({ ok: false, reason: AIR });
    const upper = roomAtSpot(world, 'parkingSpace', -1, 200);
    expect(applyCommand(world, { kind: 'demolish', roomId: upper.id })).toEqual({
      ok: false,
      reason: 'Something below rests on this. Remove that first.',
    });
  });

  it('loads a save whose structure already breaks the rule, keeps it, and still lets it be demolished', () => {
    const world = makeWorld();
    lobby(world, 100, 6);
    // an office hanging in the air, placed directly as an older build would have left it
    const floating: Room = {
      id: allocId(world),
      kind: 'office',
      floor: 2,
      x: 300,
      width: ROOMS.office.width,
      height: 1,
      eval: 1,
      tenants: [],
      occupancy: 0,
      builtAtMinute: 0,
      vacant: true,
      dirty: false,
      infested: false,
      lowEvalSinceMinute: null,
      onFire: false,
      rent: 100,
    };
    addRoom(world, floating);
    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.world.rooms.get(floating.id)?.x).toBe(300);
    expect(loaded.world.rooms.size).toBe(7);
    // the old floating office blocks no demolition, and can itself be removed
    const lobbyTile = roomAtSpot(loaded.world, 'lobby', 1, 105);
    expect(applyCommand(loaded.world, { kind: 'demolish', roomId: lobbyTile.id })).toEqual(OK);
    expect(applyCommand(loaded.world, { kind: 'demolish', roomId: floating.id })).toEqual(OK);
  });
});

describe('stairs and escalators: overlay, depth and support', () => {
  const AIR = 'Nothing is holding this up. Build under it first.';

  it('lays stairs over offices and condos, and lets a room go where stairs already are', () => {
    const world = makeWorld();
    lobby(world, 100, 30); // floor 1 tiles 100 to 129
    expect(build(world, 'office', 2, 100)).toEqual(OK); // 100 to 108
    expect(build(world, 'condo', 2, 109)).toEqual(OK); // 109 to 124
    expect(build(world, 'stairs', 2, 104)).toEqual(OK); // 104 to 111, across both
    expect(build(world, 'stairs', 1, 116)).toEqual(OK); // over the lobby, under the condo
    // an office on floor 3, where the flight from floor 2 reaches, over the flight's tiles
    expect(build(world, 'office', 3, 104)).toEqual(OK);
    expect(world.rooms.size).toBe(30 + 5);
  });

  it('lets a flight stand on an overhanging office, but not an escalator', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world, 100, 6); // floor 1 tiles 100 to 105
    expect(build(world, 'office', 2, 104)).toEqual(OK); // 104 to 112, overhangs from 106
    // 106 to 113 has nothing under it on floor 1, but stands on the office's floor
    expect(canBuild(world, 'escalator', 2, 106)).toEqual({ ok: false, reason: AIR });
    expect(canBuild(world, 'stairs', 2, 106)).toEqual(OK);
    expect(build(world, 'stairs', 2, 106)).toEqual(OK);
    // off the office's end there is still nothing to stand on
    expect(canBuild(world, 'stairs', 3, 200)).toEqual({ ok: false, reason: AIR });
  });

  for (const kind of ['stairs', 'escalator'] as const) {
    it(`joins B1 to the ground with ${kind}, and refuses them any deeper`, () => {
      const world = makeWorld(8_000_000, 3);
      const deep = `${kind === 'stairs' ? 'Stairs' : 'Escalators'} can only go down one level, to B1.`;
      expect(canBuild(world, kind, -1, 100)).toEqual({ ok: false, reason: 'Build a floor below this one first.' });
      lobby(world, 100, 6);
      expect(build(world, kind, -1, 100)).toEqual(OK);
      const flight = [...world.rooms.values()].find((r) => r.kind === kind) as Room;
      expect(flight.floor).toBe(-1);
      expect(world.floorIndex.rooms.get(1)).toContain(flight);
      expect(world.floorIndex.rooms.has(0)).toBe(false);
      // B1 and B2 built out, still no deeper flight
      expect(build(world, 'parkingSpace', -1, 200)).toEqual(OK);
      expect(build(world, 'parkingSpace', -2, 200)).toEqual(OK);
      expect(canBuild(world, kind, -2, 200)).toEqual({ ok: false, reason: deep });
      expect(canBuild(world, kind, -3, 200)).toEqual({ ok: false, reason: deep });
      // and every floor from the ground up is fine
      expect(build(world, kind, 1, 102)).toEqual(OK);
      expect(build(world, kind, 2, 102)).toEqual(OK);
    });
  }

  it('keeps other rooms off floor 0: a two floor room from B1 still does not fit', () => {
    const world = makeWorld(8_000_000, 3);
    lobby(world, 100, 40);
    expect(canBuild(world, 'cinema', -1, 100)).toEqual({ ok: false, reason: 'That does not fit inside the tower.' });
  });
});

describe('car range across the ground (audit A S6)', () => {
  it('refuses a range that names floor 0 and accepts B1 to floor 1', () => {
    const world = makeWorld();
    lobby(world);
    expect(buildShaft(world, 'standard', 100, -1, 5)).toEqual(OK);
    const shaft = onlyShaft(world);
    const car = shaft.cars[0] as Shaft['cars'][number];
    const setRange = (lo: number, hi: number): CommandResult =>
      applyCommand(world, { kind: 'shaft.setCarRange', shaftId: shaft.id, carId: car.id, range: { lo, hi } });
    expect(setRange(0, 1)).toEqual({ ok: false, reason: 'That floor is not on this elevator.' });
    expect(setRange(-1, 0)).toEqual({ ok: false, reason: 'That floor is not on this elevator.' });
    expect(car.range).toBeNull();
    expect(setRange(-1, 1)).toEqual(OK);
    expect(car.range).toEqual({ lo: -1, hi: 1 });
  });
});

describe('refusal wording: plurals (audit A S7)', () => {
  const underBase = (kind: RoomKind): number => -ROOMS[kind].height;

  function refusalStrings(): string[] {
    const world = makeWorld(20_000_000, 6);
    lobby(world, 0, 300);
    expect(buildShaft(world, 'standard', 348, 1, 15)).toEqual(OK);
    expect(buildShaft(world, 'standard', 360, 1, 5)).toEqual(OK);
    const shaft = [...world.shafts.values()].find((s) => s.x === 360) as Shaft;
    const out: string[] = [];
    const push = (r: CommandResult): void => {
      expect(r.ok).toBe(false);
      if (!r.ok) out.push(r.reason);
    };
    // the placement refusals, with cash in hand
    for (const kind of Object.keys(ROOMS) as RoomKind[]) {
      const rule = ROOMS[kind];
      if (rule.placement === 'aboveGround') push(canBuild(world, kind, underBase(kind), 0));
      if (rule.placement === 'underground') push(canBuild(world, kind, 2, 0));
    }
    push(canBuild(world, 'stairs', -3, 0));
    push(canBuild(world, 'escalator', -3, 0));
    push(canBuildShaft(world, 'standard', 200, 1, 40));
    push(canBuildShaft(world, 'service', 200, 1, 40));
    // one of a kind: a second one is refused
    const other = makeWorld(20_000_000, 6);
    lobby(other, 0, 200);
    expect(build(other, 'recycling', -2, 0)).toEqual(OK);
    push(canBuild(other, 'recycling', -2, 100));
    // the cash refusals, with nothing in hand
    world.cash = 0;
    for (const kind of Object.keys(ROOMS) as RoomKind[]) {
      const rule = ROOMS[kind];
      let r: CommandResult;
      if (kind === 'lobby') r = canBuild(world, kind, 1, 300);
      else if (kind === 'skyLobby') r = canBuild(world, kind, 15, 350);
      else if (rule.placement === 'underground') r = canBuild(world, kind, underBase(kind), 100);
      else r = canBuild(world, kind, 2, 0);
      expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^Not enough cash\. /) });
      push(r);
    }
    for (const kind of Object.keys(SHAFTS) as ShaftKind[]) {
      const r = canBuildShaft(world, kind, 200, 1, 5);
      expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/^Not enough cash\. /) });
      push(r);
    }
    push(applyCommand(world, { kind: 'shaft.addCar', shaftId: shaft.id }));
    return out;
  }

  it('says Lobbies, Housekeeping and Fast food, never "ys " or a doubled plural', () => {
    const reasons = refusalStrings();
    expect(reasons.length).toBeGreaterThan(40);
    for (const reason of reasons) {
      expect(reason).not.toMatch(/ys /);
      expect(reason).not.toMatch(/Housekeepings|Fast foods|Stairss|lobbys/i);
    }
    expect(reasons).toContain('Not enough cash. Lobbies cost $5,000.');
    expect(reasons).toContain('Not enough cash. Sky lobbies cost $5,000.');
    expect(reasons).toContain('Lobbies must go above ground.');
    expect(reasons).toContain('Not enough cash. Housekeeping costs $50,000.');
    expect(reasons).toContain('Not enough cash. Fast food costs $100,000.');
    expect(reasons).toContain('Not enough cash. Offices cost $40,000.');
    expect(reasons).toContain('Not enough cash. Elevator cars cost $80,000.');
  });

  it('has a plural for every room and elevator label', () => {
    for (const rule of [...Object.values(ROOMS), ...Object.values(SHAFTS)]) {
      expect(PLURAL_LABELS[rule.label], rule.label).toBeDefined();
      if ('carCost' in rule) expect(PLURAL_LABELS[`${rule.label} car`], rule.label).toBeDefined();
    }
  });
});

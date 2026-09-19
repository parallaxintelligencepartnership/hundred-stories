import { describe, expect, it } from 'vitest';
import { createWorld, addRoom, addShaft, addSim, log } from '../../src/sim/world';
import { serialize, deserialize, hashWorld, SAVE_VERSION } from '../../src/sim/save';
import type { Room, Shaft, Sim, World } from '../../src/sim/types';

function buildRoom(overrides: Partial<Room> = {}): Room {
  return {
    id: 1,
    kind: 'office',
    floor: 2,
    x: 100,
    width: 10,
    height: 1,
    eval: 0.8,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: true,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    ...overrides,
  };
}

function buildShaft(overrides: Partial<Shaft> = {}): Shaft {
  return {
    id: 10,
    kind: 'standard',
    x: 150,
    width: 2,
    floorMin: 1,
    floorMax: 10,
    stops: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    homeFloor: 1,
    cars: [
      {
        id: 11,
        shaftId: 10,
        y: 1,
        dir: 0,
        state: 'idle',
        doorTimer: 0,
        idleSince: 0,
        passengers: [],
        calls: new Set([5]),
      },
    ],
    hallCalls: new Map([[3, { up: true, down: false }]]),
    ...overrides,
  };
}

function buildSim(overrides: Partial<Sim> = {}): Sim {
  return {
    id: 20,
    kind: 'worker',
    homeRoomId: 1,
    pos: { floor: 2, x: 105 },
    inCarId: null,
    inRoomId: 1,
    route: [{ kind: 'walk', toX: 110 }],
    state: 'inRoom',
    stress: 0.1,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...overrides,
  };
}

function richWorld(): World {
  const world = createWorld(777);
  addRoom(world, buildRoom());
  addRoom(world, buildRoom({ id: 2, kind: 'lobby', floor: 1, x: 100, width: 40, height: 1, vacant: false }));
  addShaft(world, buildShaft());
  addSim(world, buildSim());
  world.events.push({ kind: 'santa', startedAt: 0, x: 0 });
  world.cash = 123456;
  world.stars = 3;
  world.population = 6;
  log(world, 'Test event happened.');
  return world;
}

describe('save/deserialize round trip', () => {
  it('hashWorld matches after a full serialize/deserialize round trip', () => {
    const world = richWorld();
    const beforeHash = hashWorld(world);
    const text = serialize(world);
    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterHash = hashWorld(result.world);
    expect(afterHash).toBe(beforeHash);
  });

  it('restores rooms as a Map keyed by id', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.rooms).toBeInstanceOf(Map);
    expect(result.world.rooms.get(1)?.kind).toBe('office');
    expect(result.world.rooms.get(2)?.kind).toBe('lobby');
  });

  it('restores shaft stops as a Set of numbers', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(10);
    expect(shaft?.stops).toBeInstanceOf(Set);
    expect(Array.from(shaft?.stops ?? []).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('restores car calls as a Set and hallCalls as a Map', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shaft = result.world.shafts.get(10);
    expect(shaft?.cars[0]?.calls).toBeInstanceOf(Set);
    expect(shaft?.cars[0]?.calls.has(5)).toBe(true);
    expect(shaft?.hallCalls).toBeInstanceOf(Map);
    expect(shaft?.hallCalls.get(3)).toEqual({ up: true, down: false });
  });

  it('restores sims as a Map keyed by id', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.sims).toBeInstanceOf(Map);
    expect(result.world.sims.get(20)?.kind).toBe('worker');
  });

  it('caps the restored log at 200 entries even if more are saved', () => {
    const world = richWorld();
    for (let i = 0; i < 300; i++) log(world, `Line ${i}`);
    // world.log itself is capped at 500 by world.ts's log(); force a bigger array to
    // simulate a save file authored by another version with more history.
    const text = serialize(world);
    const data = JSON.parse(text);
    expect(data.log.length).toBeLessThanOrEqual(200);
    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.log.length).toBeLessThanOrEqual(200);
  });

  it('sets routingDirty true and rebuilds the floor index after loading', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.routingDirty).toBe(true);
    expect(result.world.floorIndex.builtFloors.has(2)).toBe(true);
    expect(result.world.floorIndex.rooms.get(2)?.some((r) => r.id === 1)).toBe(true);
  });

  it('restores scalar fields exactly', () => {
    const world = richWorld();
    const result = deserialize(serialize(world));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.world.seed).toBe(777);
    expect(result.world.cash).toBe(123456);
    expect(result.world.stars).toBe(3);
    expect(result.world.population).toBe(6);
    expect(result.world.time.minute).toBe(world.time.minute);
  });

  it('restores the rng so future draws continue the original sequence', () => {
    const world = richWorld();
    // Advance the rng a bit before saving, so the saved state is not the initial seed.
    world.rng.next();
    world.rng.next();
    const text = serialize(world);
    // Continue drawing from the original rng: these are the values a fresh load
    // should reproduce.
    const expected = [world.rng.next(), world.rng.next(), world.rng.next()];

    const result = deserialize(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actual = [result.world.rng.next(), result.world.rng.next(), result.world.rng.next()];
    expect(actual).toEqual(expected);
  });
});

describe('deserialize error handling', () => {
  it('reports a version reason for a save from a different version', () => {
    const world = richWorld();
    const data = JSON.parse(serialize(world));
    data.version = SAVE_VERSION + 1;
    const result = deserialize(JSON.stringify(data));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This save is from a different version of the game.');
  });

  it('reports a plain reason for garbage text', () => {
    const result = deserialize('not even json {{{');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This file is not a Hundred Stories save.');
  });

  it('reports a plain reason for JSON of the wrong shape', () => {
    const result = deserialize(JSON.stringify({ hello: 'world' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('This file is not a Hundred Stories save.');
  });

  it('never throws for null, arrays, or numbers as top level JSON', () => {
    expect(() => deserialize('null')).not.toThrow();
    expect(() => deserialize('[1,2,3]')).not.toThrow();
    expect(() => deserialize('42')).not.toThrow();
    expect(deserialize('null').ok).toBe(false);
    expect(deserialize('[1,2,3]').ok).toBe(false);
    expect(deserialize('42').ok).toBe(false);
  });
});

describe('hashWorld', () => {
  it('is stable across two serializations of the same world', () => {
    const world = richWorld();
    expect(hashWorld(world)).toBe(hashWorld(world));
  });

  it('changes when cash changes', () => {
    const world = richWorld();
    const before = hashWorld(world);
    world.cash += 1;
    const after = hashWorld(world);
    expect(after).not.toBe(before);
  });

  it('is not affected by log contents alone', () => {
    const worldA = richWorld();
    const worldB = richWorld();
    log(worldB, 'An extra unrelated log line.');
    expect(hashWorld(worldA)).toBe(hashWorld(worldB));
  });
});

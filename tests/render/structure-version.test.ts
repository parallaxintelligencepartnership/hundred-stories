// world.structureVersion tells the renderer the static tower changed. Every sim writer of
// a field reconcileRooms or the shaft pass reads must bump it, or a room goes stale on
// screen; and it is a render counter only, so it never reaches a save or the world hash.

import { describe, expect, it } from 'vitest';
import { applyCommand } from '../../src/sim/build';
import { startFire } from '../../src/sim/events';
import { deserialize, hashWorld, serialize } from '../../src/sim/save';
import type { Command, Shaft, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';

function tower(): World {
  const world = createWorld(42);
  world.cash = 50_000_000;
  for (let i = 0; i < 12; i++) expect(applyCommand(world, { kind: 'build', room: 'lobby', floor: 1, x: 100 + i }).ok).toBe(true);
  return world;
}

function bumps(world: World, cmd: Command): number {
  const before = world.structureVersion;
  const result = applyCommand(world, cmd);
  expect(result).toEqual({ ok: true });
  return world.structureVersion - before;
}

function onlyShaft(world: World): Shaft {
  const shaft = [...world.shafts.values()][0];
  if (!shaft) throw new Error('no shaft');
  return shaft;
}

describe('structureVersion writers', () => {
  it('starts at 0 in a new world', () => {
    expect(createWorld(1).structureVersion).toBe(0);
  });

  it('moves on build and demolish', () => {
    const world = tower();
    expect(bumps(world, { kind: 'build', room: 'office', floor: 2, x: 100 })).toBeGreaterThan(0);
    const office = [...world.rooms.values()].find((r) => r.kind === 'office')!;
    expect(bumps(world, { kind: 'demolish', roomId: office.id })).toBeGreaterThan(0);
  });

  it('moves on shaft build, extend, car add, car remove and demolish', () => {
    const world = tower();
    expect(bumps(world, { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 5 })).toBeGreaterThan(0);
    const shaft = onlyShaft(world);
    expect(bumps(world, { kind: 'shaft.extend', shaftId: shaft.id, floorMin: 1, floorMax: 8 })).toBeGreaterThan(0);
    expect(bumps(world, { kind: 'shaft.addCar', shaftId: shaft.id })).toBeGreaterThan(0);
    expect(bumps(world, { kind: 'shaft.removeCar', shaftId: shaft.id })).toBeGreaterThan(0);
    expect(bumps(world, { kind: 'shaft.demolish', shaftId: shaft.id })).toBeGreaterThan(0);
  });

  it('moves when a fire starts', () => {
    const world = tower();
    applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 100 });
    const before = world.structureVersion;
    startFire(world);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(true);
    expect(world.structureVersion).toBeGreaterThan(before);
  });
});

describe('structureVersion stays out of saves and the hash', () => {
  it('leaves the save text byte-identical and never names the field', () => {
    const world = tower();
    applyCommand(world, { kind: 'build', room: 'office', floor: 2, x: 100 });
    const text = serialize(world);
    const hash = hashWorld(world);
    expect(text).not.toContain('structureVersion');
    world.structureVersion += 1000;
    expect(serialize(world)).toBe(text);
    expect(hashWorld(world)).toBe(hash);
  });

  it('loads at 0 whatever the saved world had reached', () => {
    const world = tower();
    expect(world.structureVersion).toBeGreaterThan(0);
    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.world.structureVersion).toBe(0);
      expect(hashWorld(loaded.world)).toBe(hashWorld(world));
    }
  });
});

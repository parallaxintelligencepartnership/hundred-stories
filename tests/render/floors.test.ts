// A sim between two rooms, or waiting by a shaft on an otherwise empty floor,
// must have a floor under its feet. The renderer paints one across the built
// extent of every floor; this covers how that extent is worked out.

import { describe, expect, it } from 'vitest';
import { builtFloorExtents, simFeetY } from '../../src/render/renderer';
import { floorBaseY } from '../../src/render/camera';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Shaft, ShaftKind, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld } from '../../src/sim/world';

function room(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const built: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 0.5,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: true,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
  };
  addRoom(world, built);
  return built;
}

function shaft(world: World, kind: ShaftKind, x: number, floorMin: number, floorMax: number): Shaft {
  const built: Shaft = {
    id: allocId(world),
    kind,
    x,
    width: 4,
    floorMin,
    floorMax,
    stops: new Set<number>(),
    homeFloor: 1,
    cars: [],
    hallCalls: new Map(),
  };
  addShaft(world, built);
  return built;
}

describe('built floor extents', () => {
  it('spans the gap between two rooms on the same floor', () => {
    const world = createWorld(1);
    room(world, 'office', 2, 100); // 100 to 109
    room(world, 'office', 2, 140); // 140 to 149
    const extent = builtFloorExtents(world).get(2);
    expect(extent).toEqual({ min: 100, max: 149 });
  });

  it('gives a shaft only floor a floor to stand on', () => {
    const world = createWorld(1);
    room(world, 'lobby', 1, 100);
    shaft(world, 'standard', 150, 1, 8);
    const extents = builtFloorExtents(world);
    expect(extents.get(1)).toEqual({ min: 100, max: 154 }); // lobby out to the shaft
    expect(extents.get(5)).toEqual({ min: 150, max: 154 }); // the shaft alone
    expect(extents.has(9)).toBe(false); // nothing built above the shaft
  });

  it('covers every floor a tall room occupies and never floor 0', () => {
    const world = createWorld(1);
    room(world, 'cinema', 4, 60); // two floors
    shaft(world, 'standard', 200, -3, 3);
    const extents = builtFloorExtents(world);
    expect(extents.get(4)?.min).toBe(60);
    expect(extents.get(5)?.min).toBe(60);
    expect(extents.has(0)).toBe(false);
    expect(extents.get(-3)).toEqual({ min: 200, max: 204 });
  });
});

describe('sim footing', () => {
  it('stands a sim on the slab top, not the bottom of the floor band', () => {
    expect(simFeetY(1)).toBe(floorBaseY(1) - 3);
    expect(simFeetY(1)).toBeLessThan(floorBaseY(1));
    expect(simFeetY(-2)).toBe(floorBaseY(-2) - 3);
  });
});

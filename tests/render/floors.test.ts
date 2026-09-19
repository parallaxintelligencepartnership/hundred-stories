// A sim between two rooms, or waiting by a shaft on an otherwise empty floor,
// must have a floor under its feet. The renderer paints one across the built
// extent of every floor; this covers how that extent is worked out.

import { describe, expect, it } from 'vitest';
import { builtFloorExtents, inRoomSlot, simFeetY, simIsVisible, simMoves } from '../../src/render/renderer';
import { floorBaseY } from '../../src/render/camera';
import { TILE_PX } from '../../src/render/art';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Shaft, ShaftKind, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

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

describe('sims standing still', () => {
  function occupant(world: World, roomId: number, state: Sim['state']): Sim {
    const sim: Sim = {
      id: allocId(world),
      kind: 'worker',
      homeRoomId: roomId,
      pos: { floor: 2, x: 0 },
      inCarId: null,
      inRoomId: roomId,
      route: [],
      state,
      stress: 0,
      waitStart: null,
      schedule: [],
      nextScheduleIndex: 0,
      stayUntil: null,
      wallet: 0,
      leaveReason: null,
    };
    addSim(world, sim);
    return sim;
  }

  it('gives each occupant a fixed slot one tile apart inside an office', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 2, 100); // 100 to 108, capacity 6
    const slots = new Map<number, number>();
    const a = inRoomSlot(world, occupant(world, office.id, 'inRoom'), slots);
    const b = inRoomSlot(world, occupant(world, office.id, 'inRoom'), slots);
    // Nine tiles, six workers: one tile pitch, so all six stand shoulder to shoulder on their own desk.
    expect(a[0]).toBe(101 * TILE_PX);
    expect(b[0]).toBe(102 * TILE_PX);
    expect(a[1]).toBe(simFeetY(2));
    // Same inputs, same answer: nothing to jitter between frames.
    expect(inRoomSlot(world, occupant(world, office.id, 'inRoom'), new Map())[0]).toBe(a[0]);
  });

  it('fits all six of an office\'s workers inside its nine tiles', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 2, 100); // 100 to 108
    const slots = new Map<number, number>();
    const tiles = Array.from({ length: 6 }, () => inRoomSlot(world, occupant(world, office.id, 'inRoom'), slots)[0] / TILE_PX);
    expect(tiles).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it('clamps a crowd inside the room', () => {
    const world = createWorld(1);
    const single = room(world, 'hotelSingle', 2, 200); // 4 tiles wide
    const slots = new Map<number, number>();
    for (let i = 0; i < 6; i++) {
      const [x] = inRoomSlot(world, occupant(world, single.id, 'inRoom'), slots);
      expect(x).toBeGreaterThanOrEqual(200 * TILE_PX);
      expect(x).toBeLessThanOrEqual(203 * TILE_PX);
    }
  });

  it('only moving states interpolate, and riders are not drawn', () => {
    const world = createWorld(1);
    const office = room(world, 'office', 2, 100);
    for (const state of ['walking', 'waiting', 'leaving'] as const) {
      expect(simMoves(occupant(world, office.id, state))).toBe(true);
    }
    for (const state of ['inRoom', 'riding'] as const) {
      expect(simMoves(occupant(world, office.id, state))).toBe(false);
    }
    expect(simIsVisible(occupant(world, office.id, 'riding'))).toBe(false);
    expect(simIsVisible(occupant(world, office.id, 'inRoom'))).toBe(true);
  });
});

describe('sim footing', () => {
  it('stands a sim on the slab top, not the bottom of the floor band', () => {
    expect(simFeetY(1)).toBe(floorBaseY(1) - 3);
    expect(simFeetY(1)).toBeLessThan(floorBaseY(1));
    expect(simFeetY(-2)).toBe(floorBaseY(-2) - 3);
  });
});

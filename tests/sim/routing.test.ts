import { beforeEach, describe, expect, it } from 'vitest';

import { applyCommand } from '../../src/sim/build';
import { entrances, ensureRouting, findRoute, goalScanCheck, isReachableFromLobby, SeqHeap } from '../../src/sim/routing';
import { LIMITS, ROOMS } from '../../src/sim/rules';
import type { Car, Leg, Room, RoomKind, Shaft, ShaftKind, World } from '../../src/sim/types';
import { deserialize, serialize } from '../../src/sim/save';
import { addRoom, addShaft, allocId, createWorld, removeShaft } from '../../src/sim/world';

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: true,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
  };
  addRoom(world, room);
  return room;
}

/** Lobby segments are one tile wide, so a ground lobby is a run of them. */
function makeLobby(world: World, fromX: number, toX: number): Room[] {
  const out: Room[] = [];
  for (let x = fromX; x <= toX; x++) out.push(makeRoom(world, 'lobby', 1, x));
  return out;
}

function makeShaft(
  world: World,
  kind: ShaftKind,
  x: number,
  floorMin: number,
  floorMax: number,
  stops?: number[],
): Shaft {
  const floors = stops ?? Array.from({ length: floorMax - floorMin + 1 }, (_, i) => floorMin + i);
  const shaft: Shaft = {
    id: allocId(world),
    kind,
    x,
    width: 4,
    floorMin,
    floorMax,
    stops: new Set(floors),
    homeFloor: 1,
    cars: [],
    hallCalls: new Map(),
  };
  // Routing reads the cars now: a shaft connects the floors some car will carry you
  // between, so every fixture shaft gets the one car a built shaft always has.
  shaft.cars.push(makeCar(world, shaft.id, floorMin));
  addShaft(world, shaft);
  return shaft;
}

/** The plain car every shaft is built with: carries everyone, works the whole shaft. */
function makeCar(world: World, shaftId: number, y: number): Car {
  return {
    id: allocId(world),
    shaftId,
    y,
    dir: 0,
    state: 'idle',
    doorTimer: 0,
    idleSince: null,
    passengers: [],
    calls: new Set<number>(),
    serves: 'any',
    range: null,
  };
}

/** A stack of stairs rooms: each one links its floor to the floor above. */
function makeStairs(world: World, x: number, fromFloor: number, toFloor: number): Room[] {
  const out: Room[] = [];
  for (let f = fromFloor; f < toFloor; f++) out.push(makeRoom(world, 'stairs', f, x));
  return out;
}

function kinds(legs: Leg[]): string[] {
  return legs.map((leg) => leg.kind);
}

function rides(legs: Leg[]): Extract<Leg, { kind: 'ride' }>[] {
  return legs.filter((leg): leg is Extract<Leg, { kind: 'ride' }> => leg.kind === 'ride');
}

describe('routing', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld(7);
  });

  it('ensureRouting clears the dirty flag', () => {
    makeLobby(world, 100, 140);
    expect(world.routingDirty).toBe(true);
    ensureRouting(world);
    expect(world.routingDirty).toBe(false);
  });

  it('routes a walk on the same floor as one leg', () => {
    makeLobby(world, 100, 140);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 1, x: 138 });
    expect(legs).toEqual([{ kind: 'walk', toX: 138 }]);
  });

  it('routes a same floor trip that starts at the destination tile', () => {
    makeLobby(world, 100, 140);
    const legs = findRoute(world, { floor: 3, x: 200 }, { floor: 3, x: 200 });
    expect(legs).toEqual([{ kind: 'walk', toX: 200 }]);
  });

  it('routes one shaft ride as walk, ride, walk', () => {
    makeLobby(world, 100, 140);
    makeRoom(world, 'office', 5, 200);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 });
    expect(legs).not.toBeNull();
    expect(legs).toEqual([
      { kind: 'walk', toX: 150 },
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 },
      { kind: 'walk', toX: 200 },
    ]);
  });

  it('never emits an enter leg', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    makeStairs(world, 200, 3, 5);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 210 });
    expect(legs).not.toBeNull();
    expect(kinds(legs as Leg[])).not.toContain('enter');
  });

  it('rides down as well as up', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    const legs = findRoute(world, { floor: 8, x: 160 }, { floor: 1, x: 120 });
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: expect.any(Number), fromFloor: 8, toFloor: 1 },
    ]);
  });

  it('transfers between two shafts through a middle floor', () => {
    makeLobby(world, 100, 140);
    const lower = makeShaft(world, 'standard', 150, 1, 5);
    const upper = makeShaft(world, 'standard', 170, 5, 10);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 10, x: 200 });
    expect(legs).not.toBeNull();
    expect(kinds(legs as Leg[])).toEqual(['walk', 'ride', 'walk', 'ride', 'walk']);
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: lower.id, fromFloor: 1, toFloor: 5 },
      { kind: 'ride', shaftId: upper.id, fromFloor: 5, toFloor: 10 },
    ]);
  });

  it('uses the express then a standard shaft through a sky lobby', () => {
    makeLobby(world, 100, 140);
    makeRoom(world, 'skyLobby', 15, 160);
    const express = makeShaft(world, 'express', 150, 1, 15, [1, 15]);
    const standard = makeShaft(world, 'standard', 170, 15, 25);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 20, x: 220 });
    expect(legs).not.toBeNull();
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: express.id, fromFloor: 1, toFloor: 15 },
      { kind: 'ride', shaftId: standard.id, fromFloor: 15, toFloor: 20 },
    ]);
  });

  it('refuses a floor the express does not stop at', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'express', 150, 1, 15, [1, 15]);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 7, x: 200 })).toBeNull();
  });

  it('picks the shaft nearest in x when two shafts tie on walking', () => {
    makeLobby(world, 100, 140);
    const near = makeShaft(world, 'standard', 150, 1, 10);
    makeShaft(world, 'standard', 250, 1, 10);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 300 });
    expect(rides(legs as Leg[])[0]?.shaftId).toBe(near.id);
  });

  it('picks the shaft with the shorter total walk when they do not tie', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    const far = makeShaft(world, 'standard', 320, 1, 10);
    const legs = findRoute(world, { floor: 1, x: 300 }, { floor: 5, x: 330 });
    expect(rides(legs as Leg[])[0]?.shaftId).toBe(far.id);
  });

  it('climbs two floors of stairs when there is no elevator', () => {
    makeLobby(world, 100, 140);
    const [lower, upper] = makeStairs(world, 200, 1, 3);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 3, x: 210 });
    expect(legs).not.toBeNull();
    expect(kinds(legs as Leg[])).toEqual(['walk', 'stairs', 'walk', 'stairs', 'walk']);
    expect(legs?.[1]).toEqual({ kind: 'stairs', roomId: lower?.id, toFloor: 2 });
    expect(legs?.[3]).toEqual({ kind: 'stairs', roomId: upper?.id, toFloor: 3 });
  });

  it('climbs up to stairsMaxClimbFloors floors of stairs', () => {
    makeLobby(world, 100, 140);
    makeStairs(world, 200, 1, 1 + LIMITS.stairsMaxClimbFloors);
    const legs = findRoute(
      world,
      { floor: 1, x: 100 },
      { floor: 1 + LIMITS.stairsMaxClimbFloors, x: 210 },
    );
    expect(legs).not.toBeNull();
    expect(kinds(legs as Leg[]).filter((k) => k === 'stairs')).toHaveLength(
      LIMITS.stairsMaxClimbFloors,
    );
  });

  it('refuses a stair climb beyond stairsMaxClimbFloors', () => {
    makeLobby(world, 100, 140);
    makeStairs(world, 200, 1, 2 + LIMITS.stairsMaxClimbFloors);
    const legs = findRoute(
      world,
      { floor: 1, x: 100 },
      { floor: 2 + LIMITS.stairsMaxClimbFloors, x: 210 },
    );
    expect(legs).toBeNull();
  });

  it('prefers stairs to an elevator for a single floor', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    const [stairs] = makeStairs(world, 160, 1, 2);
    const legs = findRoute(world, { floor: 1, x: 150 }, { floor: 2, x: 170 });
    expect(kinds(legs as Leg[])).toEqual(['walk', 'stairs', 'walk']);
    expect(legs?.[1]).toEqual({ kind: 'stairs', roomId: stairs?.id, toFloor: 2 });
  });

  it('takes the elevator when the stairs run out below the destination', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    makeStairs(world, 200, 1, 3); // stairs stop at floor 3
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 8, x: 210 });
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 8 },
    ]);
    expect(kinds(legs as Leg[])).not.toContain('stairs');
  });

  it('takes the elevator when the stair climb would pass the limit', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    const top = 2 + LIMITS.stairsMaxClimbFloors;
    makeStairs(world, 200, 1, top);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: top, x: 210 });
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: top },
    ]);
  });

  it('ignores a service shaft for an ordinary sim', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'service', 150, 1, 10);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toBeNull();
  });

  it('uses a service shaft for a staff route', () => {
    makeLobby(world, 100, 140);
    const service = makeShaft(world, 'service', 150, 1, 10);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 }, { staff: true });
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: service.id, fromFloor: 1, toFloor: 5 },
    ]);
  });

  it('returns null when no shaft or stairs reaches the floor', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 12, x: 200 })).toBeNull();
  });

  it('returns null when the tower has no vertical transport at all', () => {
    makeLobby(world, 100, 140);
    makeRoom(world, 'office', 2, 200);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 2, x: 200 })).toBeNull();
  });

  it('reports a served floor as reachable from the lobby', () => {
    makeLobby(world, 100, 140);
    makeRoom(world, 'office', 5, 200);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
    expect(isReachableFromLobby(world, 1, 130)).toBe(true);
  });

  it('reports an unserved floor as not reachable from the lobby', () => {
    makeLobby(world, 100, 140);
    makeRoom(world, 'office', 12, 200);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(isReachableFromLobby(world, 12, 200)).toBe(false);
  });

  it('reports nothing reachable when there is no ground lobby', () => {
    makeRoom(world, 'office', 5, 200);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(isReachableFromLobby(world, 5, 200)).toBe(false);
  });

  it('does not offer a staff only shaft to isReachableFromLobby', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'service', 150, 1, 10);
    expect(isReachableFromLobby(world, 5, 200)).toBe(false);
  });

  it('rebuilds the cached graph after a room is added', () => {
    makeLobby(world, 100, 140);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 2, x: 210 })).toBeNull();
    expect(world.routingDirty).toBe(false);

    makeStairs(world, 200, 1, 2);
    expect(world.routingDirty).toBe(true);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 2, x: 210 });
    expect(kinds(legs as Leg[])).toEqual(['walk', 'stairs', 'walk']);
    expect(world.routingDirty).toBe(false);
  });

  it('rebuilds the cached graph after a shaft is added', () => {
    makeLobby(world, 100, 140);
    expect(isReachableFromLobby(world, 5, 200)).toBe(false);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
  });

  it('lists the lobby ends as entrances', () => {
    makeLobby(world, 100, 140);
    expect(entrances(world)).toEqual([
      { floor: 1, x: 100 },
      { floor: 1, x: 140 },
    ]);
  });

  it('adds the metro station center to the entrances', () => {
    makeLobby(world, 100, 140);
    const metro = makeRoom(world, 'metro', -3, 60);
    expect(entrances(world)).toEqual([
      { floor: 1, x: 100 },
      { floor: 1, x: 140 },
      { floor: -3, x: metro.x + Math.floor(ROOMS.metro.width / 2) },
    ]);
  });

  it('lists no entrances before the lobby is built', () => {
    expect(entrances(world)).toEqual([]);
  });
});

describe('stairs versus elevator', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld(7);
  });

  it('takes the stairs for a one floor trip even with a shaft available', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 2, [1, 2]);
    makeStairs(world, 200, 1, 2);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 2, x: 210 });
    expect(rides(legs as Leg[])).toEqual([]);
    expect(kinds(legs as Leg[])).toContain('stairs');
  });

  it('takes the shaft for a two floor trip when both are available', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 3, [1, 3]);
    makeStairs(world, 200, 1, 3);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 3, x: 210 });
    expect(rides(legs as Leg[])).toEqual([
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 3 },
    ]);
  });

  it('takes the stairs for a two floor trip when there is no shaft', () => {
    makeLobby(world, 100, 140);
    makeStairs(world, 200, 1, 3);
    const legs = findRoute(world, { floor: 1, x: 100 }, { floor: 3, x: 210 });
    expect(rides(legs as Leg[])).toEqual([]);
    expect(kinds(legs as Leg[])).toContain('stairs');
  });
});

describe('route cache', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld(7);
  });

  it('routes two destinations from one origin in the same minute', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    const up = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 });
    const higher = findRoute(world, { floor: 1, x: 100 }, { floor: 7, x: 300 });
    expect(up).toEqual([
      { kind: 'walk', toX: 150 },
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 },
      { kind: 'walk', toX: 200 },
    ]);
    expect(higher).toEqual([
      { kind: 'walk', toX: 150 },
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 7 },
      { kind: 'walk', toX: 300 },
    ]);
  });

  it('still prefers the shaft nearest each origin within one minute', () => {
    makeLobby(world, 100, 340);
    const near = makeShaft(world, 'standard', 150, 1, 10);
    const far = makeShaft(world, 'standard', 300, 1, 10);
    expect(rides(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 120 }) as Leg[])).toEqual([
      { kind: 'ride', shaftId: near.id, fromFloor: 1, toFloor: 5 },
    ]);
    expect(rides(findRoute(world, { floor: 1, x: 330 }, { floor: 5, x: 320 }) as Leg[])).toEqual([
      { kind: 'ride', shaftId: far.id, fromFloor: 1, toFloor: 5 },
    ]);
  });

  it('picks up a shaft built in the same minute', () => {
    makeLobby(world, 100, 140);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toBeNull();
    expect(isReachableFromLobby(world, 5, 200)).toBe(false);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    expect(rides(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 }) as Leg[])).toEqual([
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 },
    ]);
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
  });

  it('drops a demolished shaft in the same minute', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 10);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).not.toBeNull();
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
    removeShaft(world, shaft.id);
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toBeNull();
    expect(isReachableFromLobby(world, 5, 200)).toBe(false);
  });

  it('drops a floor a car stops serving in the same minute', () => {
    makeLobby(world, 100, 140);
    const shaft = makeShaft(world, 'standard', 150, 1, 5);
    makeRoom(world, 'office', 5, 200);
    const car = shaft.cars[0]!;
    expect(rides(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 }) as Leg[])).toEqual([
      { kind: 'ride', shaftId: shaft.id, fromFloor: 1, toFloor: 5 },
    ]);
    expect(
      applyCommand(world, {
        kind: 'shaft.setCarRange',
        shaftId: shaft.id,
        carId: car.id,
        range: { lo: 1, hi: 3 },
      }),
    ).toEqual({ ok: true });
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toBeNull();
  });

  it('keeps floor searches across minutes and still drops them on a graph change', () => {
    makeLobby(world, 100, 340);
    const near = makeShaft(world, 'standard', 150, 1, 10);
    const far = makeShaft(world, 'standard', 300, 1, 10);
    const ridesFrom = (x: number): Extract<Leg, { kind: 'ride' }>[] =>
      rides(findRoute(world, { floor: 1, x }, { floor: 5, x: 320 }) as Leg[]);
    expect(ridesFrom(100)).toEqual([{ kind: 'ride', shaftId: near.id, fromFloor: 1, toFloor: 5 }]);
    world.time.minute += 7;
    // Same floor, another tile, a later minute: the walk from this tile still decides.
    expect(ridesFrom(330)).toEqual([{ kind: 'ride', shaftId: far.id, fromFloor: 1, toFloor: 5 }]);
    expect(ridesFrom(100)).toEqual([{ kind: 'ride', shaftId: near.id, fromFloor: 1, toFloor: 5 }]);
    world.time.minute += 7;
    removeShaft(world, near.id);
    expect(ridesFrom(100)).toEqual([{ kind: 'ride', shaftId: far.id, fromFloor: 1, toFloor: 5 }]);
  });

  it('answers the same for every tile on a floor and every minute', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
    expect(isReachableFromLobby(world, 5, 20)).toBe(true);
    expect(isReachableFromLobby(world, 40, 200)).toBe(false);
    const first = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 });
    world.time.minute += 1;
    expect(findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toEqual(first);
    expect(isReachableFromLobby(world, 5, 200)).toBe(true);
    expect(isReachableFromLobby(world, 40, 200)).toBe(false);
  });

  it('gives a loaded world the same routes as the saved one', () => {
    makeLobby(world, 100, 140);
    makeShaft(world, 'standard', 150, 1, 10);
    makeRoom(world, 'office', 5, 200);
    const before = findRoute(world, { floor: 1, x: 100 }, { floor: 5, x: 200 });
    const loaded = deserialize(serialize(world));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(findRoute(loaded.world, { floor: 1, x: 100 }, { floor: 5, x: 200 })).toEqual(before);
    expect(isReachableFromLobby(loaded.world, 5, 200)).toBe(true);
    expect(entrances(loaded.world)).toEqual(entrances(world));
  });
});

describe('search open set heap', () => {
  interface Item {
    key: number;
    id: number;
  }
  const less = (a: Item, b: Item): boolean => a.key < b.key;

  it('pops equal keys in the order they were pushed', () => {
    const heap = new SeqHeap<Item>(less);
    const keys = [3, 1, 2, 1, 3, 1, 2, 0, 2];
    keys.forEach((key, id) => heap.push({ key, id }));
    const popped: number[] = [];
    while (heap.size > 0) popped.push((heap.pop() as Item).id);
    // key 0: id 7; key 1: ids 1, 3, 5; key 2: ids 2, 6, 8; key 3: ids 0, 4
    expect(popped).toEqual([7, 1, 3, 5, 2, 6, 8, 0, 4]);
    expect(heap.pop()).toBeUndefined();
  });

  it('matches the old linear scan pick through interleaved pushes and pops', () => {
    // The pick the search made before the heap: the first queued item among the best keys.
    const oldPick = (queue: Item[]): Item => {
      let pick = 0;
      for (let i = 1; i < queue.length; i++) if (less(queue[i] as Item, queue[pick] as Item)) pick = i;
      return queue.splice(pick, 1)[0] as Item;
    };
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const heap = new SeqHeap<Item>(less);
    const queue: Item[] = [];
    const fromHeap: number[] = [];
    const fromScan: number[] = [];
    for (let id = 0; id < 2000; id++) {
      const item = { key: rand(8), id };
      heap.push(item);
      queue.push(item);
      if (rand(3) === 0) {
        fromHeap.push((heap.pop() as Item).id);
        fromScan.push(oldPick(queue).id);
      }
    }
    while (queue.length > 0) {
      fromHeap.push((heap.pop() as Item).id);
      fromScan.push(oldPick(queue).id);
    }
    expect(fromHeap).toEqual(fromScan);
  });
});

describe('goal picked from the per floor index', () => {
  it('matches a brute force scan of every settled state', () => {
    const world = createWorld(7);
    makeLobby(world, 100, 220);
    makeShaft(world, 'standard', 110, 1, 8);
    const split = makeShaft(world, 'standard', 150, 1, 8);
    const second = makeCar(world, split.id, 1);
    second.range = { lo: 1, hi: 4 };
    split.cars.push(second);
    makeShaft(world, 'standard', 190, 3, 8);
    makeShaft(world, 'service', 210, 1, 8);
    makeStairs(world, 120, 1, 5);
    makeStairs(world, 170, 4, 8);

    let routed = 0;
    let most = 0;
    for (const staff of [false, true]) {
      for (let fromFloor = 1; fromFloor <= 8; fromFloor++) {
        for (const fromX of [100, 124, 130, 150, 172, 215]) {
          for (let toFloor = 1; toFloor <= 8; toFloor++) {
            if (toFloor === fromFloor) continue;
            for (const toX of [100, 160, 220]) {
              const check = goalScanCheck(world, { floor: fromFloor, x: fromX }, { floor: toFloor, x: toX }, { staff });
              expect(check.indexed).toEqual(check.bruteForce);
              if (check.indexed) routed++;
              most = Math.max(most, check.candidates);
            }
          }
        }
      }
    }
    expect(routed).toBeGreaterThan(500);
    expect(most).toBeGreaterThanOrEqual(4); // several arrival states compete on one floor
  }, 30_000); // a brute force scan over about 700 trips; slow when the machine is loaded
});

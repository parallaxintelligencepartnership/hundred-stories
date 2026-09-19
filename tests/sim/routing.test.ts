import { beforeEach, describe, expect, it } from 'vitest';

import { entrances, ensureRouting, findRoute, isReachableFromLobby } from '../../src/sim/routing';
import { LIMITS, ROOMS } from '../../src/sim/rules';
import type { Leg, Room, RoomKind, Shaft, ShaftKind, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld } from '../../src/sim/world';

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
    cars: [], // routing never looks at cars
    hallCalls: new Map(),
  };
  addShaft(world, shaft);
  return shaft;
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

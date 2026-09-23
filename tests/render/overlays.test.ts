// The information views: each view's five step ramp from a stub world, the served floors an
// elevator ghost bands, and the tint pass that redraws every frame while on and costs nothing off.
import { describe, expect, it } from 'vitest';
import {
  createOverlayPass,
  floorWaits,
  hallQueues,
  noiseStep,
  OVERLAY_RAMP,
  overlayLegend,
  roomStep,
  servedFloors,
  stressStep,
  vacancyStep,
  waitStepOf,
  type ViewRect,
} from '../../src/render/overlays';
import { ROOMS, STRESS } from '../../src/sim/rules';
import type { Room, RoomKind, Shaft, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 0.7,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...extra,
  };
  addRoom(world, room);
  return room;
}

function makeSim(world: World, extra: Partial<Sim>): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind: 'worker',
    homeRoomId: null,
    pos: { floor: 1, x: 0 },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'inRoom',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
    ...extra,
  };
  addSim(world, sim);
  return sim;
}

function makeShaft(world: World, floorMin: number, floorMax: number, x = 50): Shaft {
  const stops = new Set<number>();
  for (let f = floorMin; f <= floorMax; f += 1) if (f !== 0) stops.add(f);
  const shaft: Shaft = {
    id: allocId(world),
    kind: 'standard',
    x,
    width: 4,
    floorMin,
    floorMax,
    stops,
    homeFloor: 1,
    cars: [],
    hallCalls: new Map(),
  };
  addShaft(world, shaft);
  return shaft;
}

/** An office whose tenants all carry this stress. */
function officeWithStress(world: World, stress: number, x: number): Room {
  const room = makeRoom(world, 'office', 3, x);
  for (let i = 0; i < 2; i += 1) room.tenants.push(makeSim(world, { stress, homeRoomId: room.id }).id);
  return room;
}

function waiter(world: World, shaftId: number, floor: number, waitStart: number): Sim {
  return makeSim(world, {
    state: 'waiting',
    pos: { floor, x: 52 },
    waitStart,
    route: [{ kind: 'ride', shaftId, fromFloor: floor, toFloor: 1 }],
  });
}

describe('stress ramp', () => {
  it('cuts average tenant stress at half pink, pink, halfway to red and red', () => {
    const world = createWorld(1);
    const steps = [0, 0.2, STRESS.pink, 0.6, STRESS.red, 1].map((s, i) => stressStep(world, officeWithStress(world, s, i * 10)));
    expect(steps).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('leaves a room nobody is a tenant of untinted', () => {
    const world = createWorld(1);
    expect(stressStep(world, makeRoom(world, 'shop', 2, 0))).toBe(null);
  });
});

describe('noise ramp', () => {
  it('counts one step per noisy neighbor, four or more at the top, quiet rooms only', () => {
    const world = createWorld(1);
    const condo = makeRoom(world, 'condo', 5, 100);
    expect(noiseStep(world, condo)).toBe(0);
    makeRoom(world, 'fastFood', 5, 120); // same floor, inside the 21 tile range
    expect(noiseStep(world, condo)).toBe(1);
    makeRoom(world, 'fastFood', 5, 80);
    makeRoom(world, 'fastFood', 4, 100); // directly below
    makeRoom(world, 'fastFood', 6, 100); // directly above
    makeRoom(world, 'fastFood', 5, 60);
    expect(noiseStep(world, condo)).toBe(4);
    expect(noiseStep(world, makeRoom(world, 'fastFood', 9, 0))).toBe(null); // noise does not mind noise
  });
});

describe('vacancy ramp', () => {
  it('is occupied or vacant for the rooms that take a tenant, nothing for the rest', () => {
    const world = createWorld(1);
    expect(vacancyStep(makeRoom(world, 'office', 2, 0, { vacant: false }))).toBe(0);
    expect(vacancyStep(makeRoom(world, 'condo', 2, 20, { vacant: true }))).toBe(4);
    expect(vacancyStep(makeRoom(world, 'hotelSingle', 2, 40))).toBe(4);
    expect(vacancyStep(makeRoom(world, 'hotelSingle', 2, 50, { tenants: [99] }))).toBe(0);
    expect(vacancyStep(makeRoom(world, 'shop', 3, 0))).toBe(null);
  });
});

describe('elevator wait ramp', () => {
  it('steps the longest wait on a floor at nobody, 5, 15 and 35 minutes', () => {
    expect([null, 0, 4, 5, 14, 15, 34, 35, 60].map(waitStepOf)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it('reads the waits from the sims queued at each hall, the oldest per floor', () => {
    const world = createWorld(1);
    world.time.minute = 1000;
    const shaft = makeShaft(world, 1, 10);
    waiter(world, shaft.id, 4, 990);
    waiter(world, shaft.id, 4, 960);
    waiter(world, shaft.id, 7, 998);
    makeSim(world, { state: 'waiting', pos: { floor: 9, x: 0 }, waitStart: 900, route: [] }); // not waiting for a car
    const queues = hallQueues(world);
    expect(queues.get(shaft.id)?.get(4)).toEqual({ count: 2, since: 960 });
    expect(floorWaits(world)).toEqual(
      new Map([
        [4, 40],
        [7, 2],
      ]),
    );
    const onFour = makeRoom(world, 'office', 4, 100);
    const onSeven = makeRoom(world, 'office', 7, 100);
    const onTwo = makeRoom(world, 'office', 2, 100);
    expect([onFour, onSeven, onTwo].map((r) => roomStep(world, r, 'wait'))).toEqual([4, 1, 0]);
    expect(roomStep(world, makeRoom(world, 'stairs', 4, 200), 'wait')).toBe(null);
  });
});

describe('legend', () => {
  it('has five colours from the ramp for the stepped views and two for vacancy', () => {
    for (const kind of ['stress', 'noise', 'wait'] as const) {
      expect(overlayLegend(kind).entries.map((e) => e.color)).toEqual([...OVERLAY_RAMP]);
    }
    expect(overlayLegend('vacancy').entries.map((e) => e.label)).toEqual(['Occupied', 'Vacant']);
    expect(overlayLegend('wait').entries.map((e) => e.label)).toEqual([
      'Nobody',
      'Under 5 min',
      '5 to 15',
      '15 to 35',
      '35 min or more',
    ]);
  });
});

describe('served floors on an elevator ghost', () => {
  it('is every floor for a standard car and the lobbies and basements for an express', () => {
    expect(servedFloors('standard', -2, 3)).toEqual([3, 2, 1, -1, -2]);
    expect(servedFloors('express', -1, 31)).toEqual([30, 15, 1, -1]);
  });
});

/** A Graphics stand-in that counts what the pass asks of it. */
function recorder() {
  const calls = { clear: 0, rects: [] as { color: number }[] };
  const g = {
    visible: false,
    clear() {
      calls.clear += 1;
      return g;
    },
    rect() {
      return g;
    },
    fill(style: { color: number }) {
      calls.rects.push({ color: style.color });
      return g;
    },
  };
  return { g, calls };
}

const WIDE: ViewRect = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

describe('tint pass', () => {
  it('touches nothing while no view is on', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 2, 0, { vacant: true });
    const { g, calls } = recorder();
    const pass = createOverlayPass(g as never);
    for (let i = 0; i < 5; i += 1) pass.draw(world, WIDE, null);
    expect(calls.clear).toBe(0);
    expect(calls.rects).toHaveLength(0);
  });

  it('redraws every frame while a view is on, with no structure change, then clears when turned off', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 2, 0, { vacant: true });
    makeRoom(world, 'office', 2, 20, { vacant: false });
    makeRoom(world, 'shop', 3, 0);
    const { g, calls } = recorder();
    const pass = createOverlayPass(g as never);
    pass.set('vacancy');
    const version = world.structureVersion;
    pass.draw(world, WIDE, null);
    pass.draw(world, WIDE, null);
    pass.draw(world, WIDE, null);
    expect(world.structureVersion).toBe(version);
    expect(calls.clear).toBe(3);
    const [bad, good] = [OVERLAY_RAMP[4], OVERLAY_RAMP[0]];
    expect(calls.rects.map((r) => r.color)).toEqual([bad, good, bad, good, bad, good]);
    expect(g.visible).toBe(true);
    pass.set(null);
    pass.draw(world, WIDE, null);
    expect(g.visible).toBe(false);
    expect(calls.clear).toBe(4);
    pass.draw(world, WIDE, null);
    expect(calls.clear).toBe(4); // off again costs nothing
  });

  it('holds one view at a time', () => {
    const { g } = recorder();
    const pass = createOverlayPass(g as never);
    pass.set('stress');
    pass.set('noise');
    expect(pass.get()).toBe('noise');
    pass.set(null);
    expect(pass.get()).toBe(null);
  });

  it('skips rooms off screen', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 2, 0, { vacant: true });
    makeRoom(world, 'office', 2, 300, { vacant: true });
    const { g, calls } = recorder();
    const pass = createOverlayPass(g as never);
    pass.set('vacancy');
    pass.draw(world, { left: -100, right: 500, top: -1000, bottom: 1000 }, null);
    expect(calls.rects).toHaveLength(1);
  });

  it('bands each floor an elevator ghost will stop at, even with no view on', () => {
    const world = createWorld(1);
    const { g, calls } = recorder();
    const pass = createOverlayPass(g as never);
    pass.draw(world, WIDE, { widthTiles: 6, heightFloors: 31, floor: 1, x: 10, ok: true, shaft: 'express' });
    expect(calls.rects).toHaveLength(3); // floors 1, 15 and 30
    calls.rects.length = 0;
    pass.draw(world, WIDE, { widthTiles: 4, heightFloors: 5, floor: 1, x: 10, ok: true, shaft: 'standard' });
    expect(calls.rects).toHaveLength(5);
    pass.draw(world, WIDE, { widthTiles: 9, heightFloors: 1, floor: 2, x: 10, ok: true }); // a room ghost: no band
    expect(g.visible).toBe(false);
  });
});

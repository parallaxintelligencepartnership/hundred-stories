// The information views: each view's five step ramp from a stub world, the served floors an
// elevator ghost bands, and the tint pass that redraws every frame while on and costs nothing off.
import { describe, expect, it } from 'vitest';
import { floorTopY } from '../../src/render/camera';
import { lerpColor } from '../../src/render/light';
import {
  BLOCK_GLOW,
  BLOCK_GLOW_ALPHA,
  BLOCK_NIGHT,
  BLOCK_NIGHT_MIX,
  createOverlayPass,
  drawBlocks,
  floorWaits,
  hallQueues,
  noiseStep,
  OVERLAY_KINDS,
  OVERLAY_RAMP,
  overlayLegend,
  overlayTitle,
  roomStep,
  servedFloors,
  stressStep,
  vacancyStep,
  waitStepOf,
  type ViewRect,
} from '../../src/render/overlays';
import { BLOCK, BLOCK_FILL_LIFT, BLOCK_OUTLINE } from '../../src/render/palette';
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
    expect(overlayLegend('vacancy').entries.map((e) => e.label)).toEqual(['Occupied', 'Empty']);
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

// ---------------------------------------------------------------- BB-2 and D-8: the block pass

interface BlockRect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  alpha?: number;
}

/** A Graphics stand-in that records each rectangle with the fill or the stroke it was given. */
function blockRecorder() {
  const calls = { fills: [] as BlockRect[], strokes: [] as BlockRect[] };
  let last = { x: 0, y: 0, w: 0, h: 0 };
  const g = {
    visible: false,
    clear() {
      return g;
    },
    rect(x: number, y: number, w: number, h: number) {
      last = { x, y, w, h };
      return g;
    },
    fill(style: number | { color: number; alpha?: number }) {
      const s = typeof style === 'number' ? { color: style, alpha: 1 } : { color: style.color, alpha: style.alpha ?? 1 };
      calls.fills.push({ ...last, ...s });
      return g;
    },
    stroke(style: { color: number }) {
      calls.strokes.push({ ...last, color: style.color });
      return g;
    },
    poly() {
      return g;
    },
  };
  return { g, calls };
}

describe('BB-2: the Districts view', () => {
  it('lists Districts after the four views, with a legend of the categories', () => {
    expect(OVERLAY_KINDS).toEqual(['stress', 'noise', 'vacancy', 'wait', 'districts']);
    expect(overlayTitle('districts')).toBe('Districts');
    expect(overlayLegend('districts')).toEqual({
      title: 'Districts',
      entries: [
        { color: BLOCK.office, label: 'Offices' },
        { color: BLOCK.condo, label: 'Homes' },
        { color: BLOCK.hotelSingle, label: 'Hotels' },
        { color: BLOCK.fastFood, label: 'Food' },
        { color: BLOCK.shop, label: 'Shops' },
        { color: BLOCK.medical, label: 'Services' },
      ],
    });
    // Categories, not a ramp: the same colours with the color-blind views on.
    expect(overlayLegend('districts', true)).toEqual(overlayLegend('districts'));
  });

  it('draws the block chart through the overlay pass: a block per room in its colour, occupancy lighter from the floor up, a lobby run outlined once', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 3, 100, { occupancy: ROOMS.office.capacity / 2 });
    makeRoom(world, 'condo', 4, 100);
    for (let x = 90; x < 96; x += 1) makeRoom(world, 'lobby', 1, x);
    makeRoom(world, 'stairs', 2, 120); // a connector is not a block
    const { g, calls } = blockRecorder();
    const pass = createOverlayPass(g as never);
    pass.set('districts');
    pass.draw(world, WIDE, null);
    expect(g.visible).toBe(true);
    const office = { x: 100 * 16, y: floorTopY(3), w: 9 * 16, h: 72 };
    expect(calls.fills.slice(0, 2)).toEqual([
      { ...office, color: BLOCK.office, alpha: 1 },
      { ...office, y: office.y + 36, h: 36, color: lerpColor(BLOCK.office, 0xffffff, BLOCK_FILL_LIFT), alpha: 1 },
    ]);
    expect(calls.fills.filter((f) => f.color === BLOCK.lobby)).toHaveLength(6);
    expect(calls.fills.some((f) => f.color === BLOCK.stairs)).toBe(false);
    expect(calls.strokes).toEqual([
      { ...office, color: BLOCK_OUTLINE },
      { x: 100 * 16, y: floorTopY(4), w: 16 * 16, h: 72, color: BLOCK_OUTLINE },
      { x: 90 * 16, y: floorTopY(1), w: 6 * 16, h: 72, color: BLOCK_OUTLINE },
    ]);
    // Off screen, nothing is drawn.
    calls.fills.length = 0;
    calls.strokes.length = 0;
    pass.draw(world, { left: -100, right: 500, top: -1e6, bottom: 1e6 }, null);
    expect([calls.fills, calls.strokes]).toEqual([[], []]);
    // Off again: cleared and hidden.
    pass.set(null);
    pass.draw(world, WIDE, null);
    expect(g.visible).toBe(false);
  });

  it('gives no room a ramp step in the districts view', () => {
    const world = createWorld(1);
    expect(roomStep(world, makeRoom(world, 'office', 2, 0), 'districts')).toBe(null);
  });
});

describe('D-8: the block pass at night', () => {
  it('darkens each block toward the night sky and draws its occupancy as a warm glow from the floor up', () => {
    expect([BLOCK_NIGHT, BLOCK_NIGHT_MIX, BLOCK_GLOW, BLOCK_GLOW_ALPHA]).toEqual([0x0d1b3d, 0.45, 0xffd678, 0.85]);
    const world = createWorld(1);
    makeRoom(world, 'office', 3, 100, { occupancy: ROOMS.office.capacity / 2 });
    makeRoom(world, 'condo', 4, 100); // empty: dark navy, no glow
    const blocks = blockRecorder();
    const glow = blockRecorder();
    drawBlocks(blocks.g as never, world.rooms.values(), { night: true, glow: glow.g as never });
    expect(blocks.calls.fills.map((f) => f.color)).toEqual([lerpColor(BLOCK.office, 0x0d1b3d, 0.45), lerpColor(BLOCK.condo, 0x0d1b3d, 0.45)]);
    expect(glow.calls.fills).toEqual([{ x: 100 * 16, y: floorTopY(3) + 36, w: 9 * 16, h: 36, color: 0xffd678, alpha: 0.85 }]);
  });

  it('draws the blocks as before by day and leaves the glow untouched', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 3, 100, { occupancy: ROOMS.office.capacity });
    const blocks = blockRecorder();
    const glow = blockRecorder();
    drawBlocks(blocks.g as never, world.rooms.values(), { night: false, glow: glow.g as never });
    expect(blocks.calls.fills.map((f) => f.color)).toEqual([BLOCK.office, lerpColor(BLOCK.office, 0xffffff, BLOCK_FILL_LIFT)]);
    expect(glow.calls.fills).toEqual([]);
  });
});

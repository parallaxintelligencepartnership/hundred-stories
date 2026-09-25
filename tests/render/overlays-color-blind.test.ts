// Color-blind friendly views: the tint pass switches to the blue to orange ramp and stripes the
// worst step, so no meaning rests on color alone. Render only: the world and its hash are the
// same before and after.
import { describe, expect, it } from 'vitest';
import {
  createOverlayPass,
  OVERLAY_RAMP,
  OVERLAY_RAMP_COLOR_BLIND,
  overlayLegend,
  overlayRamp,
  STRIPE_COLOR,
  stripePolygons,
  STRIPE_WIDTH,
  type ViewRect,
} from '../../src/render/overlays';
import { TILE_PX } from '../../src/render/grid';
import { hashWorld } from '../../src/sim/save';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

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

function recorder() {
  const calls = { rects: [] as number[], polys: [] as { points: number[]; color: number }[] };
  let last: 'rect' | 'poly' = 'rect';
  let points: number[] = [];
  const g = {
    visible: false,
    clear: () => g,
    rect() {
      last = 'rect';
      return g;
    },
    poly(p: number[]) {
      last = 'poly';
      points = p;
      return g;
    },
    fill(style: { color: number }) {
      if (last === 'rect') calls.rects.push(style.color);
      else calls.polys.push({ points, color: style.color });
      return g;
    },
  };
  return { g, calls };
}

const WIDE: ViewRect = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };

describe('color-blind ramp', () => {
  it('runs blue for fine to orange for trouble, and is picked by the switch', () => {
    const [fine, , , , worst] = OVERLAY_RAMP_COLOR_BLIND;
    const rgb = (c: number): [number, number, number] => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    expect(rgb(fine)[2]).toBeGreaterThan(rgb(fine)[0]); // blue over red
    expect(rgb(worst)[0]).toBeGreaterThan(rgb(worst)[2]); // red-orange over blue
    expect(overlayRamp(false)).toBe(OVERLAY_RAMP);
    expect(overlayRamp(true)).toBe(OVERLAY_RAMP_COLOR_BLIND);
    // Neither ramp uses green, so the two ends never hinge on red against green.
    expect(OVERLAY_RAMP_COLOR_BLIND.every((c) => ((c >> 8) & 255) <= Math.max((c >> 16) & 255, c & 255))).toBe(true);
  });

  it('gives the legend the same ramp and marks the worst entry', () => {
    const legend = overlayLegend('vacancy', true);
    expect(legend.entries.map((e) => e.color)).toEqual([OVERLAY_RAMP_COLOR_BLIND[0], OVERLAY_RAMP_COLOR_BLIND[4]]);
    expect(legend.entries.map((e) => e.worst === true)).toEqual([false, true]);
    for (const kind of ['stress', 'noise', 'wait'] as const) {
      expect(overlayLegend(kind, true).entries.filter((e) => e.worst)).toHaveLength(1);
    }
    expect(overlayLegend('vacancy').entries[1]?.color).toBe(OVERLAY_RAMP[4]);
  });
});

describe('stripes', () => {
  it('cuts 45 degree bands to the box, every point inside it', () => {
    const polys = stripePolygons(0, 0, 144, 72);
    expect(polys.length).toBeGreaterThan(5);
    for (const flat of polys) {
      expect(flat.length % 2).toBe(0);
      expect(flat.length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < flat.length; i += 2) {
        expect(flat[i]!).toBeGreaterThanOrEqual(-1e-9);
        expect(flat[i]!).toBeLessThanOrEqual(144 + 1e-9);
        expect(flat[i + 1]!).toBeGreaterThanOrEqual(-1e-9);
        expect(flat[i + 1]!).toBeLessThanOrEqual(72 + 1e-9);
        // and inside one band: x + y within a stripe's width of its start
      }
      const sums = [];
      for (let i = 0; i < flat.length; i += 2) sums.push(flat[i]! + flat[i + 1]!);
      expect(Math.max(...sums) - Math.min(...sums)).toBeLessThanOrEqual(STRIPE_WIDTH + 1e-9);
    }
  });

  it('draws nothing for an empty box', () => {
    expect(stripePolygons(0, 0, 0, 10)).toEqual([]);
  });
});

describe('tint pass with color-blind on', () => {
  it('tints in the blue to orange ramp and stripes only the worst step', () => {
    const world = createWorld(1);
    makeRoom(world, 'office', 2, 0, { vacant: true });
    makeRoom(world, 'office', 2, 20, { vacant: false });
    const { g, calls } = recorder();
    const pass = createOverlayPass(g as never);
    pass.set('vacancy');
    pass.draw(world, WIDE, null);
    expect(calls.rects).toEqual([OVERLAY_RAMP[4], OVERLAY_RAMP[0]]);
    expect(calls.polys).toHaveLength(0); // the usual palette has no stripes
    calls.rects.length = 0;
    pass.setColorBlind(true);
    pass.draw(world, WIDE, null);
    expect(calls.rects).toEqual([OVERLAY_RAMP_COLOR_BLIND[4], OVERLAY_RAMP_COLOR_BLIND[0]]);
    expect(calls.polys.length).toBeGreaterThan(0);
    expect(calls.polys.every((p) => p.color === STRIPE_COLOR)).toBe(true);
    // Every stripe is over the vacant office, none over the occupied one.
    const vacantRight = ROOMS.office.width * TILE_PX;
    for (const { points } of calls.polys) {
      for (let i = 0; i < points.length; i += 2) expect(points[i]!).toBeLessThanOrEqual(vacantRight + 1e-9);
    }
  });

  it('never touches the world or its hash', () => {
    const world = createWorld(7);
    makeRoom(world, 'office', 2, 0, { vacant: true });
    makeRoom(world, 'condo', 3, 0, { vacant: true });
    const before = hashWorld(world);
    const version = world.structureVersion;
    const { g } = recorder();
    const pass = createOverlayPass(g as never);
    pass.setColorBlind(true);
    for (const kind of ['stress', 'noise', 'vacancy', 'wait'] as const) {
      pass.set(kind);
      pass.draw(world, WIDE, null);
    }
    pass.setColorBlind(false);
    pass.draw(world, WIDE, null);
    expect(hashWorld(world)).toBe(before);
    expect(world.structureVersion).toBe(version);
  });
});

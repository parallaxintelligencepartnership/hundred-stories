// Is it raining: the one test the umbrellas, the rain streaks and the puddle ripples share
// (weather.ts rainFalling). Umbrellas are up exactly when rain is clearly on screen, overcast
// gives neither, the rain falls where the commuters walk, and the street stays wet for a while
// after the rain stops, then dries.

import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { WeatherKind, WeatherSnapshot } from '../../src/game/weather';
import { lobbyDoors, umbrellasUp } from '../../src/render/curb';
import { builtFloorExtents } from '../../src/render/renderer';
import { floorTopY } from '../../src/render/camera';
import { FLOOR_PX, TILE_PX } from '../../src/render/grid';
import {
  easeView,
  intersects,
  rainFalling,
  RAIN_MIN_STRENGTH,
  RAIN_ON,
  settledView,
  sheetStyle,
  STREET_DRY_MS,
  STREET_SOAK_MS,
  WET_BAND_PX,
  type Rect,
  type WeatherView,
} from '../../src/render/weather';
import { basementSpanOf, createWeatherFx, floorRectsOf, sheetRectsOnScreen, type WeatherFrame } from '../../src/render/weatherfx';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

const FRAME_MS = 1000 / 60;
const snap = (kind: WeatherKind, intensity = 0.8): WeatherSnapshot => ({ kind, from: kind, blend: 1, intensity });
const mixed = (rain: number, storm: number, intensity: number): WeatherView => ({
  weights: { clear: Math.max(0, 1 - rain - storm), overcast: 0, rain, storm },
  intensity,
});

function room(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const r: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, r);
  return r;
}

/** A lobby narrower than the offices above it (like the demo tower), and parking under part of it. */
function tower(): World {
  const world = createWorld(5);
  for (let x = 100; x < 140; x++) room(world, 'lobby', 1, x);
  for (const floor of [2, 3, 4]) for (let x = 100; x + ROOMS.office.width <= 190; x += ROOMS.office.width) room(world, 'office', floor, x);
  for (let x = 112; x < 136; x += ROOMS.parkingSpace.width) room(world, 'parkingSpace', -1, x);
  return world;
}

function cells(world: World): Rect[] {
  const out: Rect[] = [];
  for (const r of world.rooms.values()) out.push({ x: r.x * TILE_PX, y: floorTopY(r.floor + r.height - 1), w: r.width * TILE_PX, h: r.height * FLOOR_PX });
  return out;
}

function scene(world: World) {
  const extents = builtFloorExtents(world);
  const fx = createWeatherFx({ sky: new Container(), sheet: new Container(), ground: new Container() });
  const doors = lobbyDoors(world);
  const frame = (view: WeatherView, reducedMotion = false): WeatherFrame => ({
    view,
    seed: 11,
    night: 0,
    viewW: 1280,
    viewH: 800,
    // The opening shot: the lobby's right door a little right of centre, the street low.
    originX: 640 - 140 * TILE_PX,
    originY: 520,
    zoom: 1,
    floors: floorRectsOf(extents),
    basement: basementSpanOf(extents),
    doors,
    skyColor: 0x9fb3c9,
    dtMs: FRAME_MS,
    reducedMotion,
  });
  return { fx, frame, doors: doors!, extents };
}

describe('umbrellas and rain share one test', () => {
  it('agree at every weight and intensity: umbrellas up exactly when rain is clearly drawn', () => {
    for (const intensity of [0.4, 0.55, 0.7, 0.85, 1]) {
      for (let wet = 0; wet <= 1.0001; wet += 0.01) {
        for (const stormShare of [0, 0.5, 1]) {
          const v = mixed(wet * (1 - stormShare), wet * stormShare, intensity);
          const up = umbrellasUp(v);
          const alpha = sheetStyle(v).alpha;
          expect(alpha > 0, `wet ${wet.toFixed(2)} intensity ${intensity}`).toBe(up);
          // Clearly on screen: never a faint wisp under open umbrellas.
          if (up) expect(alpha).toBeGreaterThanOrEqual(0.5);
        }
      }
    }
  });

  it('switches both at RAIN_ON, starting the rain at RAIN_MIN_STRENGTH', () => {
    expect(RAIN_ON).toBe(0.5);
    for (const intensity of [0.4, 1]) {
      expect(umbrellasUp(mixed(0.5, 0, intensity))).toBe(false);
      expect(rainFalling(mixed(0.5, 0, intensity))).toBe(0);
      expect(umbrellasUp(mixed(0.51, 0, intensity))).toBe(true);
      expect(rainFalling(mixed(0.51, 0, intensity))).toBeGreaterThanOrEqual(RAIN_MIN_STRENGTH);
      expect(rainFalling(mixed(0.3, 0.3, intensity))).toBeGreaterThan(0);
    }
    expect(rainFalling(mixed(1, 0, 1))).toBe(1);
  });

  it('agree frame by frame through a change of weather, on the drawn layer', () => {
    const { fx, frame } = scene(tower());
    let v = settledView(snap('clear'));
    let sawBoth = 0;
    for (const target of ['rain', 'overcast', 'storm', 'clear'] as const) {
      for (let i = 0; i < 6 * 60; i++) {
        v = easeView(v, snap(target, 0.4), FRAME_MS);
        fx.update(frame(v));
        const rain = fx.rain();
        expect(rain.alpha > 0).toBe(umbrellasUp(v));
        if (umbrellasUp(v)) {
          sawBoth++;
          expect(rain.alpha).toBeGreaterThanOrEqual(0.5);
          expect(rain.lattices).toBeGreaterThanOrEqual(1);
          expect(fx.sheetRects().length).toBeGreaterThan(0);
        }
      }
    }
    expect(sawBoth).toBeGreaterThan(60);
  });

  it('gives neither under overcast, and never wets the street', () => {
    const { fx, frame } = scene(tower());
    const v = settledView(snap('overcast', 1));
    expect(umbrellasUp(v)).toBe(false);
    expect(rainFalling(v)).toBe(0);
    for (let i = 0; i < 30 * 60; i++) fx.update(frame(v));
    expect(fx.rain().alpha).toBe(0);
    expect(fx.street().wet).toBe(0);
    expect(fx.street().alpha).toBe(0);
    expect(fx.ripplePoints()).toHaveLength(0);
  });
});

describe('where the rain falls', () => {
  it('falls beside a lobby narrower than the floors above, where the commuters walk, and never on a room', () => {
    const world = tower();
    const { frame, doors } = scene(world);
    const f = frame(settledView(snap('rain')));
    const rects = sheetRectsOnScreen(f.floors, f.originX, f.originY, f.zoom, f.viewW, f.viewH);
    // A commuter's head, three tiles out from the right door, half a floor above the street.
    const x = f.originX + (doors.right + 3 * TILE_PX) * f.zoom;
    const y = f.originY - 40 * f.zoom;
    expect(rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)).toBe(true);
    for (const r of rects) {
      expect(r.y + r.h).toBeLessThanOrEqual(f.originY);
      for (const c of cells(world)) {
        const sc = { x: f.originX + c.x * f.zoom, y: f.originY + c.y * f.zoom, w: c.w * f.zoom, h: c.h * f.zoom };
        expect(intersects(r, sc)).toBe(false);
      }
    }
  });

  it('is heavier in a storm: more streaks, faster, at least as strong', () => {
    const { fx: a, frame } = scene(tower());
    const { fx: b } = scene(tower());
    a.update(frame(settledView(snap('rain', 0.7))));
    b.update(frame(settledView(snap('storm', 0.7))));
    expect(b.rain().lattices).toBeGreaterThan(a.rain().lattices);
    expect(b.rain().speed).toBeGreaterThan(a.rain().speed);
    expect(b.rain().alpha).toBeGreaterThanOrEqual(a.rain().alpha);
  });

  it('under reduced motion falls slower with fewer streaks and ripples, never none', () => {
    for (const kind of ['rain', 'storm'] as const) {
      const { fx: normal, frame } = scene(tower());
      const { fx: calm } = scene(tower());
      const v = settledView(snap(kind, 0.4));
      for (let i = 0; i < 120; i++) {
        normal.update(frame(v));
        calm.update(frame(v, true));
      }
      expect(calm.rain().alpha).toBeGreaterThanOrEqual(0.5);
      expect(calm.rain().lattices).toBeGreaterThanOrEqual(1);
      expect(calm.rain().lattices).toBeLessThan(normal.rain().lattices);
      expect(calm.rain().speed).toBeGreaterThan(0);
      expect(calm.rain().speed).toBeLessThan(normal.rain().speed);
      expect(calm.ripplePoints().length).toBeGreaterThan(0);
      expect(calm.ripplePoints().length).toBeLessThan(normal.ripplePoints().length);
    }
  });
});

describe('the wet street', () => {
  it('ripples only on the wet band while rain falls, never over the basement', () => {
    const world = tower();
    const { fx, frame, extents } = scene(world);
    const basement = basementSpanOf(extents)!;
    const v = settledView(snap('storm', 1));
    for (let i = 0; i < 5 * 60; i++) {
      fx.update(frame(v));
      for (const p of fx.ripplePoints()) {
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(WET_BAND_PX);
        expect(p.x < basement.left || p.x > basement.right).toBe(true);
      }
    }
    expect(fx.ripplePoints().length).toBeGreaterThan(5);
  });

  it('stays wet after the umbrellas close, then dries gradually, and soaks again in rain', () => {
    const { fx, frame } = scene(tower());
    let v = settledView(snap('rain'));
    fx.update(frame(v));
    expect(fx.street().wet).toBe(1);
    expect(fx.street().alpha).toBe(1);

    // The rain stops (overcast): step until the umbrellas close.
    let t = 0;
    while (umbrellasUp(v)) {
      v = easeView(v, snap('overcast'), FRAME_MS);
      fx.update(frame(v));
      t += FRAME_MS;
    }
    expect(t).toBeLessThan(4000);
    // The same frame: no rain and no ripples, but the street is still soaked.
    expect(fx.rain().alpha).toBe(0);
    expect(fx.ripplePoints()).toHaveLength(0);
    expect(fx.street().wet).toBeGreaterThan(0.9);

    // It dries gradually: always falling, still wet half way, dry by STREET_DRY_MS.
    let last = fx.street().wet;
    let halfway = -1;
    for (let ms = 0; ms < STREET_DRY_MS + 1000; ms += FRAME_MS) {
      v = easeView(v, snap('overcast'), FRAME_MS);
      fx.update(frame(v));
      const now = fx.street().wet;
      expect(now).toBeLessThanOrEqual(last);
      last = now;
      if (halfway < 0 && ms >= STREET_DRY_MS / 2) halfway = now;
    }
    expect(halfway).toBeGreaterThan(0.3);
    expect(halfway).toBeLessThan(0.7);
    expect(fx.street().wet).toBe(0);
    expect(fx.street().alpha).toBe(0);

    // Rain again: the street soaks through within STREET_SOAK_MS of the umbrellas opening.
    while (!umbrellasUp(v)) {
      v = easeView(v, snap('rain'), FRAME_MS);
      fx.update(frame(v));
    }
    for (let ms = 0; ms < STREET_SOAK_MS + 100; ms += FRAME_MS) {
      v = easeView(v, snap('rain'), FRAME_MS);
      fx.update(frame(v));
    }
    expect(fx.street().wet).toBe(1);
  });
});

// Weather as the renderer shows it (package 3): the real time ease, lightning scheduling, the
// clip rule that keeps rain off the tower, the clear sky byte for byte, and the dev capture
// path that production ignores.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { weatherAt, type WeatherKind, type WeatherSnapshot } from '../../src/game/weather';
import { builtFloorExtents } from '../../src/render/renderer';
import { lightTintAt } from '../../src/render/light';
import { skyAt, skyBackground } from '../../src/render/sky';
import { floorTopY } from '../../src/render/camera';
import { TILE_PX, FLOOR_PX } from '../../src/render/grid';
import {
  easeView,
  intersects,
  LIGHTNING_GAP_MS,
  lightningDue,
  parseWeatherQuery,
  rainSheetRects,
  setForcedWeather,
  settledView,
  weatherLightTint,
  weatherNow,
  weatherSkyColor,
  wetStreetRects,
  type Rect,
  type WeatherView,
} from '../../src/render/weather';
import { basementSpanOf, createWeatherFx, sheetRectsOnScreen, towerRectOf } from '../../src/render/weatherfx';
import { applyDevWeather } from '../../src/main';
import { ROOMS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld } from '../../src/sim/world';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

afterEach(() => setForcedWeather(null));

const FRAME_MS = 1000 / 60;
const snap = (kind: WeatherKind, intensity = 0.8): WeatherSnapshot => ({ kind, from: kind, blend: 1, intensity });

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
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
  };
  addRoom(world, room);
  return room;
}

/** A tower `floors` tall: a lobby, offices up one side, a shaft the full height, one basement. */
function tower(floors: number): World {
  const world = createWorld(3);
  for (let x = 100; x < 180; x += ROOMS.lobby.width) makeRoom(world, 'lobby', 1, x);
  for (let f = 2; f <= floors; f++) makeRoom(world, 'office', f, 110 + (f % 3) * 4);
  makeRoom(world, 'office', -1, 120);
  const id = allocId(world);
  const car: Car = {
    id: allocId(world),
    shaftId: id,
    y: 1,
    dir: 0,
    state: 'idle',
    doorTimer: 0,
    idleSince: null,
    passengers: [],
    calls: new Set(),
    serves: 'any',
    range: null,
  };
  const stops = new Set<number>();
  for (let f = 1; f <= floors; f++) stops.add(f);
  addShaft(world, { id, kind: 'standard', x: 170, width: 4, floorMin: 1, floorMax: floors, stops, homeFloor: 1, cars: [car], hallCalls: new Map() });
  return world;
}

/** Every room cell and shaft of a world as world px rectangles. */
function cells(world: World): Rect[] {
  const out: Rect[] = [];
  for (const r of world.rooms.values()) {
    const top = floorTopY(r.floor + r.height - 1);
    out.push({ x: r.x * TILE_PX, y: top, w: r.width * TILE_PX, h: r.height * FLOOR_PX });
  }
  for (const s of world.shafts.values()) {
    const top = floorTopY(s.floorMax);
    out.push({ x: s.x * TILE_PX, y: top, w: s.width * TILE_PX, h: (s.floorMax - s.floorMin + 1) * FLOOR_PX });
  }
  return out;
}

describe('the eased weather view', () => {
  it('converges to weight 1 within 4.1 s of real time, and not before about 4 s', () => {
    let view = settledView(snap('clear'));
    let t = 0;
    for (; t < 3900; t += FRAME_MS) view = easeView(view, snap('storm'), FRAME_MS);
    expect(view.weights.storm).toBeLessThan(1);
    for (; t < 4100; t += FRAME_MS) view = easeView(view, snap('storm'), FRAME_MS);
    expect(view.weights.storm).toBe(1);
    expect(view.weights.clear).toBe(0);
    expect(view.weights.rain + view.weights.overcast).toBe(0);
  });

  it('is unaffected by game speed: 1 and 10 game minutes a frame give the same view', () => {
    // A block that changes from clear to storm, found from the forecast itself.
    let seed = 1;
    while (!(weatherAt(seed, 360).kind === 'storm' && weatherAt(seed, 359).kind !== 'storm')) seed++;
    const run = (minutesPerFrame: number): WeatherView => {
      let minute = 360;
      let view = settledView(weatherAt(seed, 359));
      for (let t = 0; t < 4100; t += FRAME_MS) {
        view = easeView(view, weatherNow(seed, minute), FRAME_MS);
        minute += minutesPerFrame;
      }
      return view;
    };
    const slow = run(0.05);
    const fast = run(1.4); // 345 minutes in 4.1 s, still inside the block
    expect(fast).toEqual(slow);
    expect(slow.weights.storm).toBe(1);
  });
});

describe('lightning', () => {
  it('never schedules under reduced motion, in a full storm over ten minutes', () => {
    let due = 0;
    for (let t = 0; t < 600_000; t += FRAME_MS) if (lightningDue(99, t, -Infinity, 1, true)) due++;
    expect(due).toBe(0);
  });

  it('flashes the sky layer for two frames at most once per 8 s, and never under reduced motion', () => {
    const sky = new Container();
    const fx = createWeatherFx({ sky, sheet: new Container(), ground: new Container() });
    const storm = settledView(snap('storm', 1));
    const frame = (reducedMotion: boolean) => ({
      view: storm,
      seed: 42,
      night: 0,
      viewW: 800,
      viewH: 600,
      originX: 400,
      originY: 400,
      zoom: 1,
      tower: null,
      basement: null,
      dtMs: FRAME_MS,
      reducedMotion,
    });
    const starts: number[] = [];
    let was = false;
    let run = 0;
    let longest = 0;
    const on60 = frame(false);
    for (let i = 0; i < 60 * 60; i++) {
      fx.update(on60);
      const on = fx.flashing();
      if (on && !was) starts.push(i);
      run = on ? run + 1 : 0;
      longest = Math.max(longest, run);
      was = on;
    }
    expect(longest).toBe(2);
    expect(starts.length).toBeGreaterThan(0);
    for (let i = 1; i < starts.length; i++) expect((starts[i]! - starts[i - 1]!) * FRAME_MS).toBeGreaterThanOrEqual(LIGHTNING_GAP_MS - FRAME_MS);

    const calm = createWeatherFx({ sky: new Container(), sheet: new Container(), ground: new Container() });
    const reduced = frame(true);
    let flashes = 0;
    for (let i = 0; i < 60 * 60; i++) {
      calm.update(reduced);
      if (calm.flashing()) flashes++;
    }
    expect(flashes).toBe(0);
  });
});

describe('the clip rule: no rain on the tower', () => {
  for (const floors of [5, 60]) {
    it(`keeps the rain sheet off a ${floors} floor tower and the wet street off its basement`, () => {
      const world = tower(floors);
      const extents = builtFloorExtents(world);
      const rect = towerRectOf(extents);
      expect(rect).not.toBeNull();
      expect(rect!.y).toBe(floorTopY(floors));
      const all = cells(world);
      // World space, a view far larger than the tower.
      const view = { x: -4000, y: floorTopY(floors) - 2000, w: 12000, h: 6000 };
      const sheet = rainSheetRects(rect, view, 0);
      expect(sheet.length).toBe(3);
      for (const r of sheet) {
        expect(intersects(r, rect!)).toBe(false);
        for (const c of all) expect(intersects(r, c)).toBe(false);
      }
      // Screen space at an awkward zoom, as the renderer draws it.
      for (const zoom of [0.37, 1, 2.5]) {
        const originX = 213.4;
        const originY = 517.7;
        const screenSheet = sheetRectsOnScreen(rect!, originX, originY, zoom, 1280, 800);
        expect(screenSheet.length).toBeGreaterThan(0);
        for (const r of screenSheet) {
          for (const c of all) {
            const sc = { x: originX + c.x * zoom, y: originY + c.y * zoom, w: c.w * zoom, h: c.h * zoom };
            expect(intersects(r, sc)).toBe(false);
          }
        }
      }
      const street = wetStreetRects(basementSpanOf(extents), -3200, 10000);
      expect(street.length).toBe(2);
      for (const r of street) for (const c of all) expect(intersects(r, c)).toBe(false);
    });
  }
});

describe('sky and light under the weather', () => {
  it('leaves the sky exactly at skyAt for clear weather at weight 1, every minute of the day', () => {
    const clear = settledView(snap('clear'));
    for (let m = 0; m < 1440; m++) {
      const c = skyAt(m);
      expect(weatherSkyColor(c.top, clear)).toBe(c.top);
      expect(weatherSkyColor(c.bottom, clear)).toBe(c.bottom);
      expect(weatherSkyColor(skyBackground(m), clear)).toBe(skyBackground(m));
      expect(weatherLightTint(lightTintAt(m), clear)).toBe(lightTintAt(m));
    }
  });

  it('grays the sky more for storm than rain than overcast, and cools the light only in rain and storm', () => {
    const noon = skyAt(12 * 60).top;
    const dist = (a: number, b: number): number =>
      Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)) + Math.abs((a & 0xff) - (b & 0xff));
    const d = (k: WeatherKind): number => dist(weatherSkyColor(noon, settledView(snap(k))), noon);
    expect(d('overcast')).toBeGreaterThan(0);
    expect(d('rain')).toBeGreaterThan(d('overcast'));
    expect(d('storm')).toBeGreaterThan(d('rain'));
    expect(weatherLightTint(0xffffff, settledView(snap('overcast')))).toBe(0xffffff);
    expect(weatherLightTint(0xffffff, settledView(snap('storm')))).not.toBe(0xffffff);
  });
});

describe('the dev capture path', () => {
  it('is ignored when import.meta.env.DEV is false', () => {
    const world = { seed: 11, time: { minute: 3 * 1440 + 500 } };
    expect(applyDevWeather('?weather=storm&hour=13', false, world)).toBe(false);
    expect(world.time.minute).toBe(3 * 1440 + 500);
    expect(weatherNow(world.seed, world.time.minute)).toEqual(weatherAt(world.seed, world.time.minute));
  });

  it('pins the weather and moves the clock forward to the hour in dev', () => {
    const world = { seed: 11, time: { minute: 3 * 1440 + 500 } };
    expect(applyDevWeather('?weather=storm&hour=13', true, world)).toBe(true);
    expect(world.time.minute).toBe(3 * 1440 + 13 * 60);
    expect(weatherNow(world.seed, world.time.minute).kind).toBe('storm');
    applyDevWeather('?hour=2', true, world);
    expect(world.time.minute).toBe(4 * 1440 + 2 * 60);
  });

  it('parses only the four kinds and hours 0 to 23', () => {
    expect(parseWeatherQuery('?weather=rain&hour=22')).toEqual({ kind: 'rain', hour: 22 });
    expect(parseWeatherQuery('?weather=snow&hour=24')).toEqual({ kind: null, hour: null });
    expect(parseWeatherQuery('?hour=')).toEqual({ kind: null, hour: null });
  });
});

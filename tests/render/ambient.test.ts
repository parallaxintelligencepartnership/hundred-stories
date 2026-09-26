// Ambient life (look round ship L3): shop signs blink at night, restaurant steam rises, the
// cinema marquee cycles, and none of it exists under reduced motion. Plus the build feedback
// timing: the 4 px settle, the dust puff and the flash, and D-14's window reveal and price floater.

import { describe, expect, it } from 'vitest';
import { Container, Graphics, Sprite } from 'pixi.js';
import {
  ambientEmitters,
  createAmbient,
  emitterPhase,
  MARQUEE_STEP_MS,
  marqueeColour,
  SIGN_CYCLE_MS,
  signLit,
  STEAM_PX,
  STEAM_RISE_PX,
  steamPuffs,
} from '../../src/render/ambient';
import { CINEMA_MARQUEE_COLOURS } from '../../src/render/art';
import { BUILD_FX_MS, buildFxAt, createBuildFx, DUST_COUNT, FLASH_MS, priceLabel, REVEAL_COLOUR, REVEAL_MS, SETTLE_MS, SETTLE_PX } from '../../src/render/buildfx';
import { drawLedText, ledTextWidth } from '../../src/render/led';
import { PALETTE } from '../../src/render/palette';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

function room(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const r: Room = {
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
  addRoom(world, r);
  return r;
}

function mixedWorld(): World {
  const world = createWorld(3);
  room(world, 'shop', 2, 10);
  room(world, 'restaurant', 3, 10);
  room(world, 'cinema', 4, 10);
  room(world, 'office', 7, 10);
  room(world, 'condo', 8, 10);
  return world;
}

describe('ambient emitters', () => {
  it('attaches one emitter to each shop, restaurant and cinema, and none to anything else', () => {
    const kinds = ambientEmitters(mixedWorld(), false).map((e) => e.kind).sort();
    expect(kinds).toEqual(['marquee', 'sign', 'steam']);
  });

  it('are absent under reduced motion', () => {
    expect(ambientEmitters(mixedWorld(), true)).toEqual([]);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(mixedWorld(), true);
    expect(ambient.count()).toBe(0);
    expect(layer.children).toHaveLength(0);
  });

  it('come and go with the reduced motion switch', () => {
    const world = mixedWorld();
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    expect(ambient.count()).toBe(3);
    ambient.update(16, true);
    ambient.sync(world, true);
    expect(ambient.count()).toBe(0);
    expect(layer.children).toHaveLength(0);
  });

  it('shows the shop sign only at night, lit most of the time with a neon stutter', () => {
    const world = createWorld(3);
    const shop = room(world, 'shop', 2, 10);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const strip = (layer.children[0] as Container).children[0] as Sprite;
    ambient.update(10, false);
    expect(strip.visible).toBe(false);
    ambient.update(10, true);
    expect(strip.visible).toBe(true);
    let off = 0;
    for (let t = 0; t < SIGN_CYCLE_MS; t += 10) {
      ambient.update(10, true);
      if (strip.tint !== PALETTE.amber) off += 10;
    }
    expect(off).toBe(200); // 120 ms and 80 ms dark in every 3 s
    expect(emitterPhase(shop.id)).toBeLessThan(SIGN_CYCLE_MS);
  });

  it('D-17: gives each shop sign its own rhythm, so two shops are not both off at one clock', () => {
    const world = createWorld(3);
    // ids 1 and 3 (an office takes 2). Phases are independent per id, so not every pair misses:
    // ids 1 and 2 share 13 ms of dark in each cycle.
    const a = room(world, 'shop', 2, 10);
    room(world, 'office', 7, 10);
    const b = room(world, 'shop', 3, 10);
    expect([a.id, b.id]).toEqual([1, 3]);
    expect(emitterPhase(a.id)).not.toBe(emitterPhase(b.id));
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const [sa, sb] = layer.children.map((n) => (n as Container).children[0] as Sprite);
    expect(layer.children).toHaveLength(2);
    let aOff = false;
    let bOff = false;
    for (let t = 0; t < 2 * SIGN_CYCLE_MS; t += 10) {
      ambient.update(10, true, 20 * 60);
      const offA = sa!.tint !== PALETTE.amber;
      const offB = sb!.tint !== PALETTE.amber;
      aOff ||= offA;
      bOff ||= offB;
      expect(offA && offB).toBe(false);
    }
    expect(aOff && bOff).toBe(true); // both do stutter, just never together
  });

  it('D-17: spreads the signs so they never go dark as one: 60 shops, 58 or more phases, at most 12 dark at once', () => {
    const world = createWorld(3);
    for (let i = 0; i < 60; i++) room(world, 'shop', 2 + i, 10);
    const ids = [...world.rooms.keys()];
    expect(ids).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(new Set(ids.map(emitterPhase)).size).toBeGreaterThanOrEqual(58);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const strips = layer.children.map((n) => (n as Container).children[0] as Sprite);
    expect(strips).toHaveLength(60);
    let worst = 0;
    for (let t = 0; t < SIGN_CYCLE_MS; t += 10) {
      ambient.update(10, true, 20 * 60);
      worst = Math.max(worst, strips.filter((s) => s.tint !== PALETTE.amber).length);
    }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(12); // 20 percent; one shared clock would be all 60
  });

  it('D-17: steps each cinema marquee on its own offset, and puffs 3 px steam', () => {
    const world = createWorld(3);
    room(world, 'cinema', 2, 10);
    room(world, 'cinema', 4, 10);
    room(world, 'restaurant', 6, 10);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const [ma, mb, steam] = layer.children.map((n) => (n as Container).children as Sprite[]);
    let apart = false;
    for (let t = 0; t < 1800; t += 50) {
      ambient.update(50, true);
      if (ma![0]!.tint !== mb![0]!.tint) apart = true;
    }
    expect(apart).toBe(true);
    expect(STEAM_PX).toBe(3);
    expect(steam![0]!.width).toBe(3);
  });

  it('keeps a closed shop dark: the strip blinks only while the shop is open (package 2)', () => {
    const world = createWorld(3);
    room(world, 'shop', 2, 10);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const strip = (layer.children[0] as Container).children[0] as Sprite;
    ambient.update(10, true, 20 * 60); // 20:00, open until 21:00
    expect(strip.visible).toBe(true);
    ambient.update(10, true, 22 * 60); // 22:00, shuttered
    expect(strip.visible).toBe(false);
  });

  it('times the sign, the marquee and the steam on real time', () => {
    expect(SIGN_CYCLE_MS).toBe(3000);
    expect([0, 2599, 2600, 2719, 2720, 2839, 2840, 2919, 2920, 2999, 5600].map(signLit)).toEqual([
      true, true, false, false, true, true, false, false, true, true, false,
    ]);
    expect(MARQUEE_STEP_MS).toBe(600);
    expect([0, 600, 1200, 1800].map(marqueeColour)).toEqual([...CINEMA_MARQUEE_COLOURS, CINEMA_MARQUEE_COLOURS[0]]);
    const puffs = steamPuffs(0);
    expect(puffs).toHaveLength(3);
    for (let t = 0; t < 2400; t += 50) {
      for (const p of steamPuffs(t)) {
        expect(p.dy).toBeLessThanOrEqual(0);
        expect(p.dy).toBeGreaterThanOrEqual(-STEAM_RISE_PX);
        expect(p.alpha).toBeGreaterThanOrEqual(0);
      }
    }
    // one puff rises through its whole 12 px over 1.2 s
    expect(Math.min(...[0, 300, 600, 900, 1190].map((t) => steamPuffs(t)[0]!.dy))).toBeLessThanOrEqual(-STEAM_RISE_PX + 1);
  });
});

describe('build feedback', () => {
  it('drops the room 4 px onto its slab over 120 ms', () => {
    expect(buildFxAt(0, 144).settleDy).toBe(SETTLE_PX);
    expect(buildFxAt(SETTLE_MS / 2, 144).settleDy).toBeLessThan(SETTLE_PX);
    expect(buildFxAt(SETTLE_MS, 144).settleDy).toBe(0);
    expect(buildFxAt(1000, 144).settleDy).toBe(0);
  });

  it('flashes white from 0.5 to nothing over 200 ms', () => {
    expect(buildFxAt(0, 144).flashAlpha).toBe(0.5);
    expect(buildFxAt(FLASH_MS / 2, 144).flashAlpha).toBeCloseTo(0.25);
    expect(buildFxAt(FLASH_MS, 144).flashAlpha).toBe(0);
  });

  it('puffs six specks of dust at the base that fade over 300 ms', () => {
    const start = buildFxAt(0, 144).dust;
    expect(start).toHaveLength(DUST_COUNT);
    for (const d of start) expect(Math.abs(d.dx)).toBeLessThanOrEqual(72);
    expect(buildFxAt(150, 144).dust.every((d) => d.alpha > 0 && d.alpha < 1)).toBe(true);
    expect(buildFxAt(300, 144).dust).toHaveLength(0);
  });

  it('lands the room where it rests and tidies up after the effect', () => {
    const layer = new Container();
    const fx = createBuildFx(layer);
    const sprite = new Sprite();
    sprite.y = 100;
    fx.start([sprite], 0, 100, 144, 72);
    expect(sprite.y).toBe(100 - SETTLE_PX);
    expect(fx.count()).toBe(1);
    fx.update(60);
    expect(sprite.y).toBeGreaterThan(100 - SETTLE_PX);
    fx.update(400);
    expect(sprite.y).toBe(100);
    expect(fx.count()).toBe(1); // the price is still rising
    fx.update(BUILD_FX_MS);
    expect(fx.count()).toBe(0);
    expect(layer.children).toHaveLength(0);
  });

  it('D-14: lights the window band left to right, 75 percent of the width revealed at 180 ms', () => {
    expect(REVEAL_MS).toBe(360);
    expect(BUILD_FX_MS).toBe(900);
    expect(buildFxAt(0, 144).revealed).toBe(0);
    expect(buildFxAt(180, 144).revealed).toBeCloseTo(0.75 * 144);
    expect(buildFxAt(REVEAL_MS, 144).revealed).toBe(144);
    const layer = new Container();
    const floater = new Container();
    const fx = createBuildFx(layer, floater);
    const bands = [{ y: 104, h: 16 }, { y: 176, h: 16 }];
    fx.start([], 20, 100, 144, 144, bands, '-$40,000');
    const covers = (): Sprite[] =>
      ((layer.children[0] as Container).children as Sprite[]).filter((c) => c instanceof Sprite && c.tint === REVEAL_COLOUR);
    expect(covers()).toHaveLength(2);
    fx.update(180);
    for (const [i, c] of covers().entries()) {
      expect(c.x).toBeCloseTo(20 + 0.75 * 144);
      expect(c.x + c.width).toBeCloseTo(20 + 144);
      expect(c.y).toBe(bands[i]!.y); // the settle is long over
      expect(c.height).toBe(16);
    }
    fx.update(180);
    for (const c of covers()) expect(c.visible).toBe(false);
  });

  it('D-14: floats the price up out of the room in the indicator face, rising 16 px over 900 ms and fading from 600 ms', () => {
    expect(priceLabel(40000)).toBe('-$40,000');
    expect(priceLabel(1500000)).toBe('-$1,500,000');
    const layer = new Container();
    const over = new Container();
    const fx = createBuildFx(layer, over);
    fx.start([], 20, 100, 144, 72, [], priceLabel(40000));
    expect(over.children).toHaveLength(1);
    const g = over.children[0] as Graphics;
    expect(g).toBeInstanceOf(Graphics);
    const plateW = ledTextWidth('-$40,000', 2) + 8;
    const b0 = g.getLocalBounds();
    expect(b0.width).toBe(plateW);
    expect(b0.height).toBe(18);
    // centred on the room, its foot 8 px over the room's top
    expect(g.x + b0.x + plateW / 2).toBeCloseTo(20 + 72);
    expect(g.y + b0.y + 18).toBe(100 - 8);
    const y0 = g.y;
    fx.update(450);
    expect(g.y).toBeCloseTo(y0 - 8);
    expect(g.alpha).toBe(1);
    fx.update(300); // 750 ms: half faded
    expect(g.alpha).toBeCloseTo(0.5);
    fx.update(150);
    expect(over.children).toHaveLength(0);
  });

  it('D-14: draws the price in the elevator indicator digits, minus, comma and dollar included', () => {
    const g = new Graphics();
    drawLedText(g, '-$1,0', 0, 0, 2, 0xffb347);
    const b = g.getLocalBounds();
    expect(b.width).toBe(ledTextWidth('-$1,0', 2));
    expect(ledTextWidth('-$1,0', 2)).toBe(5 * 8 - 2);
    expect(b.height).toBe(10);
  });
});

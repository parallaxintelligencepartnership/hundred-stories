// Ambient life (look round ship L3): shop signs blink at night, restaurant steam rises, the
// cinema marquee cycles, and none of it exists under reduced motion. Plus the build feedback
// timing: the 4 px settle, the dust puff and the flash.

import { describe, expect, it } from 'vitest';
import { Container, Sprite } from 'pixi.js';
import {
  ambientEmitters,
  createAmbient,
  MARQUEE_STEP_MS,
  marqueeColour,
  SIGN_BLINK_MS,
  signLit,
  STEAM_RISE_PX,
  steamPuffs,
} from '../../src/render/ambient';
import { CINEMA_MARQUEE_COLOURS } from '../../src/render/art';
import { buildFxAt, createBuildFx, DUST_COUNT, FLASH_MS, SETTLE_MS, SETTLE_PX } from '../../src/render/buildfx';
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

  it('shows the shop sign only at night, blinking every 900 ms', () => {
    const world = createWorld(3);
    room(world, 'shop', 2, 10);
    const layer = new Container();
    const ambient = createAmbient(layer);
    ambient.sync(world, false);
    const strip = (layer.children[0] as Container).children[0] as Sprite;
    ambient.update(10, false);
    expect(strip.visible).toBe(false);
    ambient.update(10, true);
    expect(strip.visible).toBe(true);
    const first = strip.tint;
    ambient.update(SIGN_BLINK_MS, true);
    expect(strip.tint).not.toBe(first);
    ambient.update(SIGN_BLINK_MS, true);
    expect(strip.tint).toBe(first);
  });

  it('times the sign, the marquee and the steam on real time', () => {
    expect(SIGN_BLINK_MS).toBe(900);
    expect(signLit(0)).toBe(true);
    expect(signLit(899)).toBe(true);
    expect(signLit(900)).toBe(false);
    expect(signLit(1800)).toBe(true);
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
    expect(fx.count()).toBe(0);
    expect(layer.children).toHaveLength(0);
  });
});

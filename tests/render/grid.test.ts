// The 0.4.0 grid: 16 px tiles and 72 px floors, and every baked texture on it. A drawer that
// still assumes the 8 px grid bakes a texture of the wrong size, so every drawer is baked here
// through a stub renderer that records the requested frame, which needs no GPU.

import { describe, expect, it } from 'vitest';
import { Rectangle } from 'pixi.js';
import type { Renderer as PixiRenderer, Texture } from 'pixi.js';
import { FLOOR_PX, SLAB_PX, SLAB_SHADOW_PX, TEXTURE_SIZE, TILE_PX, bakeResolution, createArt } from '../../src/render/art';
import { WINDOW_STATES } from '../../src/render/light';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import type { RoomKind, ShaftKind } from '../../src/sim/types';

interface Baked {
  width: number;
  height: number;
  resolution: number;
}

function recorder(): { renderer: PixiRenderer; last: () => Baked } {
  let last: Baked = { width: 0, height: 0, resolution: 0 };
  const renderer = {
    generateTexture(options: { frame: Rectangle; resolution: number }): Texture {
      last = { width: options.frame.width, height: options.frame.height, resolution: options.resolution };
      return {} as Texture;
    },
  } as unknown as PixiRenderer;
  return { renderer, last: () => last };
}

describe('the base grid', () => {
  it('is 16 px tiles and 72 px floors', () => {
    expect(TILE_PX === 16 && FLOOR_PX === 72).toBe(true);
  });

  it('bakes at the device pixel ratio rounded to 1 or 2', () => {
    expect(bakeResolution(undefined)).toBe(1);
    expect(bakeResolution(0)).toBe(1);
    expect(bakeResolution(1)).toBe(1);
    expect(bakeResolution(1.25)).toBe(1);
    expect(bakeResolution(1.5)).toBe(2);
    expect(bakeResolution(2)).toBe(2);
    expect(bakeResolution(3)).toBe(2);
  });
});

describe('every drawer bakes on the grid', () => {
  const kinds = Object.keys(ROOMS) as RoomKind[];

  it('bakes each room kind at tiles * TILE_PX by floors * FLOOR_PX', () => {
    for (const kind of kinds) {
      const rule = ROOMS[kind];
      for (const state of WINDOW_STATES) {
        const { renderer, last } = recorder();
        createArt(renderer).room(kind, rule.width, rule.height, 0, state);
        const { width, height } = last();
        expect({ kind, width, height }).toEqual({ kind, width: rule.width * TILE_PX, height: rule.height * FLOOR_PX });
      }
    }
  });

  it('bakes the slab a tile run wide and SLAB_PX tall plus its 4 px shadow', () => {
    const { renderer, last } = recorder();
    createArt(renderer).slab(9);
    expect(SLAB_SHADOW_PX).toBe(4);
    expect(last()).toMatchObject({ width: 9 * TILE_PX, height: SLAB_PX + SLAB_SHADOW_PX });
  });

  it('bakes shafts, cars, sims and the ghost on the same grid', () => {
    for (const kind of Object.keys(SHAFTS) as ShaftKind[]) {
      const shaft = recorder();
      createArt(shaft.renderer).shaft(kind, 5);
      expect(shaft.last()).toMatchObject({ width: SHAFTS[kind].width * TILE_PX, height: 5 * FLOOR_PX });
      for (const open of [false, true]) {
        const car = recorder();
        createArt(car.renderer).car(kind, open);
        // body SHAFTS width * TILE_PX - 8 by FLOOR_PX - 12, with the 4 px cast shadow on top
        expect(car.last()).toMatchObject({ width: SHAFTS[kind].width * TILE_PX - 8, height: FLOOR_PX - 12 + 4 });
        expect(car.last()).toMatchObject(TEXTURE_SIZE.car(kind));
      }
    }
    const sim = recorder();
    createArt(sim.renderer).sim('worker', 'calm', 0);
    expect(sim.last()).toMatchObject({ width: TILE_PX, height: 3 * TILE_PX });
    const ghost = recorder();
    createArt(ghost.renderer).ghost(4, 2, true);
    expect(ghost.last()).toMatchObject({ width: 4 * TILE_PX, height: 2 * FLOOR_PX });
  });

  it('passes the bake resolution to every texture', () => {
    const { renderer, last } = recorder();
    createArt(renderer).room('office', 9, 1, 0, 'day');
    expect(last().resolution).toBe(bakeResolution(typeof window === 'undefined' ? 1 : window.devicePixelRatio));
  });

  it('bakes the standard car at the 56 by 60 of the art note, plus its shadow', () => {
    expect(TEXTURE_SIZE.car('standard')).toEqual({ width: 56, height: 60 + 4 });
  });
});

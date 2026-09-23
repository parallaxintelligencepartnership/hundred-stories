// The figures are one tile wide and three tall, the way the original's people read.
// Nothing may spill outside that box: a sim wider than its tile overlaps the sim beside
// it in a lift queue, and a sim taller than three tiles pokes through the slab above.
// These tests bake every kind, band and frame through a stub renderer and rasterize the
// rectangles the art module draws, so the check needs no GPU.

import { afterEach, describe, expect, it } from 'vitest';
import { Graphics, Rectangle } from 'pixi.js';
import type { Renderer as PixiRenderer, Texture } from 'pixi.js';
import { SIM_H, SIM_W, TILE_PX, createArt } from '../../src/render/art';
import type { SimKind, StressBand } from '../../src/sim/types';

const KINDS: readonly SimKind[] = ['worker', 'resident', 'guest', 'shopper', 'diner', 'staff', 'visitor', 'vip'];
const BANDS: readonly StressBand[] = ['calm', 'pink', 'red'];
const FRAMES = [0, 1] as const;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Baked {
  width: number;
  height: number;
  rects: Rect[];
}

const originalRect = Graphics.prototype.rect;

afterEach(() => {
  Graphics.prototype.rect = originalRect;
});

/** Bakes one sim texture and returns the requested texture size plus every rectangle drawn into it. */
function bakeSim(kind: SimKind, band: StressBand, frame: 0 | 1): Baked {
  const rects: Rect[] = [];
  Graphics.prototype.rect = function patched(this: Graphics, x: number, y: number, w: number, h: number) {
    rects.push({ x, y, w, h });
    return originalRect.call(this, x, y, w, h);
  };
  let size = { width: 0, height: 0 };
  const renderer = {
    generateTexture(options: { frame: Rectangle }): Texture {
      size = { width: options.frame.width, height: options.frame.height };
      return {} as Texture;
    },
  } as unknown as PixiRenderer;
  createArt(renderer).sim(kind, band, frame);
  Graphics.prototype.rect = originalRect;
  return { width: size.width, height: size.height, rects };
}

/** The filled pixels of a baked sim, as one string per row, so two frames can be compared. */
function silhouette(baked: Baked): string[] {
  const grid: string[][] = Array.from({ length: SIM_H }, () => Array.from({ length: SIM_W }, () => '.'));
  for (const rect of baked.rects) {
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const row = grid[y];
        if (row && x >= 0 && x < SIM_W) row[x] = '#';
      }
    }
  }
  return grid.map((row) => row.join(''));
}

describe('sim sprite size', () => {
  it('is one tile by three tiles, 16 by 48 on the 0.4.0 grid', () => {
    expect(SIM_W).toBe(TILE_PX);
    expect(SIM_H).toBe(3 * TILE_PX);
    expect([SIM_W, SIM_H]).toEqual([16, 48]);
  });

  it('bakes every kind, band and frame at one tile by three tiles', () => {
    for (const kind of KINDS) {
      for (const band of BANDS) {
        for (const frame of FRAMES) {
          const baked = bakeSim(kind, band, frame);
          expect({ kind, band, frame, ...{ width: baked.width, height: baked.height } }).toEqual({
            kind,
            band,
            frame,
            width: SIM_W,
            height: SIM_H,
          });
        }
      }
    }
  });

  it('draws every pixel inside the one by three tile box', () => {
    for (const kind of KINDS) {
      for (const band of BANDS) {
        for (const frame of FRAMES) {
          const baked = bakeSim(kind, band, frame);
          expect(baked.rects.length).toBeGreaterThan(0);
          for (const rect of baked.rects) {
            expect(rect.x).toBeGreaterThanOrEqual(0);
            expect(rect.y).toBeGreaterThanOrEqual(0);
            expect(rect.x + rect.w).toBeLessThanOrEqual(SIM_W);
            expect(rect.y + rect.h).toBeLessThanOrEqual(SIM_H);
          }
        }
      }
    }
  });

  it('stands the feet on the bottom row so they meet the slab line', () => {
    for (const frame of FRAMES) {
      const rows = silhouette(bakeSim('worker', 'calm', frame));
      expect(rows[SIM_H - 1]).toContain('#');
    }
  });

  it('keeps the two walk frames distinct', () => {
    const still = silhouette(bakeSim('worker', 'calm', 0));
    const step = silhouette(bakeSim('worker', 'calm', 1));
    expect(step).not.toEqual(still);
  });

  it('tints the stress bands without changing the figure', () => {
    for (const frame of FRAMES) {
      const calm = silhouette(bakeSim('worker', 'calm', frame));
      expect(silhouette(bakeSim('worker', 'pink', frame))).toEqual(calm);
      expect(silhouette(bakeSim('worker', 'red', frame))).toEqual(calm);
    }
  });
});

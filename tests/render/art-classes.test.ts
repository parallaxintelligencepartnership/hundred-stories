// The two texture classes (package 2): structural room shells, slabs, shafts and the ghost bake at
// the bake resolution with nearest sampling; people, venues, signs, the car and the curb pieces
// bake on an anti-aliased canvas at twice that, with linear sampling. And the budget's tools:
// the byte count, and the sweep that frees poses nobody shows.

import { describe, expect, it } from 'vitest';
import { Rectangle, Texture, type Renderer as PixiRenderer } from 'pixi.js';
import { createArt, TEXTURE_CLASS, TEXTURE_SIZE, VENUE_SHELL } from '../../src/render/art';
import { FRAME } from '../../src/render/anim';
import { VENUE_BAND } from '../../src/render/illustrated';

interface Baked {
  scaleMode: string;
  resolution: number;
  antialias: boolean;
}

function harness(resolution: 1 | 2 = 1): { art: ReturnType<typeof createArt>; structural: Baked[]; canvases: { width: number; height: number }[] } {
  const structural: Baked[] = [];
  const canvases: { width: number; height: number }[] = [];
  const renderer = {
    generateTexture(options: { frame: Rectangle; resolution: number; antialias: boolean; textureSourceOptions: { scaleMode: string } }): Texture {
      structural.push({ scaleMode: options.textureSourceOptions.scaleMode, resolution: options.resolution, antialias: options.antialias });
      return new Texture();
    },
  } as unknown as PixiRenderer;
  const noop = (): void => {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText' ? () => ({ width: 20 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop,
      set: () => true,
    },
  );
  const createCanvas = (width: number, height: number): HTMLCanvasElement => {
    canvases.push({ width, height });
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
  return { art: createArt(renderer, { createCanvas, resolution }), structural, canvases };
}

describe('texture classes', () => {
  it('samples structural textures nearest at the bake resolution, with no anti-aliasing', () => {
    expect(TEXTURE_CLASS.structural).toEqual({ scale: 1, scaleMode: 'nearest', antialias: false });
    const { art, structural } = harness(2);
    art.room('office', 9, 1, VENUE_SHELL, 'day');
    art.room('hotelSingle', 4, 1, 0, 'lit');
    art.slab(9);
    art.shaft('standard', 6);
    art.ghost(9, 1, true);
    expect(structural).toHaveLength(5);
    for (const b of structural) expect(b).toEqual({ scaleMode: 'nearest', resolution: 2, antialias: false });
  });

  it('samples illustrated textures linear at twice the bake resolution', () => {
    expect(TEXTURE_CLASS.illustrated).toEqual({ scale: 2, scaleMode: 'linear', antialias: true });
    for (const resolution of [1, 2] as const) {
      const { art, structural } = harness(resolution);
      const textures = [
        art.sim('worker', 'calm', FRAME.stride, 12),
        art.car('standard', 0.5),
        art.venue!('shop', 12, 1),
        art.sign!('shop', 12, 'Wren Books', 0x2f5c9e),
        art.closed!('office', 9),
        art.prop!('suitcase'),
        art.mark!('bang'),
        art.umbrella!(0x2f5c9e),
        art.vehicle!('vip'),
      ];
      expect(structural).toHaveLength(0); // none of them goes through the structural bake
      for (const t of textures) {
        expect(t.source.scaleMode).toBe('linear');
        expect(t.source.resolution).toBe(2 * resolution);
      }
    }
  });

  it('bakes a person at 16 by 48 logical px, 32 by 96 canvas px at resolution 1', () => {
    const { art, canvases } = harness(1);
    const t = art.sim('resident', 'pink', FRAME.stand, 3);
    expect([t.width, t.height]).toEqual([TEXTURE_SIZE.sim().width, TEXTURE_SIZE.sim().height]);
    expect(canvases[0]).toEqual({ width: 32, height: 96 });
  });

  it('crops a venue texture to the rows it draws', () => {
    const { art } = harness(1);
    const t = art.venue!('office', 9, 0);
    expect([t.width, t.height]).toEqual([9 * 16, VENUE_BAND.height]);
  });

  it('ignores stress in the person texture: the mark is a separate sprite', () => {
    const { art } = harness(1);
    expect(art.sim('worker', 'calm', FRAME.stand, 5)).toBe(art.sim('worker', 'red', FRAME.stand, 5));
    expect(art.mark!('dot')).not.toBe(art.mark!('bang'));
  });

  it('shares a texture between a frame and its mirror', () => {
    const { art } = harness(1);
    expect(art.sim('guest', 'calm', FRAME.strideMirrored, 9)).toBe(art.sim('guest', 'calm', FRAME.stride, 9));
    expect(art.sim('guest', 'calm', FRAME.shiftRight, 9)).toBe(art.sim('guest', 'calm', FRAME.shiftLeft, 9));
  });
});

describe('texture budget', () => {
  it('counts every baked texture and its bytes at its own resolution', () => {
    const { art } = harness(1);
    art.room('office', 9, 1, VENUE_SHELL, 'day'); // 144 x 72 x 4
    art.sim('worker', 'calm', FRAME.stand, 0); // 32 x 96 x 4
    const stats = art.stats!();
    expect(stats.structural).toEqual({ textures: 1, bytes: 144 * 72 * 4 });
    expect(stats.illustrated).toEqual({ textures: 1, bytes: 32 * 96 * 4 });
    expect(stats.bytes).toBe(144 * 72 * 4 + 32 * 96 * 4);
    expect(stats.byFamily).toEqual({ room: 144 * 72 * 4, person: 32 * 96 * 4 });
  });

  it('frees person textures nobody shows once they have gone unasked for, and keeps the live ones', () => {
    const { art } = harness(1);
    const shown = art.sim('worker', 'calm', FRAME.stand, 0);
    const stale = art.sim('worker', 'calm', FRAME.stride, 0);
    expect(art.sweep!(new Set([shown]), 60_000)).toBe(0); // both asked for just now
    expect(art.sweep!(new Set([shown]), 0)).toBe(1);
    expect(stale.destroyed).toBe(true);
    expect(shown.destroyed).toBe(false);
    expect(art.stats!().illustrated).toEqual({ textures: 1, bytes: 32 * 96 * 4 });
    // Asked for again, it is baked afresh.
    const again = art.sim('worker', 'calm', FRAME.stride, 0);
    expect(again).not.toBe(stale);
    expect(again.destroyed).toBe(false);
  });
});

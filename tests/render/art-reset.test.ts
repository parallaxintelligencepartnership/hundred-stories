// After a WebGL context loss and restore, a baked render texture draws blank: it keeps no pixels
// to upload again (R1, 2026-10-01). art.resetBaked frees every generateTexture bake (room shells,
// slabs, shafts, ghosts) so the next ask bakes it anew, and keeps the canvas backed textures,
// which Pixi uploads again by itself. Whether the restored frame really draws is proven only in
// a browser (the scratchpad gpu.mjs probe); this covers the cache's bookkeeping.

import { describe, expect, it } from 'vitest';
import { Texture, type Renderer as PixiRenderer } from 'pixi.js';
import { createArt, GHOST_KEEP, VENUE_SHELL } from '../../src/render/art';

function harness(): { art: ReturnType<typeof createArt>; bakes: { texture: Texture; destroyed: number }[] } {
  const bakes: { texture: Texture; destroyed: number }[] = [];
  const renderer = {
    generateTexture(): Texture {
      const texture = new Texture();
      const bake = { texture, destroyed: 0 };
      bakes.push(bake);
      const destroy = texture.destroy.bind(texture);
      texture.destroy = (options?: boolean): void => {
        bake.destroyed++;
        destroy(options);
      };
      return texture;
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
  const createCanvas = (width: number, height: number): HTMLCanvasElement =>
    ({ width, height, getContext: () => ctx }) as unknown as HTMLCanvasElement;
  return { art: createArt(renderer, { createCanvas, resolution: 1 }), bakes };
}

const STRUCTURAL = /^(room|slab|shaft|ghost):/;

describe('art.resetBaked (context restore)', () => {
  it('frees every baked key once, keeps the canvas textures, and the counts match what is left', () => {
    const { art, bakes } = harness();
    art.room('office', 9, 1, VENUE_SHELL, 'day');
    art.room('office', 9, 1, VENUE_SHELL, 'lit');
    art.room('condo', 16, 1, 0, 'day');
    art.slab(9);
    art.shaft('standard', 6);
    art.shaft('express', 40); // two pieces' worth of floors, one piece texture
    art.ghost(4, 1, true);
    art.ghost(4, 1, false);
    const glow = art.glow!();
    const sign = art.sign!('shop', 6, 'Corner', 0xff0000);
    const person = art.sim('worker', 'calm', 0, 0);
    const before = art.stats!();
    const structuralBefore = Object.keys(before.byKey!).filter((k) => STRUCTURAL.test(k));
    expect(structuralBefore.length).toBe(bakes.length);
    expect(before.structural.textures).toBe(bakes.length);

    const freed = art.resetBaked!();

    expect(freed).toBe(bakes.length);
    // Each bake destroyed exactly once.
    expect(bakes.map((b) => b.destroyed)).toEqual(bakes.map(() => 1));
    const after = art.stats!();
    expect(after.structural).toEqual({ textures: 0, bytes: 0 });
    expect(Object.keys(after.byKey!).filter((k) => STRUCTURAL.test(k))).toEqual([]);
    for (const family of ['room', 'slab', 'shaft', 'ghost']) expect(after.byFamily[family] ?? 0).toBe(0);
    // The canvas backed ones are untouched: same textures, same counts.
    expect(after.illustrated).toEqual(before.illustrated);
    expect(art.glow!()).toBe(glow);
    expect(art.sign!('shop', 6, 'Corner', 0xff0000)).toBe(sign);
    expect(art.sim('worker', 'calm', 0, 0)).toBe(person);

    // A second reset finds nothing to free and destroys nothing again.
    expect(art.resetBaked!()).toBe(0);
    expect(bakes.every((b) => b.destroyed === 1)).toBe(true);
  });

  it('bakes anew on the next ask, and the bounded ghost cache starts empty', () => {
    const { art, bakes } = harness();
    const shell = art.room('office', 9, 1, VENUE_SHELL, 'day');
    art.ghost(4, 1, true);
    art.ghost(4, 2, true);
    art.resetBaked!();
    const n = bakes.length;

    const again = art.room('office', 9, 1, VENUE_SHELL, 'day');
    expect(again).not.toBe(shell);
    expect(bakes.length).toBe(n + 1);
    expect(art.stats!().structural.textures).toBe(1);

    // The ghost list was cleared with the cache: new ghosts fill it to GHOST_KEEP before any is
    // freed, and freeing an old key now never touches a texture the reset already destroyed.
    for (let floors = 1; floors <= GHOST_KEEP + 1; floors++) art.ghost(4, floors, false);
    expect(bakes.filter((b) => b.destroyed > 1)).toEqual([]);
    const ghostsLive = Object.keys(art.stats!().byKey!).filter((k) => k.startsWith('ghost:'));
    expect(ghostsLive.length).toBe(GHOST_KEEP);
    art.dropGhosts!();
    expect(Object.keys(art.stats!().byKey!).filter((k) => k.startsWith('ghost:'))).toEqual([]);
    expect(art.stats!().structural.textures).toBe(1);
    expect(bakes.every((b) => b.destroyed <= 1)).toBe(true);
  });
});

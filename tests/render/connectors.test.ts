// Connectors are drawn over the rooms they cover: stairs and escalators keep their
// treads, rails and outline but lose the backing fill, so the room behind stays visible.
// The textures are baked through a stub renderer and the rectangles recorded, so this
// needs no GPU. See docs/DESIGN.md section 2.

import { afterEach, describe, expect, it } from 'vitest';
import { Graphics, Rectangle } from 'pixi.js';
import type { Renderer as PixiRenderer, Texture } from 'pixi.js';
import { FLOOR_PX, LINE_PX, TILE_PX, createArt } from '../../src/render/art';
import { drawsOverRooms } from '../../src/render/renderer';
import type { RoomKind } from '../../src/sim/types';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const originalRect = Graphics.prototype.rect;

afterEach(() => {
  Graphics.prototype.rect = originalRect;
});

/** Bakes one room texture and returns every rectangle drawn into it. */
function bakeRoom(kind: RoomKind, tiles: number, floors: number): Rect[] {
  const rects: Rect[] = [];
  Graphics.prototype.rect = function patched(this: Graphics, x: number, y: number, w: number, h: number) {
    rects.push({ x, y, w, h });
    return originalRect.call(this, x, y, w, h);
  };
  const renderer = {
    generateTexture(_options: { frame: Rectangle }): Texture {
      return {} as Texture;
    },
  } as unknown as PixiRenderer;
  createArt(renderer).room(kind, tiles, floors, 0, false);
  Graphics.prototype.rect = originalRect;
  return rects;
}

/** Rectangles that cover the whole texture: the opaque backing a room is built on. */
function fullCover(rects: readonly Rect[], w: number, h: number): Rect[] {
  return rects.filter((r) => r.x <= 0 && r.y <= 0 && r.w >= w && r.h >= h);
}

/** Rectangles as wide as the texture and thicker than an outline: a wall or a slab band. */
function fullWidthBands(rects: readonly Rect[], w: number): Rect[] {
  return rects.filter((r) => r.x <= 0 && r.w >= w && r.h > LINE_PX);
}

describe('connector art is an overlay', () => {
  it('backs an office with an opaque fill', () => {
    const w = 9 * TILE_PX;
    const h = FLOOR_PX;
    expect(fullCover(bakeRoom('office', 9, 1), w, h)).toHaveLength(1);
  });

  it('draws stairs and escalators with no backing fill and no slab band', () => {
    const w = 8 * TILE_PX;
    const h = 2 * FLOOR_PX;
    for (const kind of ['stairs', 'escalator'] as const) {
      const rects = bakeRoom(kind, 8, 2);
      expect(fullCover(rects, w, h)).toHaveLength(0);
      expect(fullWidthBands(rects, w)).toHaveLength(0);
      // the treads, rails, landings and the cell outline are all still there
      expect(rects.length).toBeGreaterThan(20);
      expect(rects.some((r) => r.x === 0 && r.y === 0 && r.w === w && r.h === LINE_PX)).toBe(true);
    }
  });
});

describe('connector layering', () => {
  it('puts stairs and escalators on the layer above the rooms', () => {
    expect(drawsOverRooms('stairs')).toBe(true);
    expect(drawsOverRooms('escalator')).toBe(true);
    for (const kind of ['office', 'lobby', 'skyLobby', 'condo', 'shop'] as const) {
      expect(drawsOverRooms(kind)).toBe(false);
    }
  });
});

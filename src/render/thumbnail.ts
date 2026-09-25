// Palette thumbnails: a room as the world draws it by day, or a one floor shaft, as a plain
// canvas the DOM palette can draw from. The renderer owns the one Art instance, so this borrows
// it rather than making another (a second Art would bake a second cache).
//
// Since package 8b a room is two layers in the world, the structural shell and the illustrated
// interior over it (interiors.ts), so a thumbnail is the same two composited: the palette shows
// the room the player will get. Stairs and escalators are their illustrated flight alone, and a
// one tile room (the lobby and sky lobby segments) is a short run of tiles in its rhythm.
//
// Each kind is composited once and kept. The textures are asked for on every call, which is a
// cache lookup inside Art, and the canvas is made again only if Art hands back a different
// texture (its cache was rebuilt), so a stale picture cannot outlive its art.

import type { Texture } from 'pixi.js';
import { ROOMS, SHAFTS } from '../sim/rules';
import type { RoomKind, ShaftKind } from '../sim/types';
import { VENUE_SHELL, type Art } from './art';
import { FLOOR_PX, TILE_PX } from './grid';
import { DECOR, INTERIORS, lookOf } from './interiors';

export type ThumbnailKind = RoomKind | ShaftKind;

export interface ThumbnailDeps {
  /** The renderer's Art, read at call time. */
  art: () => Art;
  /** Pixels of a baked texture, at the texture's own resolution. The renderer's extract.canvas. */
  extract: (texture: Texture) => HTMLCanvasElement;
  /** A blank canvas to composite on; the DOM's by default, a fake in the tests. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement;
}

/**
 * A one tile room (the lobby and sky lobby segments, which are laid in runs) is shown as a
 * run of this many tiles, so its thumbnail is a strip of lobby rather than a two pixel sliver.
 */
export const THUMBNAIL_MIN_TILES = 4;

/** One texture in a thumbnail, placed in logical px from the room's top left. */
export interface ThumbnailLayer {
  texture: Texture;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Illustrated layers are smoothed as they are scaled; structural ones keep their pixels. */
  smooth: boolean;
}

export interface ThumbnailPlan {
  /** The whole picture, logical px. */
  width: number;
  height: number;
  layers: ThumbnailLayer[];
}

/**
 * What a kind's thumbnail is made of: a room at its rule size by day, its shell and then its
 * illustrated interior in the first variant, or one floor of shaft.
 */
export function thumbnailPlan(art: Art, kind: ThumbnailKind): ThumbnailPlan {
  if (kind in SHAFTS) {
    const texture = art.shaft(kind as ShaftKind, 1);
    const w = SHAFTS[kind as ShaftKind].width * TILE_PX;
    return { width: w, height: FLOOR_PX, layers: [{ texture, x: 0, y: 0, w, h: FLOOR_PX, smooth: false }] };
  }
  const room = kind as RoomKind;
  const rule = ROOMS[room];
  const tiles = rule.width === 1 ? THUMBNAIL_MIN_TILES : rule.width;
  const floors = rule.height;
  const width = tiles * TILE_PX;
  const height = floors * FLOOR_PX;
  const spec = INTERIORS[room];
  const layers: ThumbnailLayer[] = [];
  if (!(spec.overlay && art.interior)) {
    layers.push({ texture: art.room(room, tiles, floors, art.interior ? VENUE_SHELL : 0, 'day'), x: 0, y: 0, w: width, h: height, smooth: false });
  }
  if (art.interior) {
    const band = spec.band(floors);
    if (rule.width === 1) {
      // A run of single tiles, each in its place in the rhythm, as a lobby is laid.
      for (let i = 0; i < tiles; i++) {
        layers.push({ texture: art.interior(room, 1, floors, i), x: i * TILE_PX, y: band.top, w: TILE_PX, h: band.height, smooth: true });
      }
    } else {
      const look = lookOf(room, 0);
      layers.push({ texture: art.interior(room, tiles, floors, look.base), x: 0, y: band.top, w: width, h: band.height, smooth: true });
      // The first look's plants and frames, as a room of that look shows them (no painted wall).
      if (art.decor) {
        for (const p of look.decor) {
          const piece = DECOR[p.piece];
          layers.push({ texture: art.decor(p.piece, true), x: p.x, y: p.y, w: piece.w, h: piece.h, smooth: true });
        }
      }
    }
  }
  return { width, height, layers };
}

/**
 * An illustrated texture is a canvas already (art.ts paint): draw from it as it is. Reading it
 * back through the GPU would only copy it, and a texture not yet uploaded reads back blank.
 */
function canvasOf(texture: Texture): HTMLCanvasElement | null {
  const resource = (texture.source as { resource?: unknown } | undefined)?.resource;
  if (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) return resource;
  return null;
}

function domCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createThumbnails(deps: ThumbnailDeps): (kind: ThumbnailKind) => HTMLCanvasElement {
  const cache = new Map<ThumbnailKind, { textures: Texture[]; canvas: HTMLCanvasElement }>();
  const makeCanvas = deps.createCanvas ?? domCanvas;
  return (kind) => {
    const plan = thumbnailPlan(deps.art(), kind);
    const textures = plan.layers.map((l) => l.texture);
    const hit = cache.get(kind);
    if (hit && hit.textures.length === textures.length && hit.textures.every((t, i) => t === textures[i])) return hit.canvas;
    const sources = plan.layers.map((l) => canvasOf(l.texture) ?? deps.extract(l.texture));
    // Composite at the sharpest layer's own scale, so the illustrated interior keeps its detail.
    let scale = 1;
    plan.layers.forEach((l, i) => {
      const src = sources[i] as HTMLCanvasElement;
      if (l.w > 0 && src.width > 0) scale = Math.max(scale, src.width / l.w);
    });
    let canvas: HTMLCanvasElement;
    if (plan.layers.length === 1) {
      canvas = sources[0] as HTMLCanvasElement;
    } else {
      canvas = makeCanvas(Math.round(plan.width * scale), Math.round(plan.height * scale));
      const ctx = canvas.getContext?.('2d');
      if (ctx) {
        plan.layers.forEach((l, i) => {
          ctx.imageSmoothingEnabled = l.smooth;
          ctx.drawImage(sources[i] as HTMLCanvasElement, l.x * scale, l.y * scale, l.w * scale, l.h * scale);
        });
      }
    }
    cache.set(kind, { textures, canvas });
    return canvas;
  };
}

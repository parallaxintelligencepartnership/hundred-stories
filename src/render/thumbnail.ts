// Palette thumbnails: the daytime room art, or a one floor shaft, as a plain canvas the DOM
// palette can draw from. The renderer owns the one Art instance, so this borrows it rather
// than making another (a second Art would bake a second cache).
//
// Each kind is extracted from the GPU once and kept. The texture is asked for on every call,
// which is a cache lookup inside Art, and the canvas is extracted again only if Art hands back
// a different texture (its cache was rebuilt), so a stale picture cannot outlive its art.

import type { Texture } from 'pixi.js';
import { ROOMS, SHAFTS } from '../sim/rules';
import type { RoomKind, ShaftKind } from '../sim/types';
import type { Art } from './art';

export type ThumbnailKind = RoomKind | ShaftKind;

export interface ThumbnailDeps {
  /** The renderer's Art, read at call time. */
  art: () => Art;
  /** Pixels of a baked texture, at the texture's own resolution. The renderer's extract.canvas. */
  extract: (texture: Texture) => HTMLCanvasElement;
}

/**
 * A one tile room (the lobby and sky lobby segments, which are laid in runs) is shown as a
 * run of this many tiles, so its thumbnail is a strip of lobby rather than a two pixel sliver.
 */
export const THUMBNAIL_MIN_TILES = 4;

/** The texture a kind's thumbnail is cut from: a room at its rule size by day, or one floor of shaft. */
export function thumbnailTexture(art: Art, kind: ThumbnailKind): Texture {
  if (kind in SHAFTS) return art.shaft(kind as ShaftKind, 1);
  const rule = ROOMS[kind as RoomKind];
  const width = rule.width === 1 ? THUMBNAIL_MIN_TILES : rule.width;
  return art.room(kind as RoomKind, width, rule.height, 0, 'day');
}

export function createThumbnails(deps: ThumbnailDeps): (kind: ThumbnailKind) => HTMLCanvasElement {
  const cache = new Map<ThumbnailKind, { texture: Texture; canvas: HTMLCanvasElement }>();
  return (kind) => {
    const texture = thumbnailTexture(deps.art(), kind);
    const hit = cache.get(kind);
    if (hit && hit.texture === texture) return hit.canvas;
    const canvas = deps.extract(texture);
    // The palette scales these down; nearest neighbour keeps the pixel art from smearing.
    const context = canvas.getContext?.('2d');
    if (context) context.imageSmoothingEnabled = false;
    cache.set(kind, { texture, canvas });
    return canvas;
  };
}

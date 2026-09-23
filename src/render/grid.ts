// The base pixel grid every drawer and every world to screen mapping is built on.
// Since 0.4.0 a tile is 16 px wide and a floor 72 px tall (twice the 0.3 grid), so a room
// has a real interior at zoom 1. Nothing outside this file may assume a pixel size.

export const TILE_PX = 16;
export const FLOOR_PX = 72;

/** Every silhouette, cell outline and mullion is this thick. */
export const LINE_PX = 2;

/** The slab is the bottom SLAB_PX of a floor band: a SLAB_EDGE_PX dark top edge over the deck. */
export const SLAB_PX = 6;
export const SLAB_EDGE_PX = 2;
/** The slab casts a soft shadow this tall over the top of the floor below it. */
export const SLAB_SHADOW_PX = 4;
export const SLAB_SHADOW_ALPHA = 0.25;

/** The window band, per floor: a head rail, a row of panes one per tile, and a sill. */
export const WIN_TOP = 4; // head rail, 2 px
export const WIN_PANE = 12; // pane width and height
export const WIN_PANE_TOP = 6; // first row of glass
export const WIN_PANE_X = 2; // pane n sits at x = WIN_PANE_X + TILE_PX * n
export const WIN_SILL = WIN_PANE_TOP + WIN_PANE; // 18, the sill runs y 18 to 19
/** First free row under the windows, for kinds with a window band. */
export const INTERIOR_TOP = WIN_SILL + LINE_PX + 2; // 22
/** First free row for a kind with no window band. */
export const OPEN_TOP = 4;

/** Two-tone walls: the rightmost interior strip is a shadow face this wide (half that for a lobby tile). */
export const WALL_SHADOW_PX = 8;
export const LOBBY_SHADOW_PX = 4;

/** A person is one tile wide and three tall, the way the original's people read. */
export const SIM_W = TILE_PX;
export const SIM_H = 3 * TILE_PX;

/** A car is inset from its shaft and clear of the slab above; the cast shadow sits on top of it. */
export const CAR_INSET_PX = 8;
export const CAR_CLEAR_PX = 12;
export const CAR_SHADOW_PX = 4;

/**
 * The resolution textures are baked at and the renderer draws at: the device pixel ratio,
 * rounded to 1 or 2. Fixed for the life of a renderer, so the art cache needs no key for it.
 */
export function bakeResolution(devicePixelRatio: number | undefined): 1 | 2 {
  const dpr = Number.isFinite(devicePixelRatio) && (devicePixelRatio as number) > 0 ? (devicePixelRatio as number) : 1;
  return Math.min(Math.max(Math.round(dpr), 1), 2) as 1 | 2;
}

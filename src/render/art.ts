// Procedural pixel art for the tower cross section. See docs/VISUAL.md and docs/DESIGN.md section 9.
// No image assets: every texture is baked from Graphics primitives once and cached by key.
//
// The grid is 16 px tiles and 72 px floors (grid.ts), drawn on integer pixels with antialias
// off and baked at the device pixel ratio rounded to 1 or 2, so the art stays crisp at the
// snapped zoom steps (0.5, 1, 2, 3). Geometry follows docs/reviews/2026-09-22-codex-astra-ui-graphics.md
// section 1: a 2 px outline, a slab at y 66 to 71 with a 2 px edge and a 4 px cast shadow,
// two-tone walls, 12 by 12 panes one per tile.
//
// Two classes of drawer. Native (this file): the shell of every room, the structure pieces,
// office, the three hotel rooms, cars, people, shafts, the ghost. Half grid (art-2x.ts): the
// interiors of the other fourteen kinds, drawn through a 2x scale inside the native shell until
// ship L3 re-authors them.

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Renderer, Texture } from 'pixi.js';
import type { RoomKind, ShaftKind, SimKind, StressBand } from '../sim/types';
import { SHAFTS } from '../sim/rules';
import { HALF_KINDS, HALF_SCALE, drawHalfInterior } from './art-2x';
import {
  CAR_CLEAR_PX,
  CAR_INSET_PX,
  CAR_SHADOW_PX,
  FLOOR_PX,
  INTERIOR_TOP,
  LINE_PX,
  LOBBY_SHADOW_PX,
  SIM_H,
  SIM_W,
  SLAB_EDGE_PX,
  SLAB_PX,
  SLAB_SHADOW_ALPHA,
  SLAB_SHADOW_PX,
  TILE_PX,
  WALL_SHADOW_PX,
  WIN_PANE,
  WIN_PANE_TOP,
  WIN_PANE_X,
  WIN_SILL,
  WIN_TOP,
  bakeResolution,
} from './grid';
import { INK, PALETTE, wallShadow } from './palette';

export {
  CAR_CLEAR_PX,
  CAR_INSET_PX,
  CAR_SHADOW_PX,
  FLOOR_PX,
  LINE_PX,
  SIM_H,
  SIM_W,
  SLAB_PX,
  SLAB_SHADOW_PX,
  TILE_PX,
  bakeResolution,
};

export interface Art {
  room(kind: RoomKind, width: number, height: number, variant: number, lit: boolean): Texture;
  slab(widthTiles: number): Texture;
  shaft(kind: ShaftKind, floors: number): Texture;
  car(kind: ShaftKind, doorsOpen: boolean): Texture;
  sim(kind: SimKind, band: StressBand, frame: 0 | 1): Texture;
  ghost(widthTiles: number, heightFloors: number, ok: boolean): Texture;
}

/** Texture sizes, in logical pixels, so the renderer and the tests share one rule. */
export const TEXTURE_SIZE = {
  room: (tiles: number, floors: number) => ({ width: tiles * TILE_PX, height: floors * FLOOR_PX }),
  slab: (tiles: number) => ({ width: tiles * TILE_PX, height: SLAB_PX + SLAB_SHADOW_PX }),
  shaft: (kind: ShaftKind, floors: number) => ({ width: SHAFTS[kind].width * TILE_PX, height: floors * FLOOR_PX }),
  car: (kind: ShaftKind) => ({
    width: SHAFTS[kind].width * TILE_PX - CAR_INSET_PX,
    height: FLOOR_PX - CAR_CLEAR_PX + CAR_SHADOW_PX,
  }),
  sim: () => ({ width: SIM_W, height: SIM_H }),
  ghost: (tiles: number, floors: number) => ({ width: tiles * TILE_PX, height: floors * FLOOR_PX }),
} as const;

type WindowMood = 'glass' | 'none';

const WINDOWS: Record<RoomKind, WindowMood> = {
  lobby: 'glass',
  skyLobby: 'glass',
  stairs: 'none', // the diagonal needs the full height, the way the original draws a stair well
  escalator: 'none',
  office: 'glass',
  condo: 'glass',
  hotelSingle: 'glass',
  hotelTwin: 'glass',
  hotelSuite: 'glass',
  fastFood: 'glass',
  restaurant: 'glass',
  shop: 'glass',
  cinema: 'none', // a cinema is a dark box: the screen and the projector carry the light
  partyHall: 'glass',
  medical: 'glass',
  security: 'glass',
  housekeeping: 'glass',
  parkingRamp: 'none',
  parkingSpace: 'none',
  recycling: 'none',
  metro: 'none',
  cathedral: 'none', // tall stained windows are drawn by the cathedral interior itself
};

/**
 * Connectors are overlays: they are drawn above the rooms they cover, so they get no
 * wall fill and no slab band. Only their treads, rails, landings and outline are drawn,
 * and the room behind shows through everything else.
 */
export const OVERLAY_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['stairs', 'escalator']);

// Kinds whose interior is drawn once across the whole height instead of once per floor.
const FULL_HEIGHT: ReadonlySet<RoomKind> = new Set<RoomKind>([
  'skyLobby',
  'stairs',
  'escalator',
  'cinema',
  'partyHall',
  'recycling',
  'metro',
  'cathedral',
]);

/** Lobby tiles are one tile wide, so their shadow face is half the usual strip. */
const LOBBY_KINDS: ReadonlySet<RoomKind> = new Set<RoomKind>(['lobby', 'skyLobby']);

/** The interior baseline: the first row of the slab, measured from the top of a floor band. */
const BASE = FLOOR_PX - SLAB_PX; // 66

// ---------------------------------------------------------------------------
// Primitives. Lines default to LINE_PX; a 1 px argument is a native highlight.
// ---------------------------------------------------------------------------

function box(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw <= 0 || rh <= 0) return;
  g.rect(rx, ry, rw, rh).fill({ color, alpha });
}

function stripe(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number, width = LINE_PX): void {
  g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width, alignment: 0.5, cap: 'butt' });
}

function outline(g: Graphics, x: number, y: number, w: number, h: number, color: number, t = LINE_PX): void {
  box(g, x, y, w, t, color);
  box(g, x, y + h - t, w, t, color);
  box(g, x, y, t, h, color);
  box(g, x + w - t, y, t, h, color);
}

/** A filled shape with a line around it: the unit every piece of furniture is built from. */
function panel(g: Graphics, x: number, y: number, w: number, h: number, fill: number, ink = INK): void {
  box(g, x, y, w, h, fill);
  outline(g, x, y, w, h, ink);
}

function hline(g: Graphics, x: number, y: number, w: number, color = INK, t = LINE_PX): void {
  box(g, x, y, w, t, color);
}

function vline(g: Graphics, x: number, y: number, h: number, color = INK, t = LINE_PX): void {
  box(g, x, y, t, h, color);
}

// ---------------------------------------------------------------------------
// Shared native furniture. Every piece is drawn from its baseline `by`, the first row of
// the slab, so it sits on the floor in whichever band it lands.
// ---------------------------------------------------------------------------

function plantIcon(g: Graphics, x: number, by: number): void {
  const leaf = PALETTE.detail.leaf;
  box(g, x + 4, by - 28, 6, 2, leaf);
  box(g, x + 2, by - 26, 10, 2, leaf);
  box(g, x, by - 24, 14, 2, leaf);
  box(g, x + 2, by - 22, 10, 2, leaf);
  box(g, x + 4, by - 20, 6, 2, leaf);
  box(g, x + 3, by - 25, 2, 1, PALETTE.detail.leafLight); // light catching the top leaves
  box(g, x + 8, by - 23, 2, 1, PALETTE.detail.leafLight);
  vline(g, x + 6, by - 20, 10, PALETTE.detail.woodDark);
  panel(g, x + 2, by - 10, 10, 10, PALETTE.detail.pot);
  hline(g, x + 4, by - 8, 6, PALETTE.detail.woodLight, 1); // the pot's rim
}

function picture(g: Graphics, x: number, y: number, w: number, h: number, sky: number): void {
  panel(g, x, y, w, h, PALETTE.detail.gold);
  box(g, x + 2, y + 2, w - 4, h - 4, sky);
  box(g, x + 2, y + h - 6, w - 4, 4, PALETTE.detail.leaf); // ground
  box(g, x + 6, y + h - 10, 6, 4, PALETTE.detail.stoneDark); // a hill in the middle distance
  box(g, x + 7, y + h - 11, 4, 1, PALETTE.detail.stoneDark);
}

function wallClock(g: Graphics, x: number, y: number): void {
  box(g, x + 2, y, 6, 2, INK);
  box(g, x, y + 2, 2, 6, INK);
  box(g, x + 8, y + 2, 2, 6, INK);
  box(g, x + 2, y + 8, 6, 2, INK);
  box(g, x + 1, y + 1, 1, 1, INK); // the corners round it off
  box(g, x + 8, y + 1, 1, 1, INK);
  box(g, x + 1, y + 8, 1, 1, INK);
  box(g, x + 8, y + 8, 1, 1, INK);
  box(g, x + 2, y + 2, 6, 6, PALETTE.detail.linen);
  box(g, x + 4, y + 3, 1, 3, INK); // hands, one pixel thin
  box(g, x + 4, y + 5, 3, 1, INK);
}

function floorLampIcon(g: Graphics, x: number, by: number, lit: boolean): void {
  box(g, x + 2, by - 4, 12, 4, PALETTE.detail.metalDark);
  hline(g, x + 2, by - 4, 12);
  box(g, x + 7, by - 32, 2, 28, PALETTE.detail.metal);
  hline(g, x + 4, by - 42, 8); // shade top
  box(g, x + 2, by - 40, 12, 8, lit ? PALETTE.windowLit : PALETTE.detail.linen);
  vline(g, x + 2, by - 40, 8);
  vline(g, x + 12, by - 40, 8);
  hline(g, x, by - 32, 16);
  if (lit) box(g, x + 4, by - 38, 8, 1, PALETTE.carLight);
}

function tableLamp(g: Graphics, x: number, by: number, lit: boolean): void {
  box(g, x + 2, by - 2, 6, 2, PALETTE.detail.metalDark); // foot
  box(g, x + 4, by - 8, 2, 6, PALETTE.detail.metal); // stem
  box(g, x + 1, by - 14, 8, 2, INK); // shade, narrower at the top
  box(g, x, by - 12, 10, 4, lit ? PALETTE.windowLit : PALETTE.detail.linen);
  hline(g, x, by - 8, 10);
  vline(g, x, by - 12, 4, INK, 1);
  vline(g, x + 9, by - 12, 4, INK, 1);
}

function monitorIcon(g: Graphics, x: number, by: number, w: number, h: number, lit: boolean): void {
  panel(g, x, by - h, w, h, PALETTE.detail.metalDark);
  box(g, x + 2, by - h + 2, w - 4, h - 6, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  if (lit) box(g, x + 2, by - h + 2, w - 4, 2, PALETTE.carLight); // the glow off the top of the tube
  else box(g, x + 3, by - h + 3, 2, 1, PALETTE.detail.metal); // a glint on the dark glass
  box(g, x + w - 5, by - 3, 2, 1, lit ? PALETTE.detail.led : PALETTE.detail.metal); // power light
}

function officeChair(g: Graphics, x: number, by: number, color: number): void {
  panel(g, x + 2, by - 34, 8, 20, color); // padded back
  vline(g, x + 4, by - 32, 16, 0xffffff, 1); // a seam down the pad
  panel(g, x, by - 16, 12, 6, color); // seat
  vline(g, x + 4, by - 10, 8, PALETTE.detail.metalDark); // gas post
  hline(g, x, by - 2, 12); // star base
  box(g, x, by - 4, 4, 2, INK); // casters
  box(g, x + 8, by - 4, 4, 2, INK);
}

function deskWithMonitor(g: Graphics, x: number, by: number, lit: boolean, chairColor: number): void {
  monitorIcon(g, x + 2, by - 20, 14, 14, lit);
  box(g, x, by - 20, 20, 4, PALETTE.detail.wood); // desk top
  hline(g, x, by - 20, 20);
  hline(g, x + 2, by - 18, 16, PALETTE.detail.woodLight, 1); // grain along the top
  box(g, x + 17, by - 24, 2, 4, PALETTE.detail.linen); // a mug
  vline(g, x + 2, by - 16, 16, PALETTE.detail.woodDark);
  vline(g, x + 16, by - 16, 16, PALETTE.detail.woodDark);
  officeChair(g, x + 20, by, chairColor);
}

function bedIcon(g: Graphics, x: number, by: number, w: number, v: number, headLeft = true): void {
  const blanket = v === 0 ? PALETTE.detail.blanketA : PALETTE.detail.blanketB;
  const hb = 8;
  const hx = headLeft ? x : x + w - hb;
  box(g, hx, by - 32, hb, 32, PALETTE.detail.wood); // headboard
  hline(g, hx, by - 32, hb);
  vline(g, headLeft ? hx : hx + hb - LINE_PX, by - 32, 32); // only the outer edge is inked
  vline(g, headLeft ? hx + hb - LINE_PX : hx, by - 32, 12); // the board reads above the mattress
  hline(g, hx + 2, by - 28, hb - 4, PALETTE.detail.woodDark); // a rail across the board
  hline(g, hx + 2, by - 24, hb - 4, PALETTE.detail.woodLight, 1);
  const mx = headLeft ? x + hb : x;
  const mw = w - hb;
  panel(g, mx, by - 12, mw, 12, PALETTE.detail.woodDark); // base
  panel(g, mx, by - 20, mw, 10, PALETTE.detail.linen); // mattress and sheet
  const pw = Math.min(12, Math.max(6, mw - 12));
  const px = headLeft ? mx + 2 : mx + mw - pw - 2;
  panel(g, px, by - 26, pw, 6, PALETTE.detail.pillow);
  hline(g, px + 2, by - 23, pw - 4, PALETTE.detail.marbleVein, 1); // the dent in the pillow
  const bw = Math.min(20, Math.max(6, mw - 16));
  const bx = headLeft ? mx + mw - bw - 2 : mx + 2;
  box(g, bx, by - 18, bw, 6, blanket);
  hline(g, bx, by - 18, bw);
  hline(g, bx, by - 16, bw, PALETTE.detail.linen, 1); // the turned down sheet
}

function sofaIcon(g: Graphics, x: number, by: number, w: number, back: number, seat: number): void {
  panel(g, x + 6, by - 28, w - 12, 16, back); // backrest
  panel(g, x, by - 22, 8, 22, back); // arms
  panel(g, x + w - 8, by - 22, 8, 22, back);
  panel(g, x + 6, by - 14, w - 12, 14, seat); // cushions
  const half = Math.max(16, Math.floor((w - 12) / 4) * 2);
  for (let cx = x + 6 + half; cx < x + w - 10; cx += half) vline(g, cx, by - 12, 10);
  hline(g, x + 8, by - 12, w - 16, 0xffffff, 1); // light along the cushion fronts
}

function lowTable(g: Graphics, x: number, by: number, w: number, v: number): void {
  box(g, x, by - 12, w, 4, PALETTE.detail.wood);
  hline(g, x, by - 12, w);
  hline(g, x + 2, by - 10, w - 4, PALETTE.detail.woodLight, 1);
  vline(g, x + 2, by - 8, 8, PALETTE.detail.woodDark);
  vline(g, x + w - 4, by - 8, 8, PALETTE.detail.woodDark);
  const cx = x + Math.floor(w / 4) * 2 - 2;
  box(g, cx, by - 18, 6, 6, v === 0 ? PALETTE.detail.leaf : PALETTE.detail.cross);
  hline(g, cx, by - 18, 6);
}

const NIGHTSTAND_W = 10;
const TV_W = 14;

function nightstand(g: Graphics, x: number, by: number, lit: boolean): void {
  panel(g, x, by - 16, NIGHTSTAND_W, 16, PALETTE.detail.wood);
  hline(g, x + 2, by - 10, NIGHTSTAND_W - 4, PALETTE.detail.woodDark); // drawer
  box(g, x + 4, by - 7, 2, 1, PALETTE.detail.gold); // its knob
  tableLamp(g, x, by - 16, lit);
}

function smallTv(g: Graphics, x: number, by: number, lit: boolean): void {
  panel(g, x + 2, by - 10, TV_W - 4, 10, PALETTE.detail.wood); // stand
  monitorIcon(g, x, by - 10, TV_W, 16, lit);
}

// ---------------------------------------------------------------------------
// Room shell: two-tone wall, window band per floor, floor slabs
// ---------------------------------------------------------------------------

function drawWindowBand(g: Graphics, kind: RoomKind, y0: number, w: number, lit: boolean, shadeFrom: number): void {
  if (WINDOWS[kind] === 'none') return;
  hline(g, 0, y0 + WIN_TOP, w); // head rail
  hline(g, 0, y0 + WIN_SILL, w); // sill
  const gy = y0 + WIN_PANE_TOP;
  for (let x = WIN_PANE_X; x + WIN_PANE + LINE_PX <= w; x += TILE_PX) {
    if (lit) {
      box(g, x, gy, WIN_PANE, WIN_PANE, PALETTE.windowLit);
      box(g, x, gy, WIN_PANE, 2, PALETTE.carLight); // the lamp light pooling at the head
    } else {
      // The renderer only knows lit or unlit, so an unlit pane keeps the day sky in it
      // with the deep unlit blue pooling along the bottom.
      box(g, x, gy, WIN_PANE, WIN_PANE, PALETTE.windowDay);
      box(g, x, gy + WIN_PANE - 4, WIN_PANE, 4, PALETTE.windowUnlit);
      box(g, x + 2, gy + 2, 3, 1, 0xffffff, 0.55); // a glint in the top corner
      box(g, x + 2, gy + 3, 1, 2, 0xffffff, 0.55);
    }
    vline(g, x - LINE_PX, gy, WIN_PANE); // mullions
    vline(g, x + WIN_PANE, gy, WIN_PANE);
  }
  // Glass on the shadow face sits in the same shade as the wall around it.
  if (shadeFrom < w) box(g, shadeFrom, gy, w - LINE_PX - shadeFrom, WIN_PANE, INK, 0.14);
}

function drawShell(g: Graphics, kind: RoomKind, w: number, h: number, lit: boolean): void {
  // An overlay has no shell at all: the wall and the slab would hide the room behind it.
  // The floor under it is already drawn by the slab layer and the floor strip.
  if (OVERLAY_KINDS.has(kind)) return;
  box(g, 0, 0, w, h, PALETTE.wall[kind]);
  const shadowW = LOBBY_KINDS.has(kind) ? LOBBY_SHADOW_PX : WALL_SHADOW_PX;
  const shadeFrom = w - LINE_PX - shadowW;
  box(g, shadeFrom, 0, shadowW, h, wallShadow(kind)); // the shadow face
  const floors = Math.max(1, Math.round(h / FLOOR_PX));
  const perFloorSlabs = !FULL_HEIGHT.has(kind);
  for (let f = 0; f < floors; f++) {
    const y0 = f * FLOOR_PX;
    drawWindowBand(g, kind, y0, w, lit, shadeFrom);
    if (perFloorSlabs || f === floors - 1) {
      const sy = y0 + BASE;
      box(g, 0, sy, w, SLAB_PX, PALETTE.slab);
      box(g, 0, sy, w, SLAB_EDGE_PX, PALETTE.slabEdge);
    }
  }
}

function drawCellOutline(g: Graphics, w: number, h: number, floors: number, perFloor: boolean): void {
  if (perFloor) for (let f = 0; f < floors; f++) outline(g, 0, f * FLOOR_PX, w, FLOOR_PX, PALETTE.outline);
  else outline(g, 0, 0, w, h, PALETTE.outline);
}

// ---------------------------------------------------------------------------
// Native interiors. y0 is the top of the band to fill, `by` the baseline (first row of the
// slab), `ty` the first free row under the windows.
// ---------------------------------------------------------------------------

function drawNativeInterior(g: Graphics, kind: RoomKind, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + INTERIOR_TOP;
  switch (kind) {
    case 'lobby':
      drawLobby(g, y0, w, h, v, lit);
      break;
    case 'skyLobby':
      drawSkyLobby(g, y0, w, h, v, lit);
      break;
    case 'stairs':
      drawStairs(g, y0, w, h, v, lit);
      break;
    case 'escalator':
      drawEscalator(g, y0, w, h, v, lit);
      break;
    case 'office':
      drawOffice(g, by, ty, w, v, lit);
      break;
    case 'hotelSingle':
      drawHotelSingle(g, by, ty, w, v, lit);
      break;
    case 'hotelTwin':
      drawHotelTwin(g, by, ty, w, v, lit);
      break;
    case 'hotelSuite':
      drawHotelSuite(g, by, ty, w, v, lit);
      break;
    default:
      break; // the half grid kinds are drawn by art-2x.ts
  }
}

// --- office -----------------------------------------------------------------
// Left to right: a low partition line, three desks with monitors and chairs, a filing
// cabinet at the right end, a wall clock above it. Desks at x 14, 50, 86 on a 144 px office.

function drawOffice(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const cabX = w - 20;
  const deskStep = 36;
  const desks = Math.max(1, Math.min(3, Math.floor((cabX - 12) / deskStep)));
  const chairColor = v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB;
  for (let i = 0; i < desks; i++) {
    const x = 14 + i * deskStep;
    if (x + 34 > cabX - 2) break;
    vline(g, x - 4, by - 26, 26); // the low partition between the bays
    hline(g, x - 6, by - 26, 6);
    deskWithMonitor(g, x, by, lit, chairColor);
  }
  if (cabX > 24) {
    panel(g, cabX, by - 30, 16, 30, PALETTE.detail.metal); // filing cabinet
    for (let i = 0; i < 3; i++) {
      hline(g, cabX, by - 22 + i * 8, 16);
      box(g, cabX + 6, by - 26 + i * 8, 4, 2, INK); // drawer handle
    }
    box(g, cabX + 2, by - 28, 12, 1, 0xffffff, 0.35); // light on the cabinet top
    wallClock(g, cabX + 2, ty);
  }
  if (v === 1 && cabX > 40) picture(g, 4, ty, 18, 14, PALETTE.detail.glass);
}

// --- hotel ------------------------------------------------------------------
// Single: bed at x 4, 32 wide with an 8 by 32 headboard; nightstand at (36, 50); TV at (48, 40).

function drawHotelSingle(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.max(24, w - 32);
  bedIcon(g, 4, by, bedW, v);
  const nx = 4 + bedW;
  if (nx + NIGHTSTAND_W <= w - TV_W - 4) nightstand(g, nx, by, lit);
  smallTv(g, w - TV_W - 2, by, lit);
  if (v === 1 && w >= 88) picture(g, 8, ty, 20, 16, PALETTE.detail.curtain);
}

function drawHotelTwin(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.max(24, Math.floor((w - 28) / 4) * 2);
  bedIcon(g, 4, by, bedW, v);
  bedIcon(g, 8 + bedW, by, bedW, v === 0 ? 1 : 0);
  const nx = 12 + bedW * 2;
  if (nx + NIGHTSTAND_W <= w - LINE_PX) {
    nightstand(g, nx, by, lit);
    picture(g, nx - 2, ty, 14, 12, PALETTE.detail.glass);
  }
}

function drawHotelSuite(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.min(52, Math.max(28, Math.floor(w * 0.16) * 2));
  bedIcon(g, 4, by, bedW, v);
  let x = bedW + 6;
  if (x + NIGHTSTAND_W <= w - 80) {
    nightstand(g, x, by, lit);
    x += NIGHTSTAND_W + 6;
  }
  const sofaW = Math.min(48, w - x - 50);
  if (sofaW >= 28) {
    sofaIcon(g, x, by, sofaW, PALETTE.detail.chairA, v === 0 ? PALETTE.detail.chairB : PALETTE.detail.seatA);
    picture(g, x + 6, ty, Math.min(28, sofaW - 12), 16, v === 0 ? PALETTE.detail.glass : PALETTE.detail.curtain);
    x += sofaW + 4;
  }
  if (x + 24 <= w - 22) {
    lowTable(g, x, by, 22, v);
    x += 24;
  }
  floorLampIcon(g, w - 18, by, lit);
}

// --- lobby, sky lobby, stairs, escalator -------------------------------------

function marbleFloor(g: Graphics, by: number, w: number, narrow: boolean): void {
  box(g, 0, by - 12, w, 12, PALETTE.detail.marble);
  hline(g, 0, by - 12, w, PALETTE.detail.marbleVein);
  if (narrow) {
    // a one tile segment is all joint and no floor if it keeps the joints, so it gets flecks
    box(g, 4, by - 7, 3, 1, PALETTE.detail.marbleVein);
    box(g, 10, by - 4, 2, 1, PALETTE.detail.marbleVein);
    return;
  }
  for (let x = 12; x < w - 4; x += 20) vline(g, x, by - 10, 10, PALETTE.detail.marbleVein);
}

function columnPair(g: Graphics, x: number, top: number, bot: number): void {
  for (const cx of [x, x + 8]) {
    box(g, cx, top + 4, 6, bot - top - 8, PALETTE.detail.column);
    vline(g, cx + 1, top + 4, bot - top - 8, PALETTE.detail.columnLight, 1); // fluting
    box(g, cx - 2, top, 10, 4, PALETTE.detail.column); // capital
    box(g, cx - 2, bot - 4, 10, 4, PALETTE.detail.column); // base
  }
}

/** One tile of a lobby run. The run alternates variant every six tiles, so a variant has
 *  to tile seamlessly: piers in one stretch, a length of the front desk in the next. */
function narrowLobbySegment(g: Graphics, w: number, ty: number, by: number, v: number): void {
  if (v === 0) {
    box(g, 6, ty + 4, 4, by - 16 - ty, PALETTE.detail.column); // a pier
    vline(g, 7, ty + 4, by - 16 - ty, PALETTE.detail.columnLight, 1);
    box(g, 4, ty, 8, 4, PALETTE.detail.column);
    box(g, 4, by - 16, 8, 4, PALETTE.detail.column);
  } else {
    box(g, 0, by - 32, w, 6, PALETTE.detail.wood); // a length of the front desk
    hline(g, 0, by - 32, w);
    hline(g, 0, by - 29, w, PALETTE.detail.woodLight, 1);
    box(g, 0, by - 26, w, 14, PALETTE.detail.woodDark);
    hline(g, 0, by - 14, w);
  }
}

function drawLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + INTERIOR_TOP;
  const narrow = w < 3 * TILE_PX;
  marbleFloor(g, by, w, narrow);
  hline(g, 0, ty - 2, w, PALETTE.detail.marbleVein); // the soffit over the hall, y 20
  if (!narrow) {
    columnPair(g, 6, ty, by - 12);
    panel(g, 32, by - 32, Math.min(52, w - 56), 6, PALETTE.detail.wood); // front desk
    panel(g, 34, by - 26, Math.min(48, w - 60), 14, PALETTE.detail.woodDark);
    if (w >= 96) plantIcon(g, w - 40, by - 12);
    columnPair(g, w - 20, ty, by - 12);
  } else {
    narrowLobbySegment(g, w, ty, by, v);
  }
  if (lit) box(g, 0, ty, w, 2, PALETTE.detail.glow, 0.5);
}

function drawSkyLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + INTERIOR_TOP;
  const narrow = w < 3 * TILE_PX;
  marbleFloor(g, by, w, narrow);
  const mezz = y0 + h - FLOOR_PX; // the mezzanine deck, one floor up
  box(g, 0, mezz - SLAB_PX, w, SLAB_PX, PALETTE.slab);
  hline(g, 0, mezz - SLAB_PX, w, PALETTE.slabEdge, SLAB_EDGE_PX);
  hline(g, 0, mezz - 20, w, PALETTE.detail.column); // the mezzanine rail
  hline(g, 0, mezz - 12, w, PALETTE.detail.column);
  for (let x = 6; x < w; x += TILE_PX) vline(g, x, mezz - 18, 12, PALETTE.detail.column); // balusters
  hline(g, 0, ty - 2, w, PALETTE.detail.marbleVein);
  if (!narrow) {
    columnPair(g, 6, mezz, by - 12);
    panel(g, 32, by - 32, Math.min(52, w - 56), 6, PALETTE.detail.wood);
    panel(g, 34, by - 26, Math.min(48, w - 60), 14, PALETTE.detail.woodDark);
    if (w >= 96) plantIcon(g, w - 40, by - 12);
    columnPair(g, w - 20, mezz, by - 12);
  } else {
    narrowLobbySegment(g, w, mezz + 4, by, v);
  }
  if (lit) box(g, 0, ty, w, 2, PALETTE.detail.glow, 0.5);
}

function drawStairs(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + BASE;
  const steps = 9;
  const run = 10;
  const rise = FLOOR_PX / steps; // 9 * 8 = 72 = by - ty, so the flight lands exactly on the upper floor
  const x0 = 12;
  const x1 = x0 + steps * run; // 102
  const rail = v === 0 ? PALETTE.detail.metalDark : PALETTE.detail.wood;

  // the slab under the flight
  g.poly([x0, by, x1, ty, x1, ty + 14, x0 + 18, by]).fill(PALETTE.detail.stoneDark);
  stripe(g, x0 + 18, by, x1, ty + 14, INK);

  // the steps
  for (let i = 0; i < steps; i++) {
    const x = x0 + i * run;
    const top = by - (i + 1) * rise;
    box(g, x, top, run, rise, PALETTE.detail.stone);
    hline(g, x, top, run + 2, PALETTE.detail.marble); // tread nosing
    hline(g, x + 2, top + 2, run - 2, PALETTE.detail.stoneDark, 1); // the shadow under the nosing
    vline(g, x, top, rise, INK); // riser edge
  }

  // flush landings
  hline(g, 0, by, x0, PALETTE.detail.marble);
  hline(g, x1, ty, w - x1, PALETTE.detail.marble);

  // glass balustrade
  stripe(g, x0, by - 24, x1, ty - 24, PALETTE.detail.glass, 16);
  box(g, x1, ty - 32, w - x1, 16, PALETTE.detail.glass);

  // slim posts hiding the joins
  vline(g, x0, by - 36, 36, PALETTE.detail.metalDark);
  vline(g, x1, ty - 36, 36, PALETTE.detail.metalDark);

  // flat handrail
  stripe(g, x0, by - 34, x1, ty - 34, rail, 4);
  box(g, x1, ty - 36, w - x1, 4, rail);

  if (lit) {
    stripe(g, x0, by - 32, x1, ty - 32, PALETTE.detail.glow, 2);
    hline(g, x1, ty - 32, w - x1, PALETTE.detail.glow);
  }
}

function drawEscalator(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const x0 = 8;
  const x1 = w - 8;
  const y1 = by - 6;
  const y2 = y0 + 32;
  stripe(g, x0, y1 + 6, x1, y2 + 6, INK); // the truss under the steps
  stripe(g, x0, y1, x1, y2, PALETTE.detail.metalDark, 12);
  stripe(g, x0, y1 - 6, x1, y2 - 6, PALETTE.detail.metal, 4);
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y1 + (y2 - y1) * t;
    box(g, x - 2, y - 6, 4, 6, INK); // step cleats
  }
  stripe(g, x0, y1 - 16, x1, y2 - 16, PALETTE.detail.glass, 10); // balustrade
  stripe(g, x0, y1 - 22, x1, y2 - 22, v === 0 ? INK : PALETTE.detail.chairB, 4); // handrail
  box(g, 0, by - 6, x0 + 4, 6, PALETTE.detail.metal); // landings
  hline(g, 0, by - 8, x0 + 4);
  box(g, x1 - 4, y2, w - x1 + 4, 6, PALETTE.detail.metal);
  hline(g, x1 - 4, y2, w - x1 + 4);
  if (lit) {
    box(g, 2, by - 12, 10, 4, PALETTE.detail.glow);
    box(g, w - 12, y2 - 6, 10, 4, PALETTE.detail.glow);
  }
}

// ---------------------------------------------------------------------------
// Non-room textures
// ---------------------------------------------------------------------------

/** The deck with its dark top edge, then the soft shadow it casts on the floor below. */
function drawSlab(g: Graphics, w: number): void {
  box(g, 0, 0, w, SLAB_PX, PALETTE.slab);
  box(g, 0, 0, w, SLAB_EDGE_PX, PALETTE.slabEdge);
  for (let x = 8; x < w; x += 2 * TILE_PX) box(g, x, SLAB_EDGE_PX, 2, SLAB_PX - SLAB_EDGE_PX, PALETTE.slabEdge, 0.5); // rib marks
  box(g, 0, SLAB_PX, w, SLAB_SHADOW_PX, PALETTE.slabShadow, SLAB_SHADOW_ALPHA);
}

function drawShaft(g: Graphics, kind: ShaftKind, w: number, h: number): void {
  // A hint of a cavity, not a wall: the shaft reads as rails and floor marks with the car
  // running inside them, and whatever stands behind the column shows through.
  box(g, 0, 0, w, h, PALETTE.shaftCavity, 0.14);
  box(g, 0, 0, LINE_PX, h, PALETTE.shaftFloorMark);
  box(g, w - LINE_PX, 0, LINE_PX, h, PALETTE.shaftFloorMark);
  box(g, 6, 0, 4, h, PALETTE.shaftRail); // guide rails
  box(g, w - 10, 0, 4, h, PALETTE.shaftRail);
  box(g, 6, 0, 1, h, 0xffffff, 0.5); // the lit edge of each rail
  box(g, w - 10, 0, 1, h, 0xffffff, 0.5);
  if (kind === 'express') box(g, Math.floor(w / 2) - 2, 0, 4, h, PALETTE.shaftRail, 0.6);
  for (let y = 0; y + LINE_PX <= h; y += FLOOR_PX) {
    box(g, 0, y, w, LINE_PX, PALETTE.shaftFloorMark);
    box(g, 2, y + 2, 4, 4, kind === 'service' ? PALETTE.detail.metalDark : PALETTE.shaftRail, 0.8);
  }
}

/**
 * A car, `w` by `bodyH` with its cast shadow CAR_SHADOW_PX tall on top. The standard car is
 * 56 by 60: 2 px trim, a right shadow face, a 52 by 4 ceiling light, a 44 by 48 door opening
 * at (6, 8) with two panels that slide outward, a 4 px bottom plate.
 */
function drawCar(g: Graphics, kind: ShaftKind, w: number, bodyH: number, doorsOpen: boolean): void {
  box(g, 0, 0, w, CAR_SHADOW_PX, PALETTE.slabShadow, SLAB_SHADOW_ALPHA); // cast shadow up the shaft
  const top = CAR_SHADOW_PX;
  box(g, 0, top, w, bodyH, PALETTE.carTrim);
  box(g, LINE_PX, top + LINE_PX, w - 2 * LINE_PX, bodyH - 2 * LINE_PX, PALETTE.carBody);
  box(g, w - LINE_PX - 4, top + LINE_PX, 4, bodyH - 2 * LINE_PX, PALETTE.carShade); // shadow face
  box(g, LINE_PX, top + LINE_PX, w - 2 * LINE_PX, 4, PALETTE.carLight); // ceiling light strip
  vline(g, LINE_PX, top + 6, bodyH - 10, PALETTE.carDoor, 1); // the lit edge of the body
  const ox = 6;
  const oy = top + 8;
  const ow = w - 2 * ox;
  const oh = bodyH - 12;
  box(g, ox, oy, ow, oh, PALETTE.carInterior); // the cavity behind the doors
  const panelW = Math.floor(ow / 2);
  // Each panel slides outward by 8 px of a 22 px panel, clipped to the opening.
  const slide = doorsOpen ? Math.round((panelW * 8) / 22) : 0;
  const leftW = panelW - slide;
  const rightX = ox + panelW + slide;
  const rightW = ox + ow - rightX;
  box(g, ox, oy, leftW, oh, PALETTE.carDoor);
  box(g, rightX, oy, rightW, oh, PALETTE.carDoor);
  if (doorsOpen) {
    vline(g, ox + leftW - 1, oy, oh, PALETTE.carTrim, 1); // the panel edges
    vline(g, rightX, oy, oh, PALETTE.carTrim, 1);
  } else {
    vline(g, ox + panelW - 1, oy, oh, PALETTE.carTrim); // the door line
  }
  if (kind === 'service') box(g, ox + 2, oy + 4, leftW - 4, 4, PALETTE.detail.metalDark);
  if (kind === 'express') box(g, ox + 2, oy + oh - 16, leftW - 4, 4, PALETTE.amber);
  box(g, 0, top + bodyH - 4, w, 4, PALETTE.carTrim); // bottom plate
}

/**
 * A person, 16 by 48: a straight double of the 0.3 figure. The feet fill the bottom rows so
 * the sprite's lower edge lands on the slab line, and the top four rows stay clear for the
 * vip's hat. Head 8 by 4 with its top corners rounded, a neck notch, torso 18, legs 20.
 * Nothing may reach outside the box: at one tile wide the figures stand shoulder to shoulder
 * in a lift queue, so a stray pixel lands on the neighbor.
 */
function drawSim(g: Graphics, kind: SimKind, band: StressBand, frame: 0 | 1): void {
  const body = band === 'calm' ? PALETTE.sim.calm : band === 'pink' ? PALETTE.sim.pink : PALETTE.sim.red;
  box(g, 5, 4, 6, 1, body); // crown, one pixel in at each corner
  box(g, 4, 5, 8, 3, body); // head
  box(g, 6, 8, 4, 2, body); // neck, the notch that separates head from shoulders
  box(g, 4, 10, 8, 18, body); // torso
  if (frame === 0) {
    box(g, 2, 12, 2, 14, body); // arms hanging
    box(g, 12, 12, 2, 14, body);
    box(g, 4, 28, 2, 20, body); // legs upright, a four pixel gap between them
    box(g, 10, 28, 2, 20, body);
  } else {
    box(g, 2, 14, 2, 12, body); // arms swinging, one forward one back
    box(g, 12, 10, 2, 12, body);
    box(g, 2, 28, 2, 10, body); // legs mid stride, feet planted wide
    box(g, 0, 38, 4, 10, body);
    box(g, 12, 28, 2, 10, body);
    box(g, 12, 38, 4, 10, body);
  }
  // small per kind accents, kept clear of the legs
  switch (kind) {
    case 'worker':
      box(g, 12, 22, 4, 6, PALETTE.detail.woodDark); // briefcase
      break;
    case 'guest':
      box(g, 12, 20, 4, 8, PALETTE.detail.chairA); // suitcase
      break;
    case 'shopper':
      box(g, 12, 22, 4, 6, PALETTE.detail.shelfGoodsA); // shopping bag
      break;
    case 'staff':
      box(g, 4, 10, 8, 2, PALETTE.simAccent); // uniform collar
      break;
    case 'vip':
      box(g, 2, 2, 12, 2, PALETTE.amber); // hat brim
      box(g, 4, 0, 8, 2, PALETTE.amber);
      break;
    case 'diner':
      box(g, 12, 22, 4, 4, PALETTE.detail.linen);
      break;
    case 'resident':
      box(g, 4, 10, 8, 2, PALETTE.detail.blanketA); // scarf
      break;
    case 'visitor':
      break;
  }
}

function drawGhost(g: Graphics, w: number, h: number, ok: boolean): void {
  const color = ok ? PALETTE.ghostOk : PALETTE.alert;
  box(g, 0, 0, w, h, color, 0.18);
  // Two lines of edge, not one: at phone zoom a thin outline all but disappears against the
  // tower behind it, and the outline is the whole point of the preview.
  outline(g, 0, 0, w, h, color, 2 * LINE_PX);
  for (let x = 0; x < w; x += TILE_PX) box(g, x, 0, LINE_PX, h, color, 0.12); // tile guides
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Draws a room into a container: native shell, interior (2x for the half grid kinds), outline. */
function roomContainer(kind: RoomKind, tiles: number, floors: number, v: number, lit: boolean): Container {
  const { width: w, height: h } = TEXTURE_SIZE.room(tiles, floors);
  const root = new Container();
  const shell = new Graphics();
  drawShell(shell, kind, w, h, lit);
  root.addChild(shell);
  const full = FULL_HEIGHT.has(kind);
  if (HALF_KINDS.has(kind)) {
    const inner = new Graphics();
    inner.scale.set(HALF_SCALE);
    const s = HALF_SCALE;
    if (full) drawHalfInterior(inner, kind, 0, w / s, h / s, v, lit);
    else for (let f = 0; f < floors; f++) drawHalfInterior(inner, kind, (f * FLOOR_PX) / s, w / s, FLOOR_PX / s, v, lit);
    root.addChild(inner);
    const edge = new Graphics();
    drawCellOutline(edge, w, h, floors, !full);
    root.addChild(edge);
  } else {
    if (full) drawNativeInterior(shell, kind, 0, w, h, v, lit);
    else for (let f = 0; f < floors; f++) drawNativeInterior(shell, kind, f * FLOOR_PX, w, FLOOR_PX, v, lit);
    drawCellOutline(shell, w, h, floors, !full);
  }
  return root;
}

export function createArt(renderer: Renderer): Art {
  const cache = new Map<string, Texture>();
  const resolution = bakeResolution(typeof window === 'undefined' ? 1 : window.devicePixelRatio);

  function bakeTarget(key: string, w: number, h: number, make: () => Container): Texture {
    const hit = cache.get(key);
    if (hit) return hit;
    const target = make();
    const texture = renderer.generateTexture({
      target,
      frame: new Rectangle(0, 0, w, h),
      resolution,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    target.destroy({ children: true });
    cache.set(key, texture);
    return texture;
  }

  function bake(key: string, w: number, h: number, draw: (g: Graphics) => void): Texture {
    return bakeTarget(key, w, h, () => {
      const g = new Graphics();
      draw(g);
      return g;
    });
  }

  return {
    room(kind, width, height, variant, lit) {
      const tiles = Math.max(1, Math.round(width));
      const floors = Math.max(1, Math.round(height));
      const v = ((Math.round(variant) % 2) + 2) % 2;
      const { width: w, height: h } = TEXTURE_SIZE.room(tiles, floors);
      return bakeTarget(`room:${kind}:${tiles}:${floors}:${v}:${lit ? 1 : 0}`, w, h, () =>
        roomContainer(kind, tiles, floors, v, lit),
      );
    },

    slab(widthTiles) {
      const tiles = Math.max(1, Math.round(widthTiles));
      const { width: w, height: h } = TEXTURE_SIZE.slab(tiles);
      return bake(`slab:${tiles}`, w, h, (g) => drawSlab(g, w));
    },

    shaft(kind, floors) {
      const n = Math.max(1, Math.round(floors));
      const { width: w, height: h } = TEXTURE_SIZE.shaft(kind, n);
      return bake(`shaft:${kind}:${n}`, w, h, (g) => drawShaft(g, kind, w, h));
    },

    car(kind, doorsOpen) {
      const { width: w, height: h } = TEXTURE_SIZE.car(kind);
      return bake(`car:${kind}:${doorsOpen ? 1 : 0}`, w, h, (g) => drawCar(g, kind, w, h - CAR_SHADOW_PX, doorsOpen));
    },

    sim(kind, band, frame) {
      const { width: w, height: h } = TEXTURE_SIZE.sim();
      return bake(`sim:${kind}:${band}:${frame}`, w, h, (g) => drawSim(g, kind, band, frame));
    },

    ghost(widthTiles, heightFloors, ok) {
      const tiles = Math.max(1, Math.round(widthTiles));
      const floors = Math.max(1, Math.round(heightFloors));
      const { width: w, height: h } = TEXTURE_SIZE.ghost(tiles, floors);
      return bake(`ghost:${tiles}:${floors}:${ok ? 1 : 0}`, w, h, (g) => drawGhost(g, w, h, ok));
    },
  };
}

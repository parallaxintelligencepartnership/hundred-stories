// Procedural pixel art for the tower cross section. See docs/VISUAL.md and docs/DESIGN.md section 9.
// No image assets: every texture is baked from Graphics primitives once and cached by key.
//
// The grid is 16 px tiles and 72 px floors (grid.ts), drawn on integer pixels with antialias
// off and baked at the device pixel ratio rounded to 1 or 2, so the art stays crisp at the
// snapped zoom steps (0.5, 1, 2, 3). Geometry follows docs/reviews/2026-09-22-codex-astra-ui-graphics.md
// section 1: a 2 px outline, a slab at y 66 to 71 with a 2 px edge and a 4 px cast shadow,
// two-tone walls, 12 by 12 panes one per tile.
//
// Every drawer is native to this grid: the shell of every room, the structure pieces, all
// twenty two room interiors (the last fourteen re-authored in ship L3, which removed the 2x
// scale they were drawn through), cars with five baked door positions, people with three
// walk frames and outfits, shafts, the ghost.

import { Container, Graphics, Rectangle } from 'pixi.js';
import type { Renderer, Texture } from 'pixi.js';
import type { RoomKind, ShaftKind, SimKind, StressBand } from '../sim/types';
import { SHAFTS } from '../sim/rules';
import { DOOR_FRAMES, decodeOutfit, doorFrameOf, OUTFIT_COLOURS, type SimFrame } from './anim';
import {
  CAR_CLEAR_PX,
  CAR_INSET_PX,
  CAR_SHADOW_PX,
  FLOOR_PX,
  INTERIOR_TOP,
  LINE_PX,
  LOBBY_SHADOW_PX,
  OPEN_TOP,
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
import type { WindowState } from './light';
import { INK, PALETTE, shade, wallShadow } from './palette';

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
  room(kind: RoomKind, width: number, height: number, variant: number, state: WindowState): Texture;
  slab(widthTiles: number): Texture;
  shaft(kind: ShaftKind, floors: number): Texture;
  /** A car with its doors at `door` (0 closed, 1 open), baked at the nearest of DOOR_FRAMES. */
  car(kind: ShaftKind, door: number): Texture;
  /** A person in walk frame `frame`, in outfit `outfit` (anim.ts outfit code), or plain without one. */
  sim(kind: SimKind, band: StressBand, frame: SimFrame, outfit?: number): Texture;
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

function drawWindowBand(g: Graphics, kind: RoomKind, y0: number, w: number, state: WindowState, shadeFrom: number): void {
  if (WINDOWS[kind] === 'none') return;
  hline(g, 0, y0 + WIN_TOP, w); // head rail
  hline(g, 0, y0 + WIN_SILL, w); // sill
  const gy = y0 + WIN_PANE_TOP;
  for (let x = WIN_PANE_X; x + WIN_PANE + LINE_PX <= w; x += TILE_PX) {
    if (state === 'lit') {
      box(g, x, gy, WIN_PANE, WIN_PANE, PALETTE.windowLit);
      box(g, x, gy, WIN_PANE, 2, PALETTE.carLight); // the lamp light pooling at the head
    } else if (state === 'day') {
      box(g, x, gy, WIN_PANE, WIN_PANE, PALETTE.windowDay);
      box(g, x + 2, gy + 2, 3, 1, 0xffffff, 0.55); // a glint in the top corner
      box(g, x + 2, gy + 3, 1, 2, 0xffffff, 0.55);
    } else {
      box(g, x, gy, WIN_PANE, WIN_PANE, PALETTE.windowUnlit);
      // A dirty hotel room keeps only its lamp: a low warm glow along the bottom of the glass.
      if (state === 'housekeeping') box(g, x, gy + WIN_PANE - 4, WIN_PANE, 4, PALETTE.windowLit, 0.55);
    }
    vline(g, x - LINE_PX, gy, WIN_PANE); // mullions
    vline(g, x + WIN_PANE, gy, WIN_PANE);
  }
  // Glass on the shadow face sits in the same shade as the wall around it.
  if (shadeFrom < w) box(g, shadeFrom, gy, w - LINE_PX - shadeFrom, WIN_PANE, INK, 0.14);
}

function drawShell(g: Graphics, kind: RoomKind, w: number, h: number, state: WindowState): void {
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
    drawWindowBand(g, kind, y0, w, state, shadeFrom);
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

/**
 * `lit` turns on everything a person switches on (screens, lamps, glows); `lamp` is the lamp
 * alone, which a dirty hotel room keeps at night for housekeeping.
 */
function drawNativeInterior(g: Graphics, kind: RoomKind, y0: number, w: number, h: number, v: number, lit: boolean, lamp: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + (WINDOWS[kind] === 'none' ? OPEN_TOP : INTERIOR_TOP);
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
      drawHotelSingle(g, by, ty, w, v, lit, lamp);
      break;
    case 'hotelTwin':
      drawHotelTwin(g, by, ty, w, v, lit, lamp);
      break;
    case 'hotelSuite':
      drawHotelSuite(g, by, ty, w, v, lit, lamp);
      break;
    case 'condo':
      drawCondo(g, y0, by, ty, w, v, lit);
      break;
    case 'fastFood':
      drawFastFood(g, by, ty, w, v, lit);
      break;
    case 'restaurant':
      drawRestaurant(g, by, ty, w, v, lit);
      break;
    case 'shop':
      drawShop(g, by, ty, w, v, lit);
      break;
    case 'cinema':
      drawCinema(g, y0, w, h, v, lit);
      break;
    case 'partyHall':
      drawPartyHall(g, y0, w, h, v, lit);
      break;
    case 'medical':
      drawMedical(g, by, ty, w, v, lit);
      break;
    case 'security':
      drawSecurity(g, by, ty, w, v, lit);
      break;
    case 'housekeeping':
      drawHousekeeping(g, by, ty, w, v, lit);
      break;
    case 'parkingRamp':
      drawParkingRamp(g, by, ty, w, v, lit);
      break;
    case 'parkingSpace':
      drawParkingSpace(g, by, ty, w, v, lit);
      break;
    case 'recycling':
      drawRecycling(g, y0, w, h, v, lit);
      break;
    case 'metro':
      drawMetro(g, y0, w, h, v, lit);
      break;
    case 'cathedral':
      drawCathedral(g, y0, w, h, v, lit);
      break;
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

function drawHotelSingle(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean, lamp: boolean): void {
  const bedW = Math.max(24, w - 32);
  bedIcon(g, 4, by, bedW, v);
  const nx = 4 + bedW;
  if (nx + NIGHTSTAND_W <= w - TV_W - 4) nightstand(g, nx, by, lamp);
  smallTv(g, w - TV_W - 2, by, lit);
  if (v === 1 && w >= 88) picture(g, 8, ty, 20, 16, PALETTE.detail.curtain);
}

function drawHotelTwin(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean, lamp: boolean): void {
  const bedW = Math.max(24, Math.floor((w - 28) / 4) * 2);
  bedIcon(g, 4, by, bedW, v);
  bedIcon(g, 8 + bedW, by, bedW, v === 0 ? 1 : 0);
  const nx = 12 + bedW * 2;
  if (nx + NIGHTSTAND_W <= w - LINE_PX) {
    nightstand(g, nx, by, lamp);
    picture(g, nx - 2, ty, 14, 12, PALETTE.detail.glass);
  }
}

function drawHotelSuite(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean, lamp: boolean): void {
  const bedW = Math.min(52, Math.max(28, Math.floor(w * 0.16) * 2));
  bedIcon(g, 4, by, bedW, v);
  let x = bedW + 6;
  if (x + NIGHTSTAND_W <= w - 80) {
    nightstand(g, x, by, lamp);
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
  floorLampIcon(g, w - 18, by, lamp);
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

// --- shared furniture for the fourteen rooms re-authored in ship L3 ------------

const D = PALETTE.detail;

function pick(list: readonly number[], i: number, fallback: number): number {
  return list[((i % list.length) + list.length) % list.length] ?? fallback;
}

function diningChair(g: Graphics, x: number, by: number, color: number, faceRight: boolean): void {
  const back = faceRight ? x : x + 6;
  panel(g, back, by - 32, 6, 32, color); // the back, with a slat across it
  hline(g, back + 2, by - 26, 2, D.woodLight, 1);
  panel(g, x, by - 18, 12, 6, color); // seat
  vline(g, faceRight ? x + 10 : x, by - 12, 12, D.woodDark); // front leg
}

function stool(g: Graphics, x: number, by: number, seat: number = D.seatA): void {
  panel(g, x, by - 20, 16, 4, seat);
  hline(g, x + 2, by - 18, 12, 0xffffff, 1); // light on the pad
  box(g, x + 6, by - 16, 4, 14, D.metal);
  vline(g, x + 7, by - 16, 14, 0xffffff, 1);
  hline(g, x + 2, by - 8, 12, D.metal); // foot ring
  hline(g, x + 2, by - 2, 12); // base
}

function clothTable(g: Graphics, x: number, by: number, w: number, h: number, v: number, lit: boolean): void {
  panel(g, x, by - h, w, h, D.linen);
  hline(g, x + 2, by - h + 6, w - 4, D.marbleVein); // the fall of the cloth
  for (let fx = x + 6; fx < x + w - 4; fx += 8) vline(g, fx, by - h + 8, h - 10, D.marbleVein, 1); // folds
  const cx = x + Math.floor(w / 2) - 3;
  box(g, cx, by - h - 8, 6, 8, v === 0 ? D.cross : D.leaf); // a vase with a stem in it
  hline(g, cx, by - h - 8, 6);
  box(g, x + 4, by - h - 6, 2, 6, D.linen); // a candle
  box(g, x + 4, by - h - 8, 2, 2, lit ? D.glow : D.woodDark);
  box(g, x + w - 10, by - h - 2, 6, 2, D.metal); // a plate
}

function shelfUnit(g: Graphics, x: number, by: number, w: number, h: number, v: number): void {
  panel(g, x, by - h, w, h, D.woodDark);
  const rows = Math.max(2, Math.round((h - 4) / 13));
  const step = Math.floor((h - 4) / rows);
  for (let r = 0; r < rows; r++) {
    const top = by - h + 2 + r * step;
    hline(g, x + 2, top + step - 2, w - 4, D.wood); // the shelf board
    hline(g, x + 2, top + step - 2, w - 4, D.woodLight, 1);
    for (let i = 0; x + 4 + i * 8 + 6 <= x + w - 2; i++) {
      const c = pick([D.shelfGoodsA, D.shelfGoodsB, PALETTE.amber, D.cross], i + r * 2 + v, D.shelfGoodsA);
      const gh = step - 4 - ((i + r + v) % 3 === 0 ? 2 : 0); // uneven heights read as goods, not a pattern
      box(g, x + 4 + i * 8, top + step - 2 - gh, 6, gh, c);
      box(g, x + 4 + i * 8, top + step - 2 - gh, 6, 1, 0xffffff, 0.45); // a label catching the light
      vline(g, x + 4 + i * 8 + 5, top + step - 2 - gh, gh, INK, 1);
    }
  }
}

function linenShelf(g: Graphics, x: number, by: number, w: number, h: number): void {
  panel(g, x, by - h, w, h, D.metal);
  const shelves = 3;
  const step = Math.floor((h - 2) / shelves);
  for (let s = 1; s <= shelves; s++) {
    const y = by - h + s * step;
    hline(g, x + 2, y, w - 4);
    for (let i = 0; x + 4 + i * 16 + 14 <= x + w - 2; i++) {
      const tone = (i + s) % 3 === 0 ? D.tile : D.linen;
      panel(g, x + 4 + i * 16, y - step + 4, 14, step - 4, tone);
      hline(g, x + 6 + i * 16, y - step + 8, 10, D.marbleVein, 1); // a fold in the top sheet
    }
  }
}

function carSilhouette(g: Graphics, x: number, by: number, color: number, lit: boolean): void {
  panel(g, x + 10, by - 24, 28, 12, color); // cabin
  box(g, x + 12, by - 22, 10, 6, D.glass);
  box(g, x + 24, by - 22, 12, 6, D.glass);
  box(g, x + 13, by - 21, 3, 1, 0xffffff, 0.6); // glint
  panel(g, x, by - 14, 48, 10, color); // body
  hline(g, x + 4, by - 10, 40, shade(color, 0.7), 1); // a crease along the door
  box(g, x + 4, by - 6, 10, 6, INK); // wheels, with a hub
  box(g, x + 34, by - 6, 10, 6, INK);
  box(g, x + 8, by - 4, 2, 2, D.metal);
  box(g, x + 38, by - 4, 2, 2, D.metal);
  box(g, x + 44, by - 12, 4, 2, lit ? D.glow : D.linen); // headlight
  box(g, x, by - 12, 2, 2, D.cross); // tail light
}

function ceilingLight(g: Graphics, x: number, y: number, w: number, lit: boolean): void {
  box(g, x, y, w, 4, lit ? D.glow : D.metalDark);
  outline(g, x, y, w, 4, INK, 1);
  if (lit) box(g, x + 2, y + 1, w - 4, 1, PALETTE.carLight);
}

// --- condo ------------------------------------------------------------------
// Left to right: a kitchenette (fridge, counter with sink and hob, wall cupboards), a
// curtained window over a sofa, coffee table and floor lamp on a rug, the bed at the far end.

function drawCondo(g: Graphics, y0: number, by: number, ty: number, w: number, v: number, lit: boolean): void {
  // kitchenette
  panel(g, 4, by - 44, 20, 44, D.tile); // fridge
  hline(g, 4, by - 30, 20);
  vline(g, 20, by - 40, 6, D.metal);
  vline(g, 20, by - 26, 8, D.metal);
  box(g, 7, by - 42, 12, 1, 0xffffff, 0.6);
  box(g, 22, by - 28, 56, 4, D.tile); // counter top
  hline(g, 22, by - 28, 56);
  panel(g, 24, by - 24, 26, 24, D.wood); // cupboards under the counter
  vline(g, 36, by - 22, 20, D.woodDark);
  box(g, 32, by - 14, 2, 2, D.gold);
  box(g, 39, by - 14, 2, 2, D.gold);
  panel(g, 50, by - 24, 26, 24, D.metalDark); // oven
  box(g, 54, by - 18, 18, 8, lit ? D.glow : D.metal);
  hline(g, 54, by - 21, 18, D.metal, 1);
  box(g, 30, by - 28, 12, 2, D.metal); // sink
  vline(g, 34, by - 36, 8, D.metal); // tap
  hline(g, 34, by - 36, 5, D.metal);
  box(g, 54, by - 30, 6, 2, INK); // hob rings
  box(g, 66, by - 30, 6, 2, INK);
  panel(g, 24, ty, 52, 12, D.wood); // wall cupboards
  vline(g, 36, ty + 2, 8, D.woodDark);
  vline(g, 50, ty + 2, 8, D.woodDark);
  vline(g, 62, ty + 2, 8, D.woodDark);
  hline(g, 26, ty + 2, 48, D.woodLight, 1);
  if (lit) box(g, 26, ty + 12, 48, 1, PALETTE.carLight); // the strip light under the cupboards

  // the curtained window and the living corner
  const rail = y0 + 2;
  hline(g, 74, rail, 90, D.metalDark);
  panel(g, 76, rail, 10, 30, D.curtain);
  panel(g, 152, rail, 10, 30, D.curtain);
  vline(g, 80, rail + 2, 26, shade(D.curtain, 0.75), 1); // folds
  vline(g, 156, rail + 2, 26, shade(D.curtain, 0.75), 1);
  for (let x = 88; x < 150; x += 8) box(g, x, rail + 4, 4, 4, D.curtain); // valance pleats over the glass
  box(g, 84, by - 2, 92, 2, v === 0 ? D.blanketA : D.blanketB, 0.7); // rug
  const back = v === 0 ? D.chairA : D.chairB;
  const seat = v === 0 ? D.chairB : D.chairA;
  sofaIcon(g, 88, by, 56, back, seat);
  lowTable(g, 148, by, 20, v);
  floorLampIcon(g, 170, by, lit);
  if (v === 1) picture(g, 100, ty, 28, 14, D.glass);
  else wallClock(g, 112, ty + 2);

  // the bedroom end
  const bedX = 188;
  const bedW = Math.min(46, w - bedX - 20);
  if (bedW >= 28) bedIcon(g, bedX, by, bedW, v, false);
  if (bedX + bedW + 16 <= w - LINE_PX) plantIcon(g, w - 18, by);
}

// --- fast food --------------------------------------------------------------
// A fryer and a heat lamp at the back, a striped counter with two registers under a menu
// board, a tray waiting on the counter, three stools, a bin and a drinks fridge.

function drawFastFood(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  panel(g, 4, by - 30, 24, 30, D.metal); // fryer
  box(g, 6, by - 30, 20, 4, D.metalDark);
  box(g, 8, by - 36, 6, 6, D.metalDark); // baskets hanging over the oil
  box(g, 16, by - 36, 6, 6, D.metalDark);
  vline(g, 10, by - 40, 4, D.metal, 1);
  vline(g, 18, by - 40, 4, D.metal, 1);
  box(g, 8, by - 20, 12, 2, lit ? D.glow : D.metalDark);

  const counterX = 32;
  const counterW = Math.min(84, w - 140);
  const board = v === 0 ? PALETTE.amber : D.cross;
  panel(g, 4, ty, counterX + counterW - 8, 18, board); // menu board over the counter
  for (let i = 0; 8 + i * 20 + 16 <= counterX + counterW - 8; i++) {
    box(g, 8 + i * 20, ty + 4, 10, 6, D.woodDark); // a picture of the item
    box(g, 9 + i * 20, ty + 5, 8, 2, D.shelfGoodsA);
    box(g, 8 + i * 20, ty + 12, 14, 2, INK); // its price
  }
  panel(g, counterX, by - 26, counterW, 6, D.tile); // counter top
  panel(g, counterX, by - 20, counterW, 20, D.counter);
  for (let x = counterX + 4; x < counterX + counterW - 4; x += 8) box(g, x, by - 18, 4, 16, board, 0.8); // the stripes
  for (const rx of [counterX + 6, counterX + counterW - 26]) {
    panel(g, rx, by - 40, 20, 14, D.metal); // registers
    box(g, rx + 2, by - 38, 16, 6, lit ? D.screenOn : D.screenOff);
    hline(g, rx + 2, by - 30, 16);
  }
  const tray = counterX + Math.floor(counterW / 2) - 10;
  box(g, tray, by - 28, 20, 2, D.cross); // a tray with a burger and a cup
  box(g, tray + 2, by - 34, 10, 2, D.woodLight);
  box(g, tray + 2, by - 32, 10, 2, D.woodDark);
  box(g, tray + 2, by - 30, 10, 2, D.woodLight);
  panel(g, tray + 13, by - 36, 6, 8, D.linen);

  const fridgeX = w - 44;
  const stoolsFrom = counterX + counterW + 8;
  for (let i = 0, x = stoolsFrom; i < 3 && x + 16 <= fridgeX - 24; i++, x += 22) stool(g, x, by);
  if (fridgeX - 20 > stoolsFrom) {
    panel(g, fridgeX - 18, by - 22, 14, 22, D.metal); // bin with a swing flap
    box(g, fridgeX - 16, by - 18, 10, 4, D.metalDark);
  }
  panel(g, fridgeX, by - 44, 36, 44, D.metalDark); // drinks fridge
  box(g, fridgeX + 4, by - 40, 28, 36, lit ? PALETTE.windowLit : D.glass);
  for (let s = 0; s < 3; s++) {
    const y = by - 38 + s * 12;
    hline(g, fridgeX + 4, y + 8, 28);
    for (let i = 0; i < 6; i++) {
      box(g, fridgeX + 5 + i * 4 + (i >= 3 ? 2 : 0), y, 3, 8, pick([D.cross, D.leaf, PALETTE.amber], i + s + v, D.cross));
    }
  }
  vline(g, fridgeX + 17, by - 40, 36); // door seam
  box(g, fridgeX + 2, by - 43, 32, 1, lit ? PALETTE.carLight : D.metal); // the lit header
}

// --- restaurant -------------------------------------------------------------
// Four clothed tables with chairs, candles and hanging lamps, a plant between the second and
// third, and a bar at the right end with a bottle shelf and a kitchen pass where steam rises.

const RESTAURANT_BAR_W = 88;

/** Where the plate on the kitchen pass sits, the source of the restaurant's steam (ambient.ts). */
export function restaurantSteamPoint(w: number): { x: number; y: number } {
  const barX = w - RESTAURANT_BAR_W - 4;
  return { x: barX + 14, y: BASE - 36 };
}

function drawRestaurant(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const barX = w - RESTAURANT_BAR_W - 4;
  const step = 68;
  const wood = v === 0 ? D.woodDark : D.chairB;
  for (let i = 0, x = 8; i < 4 && x + 60 <= barX - 4; i++, x += step) {
    diningChair(g, x, by, wood, true);
    clothTable(g, x + 14, by, 32, 24, (v + i) % 2, lit);
    diningChair(g, x + 48, by, wood, false);
    vline(g, x + 29, ty - 2, 6, D.metalDark); // the cord of a hanging lamp
    hline(g, x + 24, ty + 4, 12);
    box(g, x + 22, ty + 6, 16, 6, lit ? PALETTE.windowLit : D.linen);
    hline(g, x + 22, ty + 12, 16);
    if (lit) box(g, x + 24, ty + 7, 12, 1, PALETTE.carLight);
  }
  panel(g, barX, by - 28, RESTAURANT_BAR_W, 6, D.wood); // bar top
  hline(g, barX + 2, by - 26, RESTAURANT_BAR_W - 4, D.woodLight, 1);
  panel(g, barX, by - 22, RESTAURANT_BAR_W, 22, D.woodDark);
  for (let x = barX + 12; x < barX + RESTAURANT_BAR_W - 4; x += 14) {
    outline(g, x - 8, by - 18, 12, 14, D.wood, 1); // raised panels
  }
  const steam = restaurantSteamPoint(w);
  box(g, steam.x - 8, by - 30, 16, 2, D.linen); // the plate on the pass
  box(g, steam.x - 5, by - 34, 10, 4, v === 0 ? D.shelfGoodsA : D.leaf); // what is on it
  panel(g, barX + 32, ty, RESTAURANT_BAR_W - 36, 18, D.woodDark); // back shelf
  hline(g, barX + 34, ty + 10, RESTAURANT_BAR_W - 40, D.wood);
  for (let i = 0; barX + 36 + i * 6 + 4 <= barX + RESTAURANT_BAR_W - 6; i++) {
    const c = pick([D.leaf, D.cross, PALETTE.amber, D.glass], i + v, D.leaf);
    box(g, barX + 36 + i * 6, ty + 2, 4, 8, c); // bottles, with a neck
    box(g, barX + 37 + i * 6, ty + 1, 2, 1, c);
    box(g, barX + 36 + i * 6, ty + 12, 4, 4, i % 2 === 0 ? D.glass : D.linen); // glasses below
  }
  if (lit) box(g, barX + 34, ty + 2, RESTAURANT_BAR_W - 40, 1, D.glow, 0.6);
  plantIcon(g, barX - 18, by); // a plant at the end of the bar
}

// --- shop -------------------------------------------------------------------
// Two stocked shelf units, a clothes rail with hangers, and a counter with a register under
// a sign board. At night a strip under the sign blinks (ambient.ts).

const SHOP_COUNTER_W = 64;

/** The strip under the shop's sign board, the one that blinks at night (ambient.ts). */
export function shopSignStrip(w: number): { x: number; y: number; w: number; h: number } {
  const counterX = w - SHOP_COUNTER_W - 6;
  return { x: counterX - 2, y: INTERIOR_TOP + 12, w: SHOP_COUNTER_W + 4, h: 2 };
}

function drawShop(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const counterX = w - SHOP_COUNTER_W - 6;
  let x = 6;
  for (let i = 0; i < 2 && x + 36 <= counterX - 40; i++, x += 40) shelfUnit(g, x, by, 36, by - ty - 2, v + i);
  // the clothes rail
  const railW = counterX - x - 8;
  if (railW >= 24) {
    hline(g, x, ty + 4, railW, D.metal);
    vline(g, x, ty + 4, by - ty - 4, D.metal);
    vline(g, x + railW - 2, ty + 4, by - ty - 4, D.metal);
    hline(g, x - 2, by - 2, railW + 4, D.metalDark);
    for (let i = 0, hx = x + 4; hx + 8 <= x + railW - 4; i++, hx += 10) {
      const c = pick([D.chairA, D.curtain, D.leaf, PALETTE.amber], i + v, D.chairA);
      box(g, hx + 3, ty + 6, 2, 2, D.metalDark); // hanger
      panel(g, hx, ty + 8, 8, 18 + (i % 2) * 4, c); // a garment
    }
  }
  const sign = shopSignStrip(w);
  panel(g, counterX - 2, ty, SHOP_COUNTER_W + 4, 12, v === 0 ? PALETTE.amber : D.shelfGoodsB); // sign board
  for (let i = 0; counterX + 4 + i * 10 + 6 <= counterX + SHOP_COUNTER_W; i++) box(g, counterX + 4 + i * 10, ty + 4, 6, 4, INK);
  box(g, sign.x, sign.y, sign.w, sign.h, lit ? PALETTE.amber : D.metalDark); // the strip the sign lights
  panel(g, counterX, by - 24, SHOP_COUNTER_W, 6, D.wood); // counter top
  panel(g, counterX + 2, by - 18, SHOP_COUNTER_W - 4, 18, D.woodDark);
  for (let cx = counterX + 16; cx < counterX + SHOP_COUNTER_W - 4; cx += 16) vline(g, cx, by - 16, 14, D.wood);
  panel(g, counterX + SHOP_COUNTER_W - 26, by - 38, 20, 14, D.metal); // register
  box(g, counterX + SHOP_COUNTER_W - 24, by - 36, 16, 6, lit ? D.screenOn : D.screenOff);
  hline(g, counterX + SHOP_COUNTER_W - 24, by - 28, 16);
  panel(g, counterX + 6, by - 34, 14, 10, D.shelfGoodsA); // a bag waiting on the counter
  hline(g, counterX + 9, by - 36, 8, INK);
}

// --- cinema -----------------------------------------------------------------
// A dark box: the screen between two curtains, the projector and its beam at the back, rows
// of seats stepping up toward it, an exit sign, and a marquee strip across the top whose
// colour cycles (ambient.ts).

const CINEMA_LINE = 0x8a8aa0; // the cinema wall is dark, so its line art is light
export const CINEMA_MARQUEE_COLOURS = [PALETTE.amber, PALETTE.detail.cross, PALETTE.detail.led] as const;

/** The marquee strip along the top of the cinema, the one that cycles colour (ambient.ts). */
export function cinemaMarquee(w: number): { x: number; y: number; w: number; h: number } {
  return { x: 8, y: OPEN_TOP + 2, w: w - 16 - WALL_SHADOW_PX, h: 4 };
}

function drawCinema(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const line = CINEMA_LINE;
  const by = y0 + h - SLAB_PX;
  const marquee = cinemaMarquee(w);
  box(g, marquee.x - 2, y0 + marquee.y - 2, marquee.w + 4, marquee.h + 4, D.metalDark);
  box(g, marquee.x, y0 + marquee.y, marquee.w, marquee.h, CINEMA_MARQUEE_COLOURS[0], lit ? 1 : 0.5);
  for (let x = marquee.x + 4; x < marquee.x + marquee.w - 2; x += 12) box(g, x, y0 + marquee.y + 1, 2, 2, 0xffffff, lit ? 0.8 : 0.3); // bulbs

  const screenX = 16;
  const screenW = Math.min(92, Math.floor(w / 5));
  const screenTop = y0 + 20;
  const screenH = h - 52;
  panel(g, screenX - 12, screenTop - 4, 12, screenH + 24, D.curtain, line); // curtains either side
  panel(g, screenX + screenW, screenTop - 4, 12, screenH + 24, D.curtain, line);
  vline(g, screenX - 7, screenTop, screenH + 16, shade(D.curtain, 0.7), 1);
  vline(g, screenX + screenW + 5, screenTop, screenH + 16, shade(D.curtain, 0.7), 1);
  panel(g, screenX, screenTop, screenW, screenH, D.metalDark, lit ? PALETTE.windowLit : line);
  box(g, screenX + 4, screenTop + 4, screenW - 8, screenH - 8, lit ? D.screenOn : D.screenOff);
  if (lit) {
    box(g, screenX + 10, screenTop + screenH - 30, 24, 22, D.leaf, 0.7); // a scene on the screen
    box(g, screenX + 40, screenTop + screenH - 44, 20, 36, D.stoneDark, 0.7);
    box(g, screenX + 4, screenTop + 4, screenW - 8, 4, 0xffffff, 0.35);
  }

  const projX = w - 36;
  const projY = y0 + 18;
  panel(g, projX, projY, 24, 18, D.metalDark, line); // projector booth window and lamp
  box(g, projX - 4, projY + 6, 4, 6, lit ? PALETTE.windowLit : line); // lens
  box(g, projX + 4, projY + 4, 6, 6, lit ? D.glow : D.metal); // the lamp house
  if (lit) {
    const steps = 12;
    const lensY = projY + 9;
    const screenRight = screenX + screenW;
    const screenCy = screenTop + screenH / 2;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const bx0 = projX - 4 - (projX - 4 - screenRight) * t1;
      const bx1 = projX - 4 - (projX - 4 - screenRight) * t0;
      const cy = lensY + (screenCy - lensY) * t1;
      const half = 2 + (screenH / 3 - 2) * t1;
      const top = Math.max(y0 + 12, cy - half);
      box(g, bx0, top, bx1 - bx0, Math.min(by - 2, cy + half) - top, PALETTE.carLight, 0.12);
    }
  }
  panel(g, w - 38, by - 40, 20, 40, D.metalDark, line); // the exit door
  box(g, w - 36, by - 50, 16, 8, lit ? D.led : D.leaf); // and its sign
  box(g, w - 34, by - 48, 12, 4, 0xffffff, 0.6);

  const seat = v === 0 ? D.seatA : D.seatB;
  const rows = 5;
  const rowsFrom = screenX + screenW + 24;
  const rowW = Math.floor((w - rowsFrom - 48) / rows);
  for (let r = 0; r < rows; r++) {
    const rx = rowsFrom + r * rowW;
    const ry = by - r * 10;
    if (r > 0) box(g, rx, ry, rowW, by - ry, shade(PALETTE.wall.cinema, 1.25)); // the stepped floor
    hline(g, rx, ry - 2, rowW, line); // the step this row sits on
    if (r > 0) vline(g, rx, ry - 2, by - ry + 2, line); // its riser
    for (let x = rx + 4; x + 18 <= rx + rowW - 2; x += 24) {
      // the seats face the screen, so the pad reaches left from the back
      panel(g, x + 10, ry - 30, 8, 28, seat, line); // seat back
      panel(g, x, ry - 14, 14, 6, seat, line); // pad
      box(g, x + 2, ry - 20, 10, 2, line); // armrest
      vline(g, x + 4, ry - 8, 6, line); // leg
      box(g, x + 12, ry - 28, 1, 22, 0xffffff, 0.25); // light on the upholstery
    }
  }
  if (lit) for (let x = rowsFrom; x < w - 48; x += 40) box(g, x, by - 3, 4, 2, D.glow); // aisle lights
}

// --- party hall -------------------------------------------------------------
// A stage with a pleated backdrop, a lectern and two spotlights; a checkered dance floor under
// a mirror ball; two long clothed tables with place settings; bunting and balloons.

function drawPartyHall(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const ty = y0 + INTERIOR_TOP;
  const stageW = Math.min(116, Math.floor(w / 3));
  const stageTop = by - 28;
  panel(g, 4, ty + 4, stageW, stageTop - ty - 4, D.curtain); // backdrop
  for (let x = 12; x < stageW; x += 12) vline(g, x, ty + 6, stageTop - ty - 8, shade(D.curtain, 0.7));
  box(g, 4, ty + 4, stageW, 8, shade(D.curtain, 0.8)); // valance
  hline(g, 4, ty + 12, stageW);
  panel(g, 4, stageTop, stageW, 8, D.wood); // stage deck
  hline(g, 6, stageTop + 2, stageW - 4, D.woodLight, 1);
  panel(g, 4, stageTop + 8, stageW, 20, D.woodDark);
  for (let x = 20; x < stageW; x += 16) vline(g, x, stageTop + 10, 16, D.wood, 1);
  const lx = 4 + Math.floor(stageW / 2) - 9;
  panel(g, lx, stageTop - 26, 18, 26, D.wood); // lectern
  hline(g, lx - 2, stageTop - 28, 22);
  vline(g, lx + 8, stageTop - 34, 6, D.metal); // microphone
  box(g, lx + 6, stageTop - 38, 6, 4, D.metalDark);
  for (const sx of [16, stageW - 16]) {
    box(g, sx, ty + 16, 8, 6, D.metalDark); // spotlights on the truss
    if (lit) g.poly([sx, ty + 22, sx + 8, ty + 22, sx + 20, stageTop, sx - 12, stageTop]).fill({ color: PALETTE.carLight, alpha: 0.18 });
  }

  const floorX = stageW + 16;
  const floorW = Math.min(88, Math.floor((w - floorX) / 3));
  const tileB = v === 0 ? D.chairB : D.chairA;
  for (let x = floorX, i = 0; x + 8 <= floorX + floorW; x += 8, i++) {
    box(g, x, by - 8, 8, 4, i % 2 === 0 ? D.linen : tileB); // dance floor, two rows of checks
    box(g, x, by - 4, 8, 4, i % 2 === 0 ? tileB : D.linen);
  }
  hline(g, floorX, by - 8, floorW - (floorW % 8), INK, 1);
  const ballX = floorX + Math.floor(floorW / 2);
  vline(g, ballX, y0 + 4, ty + 10 - y0, D.metalDark, 1);
  box(g, ballX - 6, ty + 14, 12, 12, D.metal); // mirror ball
  box(g, ballX - 4, ty + 12, 8, 16, D.metal);
  for (let i = 0; i < 4; i++) box(g, ballX - 4 + (i % 2) * 5, ty + 15 + i * 3, 2, 2, lit ? 0xffffff : D.linen);
  if (lit) for (let i = 0; i < 5; i++) box(g, floorX + 6 + i * 18, by - 20 - (i % 3) * 14, 2, 2, pick([D.glow, D.cross, D.glass], i, D.glow)); // flecks off the ball

  const tablesX = floorX + floorW + 12;
  const tableW = Math.floor((w - tablesX - 16) / 2);
  for (let i = 0; i < 2; i++) {
    const x = tablesX + i * (tableW + 8);
    if (tableW < 32 || x + tableW > w - 4) break;
    clothTable(g, x, by, tableW, 26, (v + i) % 2, lit);
    for (let px = x + 8; px + 8 <= x + tableW - 8; px += 18) {
      panel(g, px, by - 32, 8, 6, D.linen); // place settings
      box(g, px + 10, by - 36, 2, 10, D.glass); // a glass
    }
  }

  hline(g, stageW + 8, ty + 2, w - stageW - 16, D.metalDark); // bunting line
  for (let i = 0, x = stageW + 12; x + 14 <= w - 8; i++, x += 18) {
    const c = pick([PALETTE.amber, D.cross, D.chairB, D.leaf], i + v, PALETTE.amber);
    box(g, x, ty + 4, 14, 2, c);
    box(g, x + 2, ty + 6, 10, 2, c);
    box(g, x + 4, ty + 8, 6, 2, c);
    box(g, x + 6, ty + 10, 2, 2, c);
  }
  for (let i = 0, x = tablesX + 12; i < 4 && x + 12 <= w - 12; i++, x += 44) {
    const c = pick([D.cross, PALETTE.amber, D.chairA, D.leaf], i + v, D.cross);
    box(g, x + 2, ty + 18, 8, 2, INK); // balloon
    box(g, x, ty + 20, 12, 10, c);
    box(g, x + 2, ty + 22, 3, 3, 0xffffff, 0.55);
    box(g, x + 2, ty + 30, 8, 2, INK);
    vline(g, x + 5, ty + 32, 14, D.metalDark, 1);
  }
  if (lit) box(g, 0, y0 + 2, w, 2, D.glow, 0.35);
}

// --- medical ----------------------------------------------------------------
// A red cross sign over a medicine cabinet, three beds behind curtain rails, each with a
// drip stand and a heart monitor, and a reception desk with a screen and a chair.

function drawMedical(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  panel(g, 6, ty, 24, 24, D.linen); // red cross sign
  box(g, 15, ty + 4, 6, 16, D.cross);
  box(g, 10, ty + 9, 16, 6, D.cross);
  panel(g, 8, by - 18, 20, 18, D.tile); // medicine cabinet
  hline(g, 8, by - 10, 20);
  box(g, 16, by - 16, 4, 4, D.cross);
  box(g, 22, by - 6, 2, 2, D.metalDark);

  const deskW = 72;
  const deskX = w - deskW - 20;
  for (let i = 0, x = 40; i < 3 && x + 90 <= deskX - 4; i++, x += 94) {
    hline(g, x - 4, ty - 2, 92, D.metal); // the curtain rail
    panel(g, x - 4, ty, 8, 26, (v + i) % 2 === 0 ? D.glass : D.leaf); // the curtain drawn back
    vline(g, x - 1, ty + 2, 22, 0xffffff, 1);
    bedIcon(g, x + 6, by, 70, 0);
    const sx = x + 78;
    vline(g, sx + 2, by - 40, 40, D.metal); // drip stand
    hline(g, sx, by - 40, 6, D.metal);
    panel(g, sx, by - 38, 6, 10, (v + i) % 2 === 0 ? D.glass : D.linen);
    hline(g, sx - 2, by - 2, 10);
    panel(g, x + 44, ty, 22, 14, D.metalDark); // heart monitor
    box(g, x + 46, ty + 2, 18, 10, lit ? 0x163a24 : D.screenOff);
    if (lit) {
      hline(g, x + 46, ty + 7, 5, D.led, 1); // the trace
      box(g, x + 51, ty + 3, 1, 5, D.led);
      hline(g, x + 52, ty + 8, 3, D.led, 1);
      hline(g, x + 55, ty + 7, 9, D.led, 1);
    }
  }
  panel(g, deskX, by - 24, deskW, 6, D.tile); // reception desk
  panel(g, deskX + 2, by - 18, deskW - 4, 18, D.metal);
  hline(g, deskX + 6, by - 10, deskW - 12);
  box(g, deskX + 32, by - 14, 8, 2, D.cross); // a stripe on the fascia
  monitorIcon(g, deskX + 6, by - 24, 16, 12, lit);
  officeChair(g, deskX + deskW + 2, by, D.chairA);
}

// --- security ---------------------------------------------------------------
// A console of monitors with scan lines, a radio on its charger and a mug, the guard's chair,
// a badge sign, and a pair of lockers.

function drawSecurity(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const deskW = Math.min(148, w - 108);
  for (let i = 0, x = 8; x + 36 <= deskW - 32; i++, x += 44) {
    monitorIcon(g, x, by - 22, 36, 22, lit);
    if (lit) {
      box(g, x + 4, by - 40 + ((i * 5 + v * 3) % 12), 28, 1, PALETTE.carLight, 0.6); // scan line
      box(g, x + 8 + ((i * 7) % 16), by - 36, 6, 10, D.metalDark, 0.5); // someone in the corridor
    }
  }
  panel(g, 4, by - 22, deskW, 6, D.metal); // console top
  panel(g, 6, by - 16, deskW - 4, 16, D.metalDark);
  for (let i = 0, x = 14; x < deskW - 4; i++, x += 12) box(g, x, by - 12, 4, 2, i % 3 === 0 ? D.cross : lit ? D.led : D.metal); // buttons
  panel(g, deskW - 18, by - 32, 8, 10, INK); // radio on its charger
  vline(g, deskW - 16, by - 38, 6, INK);
  box(g, deskW - 16, by - 30, 4, 2, lit ? D.led : D.metal);
  box(g, deskW - 30, by - 28, 6, 6, D.linen); // mug
  officeChair(g, deskW + 4, by, v === 0 ? D.chairA : D.chairB);

  const bx = deskW + 22;
  panel(g, bx, ty, 20, 18, D.chairA); // badge sign
  box(g, bx + 2, ty + 18, 16, 2, D.chairA);
  box(g, bx + 6, ty + 20, 8, 2, D.chairA);
  box(g, bx + 8, ty + 4, 4, 12, PALETTE.amber); // star on the badge
  box(g, bx + 4, ty + 8, 12, 4, PALETTE.amber);

  const lockerX = w - 56;
  if (lockerX > bx + 20) {
    for (let i = 0; i < 2; i++) {
      const lx = lockerX + i * 22;
      panel(g, lx, by - 42, 22, 42, D.metal);
      for (let s = 0; s < 3; s++) hline(g, lx + 6, by - 38 + s * 3, 10, D.metalDark, 1); // vents
      box(g, lx + 16, by - 24, 2, 6, INK); // handle
      box(g, lx + 3, by - 40, 1, 36, 0xffffff, 0.3);
    }
  }
}

// --- housekeeping -----------------------------------------------------------
// A linen shelf, a loaded linen cart, a mop and bucket, an ironing board with an iron, and a
// washing machine whose drum glows while it runs.

function drawHousekeeping(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const shelfW = Math.min(68, Math.floor(w * 0.28));
  linenShelf(g, 6, by, shelfW, 42);
  const cartX = shelfW + 14;
  panel(g, cartX, by - 26, 56, 22, D.metal); // linen cart
  box(g, cartX + 4, by - 36, 32, 10, D.linen); // towels heaped on top
  outline(g, cartX + 4, by - 36, 32, 10, INK);
  hline(g, cartX + 6, by - 32, 28, D.marbleVein, 1);
  box(g, cartX + 36, by - 32, 14, 6, D.blanketA); // a bundle of blue
  hline(g, cartX + 4, by - 16, 48, D.metalDark);
  box(g, cartX + 6, by - 14, 20, 8, D.linen, 0.9); // the lower shelf
  vline(g, cartX + 56, by - 38, 14, D.metalDark); // push handle
  hline(g, cartX + 48, by - 38, 10, D.metalDark);
  box(g, cartX + 6, by - 4, 8, 4, INK); // wheels
  box(g, cartX + 42, by - 4, 8, 4, INK);
  const mopX = cartX + 62;
  panel(g, mopX, by - 14, 16, 14, PALETTE.amber); // bucket
  hline(g, mopX + 2, by - 10, 12, D.binAmber, 1);
  stripe(g, mopX + 12, by - 12, mopX + 20, by - 44, D.wood, 2); // the mop handle
  box(g, mopX + 6, by - 16, 8, 4, D.linen);
  const wmX = w - 54;
  const boardX = mopX + 26;
  if (boardX + 26 <= wmX - 2) {
    box(g, boardX, by - 24, 26, 4, D.linen); // ironing board
    outline(g, boardX, by - 24, 26, 4, INK, 1);
    stripe(g, boardX + 4, by - 20, boardX + 20, by, D.metalDark, 2);
    stripe(g, boardX + 20, by - 20, boardX + 4, by, D.metalDark, 2);
    box(g, boardX + 14, by - 30, 8, 6, D.metal); // iron
    hline(g, boardX + 14, by - 30, 6, INK, 1);
    if (lit) box(g, boardX + 19, by - 28, 2, 2, D.cross);
  }
  if (wmX > cartX + 60) {
    panel(g, wmX, by - 44, 44, 44, D.tile); // washing machine
    hline(g, wmX, by - 34, 44);
    box(g, wmX + 4, by - 42, 16, 6, D.metalDark); // control panel
    box(g, wmX + 34, by - 40, 4, 4, lit ? D.glow : D.metalDark);
    panel(g, wmX + 10, by - 30, 24, 24, D.metal);
    box(g, wmX + 14, by - 26, 16, 16, lit ? PALETTE.windowLit : D.glass);
    outline(g, wmX + 14, by - 26, 16, 16, INK);
    box(g, wmX + 16, by - 18, 12, 6, D.linen, 0.6); // the wash inside the drum
    box(g, wmX + 16, by - 24, 4, 2, 0xffffff, 0.6);
  }
  if (v === 1) picture(g, cartX + 8, ty, 18, 14, D.glass);
  else wallClock(g, cartX + 12, ty + 2);
}

// --- parking ----------------------------------------------------------------

function drawParkingRamp(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  box(g, 0, ty, w, 4, D.metalDark); // the ceiling beam
  hline(g, 0, ty + 4, w);
  const x1 = 6;
  const x2 = w - 6;
  const y1 = by - 4;
  const y2 = ty + 36;
  g.poly([x1 + 40, y1 + 2, x2, y2 + 2, x2, y2 + 10, x1 + 60, y1 + 2]).fill({ color: D.stoneDark, alpha: 0.6 }); // the deck's underside
  stripe(g, x1, y1 + 2, x2, y2 + 2, INK, 2); // the deck of the ramp
  stripe(g, x1, y1 - 3, x2, y2 - 3, D.stripe, 8);
  stripe(g, x1, y1 - 8, x2, y2 - 8, INK, 2);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.3) / n;
    const x = x1 + (x2 - x1) * t;
    const y = y1 - 4 + (y2 - y1) * t;
    box(g, x, y, 10, 2, D.linen); // lane stripes
  }
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = x1 + (x2 - x1) * t;
    const y = y1 - 20 + (y2 - y1) * t;
    vline(g, x, y, 12, D.metal); // guard rail posts
  }
  stripe(g, x1, y1 - 20, x2, y2 - 20, D.metal, 4);
  stripe(g, x1, y1 - 21, x2, y2 - 21, 0xffffff, 1);
  for (let x = 40; x + 12 <= w - 40; x += 60) ceilingLight(g, x, ty + 6, 12, lit);
  panel(g, 8, ty + 8, 18, 18, D.chairA); // the P sign
  box(g, 13, ty + 12, 2, 10, D.linen);
  box(g, 15, ty + 12, 5, 2, D.linen);
  box(g, 15, ty + 16, 5, 2, D.linen);
  box(g, 19, ty + 13, 2, 4, D.linen);
  panel(g, w - 44, ty + 8, 24, 10, D.leaf); // an exit arrow up the ramp
  box(g, w - 40, ty + 12, 12, 2, D.linen);
  box(g, w - 30, ty + 10, 2, 6, D.linen);
  if (v === 1) carSilhouette(g, 12, by, D.carRed, lit);
}

function drawParkingSpace(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  box(g, 0, ty, w, 4, D.metalDark);
  hline(g, 0, ty + 4, w);
  ceilingLight(g, Math.floor(w / 2) - 8, ty + 6, 16, lit);
  vline(g, 2, by - 28, 28, D.linen); // bay lines
  vline(g, w - 4, by - 28, 28, D.linen);
  hline(g, 4, by - 2, w - 8, D.linen);
  box(g, 6, ty + 10, 10, 8, PALETTE.amber); // the bay number
  box(g, 9, ty + 12, 4, 4, INK);
  box(g, Math.floor(w / 2) - 10, by - 4, 20, 2, PALETTE.amber, 0.8); // the wheel stop
  box(g, 10, by - 3, 8, 1, INK, 0.35); // an oil stain
  carSilhouette(g, Math.max(4, Math.floor((w - 48) / 2)), by, v === 0 ? D.carBlue : D.carRed, lit);
}

// --- recycling --------------------------------------------------------------

function drawRecycling(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const balerX = w - 96;
  box(g, 4, y0 + 8, balerX - 8, 6, D.metal); // a duct along the ceiling
  hline(g, 4, y0 + 14, balerX - 8);
  for (let x = 20; x < balerX - 8; x += 40) vline(g, x, y0 + 8, 6, D.metalDark);
  for (let x = 30; x + 12 < balerX; x += 80) ceilingLight(g, x, y0 + 16, 12, lit);
  const beltY = y0 + Math.floor(h / 2) - 8;
  panel(g, 12, beltY, balerX - 20, 10, D.metalDark); // conveyor
  hline(g, 14, beltY + 2, balerX - 24, D.metal);
  for (let x = 16; x < balerX - 12; x += 6) box(g, x, beltY + 6, 2, 2, D.metal, 0.6); // the belt's cleats
  for (let x = 24; x + 8 < balerX - 12; x += 20) {
    panel(g, x, beltY + 10, 8, 8, D.metal); // rollers
    vline(g, x + 3, beltY + 18, by - 52 - (beltY + 18), D.metalDark); // legs
  }
  for (let i = 0, x = 20 + v * 10; x + 12 < balerX - 16; i++, x += 36) {
    const c = pick([D.shelfGoodsA, D.shelfGoodsB, PALETTE.amber, D.glass], i + v, D.shelfGoodsA);
    panel(g, x, beltY - 10, 12, 10, c); // parcels and bottles riding the belt
    if (i % 2 === 0) box(g, x + 16, beltY - 8, 4, 8, D.leaf);
  }
  const bins = [D.binGreen, D.binBlue, D.binAmber] as const;
  for (let i = 0, x = 12; i < 4 && x + 44 <= balerX - 8; i++, x += 52) {
    const c = pick(bins, i + v, D.binGreen);
    panel(g, x, by - 44, 44, 44, c); // bins in a row
    panel(g, x - 2, by - 50, 48, 6, D.metalDark); // lid
    hline(g, x + 4, by - 24, 36, INK);
    box(g, x + 16, by - 40, 12, 12, D.linen, 0.85); // the recycling mark
    box(g, x + 18, by - 38, 8, 8, c);
    box(g, x + 20, by - 36, 4, 4, D.linen, 0.85);
    box(g, x + 4, by - 6, 6, 4, INK); // castors
    box(g, x + 34, by - 6, 6, 4, INK);
  }
  panel(g, balerX, y0 + 8, 84, by - 24 - (y0 + 8), D.metal); // baler
  panel(g, balerX + 8, y0 + 16, 68, 20, D.metalDark); // hopper
  hline(g, balerX + 16, y0 + 36, 52, INK);
  panel(g, balerX + 28, y0 + 40, 28, 20, D.stripe); // ram
  vline(g, balerX + 40, y0 + 60, 16, D.metalDark);
  vline(g, balerX + 44, y0 + 60, 16, D.metalDark);
  box(g, balerX + 68, y0 + 16, 6, 6, lit ? D.glow : D.metalDark);
  box(g, balerX + 68, y0 + 26, 6, 6, D.cross);
  for (let x = balerX; x + 8 <= balerX + 84; x += 16) {
    box(g, x, by - 28, 8, 4, PALETTE.amber); // hazard stripes on the baler's foot
    box(g, x + 8, by - 28, 8, 4, INK);
  }
  for (let i = 0; i < 2; i++) {
    const x = balerX + 12 + i * 36;
    panel(g, x, by - 24, 32, 24, D.shelfGoodsA); // baled output
    vline(g, x + 10, by - 22, 20, D.metal);
    vline(g, x + 22, by - 22, 20, D.metal);
    hline(g, x + 2, by - 14, 28, shade(D.shelfGoodsA, 0.8), 1);
  }
}

// --- metro ------------------------------------------------------------------
// A tiled station hall: a station sign and a departure board, a flight down from the
// concourse, pillars with lamps, a bench and a route map, a platform with its yellow edge and
// tactile strip, and a train at the platform in a tunnel mouth.

function drawMetro(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const platW = Math.floor(w * 0.46);
  const tileLine = shade(PALETTE.wall.metro, 0.93);
  for (let y = y0 + 56; y < by - 36; y += 8) hline(g, 4, y, platW - 8, tileLine, 1); // wall tiles
  for (let x = 12; x < platW - 4; x += 16) vline(g, x, y0 + 56, by - 36 - (y0 + 56), tileLine, 1);

  const tunnelTop = by - 88;
  box(g, platW, tunnelTop, w - platW, by - tunnelTop, D.metalDark, 0.35); // the cut into the tunnel
  g.poly([platW, tunnelTop, platW + 24, tunnelTop - 16, w - 24, tunnelTop - 16, w, tunnelTop]).fill({ color: D.metalDark, alpha: 0.35 }); // the arch
  stripe(g, platW, tunnelTop, platW + 24, tunnelTop - 16, INK);
  hline(g, platW + 24, tunnelTop - 17, w - platW - 48);
  stripe(g, w - 24, tunnelTop - 16, w, tunnelTop, INK);
  const platTop = by - 32;
  panel(g, 0, platTop, platW, 32, D.tile); // platform
  box(g, platW - 10, platTop + 2, 8, 28, PALETTE.amber); // the yellow line at the edge
  for (let y = platTop + 4; y < by - 2; y += 4) box(g, platW - 16, y, 4, 2, D.stripe); // the tactile strip
  for (let x = 12; x + 20 <= platW - 20; x += 28) hline(g, x, platTop + 16, 20, D.marbleVein);
  const railY = by - 8;
  for (let x = platW + 4; x + 8 < w - 4; x += 16) box(g, x, railY + 2, 10, 6, D.woodDark); // sleepers
  hline(g, platW, railY, w - platW, D.rail);
  hline(g, platW, railY, w - platW, 0xffffff, 1);

  const trainX = platW + 8;
  const trainW = w - trainX - 12;
  const trainTop = railY - 68;
  panel(g, trainX, trainTop, trainW, 60, D.metal); // train
  box(g, trainX + trainW - 12, trainTop, 12, 8, PALETTE.wall.metro); // the nose tapers
  box(g, trainX + trainW - 6, trainTop + 8, 6, 6, PALETTE.wall.metro);
  hline(g, trainX + trainW - 12, trainTop + 8, 6);
  hline(g, trainX + trainW - 6, trainTop + 14, 6);
  box(g, trainX + 2, trainTop + 2, trainW - 16, 2, 0xffffff, 0.4); // the roof catching the light
  box(g, trainX + 2, trainTop + 40, trainW - 4, 8, v === 0 ? D.chairA : D.cross); // livery band
  for (let i = 0, x = trainX + 8; x + 28 <= trainX + trainW - 16; i++, x += 40) {
    if (i % 2 === 0) {
      panel(g, x, trainTop + 10, 28, 24, lit ? PALETTE.windowLit : D.glass); // windows
      if (!lit) box(g, x + 4, trainTop + 14, 6, 2, 0xffffff, 0.5);
      else box(g, x + 8, trainTop + 20, 6, 12, D.metalDark, 0.5); // a passenger
    } else {
      panel(g, x, trainTop + 8, 28, 44, D.metalDark); // doors
      box(g, x + 2, trainTop + 12, 24, 16, lit ? PALETTE.windowLit : D.glass);
      vline(g, x + 13, trainTop + 10, 40, D.metal);
    }
  }
  for (let x = trainX + 12; x + 20 <= trainX + trainW - 12; x += 52) {
    box(g, x, trainTop + 60, 20, 8, INK); // bogies
    box(g, x + 4, trainTop + 62, 4, 4, D.metal);
    box(g, x + 12, trainTop + 62, 4, 4, D.metal);
  }
  box(g, trainX + trainW - 6, trainTop + 30, 4, 4, lit ? D.glow : D.linen); // headlight

  panel(g, 16, y0 + 16, 124, 28, D.chairA); // station sign
  vline(g, 40, y0 + 4, 12, D.metalDark);
  vline(g, 116, y0 + 4, 12, D.metalDark);
  box(g, 22, y0 + 22, 14, 14, D.cross); // the line roundel
  box(g, 24, y0 + 27, 10, 4, D.linen);
  for (let i = 0; 42 + i * 12 + 8 <= 132; i++) box(g, 42 + i * 12, y0 + 24, 8, 12, D.linen);
  panel(g, 156, y0 + 16, 88, 22, INK); // departure board
  for (let r = 0; r < 2; r++) {
    for (let i = 0; 160 + i * 8 + 6 <= 240; i++) {
      if (i % 5 !== 4) box(g, 160 + i * 8, y0 + 20 + r * 8, 6, 4, lit ? PALETTE.amber : D.binAmber);
    }
  }
  wallClock(g, 252, y0 + 20);
  // a flight down from the concourse, so the platform is not a field of empty gray
  const stW = 12;
  const stH = 10;
  for (let i = 0; i < 6; i++) {
    const sx = platW - 20 - (i + 1) * stW;
    const sy = platTop - 60 + i * stH;
    if (sx < 8) break;
    box(g, sx, sy, stW + 2, 4, D.metal);
    hline(g, sx, sy, stW + 2);
    vline(g, sx, sy + 4, stH - 4, D.metalDark);
  }
  stripe(g, platW - 20, platTop - 76, platW - 20 - 6 * stW, platTop - 26, D.metalDark, 2); // its handrail
  panel(g, 24, platTop - 18, 40, 6, D.wood); // a bench on the platform
  vline(g, 26, platTop - 12, 12, D.metalDark);
  vline(g, 60, platTop - 12, 12, D.metalDark);
  panel(g, 24, platTop - 30, 40, 4, D.wood);
  panel(g, 72, platTop - 36, 18, 36, D.chairA); // a route map
  for (let i = 0; i < 4; i++) box(g, 76, platTop - 32 + i * 8, 10, 2, pick([D.cross, D.leaf, PALETTE.amber, D.glass], i, D.cross));
  for (let x = 108; x + 8 < platW - 90; x += 68) {
    panel(g, x, y0 + 52, 8, platTop - (y0 + 52), D.metal); // pillars
    box(g, x + 2, y0 + 54, 1, platTop - (y0 + 56), 0xffffff, 0.4);
    box(g, x - 6, y0 + 44, 20, 8, lit ? D.glow : D.metalDark);
    outline(g, x - 6, y0 + 44, 20, 8, INK);
  }
}

// --- cathedral --------------------------------------------------------------
// A nave in section: tall lancet windows of coloured glass between stone columns under
// pointed vaults, a rose window over the altar, a red runner down the aisle between the pews,
// chandeliers, and the organ at the right end.

function roseWindow(g: Graphics, cx: number, cy: number, r: number, v: number, lit: boolean): void {
  const panes = [D.curtain, D.glass, PALETTE.amber, D.leaf, D.chairB] as const;
  for (let y = -r; y < r; y += 2) {
    const half = Math.floor(Math.sqrt(Math.max(0, r * r - (y + 1) * (y + 1))) / 2) * 2;
    box(g, cx - half, cy + y, half * 2, 2, D.stoneDark); // the stone disc
  }
  const ri = r - 4;
  for (let y = -ri; y < ri; y += 2) {
    for (let x = -ri; x < ri; x += 2) {
      const d = Math.hypot(x + 1, y + 1);
      if (d > ri) continue;
      const angle = (Math.atan2(y + 1, x + 1) + Math.PI) / (2 * Math.PI); // 0 to 1 round the circle
      const spoke = Math.floor(angle * 12);
      const edge = Math.abs(angle * 12 - Math.round(angle * 12)) * d < 1.1; // a spoke of tracery
      const ring = d < 8 ? 0 : 1;
      const tracery = (d > 7 && d < 9.5) || (d > 8 && edge);
      box(g, cx + x, cy + y, 2, 2, tracery ? D.stone : pick(panes, ring * 3 + spoke + v, D.glass));
    }
  }
  box(g, cx - 3, cy - 3, 6, 6, PALETTE.amber); // the boss at the centre
  if (lit) {
    for (let y = -ri; y < ri; y += 2) {
      const half = Math.floor(Math.sqrt(Math.max(0, ri * ri - (y + 1) * (y + 1))) / 2) * 2;
      box(g, cx - half, cy + y, half * 2, 2, PALETTE.windowLit, 0.35);
    }
  }
}

/** A pew in section: its back, the seat and a front leg, facing the altar. */
function pew(g: Graphics, x: number, by: number, faceRight: boolean): void {
  const backX = faceRight ? x : x + 18;
  box(g, backX, by - 30, 4, 30, D.woodDark); // the back
  box(g, backX, by - 32, 4, 2, D.wood); // its capping
  box(g, faceRight ? x + 4 : x, by - 14, 18, 4, D.wood); // the seat
  hline(g, faceRight ? x + 4 : x, by - 14, 18, D.woodLight, 1);
  vline(g, faceRight ? x + 18 : x + 2, by - 10, 10, D.woodDark); // the front leg
  box(g, faceRight ? x + 6 : x + 6, by - 4, 10, 2, D.curtain); // a kneeler
}

function drawCathedral(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_PX;
  const organX = w - 80;
  const winTop = y0 + 28;
  const winBot = by - 84;
  const panes = [D.curtain, D.glass, PALETTE.amber, D.leaf] as const;
  const bays: number[] = [];
  for (let x = 20; x + 60 <= organX - 12; x += 92) bays.push(x);
  const altarBay = Math.floor((bays.length - 1) / 2);
  bays.forEach((x, i) => {
    if (i === altarBay) return; // the rose window takes this bay
    // a tall lancet, pointed at the top, with coloured panes
    for (let s = 0; s < 6; s++) {
      const inset = [26, 18, 12, 8, 4, 2][s] as number;
      box(g, x + inset, winTop + s * 4, 60 - inset * 2, 4, D.stone);
      box(g, x + inset + 2, winTop + s * 4 + 2, 56 - inset * 2, 4, lit ? PALETTE.windowLit : pick(panes, i + v + s, D.glass));
    }
    box(g, x + 2, winTop + 24, 56, winBot - winTop - 24, D.stone);
    for (let py = winTop + 26; py + 12 <= winBot - 2; py += 14) {
      for (let px = x + 6; px + 12 <= x + 54; px += 14) {
        box(g, px, py, 12, 12, pick(panes, px / 2 + py / 2 + v, D.glass));
        box(g, px + 1, py + 1, 3, 1, 0xffffff, 0.4);
        if (lit) box(g, px, py, 12, 12, PALETTE.windowLit, 0.4);
      }
    }
    vline(g, x + 29, winTop + 24, winBot - winTop - 24, D.stoneDark); // the mullion
    outline(g, x, winTop + 22, 60, winBot - winTop - 20, D.stoneDark);
  });
  // vaulting: a pointed arch from column to column
  for (let x = 14; x + 92 <= organX + 8; x += 92) {
    g.moveTo(x, winTop - 12).quadraticCurveTo(x + 46, y0 - 8, x + 92, winTop - 12).stroke({ color: D.stoneDark, width: LINE_PX });
  }
  for (let x = 8; x + 12 <= organX - 4; x += 92) {
    panel(g, x, winTop - 8, 12, by - winTop + 8, D.stone, D.stoneDark); // columns
    vline(g, x + 3, winTop - 4, by - winTop, 0xffffff, 1);
    panel(g, x - 2, winTop - 12, 16, 8, D.stoneDark, D.stoneDark); // capital
    panel(g, x - 2, by - 8, 16, 8, D.stoneDark, D.stoneDark); // base
  }

  // the organ: a case of pipes at the right end, the tallest in the middle
  const caseTop = y0 + 20;
  const caseBot = by - 48;
  panel(g, organX, caseTop, 68, caseBot - caseTop, D.woodDark);
  box(g, organX - 4, caseTop - 6, 76, 6, D.wood); // the cornice
  hline(g, organX - 4, caseTop - 6, 76);
  const foot = caseBot - 16; // the pipe mouths line up along here
  const pipes = 6;
  for (let i = 0; i < pipes; i++) {
    const x = organX + 6 + i * 10;
    const rank = Math.min(i, pipes - 1 - i); // 0 at the ends, 2 in the middle
    const ph = Math.round((foot - caseTop - 12) * (0.55 + rank * 0.2));
    box(g, x, foot - ph, 8, ph, D.gold);
    outline(g, x, foot - ph, 8, ph, INK);
    box(g, x + 2, foot - ph + 2, 1, ph - 10, 0xffffff, 0.5);
    box(g, x + 2, foot - 8, 4, 3, INK); // the mouth of the pipe
  }
  hline(g, organX + 2, foot + 2, 64, D.wood); // the pipe shelf
  panel(g, organX + 4, by - 48, 60, 8, D.wood); // the console shelf
  panel(g, organX + 16, by - 40, 36, 40, D.woodDark);
  box(g, organX + 20, by - 36, 28, 6, D.linen); // keyboard
  outline(g, organX + 20, by - 36, 28, 6, INK);
  for (let x = organX + 22; x < organX + 46; x += 6) vline(g, x, by - 36, 4);
  hline(g, organX + 20, by - 24, 28, D.wood); // stop rails
  hline(g, organX + 20, by - 16, 28, D.wood);
  box(g, organX + 22, by - 28, 4, 2, D.cross);
  box(g, organX + 40, by - 28, 4, 2, D.linen);

  // the altar on its steps, a cross above it and the rose window above that
  const altarCx = (bays[altarBay] ?? Math.floor(organX / 2) - 30) + 30;
  const ax = altarCx - 24;
  roseWindow(g, altarCx, winTop + 36, 30, v, lit);
  box(g, ax - 8, by - 8, 64, 8, D.stone);
  hline(g, ax - 8, by - 8, 64, D.stoneDark);
  box(g, ax - 4, by - 12, 56, 4, D.stone);
  hline(g, ax - 4, by - 12, 56, D.stoneDark);
  panel(g, ax, by - 32, 48, 20, D.linen);
  box(g, ax + 2, by - 30, 44, 4, D.cross); // the altar frontal
  box(g, ax + 20, by - 68, 8, 36, D.gold);
  box(g, ax + 10, by - 58, 28, 8, D.gold);
  outline(g, ax + 20, by - 68, 8, 36, INK);
  for (const cx of [ax + 4, ax + 40]) {
    box(g, cx, by - 42, 4, 10, D.linen); // candles
    box(g, cx + 1, by - 46, 2, 4, lit ? D.glow : D.woodDark);
  }

  // the red runner down the aisle to the altar
  box(g, 4, by - 4, organX - 8, 4, D.carpet);
  hline(g, 4, by - 4, organX - 8, D.gold, 1);
  // pews in section, rank on rank along the nave, all facing the altar, the aisle clear before it
  for (let x = 24; x + 22 <= organX - 8; x += 30) {
    if (x < ax + 62 && x + 22 > ax - 18) continue;
    pew(g, x, by - 4, x < ax);
  }
  // chandeliers hanging down the mullions, lit below the glass
  bays.forEach((x, i) => {
    if (i === altarBay) return;
    const cx = x + 30;
    vline(g, cx, winTop + 20, winBot - winTop - 8, D.metalDark, 1);
    box(g, cx - 14, winBot + 12, 28, 2, D.gold);
    box(g, cx - 2, winBot + 14, 4, 4, D.gold);
    for (let c = 0; c < 5; c++) {
      box(g, cx - 14 + c * 6, winBot + 6, 2, 6, D.linen);
      box(g, cx - 14 + c * 6, winBot + 4, 2, 2, lit ? D.glow : D.woodDark);
    }
  });
  if (lit) box(g, 0, y0 + 2, w, 4, D.glow, 0.25);
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
 * at (6, 8) with two panels that slide outward, a 4 px bottom plate. `door` is how far the
 * panels have slid, 0 closed to 1 open: each panel travels 8 px of its 22 at 1 (Astra
 * section 1), scaled with the car, and the renderer tweens between five baked positions.
 */
function drawCar(g: Graphics, kind: ShaftKind, w: number, bodyH: number, door: number): void {
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
  box(g, ox, oy, ow, oh, PALETTE.carLight, 0.3); // the car is lit inside, full or empty
  const panelW = Math.floor(ow / 2);
  const open = Math.min(1, Math.max(0, door));
  // Each panel slides outward, clipped to the opening: drawn narrower, never outside it.
  const slide = Math.round(((panelW * 8) / 22) * open);
  const leftW = panelW - slide;
  const rightX = ox + panelW + slide;
  const rightW = ox + ow - rightX;
  box(g, ox, oy, leftW, oh, PALETTE.carDoor);
  box(g, rightX, oy, rightW, oh, PALETTE.carDoor);
  if (slide > 0) {
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
 * The limbs of one walk frame. 0 stands, arms hanging and legs upright; 1 strides, the
 * leading leg reaching out to the edge of the box and the far arm swinging back; 2 is 1
 * mirrored. Only the limbs mirror: what a person carries stays in the same hand.
 */
function drawLimbs(g: Graphics, frame: SimFrame, body: number): void {
  if (frame === 0) {
    box(g, 2, 12, 2, 14, body); // arms hanging
    box(g, 12, 12, 2, 14, body);
    box(g, 4, 28, 2, 20, body); // legs upright, a four pixel gap between them
    box(g, 10, 28, 2, 20, body);
    return;
  }
  const m = frame === 2;
  const at = (x: number, y: number, w: number, h: number): void => box(g, m ? SIM_W - x - w : x, y, w, h, body);
  at(2, 14, 2, 12); // the near arm swinging forward and down
  at(12, 10, 2, 12); // the far arm swinging back and up
  at(4, 28, 2, 6); // the leading leg: hip, knee, then planted out wide
  at(2, 34, 2, 8);
  at(0, 42, 4, 6);
  at(10, 28, 2, 10); // the trailing leg, pushing off behind
  at(12, 38, 2, 8);
  at(12, 46, 4, 2);
}

/**
 * A person, 16 by 48: a straight double of the 0.3 figure. The feet fill the bottom rows so
 * the sprite's lower edge lands on the slab line, and the top four rows stay clear for a hat.
 * Head 8 by 4 with its top corners rounded, a neck notch, torso 18, legs 20. The outfit (a
 * colour set, a coat, a hat, a bag) is drawn in accents so the stress colour still carries
 * the head, the arms, the legs and the middle of the body. Nothing may reach outside the box:
 * at one tile wide the figures stand shoulder to shoulder in a lift queue, so a stray pixel
 * lands on the neighbor.
 */
function drawSim(g: Graphics, kind: SimKind, band: StressBand, frame: SimFrame, outfit: number): void {
  const body = band === 'calm' ? PALETTE.sim.calm : band === 'pink' ? PALETTE.sim.pink : PALETTE.sim.red;
  box(g, 5, 4, 6, 1, body); // crown, one pixel in at each corner
  box(g, 4, 5, 8, 3, body); // head
  box(g, 6, 8, 4, 2, body); // neck, the notch that separates head from shoulders
  box(g, 4, 10, 8, 18, body); // torso
  drawLimbs(g, frame, body);
  if (outfit >= 0) {
    const o = decodeOutfit(outfit);
    const { main, trim } = OUTFIT_COLOURS[o.colours];
    if (o.coat) {
      box(g, 4, 10, 2, 20, main); // the coat's two fronts, open over the body, to below the hip
      box(g, 10, 10, 2, 20, main);
      box(g, 6, 10, 1, 3, main); // lapels
      box(g, 9, 10, 1, 3, main);
    } else {
      box(g, 4, 26, 8, 2, trim); // a belt
    }
    if (o.hat && kind !== 'vip') {
      box(g, 5, 1, 6, 3, main); // crown of the hat
      box(g, 3, 3, 10, 2, main); // brim
    }
    if (o.bag) {
      box(g, 3, 12, 1, 8, trim); // the strap
      box(g, 0, 20, 4, 6, trim); // a bag at the hip
      box(g, 0, 20, 4, 1, INK);
    }
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

/** Draws a room into a container: the shell, the interior once per floor or once across the full height, the outline. */
function roomContainer(kind: RoomKind, tiles: number, floors: number, v: number, state: WindowState): Container {
  const { width: w, height: h } = TEXTURE_SIZE.room(tiles, floors);
  const lit = state === 'lit';
  const lamp = lit || state === 'housekeeping';
  const root = new Container();
  const g = new Graphics();
  drawShell(g, kind, w, h, state);
  const full = FULL_HEIGHT.has(kind);
  if (full) drawNativeInterior(g, kind, 0, w, h, v, lit, lamp);
  else for (let f = 0; f < floors; f++) drawNativeInterior(g, kind, f * FLOOR_PX, w, FLOOR_PX, v, lit, lamp);
  drawCellOutline(g, w, h, floors, !full);
  root.addChild(g);
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
    room(kind, width, height, variant, state) {
      const tiles = Math.max(1, Math.round(width));
      const floors = Math.max(1, Math.round(height));
      const v = ((Math.round(variant) % 2) + 2) % 2;
      const { width: w, height: h } = TEXTURE_SIZE.room(tiles, floors);
      return bakeTarget(`room:${kind}:${tiles}:${floors}:${v}:${state}`, w, h, () =>
        roomContainer(kind, tiles, floors, v, state),
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

    car(kind, door) {
      const { width: w, height: h } = TEXTURE_SIZE.car(kind);
      const frame = doorFrameOf(door);
      return bake(`car:${kind}:${frame}`, w, h, (g) => drawCar(g, kind, w, h - CAR_SHADOW_PX, DOOR_FRAMES[frame]));
    },

    sim(kind, band, frame, outfit) {
      const { width: w, height: h } = TEXTURE_SIZE.sim();
      const f: SimFrame = frame === 1 || frame === 2 ? frame : 0;
      const o = outfit === undefined || outfit < 0 ? -1 : Math.trunc(outfit);
      return bake(`sim:${kind}:${band}:${f}:${o}`, w, h, (g) => drawSim(g, kind, band, f, o));
    },

    ghost(widthTiles, heightFloors, ok) {
      const tiles = Math.max(1, Math.round(widthTiles));
      const floors = Math.max(1, Math.round(heightFloors));
      const { width: w, height: h } = TEXTURE_SIZE.ghost(tiles, floors);
      return bake(`ghost:${tiles}:${floors}:${ok ? 1 : 0}`, w, h, (g) => drawGhost(g, w, h, ok));
    },
  };
}

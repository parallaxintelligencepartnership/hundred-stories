// Procedural pixel art for the tower cross section. See docs/VISUAL.md and docs/DESIGN.md section 9.
// No image assets: every texture is baked from Graphics primitives once and cached by key.
// Drawing is done on an integer pixel grid at resolution 1 with antialias off so the art stays
// crisp at the snapped zoom steps (0.5, 1, 2, 3).

import { Graphics, Rectangle } from 'pixi.js';
import type { Renderer, Texture } from 'pixi.js';
import type { RoomKind, ShaftKind, SimKind, StressBand } from '../sim/types';
import { SHAFTS } from '../sim/rules';

export const TILE_PX = 8;
export const FLOOR_PX = 36;

export interface Art {
  room(kind: RoomKind, width: number, height: number, variant: number, lit: boolean): Texture;
  slab(widthTiles: number): Texture;
  shaft(kind: ShaftKind, floors: number): Texture;
  car(kind: ShaftKind, doorsOpen: boolean): Texture;
  sim(kind: SimKind, band: StressBand, frame: 0 | 1): Texture;
  ghost(widthTiles: number, heightFloors: number, ok: boolean): Texture;
}

// ---------------------------------------------------------------------------
// Palette. Every color the art uses lives here. World tokens come from VISUAL.md;
// the furniture shades below are new, kept muted so lit windows and stress tints carry the signal.
// ---------------------------------------------------------------------------

const PALETTE = {
  outline: 0x222222, // every room cell is boxed in this
  slab: 0xe6e6e6,
  slabEdge: 0x333333,
  windowDay: 0x7fb6e0,
  windowLit: 0xffd866,
  windowUnlit: 0x2a3550,
  windowFrame: 0x222222,
  amber: 0xf0c419,
  alert: 0xff5c4d,
  ghostOk: 0x5fd38a,
  shaftCavity: 0x3b3f47,
  shaftRail: 0xd8dbe0,
  shaftFloorMark: 0x222222,
  carBody: 0xf0c419,
  carTrim: 0x222222,
  carDoor: 0xf7d54a,
  carInterior: 0x3b3f47,
  carLight: 0xfff3b0,
  sim: { calm: 0x111111, pink: 0xff7ad9, red: 0xff2d2d },
  simAccent: 0xffffff,
  // Flat, bright wall color per kind, the way the original reads at 1x.
  wall: {
    lobby: 0xf8f8f6,
    skyLobby: 0xf8f8f6,
    stairs: 0xd9dde2,
    escalator: 0xd3dae2,
    office: 0xf7f5ee,
    condo: 0xf2e8d8,
    hotelSingle: 0xeef2f7,
    hotelTwin: 0xeef2f7,
    hotelSuite: 0xeef2f7,
    fastFood: 0xfff1c9,
    restaurant: 0xf3e3e3,
    shop: 0xe9f2e4,
    cinema: 0x2b2b3a,
    partyHall: 0xf5e8f2,
    medical: 0xf2f8f7,
    security: 0xe4e8ee,
    housekeeping: 0xeeeae2,
    parkingRamp: 0x8d9199,
    parkingSpace: 0x8d9199,
    recycling: 0xdfe6dc,
    metro: 0xc9ced8,
    cathedral: 0xf4efe4,
  } as Record<RoomKind, number>,
  // Interiors are drawn in dark saturated inks so they read against the light walls.
  detail: {
    metal: 0x5a6472,
    metalDark: 0x333a44,
    wood: 0xa9702f,
    woodDark: 0x6b4420,
    linen: 0xf7f7f2,
    pillow: 0xffffff,
    blanketA: 0x2f5c9e,
    blanketB: 0x8c3050,
    marble: 0xf8f8f6,
    marbleVein: 0xc9c4b8,
    column: 0x3a3a3a,
    carpet: 0x8c2f3c,
    chairA: 0x2b5ea8,
    chairB: 0x6a3a97,
    screenOn: 0x8fd4ff,
    screenOff: 0x33404d,
    glow: 0xffd866,
    pot: 0xa4522c,
    leaf: 0x2f7d3a,
    counter: 0xa9702f,
    tile: 0xeef2f5,
    cross: 0xd22b2b,
    shelfGoodsA: 0xd2761f,
    shelfGoodsB: 0x1f7d7d,
    seatA: 0x9c2b2b,
    seatB: 0x2b3f9c,
    curtain: 0x8c1f3d,
    stripe: 0x555b63,
    carRed: 0xc03028,
    carBlue: 0x2f5c9e,
    binGreen: 0x2f7d3a,
    binBlue: 0x2f5c9e,
    binAmber: 0xd28c1f,
    rail: 0x5a6472,
    stone: 0x8e87a3,
    stoneDark: 0x6c6482,
    gold: 0xc9a227,
    glass: 0x7fb6e0,
    dark: 0x222222,
  },
} as const;

const SLAB_H = 3; // the slab is the bottom 3 px of a floor band (renderer.SLAB_TOP_PX)
const INK = 0x222222; // every silhouette is drawn in 1 px of this against the light walls

// The window band is a head rail, a row of panes with mullions, and a sill line, so the
// top of a room reads as a window instead of a black bar across the whole floor.
const WIN_TOP = 2;
const WIN_H = 6;
const WIN_PANE = 6;
const WIN_STEP = 8; // one pane per tile
const SILL = WIN_TOP + WIN_H + 1; // 9
const INTERIOR_TOP = SILL + 2; // 11: first free row under the windows
const OPEN_TOP = 2; // first free row for a kind with no window band

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

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function box(g: Graphics, x: number, y: number, w: number, h: number, color: number, alpha = 1): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw <= 0 || rh <= 0) return;
  g.rect(rx, ry, rw, rh).fill({ color, alpha });
}

function stripe(g: Graphics, x1: number, y1: number, x2: number, y2: number, color: number, width = 1): void {
  g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width, alignment: 0.5, cap: 'butt' });
}

function outline(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  box(g, x, y, w, 1, color);
  box(g, x, y + h - 1, w, 1, color);
  box(g, x, y, 1, h, color);
  box(g, x + w - 1, y, 1, h, color);
}

/** A filled shape with a 1 px line around it: the unit every piece of furniture is built from. */
function panel(g: Graphics, x: number, y: number, w: number, h: number, fill: number, ink = INK): void {
  box(g, x, y, w, h, fill);
  outline(g, x, y, w, h, ink);
}

function hline(g: Graphics, x: number, y: number, w: number, color = INK): void {
  box(g, x, y, w, 1, color);
}

function vline(g: Graphics, x: number, y: number, h: number, color = INK): void {
  box(g, x, y, 1, h, color);
}

function pick(list: readonly number[], i: number, fallback: number): number {
  return list[((i % list.length) + list.length) % list.length] ?? fallback;
}

// ---------------------------------------------------------------------------
// Shared furniture. Every icon is drawn from its baseline `by`, the first row of the
// floor slab, so a piece sits on the floor no matter which floor band it lands in.
// ---------------------------------------------------------------------------

function plantIcon(g: Graphics, x: number, by: number): void {
  const leaf = PALETTE.detail.leaf;
  box(g, x + 2, by - 14, 3, 1, leaf);
  box(g, x + 1, by - 13, 5, 1, leaf);
  box(g, x, by - 12, 7, 1, leaf);
  box(g, x + 1, by - 11, 5, 1, leaf);
  box(g, x + 2, by - 10, 3, 1, leaf);
  vline(g, x + 3, by - 10, 5, PALETTE.detail.woodDark);
  panel(g, x + 1, by - 5, 5, 5, PALETTE.detail.pot);
}

function picture(g: Graphics, x: number, y: number, w: number, h: number, sky: number): void {
  panel(g, x, y, w, h, PALETTE.detail.gold);
  box(g, x + 1, y + 1, w - 2, h - 2, sky);
  box(g, x + 1, y + h - 3, w - 2, 2, PALETTE.detail.leaf); // ground
  box(g, x + 3, y + h - 5, 3, 2, PALETTE.detail.stoneDark); // a hill in the middle distance
}

function wallClock(g: Graphics, x: number, y: number): void {
  box(g, x + 1, y, 3, 1, INK);
  box(g, x, y + 1, 1, 3, INK);
  box(g, x + 4, y + 1, 1, 3, INK);
  box(g, x + 1, y + 4, 3, 1, INK);
  box(g, x + 1, y + 1, 3, 3, PALETTE.detail.linen);
  box(g, x + 2, y + 1, 1, 2, INK); // hands
  box(g, x + 2, y + 2, 2, 1, INK);
}

function floorLampIcon(g: Graphics, x: number, by: number, lit: boolean): void {
  box(g, x + 1, by - 2, 6, 2, PALETTE.detail.metalDark);
  hline(g, x + 1, by - 2, 6);
  box(g, x + 3, by - 16, 2, 14, PALETTE.detail.metal);
  hline(g, x + 2, by - 21, 4); // shade top
  box(g, x + 1, by - 20, 6, 4, lit ? PALETTE.windowLit : PALETTE.detail.linen);
  vline(g, x + 1, by - 20, 4);
  vline(g, x + 6, by - 20, 4);
  hline(g, x, by - 16, 8);
}

function tableLamp(g: Graphics, x: number, by: number, lit: boolean): void {
  box(g, x + 1, by - 4, 3, 4, PALETTE.detail.metal);
  hline(g, x, by - 7, 5);
  box(g, x, by - 6, 5, 2, lit ? PALETTE.windowLit : PALETTE.detail.linen);
  hline(g, x, by - 4, 5);
}

function monitorIcon(g: Graphics, x: number, by: number, w: number, h: number, lit: boolean): void {
  panel(g, x, by - h, w, h, PALETTE.detail.metalDark);
  box(g, x + 1, by - h + 1, w - 2, h - 3, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  if (lit) box(g, x + 1, by - h + 1, w - 2, 1, PALETTE.carLight); // the glow off the top of the tube
}

function deskWithMonitor(g: Graphics, x: number, by: number, lit: boolean, chairColor: number): void {
  monitorIcon(g, x + 1, by - 10, 7, 7, lit);
  box(g, x, by - 10, 10, 2, PALETTE.detail.wood); // desk top
  hline(g, x, by - 10, 10);
  vline(g, x + 1, by - 8, 8, PALETTE.detail.woodDark);
  vline(g, x + 8, by - 8, 8, PALETTE.detail.woodDark);
  officeChair(g, x + 10, by, chairColor);
}

function officeChair(g: Graphics, x: number, by: number, color: number): void {
  panel(g, x + 1, by - 17, 4, 10, color); // padded back
  panel(g, x, by - 8, 6, 3, color); // seat
  vline(g, x + 2, by - 5, 4, PALETTE.detail.metalDark); // gas post
  hline(g, x, by - 1, 6); // star base
  box(g, x, by - 2, 2, 1, INK); // casters
  box(g, x + 4, by - 2, 2, 1, INK);
}

function diningChair(g: Graphics, x: number, by: number, color: number, faceRight: boolean): void {
  const back = faceRight ? x : x + 3;
  panel(g, back, by - 16, 3, 16, color); // back with a slat
  box(g, x, by - 9, 6, 3, color); // seat
  outline(g, x, by - 9, 6, 3, INK);
  vline(g, faceRight ? x + 5 : x, by - 6, 6, PALETTE.detail.woodDark); // front leg
}

function stool(g: Graphics, x: number, by: number): void {
  box(g, x, by - 10, 8, 2, PALETTE.detail.seatA);
  hline(g, x, by - 10, 8);
  box(g, x + 3, by - 8, 2, 7, PALETTE.detail.metal);
  hline(g, x + 1, by - 4, 6, PALETTE.detail.metal); // foot ring
  hline(g, x + 1, by - 1, 6);
}

function bedIcon(g: Graphics, x: number, by: number, w: number, v: number, headLeft = true): void {
  const blanket = v === 0 ? PALETTE.detail.blanketA : PALETTE.detail.blanketB;
  const hb = 4;
  const hx = headLeft ? x : x + w - hb;
  box(g, hx, by - 16, hb, 16, PALETTE.detail.wood); // headboard
  hline(g, hx, by - 16, hb);
  vline(g, headLeft ? hx : hx + hb - 1, by - 16, 16); // only the outer edge is inked
  vline(g, headLeft ? hx + hb - 1 : hx, by - 16, 6); // the board reads above the mattress
  hline(g, hx + 1, by - 14, hb - 2, PALETTE.detail.woodDark); // a rail across the board
  const mx = headLeft ? x + hb : x;
  const mw = w - hb;
  panel(g, mx, by - 6, mw, 6, PALETTE.detail.woodDark); // base
  panel(g, mx, by - 10, mw, 5, PALETTE.detail.linen); // mattress and sheet
  const pw = Math.min(6, Math.max(3, mw - 6));
  panel(g, headLeft ? mx + 1 : mx + mw - pw - 1, by - 13, pw, 3, PALETTE.detail.pillow);
  const bw = Math.min(10, Math.max(3, mw - 8));
  const bx = headLeft ? mx + mw - bw - 1 : mx + 1;
  box(g, bx, by - 9, bw, 3, blanket);
  hline(g, bx, by - 9, bw);
}

function sofaIcon(g: Graphics, x: number, by: number, w: number, back: number, seat: number): void {
  panel(g, x + 3, by - 14, w - 6, 8, back); // backrest
  panel(g, x, by - 11, 4, 11, back); // arms
  panel(g, x + w - 4, by - 11, 4, 11, back);
  panel(g, x + 3, by - 7, w - 6, 7, seat); // cushions
  for (let cx = x + 3 + Math.floor((w - 6) / 2); cx < x + w - 5; cx += Math.max(8, Math.floor((w - 6) / 2))) {
    vline(g, cx, by - 6, 5);
  }
}

function lowTable(g: Graphics, x: number, by: number, w: number, v: number): void {
  box(g, x, by - 6, w, 2, PALETTE.detail.wood);
  hline(g, x, by - 6, w);
  vline(g, x + 1, by - 4, 4, PALETTE.detail.woodDark);
  vline(g, x + w - 2, by - 4, 4, PALETTE.detail.woodDark);
  box(g, x + Math.floor(w / 2) - 1, by - 9, 3, 3, v === 0 ? PALETTE.detail.leaf : PALETTE.detail.cross);
  hline(g, x + Math.floor(w / 2) - 1, by - 9, 3);
}

function clothTable(g: Graphics, x: number, by: number, w: number, h: number, v: number): void {
  panel(g, x, by - h, w, h, PALETTE.detail.linen);
  hline(g, x + 1, by - h + 3, w - 2, PALETTE.detail.marbleVein); // the fall of the cloth
  const cx = x + Math.floor(w / 2) - 1;
  box(g, cx, by - h - 4, 3, 4, v === 0 ? PALETTE.detail.cross : PALETTE.detail.leaf);
  hline(g, cx, by - h - 4, 3);
}

function shelfUnit(g: Graphics, x: number, by: number, w: number, h: number, v: number): void {
  panel(g, x, by - h, w, h, PALETTE.detail.woodDark);
  const rows = Math.max(2, Math.round((h - 2) / 7));
  const step = Math.floor((h - 2) / rows);
  for (let r = 0; r < rows; r++) {
    const top = by - h + 1 + r * step;
    hline(g, x + 1, top + step - 1, w - 2, PALETTE.detail.wood); // the shelf board
    for (let i = 0; x + 2 + i * 5 + 4 <= x + w - 1; i++) {
      const c = (i + r + v) % 3 === 0 ? PALETTE.detail.shelfGoodsA : (i + r + v) % 3 === 1 ? PALETTE.detail.shelfGoodsB : PALETTE.amber;
      box(g, x + 2 + i * 5, top + 1, 4, step - 2, c);
      outline(g, x + 2 + i * 5, top + 1, 4, step - 2, INK);
    }
  }
}

function linenShelf(g: Graphics, x: number, by: number, w: number, h: number): void {
  panel(g, x, by - h, w, h, PALETTE.detail.metal);
  const shelves = 3;
  const step = Math.floor(h / shelves);
  for (let s = 1; s <= shelves; s++) {
    const y = by - h + s * step;
    hline(g, x + 1, y, w - 2);
    for (let i = 0; x + 2 + i * 8 + 7 <= x + w - 1; i++) {
      box(g, x + 2 + i * 8, y - step + 2, 7, step - 3, PALETTE.detail.linen);
      outline(g, x + 2 + i * 8, y - step + 2, 7, step - 3, INK);
      hline(g, x + 3, y - 2, 5, PALETTE.detail.marbleVein); // a fold in the top sheet
    }
  }
}

function carSilhouette(g: Graphics, x: number, by: number, color: number): void {
  panel(g, x + 5, by - 12, 14, 6, color); // cabin
  box(g, x + 6, by - 11, 5, 3, PALETTE.detail.glass);
  box(g, x + 12, by - 11, 6, 3, PALETTE.detail.glass);
  panel(g, x, by - 7, 24, 5, color); // body
  box(g, x + 2, by - 3, 5, 3, INK); // wheels
  box(g, x + 17, by - 3, 5, 3, INK);
  box(g, x + 22, by - 6, 2, 1, PALETTE.detail.glow); // headlight
}

// ---------------------------------------------------------------------------
// Room shell: wall, window band per floor, floor slabs
// ---------------------------------------------------------------------------

function drawWindowBand(g: Graphics, kind: RoomKind, y0: number, w: number, lit: boolean): void {
  if (WINDOWS[kind] === 'none') return;
  hline(g, 0, y0 + WIN_TOP, w); // head rail
  hline(g, 0, y0 + SILL, w); // sill
  for (let x = 1; x + WIN_PANE + 1 <= w; x += WIN_STEP) {
    const gy = y0 + WIN_TOP + 1;
    if (lit) {
      box(g, x, gy, WIN_PANE, WIN_H, PALETTE.windowLit);
      box(g, x, gy, WIN_PANE, 1, PALETTE.carLight);
    } else {
      // The renderer only knows lit or unlit, so an unlit pane keeps the day sky in it
      // with the deep unlit blue pooling along the bottom.
      box(g, x, gy, WIN_PANE, WIN_H, PALETTE.windowDay);
      box(g, x, gy + WIN_H - 2, WIN_PANE, 2, PALETTE.windowUnlit);
    }
    vline(g, x - 1, gy, WIN_H); // mullions
    vline(g, x + WIN_PANE, gy, WIN_H);
  }
}

function drawShell(g: Graphics, kind: RoomKind, w: number, h: number, lit: boolean): void {
  // An overlay has no shell at all: the wall and the slab would hide the room behind it.
  // The floor under it is already drawn by the slab layer and the floor strip.
  if (OVERLAY_KINDS.has(kind)) return;
  box(g, 0, 0, w, h, PALETTE.wall[kind]);
  const floors = Math.max(1, Math.round(h / FLOOR_PX));
  const perFloorSlabs = !FULL_HEIGHT.has(kind);
  for (let f = 0; f < floors; f++) {
    const y0 = f * FLOOR_PX;
    drawWindowBand(g, kind, y0, w, lit);
    if (perFloorSlabs || f === floors - 1) {
      const sy = y0 + FLOOR_PX - SLAB_H;
      box(g, 0, sy, w, SLAB_H, PALETTE.slab);
      box(g, 0, sy, w, 1, PALETTE.slabEdge);
    }
  }
}

function drawCellOutline(g: Graphics, w: number, h: number, floors: number, perFloor: boolean): void {
  if (perFloor) for (let f = 0; f < floors; f++) outline(g, 0, f * FLOOR_PX, w, FLOOR_PX, PALETTE.outline);
  else outline(g, 0, 0, w, h, PALETTE.outline);
}

// ---------------------------------------------------------------------------
// Interiors, one per room kind. y0 is the top of the band to fill, `by` the baseline
// (first row of the floor slab), `ty` the first free row under the windows.
// ---------------------------------------------------------------------------

function drawInterior(g: Graphics, kind: RoomKind, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
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
    case 'condo':
      drawCondo(g, y0, by, ty, w, v, lit);
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
    case 'fastFood':
      drawFastFood(g, by, ty, w, v, lit);
      break;
    case 'restaurant':
      drawRestaurant(g, by, ty, w, v, lit);
      break;
    case 'shop':
      drawShop(g, by, ty, w, v);
      break;
    case 'cinema':
      drawCinema(g, y0, w, h, v, lit);
      break;
    case 'partyHall':
      drawPartyHall(g, y0, w, h, v, lit);
      break;
    case 'medical':
      drawMedical(g, by, ty, w, v);
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
// Left to right: a low partition line, three desks with monitors and chairs, a
// filing cabinet at the right end, a wall clock above it.

function drawOffice(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const cabX = w - 10;
  const deskStep = 18;
  const desks = Math.max(1, Math.min(3, Math.floor((cabX - 6) / deskStep)));
  const chairColor = v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB;
  for (let i = 0; i < desks; i++) {
    const x = 7 + i * deskStep;
    if (x + 17 > cabX - 1) break;
    vline(g, x - 2, by - 13, 13); // the low partition between the bays
    hline(g, x - 3, by - 13, 3);
    deskWithMonitor(g, x, by, lit, chairColor);
  }
  if (cabX > 12) {
    panel(g, cabX, by - 15, 8, 15, PALETTE.detail.metal); // filing cabinet
    for (let i = 0; i < 3; i++) {
      hline(g, cabX, by - 11 + i * 4, 8);
      box(g, cabX + 3, by - 13 + i * 4, 2, 1, INK); // drawer handle
    }
    wallClock(g, cabX + 1, ty);
  }
  if (v === 1 && cabX > 20) picture(g, 2, ty, 9, 7, PALETTE.detail.glass);
}

// --- condo ------------------------------------------------------------------
// A curtained window, sofa, coffee table, floor lamp, the bed at the far end, a plant.

function drawCondo(g: Graphics, y0: number, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const curtainEnd = Math.min(w - 2, 44);
  hline(g, 2, y0 + WIN_TOP - 1, curtainEnd - 2, PALETTE.detail.metalDark); // curtain rail
  panel(g, 2, y0 + WIN_TOP, 6, 13, PALETTE.detail.curtain); // drapes either side of the glass
  panel(g, curtainEnd - 6, y0 + WIN_TOP, 6, 13, PALETTE.detail.curtain);
  for (let x = 4; x < curtainEnd - 6; x += 4) box(g, x, y0 + WIN_TOP, 1, 2, PALETTE.detail.curtain); // valance pleats

  const back = v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB;
  const seat = v === 0 ? PALETTE.detail.chairB : PALETTE.detail.chairA;
  let x = 6;
  const sofaW = Math.min(34, Math.max(14, Math.floor(w * 0.28)));
  sofaIcon(g, x, by, sofaW, back, seat);
  x += sofaW + 4;
  if (x + 18 < w) {
    lowTable(g, x, by, 16, v);
    x += 20;
  }
  if (x + 8 < w) {
    floorLampIcon(g, x, by, lit);
    x += 10;
  }
  const bedW = Math.min(36, w - x - 12);
  if (bedW >= 14) {
    bedIcon(g, x, by, bedW, v, false); // headboard against the far wall
    x += bedW + 2;
  }
  if (x + 7 <= w - 1) plantIcon(g, w - 8, by);
  if (v === 1 && curtainEnd + 12 < w) picture(g, curtainEnd + 4, ty, 10, 8, PALETTE.detail.glass);
}

// --- hotel ------------------------------------------------------------------

const NIGHTSTAND_W = 5;
const TV_W = 7;

function nightstand(g: Graphics, x: number, by: number, lit: boolean): void {
  panel(g, x, by - 8, NIGHTSTAND_W, 8, PALETTE.detail.wood);
  hline(g, x + 1, by - 5, NIGHTSTAND_W - 2, PALETTE.detail.woodDark); // drawer
  tableLamp(g, x, by - 8, lit);
}

function smallTv(g: Graphics, x: number, by: number, lit: boolean): void {
  panel(g, x + 1, by - 5, TV_W - 2, 5, PALETTE.detail.wood); // stand
  monitorIcon(g, x, by - 5, TV_W, 8, lit);
}

function drawHotelSingle(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.max(12, w - 16);
  bedIcon(g, 2, by, bedW, v);
  const nx = 2 + bedW;
  if (nx + NIGHTSTAND_W <= w - TV_W - 2) nightstand(g, nx, by, lit);
  smallTv(g, w - TV_W - 1, by, lit);
  if (v === 1 && w >= 44) picture(g, 4, ty, 10, 8, PALETTE.detail.curtain);
}

function drawHotelTwin(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.max(12, Math.floor((w - 14) / 2));
  bedIcon(g, 2, by, bedW, v);
  bedIcon(g, 4 + bedW, by, bedW, v === 0 ? 1 : 0);
  const nx = 6 + bedW * 2;
  if (nx + NIGHTSTAND_W <= w - 1) {
    nightstand(g, nx, by, lit);
    picture(g, nx - 1, ty, 7, 6, PALETTE.detail.glass);
  }
}

function drawHotelSuite(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const bedW = Math.min(26, Math.max(14, Math.floor(w * 0.32)));
  bedIcon(g, 2, by, bedW, v);
  let x = bedW + 3;
  if (x + NIGHTSTAND_W <= w - 40) {
    nightstand(g, x, by, lit);
    x += NIGHTSTAND_W + 3;
  }
  const sofaW = Math.min(24, w - x - 25);
  if (sofaW >= 14) {
    sofaIcon(g, x, by, sofaW, PALETTE.detail.chairA, v === 0 ? PALETTE.detail.chairB : PALETTE.detail.seatA);
    picture(g, x + 3, ty, Math.min(14, sofaW - 6), 8, v === 0 ? PALETTE.detail.glass : PALETTE.detail.curtain);
    x += sofaW + 2;
  }
  if (x + 12 <= w - 11) {
    lowTable(g, x, by, 11, v);
    x += 12;
  }
  floorLampIcon(g, w - 9, by, lit);
}

// --- fast food --------------------------------------------------------------
// A counter with a register under a menu board, three stools, a drinks fridge.

function drawFastFood(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const counterW = Math.min(48, Math.floor(w * 0.38));
  panel(g, 2, by - 13, counterW, 3, PALETTE.detail.tile); // counter top
  panel(g, 2, by - 10, counterW, 10, PALETTE.detail.counter);
  for (let x = 10; x < counterW; x += 8) vline(g, x, by - 9, 8, PALETTE.detail.woodDark);
  const regX = 2 + counterW - 12;
  panel(g, regX, by - 20, 10, 7, PALETTE.detail.metal); // register
  box(g, regX + 1, by - 19, 8, 3, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  hline(g, regX + 1, by - 15, 8, INK);

  const boardW = counterW - 14;
  if (boardW >= 16) {
    panel(g, 4, ty, boardW, 9, v === 0 ? PALETTE.amber : PALETTE.detail.cross); // menu board
    for (let i = 0; 6 + i * 6 + 4 <= boardW; i++) {
      box(g, 6 + i * 6, ty + 2, 4, 2, INK);
      box(g, 6 + i * 6, ty + 5, 3, 2, INK);
    }
  }

  const fridgeX = w - 20;
  for (let i = 0, x = counterW + 8; i < 3 && x + 8 <= fridgeX - 4; i++, x += 12) stool(g, x, by);

  panel(g, fridgeX, by - 22, 18, 22, PALETTE.detail.metalDark); // drinks fridge
  box(g, fridgeX + 2, by - 20, 14, 18, lit ? PALETTE.windowLit : PALETTE.detail.glass);
  for (let s = 0; s < 3; s++) {
    const y = by - 19 + s * 6;
    hline(g, fridgeX + 2, y + 4, 14);
    for (let i = 0; i < 4; i++) {
      box(g, fridgeX + 3 + i * 3, y, 2, 4, pick([PALETTE.detail.cross, PALETTE.detail.leaf, PALETTE.amber], i + s + v, PALETTE.detail.cross));
    }
  }
  vline(g, fridgeX + 9, by - 20, 18); // door seam
}

// --- restaurant -------------------------------------------------------------
// Four clothed tables with chairs and hanging lamps, a bar at the right end.

function drawRestaurant(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const barW = Math.min(44, Math.floor(w * 0.24));
  const barX = w - barW - 2;
  const step = 34;
  const wood = v === 0 ? PALETTE.detail.woodDark : PALETTE.detail.chairB;
  for (let i = 0, x = 4; i < 4 && x + 30 <= barX - 2; i++, x += step) {
    diningChair(g, x, by, wood, true);
    clothTable(g, x + 7, by, 16, 12, v);
    diningChair(g, x + 24, by, wood, false);
    vline(g, x + 14, ty - 1, 3, PALETTE.detail.metalDark); // the cord of a hanging lamp
    hline(g, x + 12, ty + 2, 5);
    box(g, x + 11, ty + 3, 7, 3, lit ? PALETTE.windowLit : PALETTE.detail.linen);
    hline(g, x + 11, ty + 6, 7);
  }
  panel(g, barX, by - 14, barW, 3, PALETTE.detail.wood); // bar top
  panel(g, barX, by - 11, barW, 11, PALETTE.detail.woodDark);
  for (let x = barX + 6; x < barX + barW - 2; x += 7) vline(g, x, by - 10, 9, PALETTE.detail.wood);
  panel(g, barX + 2, ty, barW - 4, 9, PALETTE.detail.woodDark); // back shelf
  hline(g, barX + 3, ty + 5, barW - 6, PALETTE.detail.wood);
  for (let i = 0; barX + 4 + i * 4 + 2 <= barX + barW - 3; i++) {
    box(g, barX + 4 + i * 4, ty + 1, 2, 4, pick([PALETTE.detail.leaf, PALETTE.detail.cross, PALETTE.amber], i + v, PALETTE.detail.leaf));
  }
}

// --- shop -------------------------------------------------------------------

function drawShop(g: Graphics, by: number, ty: number, w: number, v: number): void {
  const counterW = Math.min(34, Math.floor(w * 0.36));
  const counterX = w - counterW - 3;
  for (let i = 0, x = 3; x + 20 <= counterX - 3; i++, x += 21) shelfUnit(g, x, by, 20, by - ty - 1, v + i);
  panel(g, counterX - 2, ty, counterW + 4, 9, v === 0 ? PALETTE.amber : PALETTE.detail.shelfGoodsB); // sign board
  for (let i = 0; counterX + 1 + i * 7 + 5 <= counterX + counterW; i++) box(g, counterX + 1 + i * 7, ty + 3, 5, 3, INK);
  panel(g, counterX, by - 12, counterW, 3, PALETTE.detail.wood); // counter top
  panel(g, counterX + 1, by - 9, counterW - 2, 9, PALETTE.detail.woodDark);
  for (let x = counterX + 8; x < counterX + counterW - 2; x += 8) vline(g, x, by - 8, 7, PALETTE.detail.wood);
  panel(g, counterX + counterW - 13, by - 19, 10, 7, PALETTE.detail.metal); // register
  box(g, counterX + counterW - 12, by - 18, 8, 3, PALETTE.detail.screenOff);
  hline(g, counterX + counterW - 12, by - 14, 8);
}

// --- cinema -----------------------------------------------------------------

function drawCinema(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const line = 0x8a8aa0; // the cinema wall is dark, so its line art is light
  const by = y0 + h - SLAB_H;
  const screenW = Math.min(46, Math.floor(w / 5));
  const screenTop = y0 + 6;
  const screenH = h - 20;
  panel(g, 4, screenTop, screenW, screenH, PALETTE.detail.metalDark, lit ? PALETTE.windowLit : line); // lit frame
  box(g, 6, screenTop + 2, screenW - 4, screenH - 4, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  const projX = w - 16;
  const projY = y0 + 5;
  panel(g, projX, projY, 12, 9, PALETTE.detail.metalDark, line);
  box(g, projX - 2, projY + 3, 2, 3, lit ? PALETTE.windowLit : line); // lens
  if (lit) {
    const steps = 10;
    const lensY = projY + 4;
    const screenCy = screenTop + screenH / 2;
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const bx0 = projX - 2 - (projX - 2 - (4 + screenW)) * t1;
      const bx1 = projX - 2 - (projX - 2 - (4 + screenW)) * t0;
      const cy = lensY + (screenCy - lensY) * t1;
      const half = 1 + (screenH / 3 - 1) * t1;
      const top = Math.max(y0 + 1, cy - half);
      const bot = Math.min(by - 1, cy + half);
      box(g, bx0, top, bx1 - bx0, bot - top, PALETTE.carLight, 0.13);
    }
  }
  const seat = v === 0 ? PALETTE.detail.seatA : PALETTE.detail.seatB;
  const rows = 4;
  const rowW = Math.floor((w - screenW - 24) / rows);
  for (let r = 0; r < rows; r++) {
    const rx = screenW + 8 + r * rowW;
    const ry = by - r * 6;
    hline(g, rx, ry - 1, rowW, line); // the step this row sits on
    vline(g, rx, ry - 6, 6, line); // its riser
    for (let x = rx + 3; x + 9 <= rx + rowW - 1; x += 11) {
      // the seats face the screen, so the pad hangs off the left of the back
      panel(g, x + 4, ry - 13, 5, 13, seat, line); // seat back
      panel(g, x + 3, ry - 16, 6, 4, seat, line); // headrest
      panel(g, x, ry - 7, 5, 3, seat, line); // pad
      vline(g, x + 1, ry - 4, 3, line); // leg
    }
  }
}

// --- party hall -------------------------------------------------------------

function drawPartyHall(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const ty = y0 + INTERIOR_TOP;
  const stageW = Math.min(58, Math.floor(w / 3));
  panel(g, 2, ty + 2, stageW, by - 14 - (ty + 2), PALETTE.detail.curtain); // backdrop
  for (let x = 6; x < stageW; x += 6) vline(g, x, ty + 3, by - 16 - (ty + 2), INK, );
  panel(g, 2, by - 14, stageW, 4, PALETTE.detail.wood); // stage deck
  panel(g, 2, by - 10, stageW, 10, PALETTE.detail.woodDark);
  const lx = 2 + Math.floor(stageW / 2) - 4;
  panel(g, lx, by - 27, 9, 13, PALETTE.detail.wood); // lectern
  hline(g, lx - 1, by - 28, 11);
  vline(g, lx + 4, by - 31, 3, PALETTE.detail.metal); // microphone
  box(g, lx + 3, by - 33, 3, 2, PALETTE.detail.metalDark);

  const tablesX = stageW + 8;
  const tableW = Math.floor((w - tablesX - 6) / 2);
  for (let i = 0; i < 2; i++) {
    const x = tablesX + i * (tableW + 4);
    if (x + tableW > w - 2) break;
    clothTable(g, x, by, tableW, 13, (v + i) % 2);
    for (let px = x + 4; px + 4 <= x + tableW - 4; px += 9) panel(g, px, by - 16, 4, 3, PALETTE.detail.linen); // place settings
  }

  hline(g, stageW + 4, ty + 1, w - stageW - 8, PALETTE.detail.metalDark); // bunting line
  for (let i = 0, x = stageW + 6; x + 7 <= w - 4; i++, x += 9) {
    const c = pick([PALETTE.amber, PALETTE.detail.cross, PALETTE.detail.chairB], i + v, PALETTE.amber);
    box(g, x, ty + 2, 7, 1, c);
    box(g, x + 1, ty + 3, 5, 1, c);
    box(g, x + 2, ty + 4, 3, 1, c);
    box(g, x + 3, ty + 5, 1, 1, c);
  }
  for (let i = 0, x = tablesX + 6; i < 3 && x + 6 <= w - 6; i++, x += 26) {
    const c = pick([PALETTE.detail.cross, PALETTE.amber, PALETTE.detail.chairA], i + v, PALETTE.detail.cross);
    box(g, x + 1, ty + 8, 4, 1, INK); // balloon
    box(g, x, ty + 9, 6, 5, c);
    box(g, x + 1, ty + 14, 4, 1, INK);
    vline(g, x + 2, ty + 15, 6, PALETTE.detail.metalDark);
  }
  if (lit) box(g, 0, y0 + 1, w, 1, PALETTE.detail.glow, 0.35);
}

// --- medical ----------------------------------------------------------------

function drawMedical(g: Graphics, by: number, ty: number, w: number, v: number): void {
  panel(g, 3, ty, 16, 16, PALETTE.detail.linen); // red cross sign
  box(g, 9, ty + 3, 4, 10, PALETTE.detail.cross);
  box(g, 6, ty + 6, 10, 4, PALETTE.detail.cross);
  const deskW = Math.min(36, Math.floor(w * 0.18));
  const deskX = w - deskW - 8;
  for (let i = 0, x = 22; i < 3 && x + 44 <= deskX - 2; i++, x += 46) {
    bedIcon(g, x, by, 38, 0);
    vline(g, x + 40, by - 20, 20, PALETTE.detail.metal); // drip stand
    hline(g, x + 39, by - 20, 3, PALETTE.detail.metal);
    box(g, x + 40, by - 19, 3, 5, (v + i) % 2 === 0 ? PALETTE.detail.glass : PALETTE.detail.linen);
    hline(g, x + 39, by - 1, 5);
  }
  panel(g, deskX, by - 12, deskW, 3, PALETTE.detail.tile); // reception desk
  panel(g, deskX + 1, by - 9, deskW - 2, 9, PALETTE.detail.metal);
  hline(g, deskX + 3, by - 5, deskW - 6);
  officeChair(g, deskX + deskW + 1, by, PALETTE.detail.chairA);
}

// --- security ---------------------------------------------------------------

function drawSecurity(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const deskW = Math.min(84, Math.floor(w * 0.66));
  for (let i = 0, x = 4; x + 16 <= deskW - 2; i++, x += 20) {
    monitorIcon(g, x, by - 11, 16, 11, lit);
    if (lit) box(g, x + 2, by - 19 + ((i + v) % 5), 12, 1, PALETTE.carLight, 0.6); // scan line
  }
  panel(g, 2, by - 11, deskW, 3, PALETTE.detail.metal); // console top
  panel(g, 3, by - 8, deskW - 2, 8, PALETTE.detail.metalDark);
  for (let x = 10; x < deskW - 2; x += 12) vline(g, x, by - 7, 6, PALETTE.detail.metal);
  officeChair(g, deskW + 4, by, v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB);
  const bx = w - 16;
  panel(g, bx, ty, 13, 13, PALETTE.detail.chairA); // badge sign
  box(g, bx + 1, ty + 13, 11, 1, PALETTE.detail.chairA);
  box(g, bx + 4, ty + 14, 5, 1, PALETTE.detail.chairA);
  hline(g, bx + 1, ty + 14, 11);
  hline(g, bx + 4, ty + 15, 5);
  box(g, bx + 5, ty + 3, 3, 7, PALETTE.amber); // star on the badge
  box(g, bx + 3, ty + 5, 7, 3, PALETTE.amber);
}

// --- housekeeping -----------------------------------------------------------

function drawHousekeeping(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  const shelfW = Math.min(40, Math.floor(w * 0.34));
  linenShelf(g, 3, by, shelfW, 20);
  const cartX = shelfW + 8;
  panel(g, cartX, by - 13, 28, 13, PALETTE.detail.metal); // linen cart
  box(g, cartX + 2, by - 18, 16, 5, PALETTE.detail.linen); // towels heaped on top
  outline(g, cartX + 2, by - 18, 16, 5, INK);
  hline(g, cartX + 3, by - 16, 14, PALETTE.detail.marbleVein);
  hline(g, cartX + 2, by - 8, 24, PALETTE.detail.metalDark);
  vline(g, cartX + 28, by - 19, 7, PALETTE.detail.metalDark); // push handle
  hline(g, cartX + 24, by - 19, 5, PALETTE.detail.metalDark);
  box(g, cartX + 3, by - 2, 4, 2, INK); // wheels
  box(g, cartX + 21, by - 2, 4, 2, INK);
  const wmX = w - 24;
  if (wmX > cartX + 30) {
    panel(g, wmX, by - 22, 22, 22, PALETTE.detail.tile); // washing machine
    hline(g, wmX, by - 17, 22);
    box(g, wmX + 2, by - 21, 8, 3, PALETTE.detail.metalDark); // control panel
    box(g, wmX + 17, by - 20, 2, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
    panel(g, wmX + 5, by - 14, 12, 12, PALETTE.detail.metal);
    box(g, wmX + 7, by - 12, 8, 8, lit ? PALETTE.windowLit : PALETTE.detail.glass);
    outline(g, wmX + 7, by - 12, 8, 8, INK);
    box(g, wmX + 5, by - 14, 1, 1, PALETTE.detail.tile); // rounded corners
    box(g, wmX + 16, by - 14, 1, 1, PALETTE.detail.tile);
    box(g, wmX + 5, by - 3, 1, 1, PALETTE.detail.tile);
    box(g, wmX + 16, by - 3, 1, 1, PALETTE.detail.tile);
  }
  if (v === 1) picture(g, cartX + 4, ty, 9, 7, PALETTE.detail.glass);
}

// --- parking ----------------------------------------------------------------

function drawParkingRamp(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  hline(g, 0, ty, w, PALETTE.detail.metalDark); // ceiling line
  const x1 = 3;
  const x2 = w - 3;
  const y1 = by - 2;
  const y2 = ty + 14;
  stripe(g, x1, y1 + 1, x2, y2 + 1, INK, 1); // the deck of the ramp
  stripe(g, x1, y1 - 3, x2, y2 - 3, PALETTE.detail.stripe, 4);
  stripe(g, x1, y1 - 5, x2, y2 - 5, INK, 1);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.3) / n;
    const x = x1 + (x2 - x1) * t;
    const y = y1 - 3 + (y2 - y1) * t;
    box(g, x, y, 5, 1, PALETTE.detail.linen); // lane stripes
  }
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    const x = x1 + (x2 - x1) * t;
    const y = y1 - 11 + (y2 - y1) * t;
    vline(g, x, y, 8, PALETTE.detail.metal); // guard rail posts
  }
  stripe(g, x1, y1 - 11, x2, y2 - 11, PALETTE.detail.metal, 2);
  for (let x = 8; x + 6 <= w - 6; x += 30) box(g, x, ty + 1, 6, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
  if (v === 1) carSilhouette(g, 6, by, PALETTE.detail.carRed);
}

function drawParkingSpace(g: Graphics, by: number, ty: number, w: number, v: number, lit: boolean): void {
  hline(g, 0, ty, w, PALETTE.detail.metalDark);
  box(g, Math.floor(w / 2) - 3, ty + 1, 6, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
  vline(g, 1, by - 14, 14, PALETTE.detail.linen); // bay lines
  vline(g, w - 2, by - 14, 14, PALETTE.detail.linen);
  hline(g, 2, by - 1, w - 4, PALETTE.detail.linen);
  carSilhouette(g, Math.max(2, Math.floor((w - 24) / 2)), by, v === 0 ? PALETTE.detail.carBlue : PALETTE.detail.carRed);
}

// --- recycling --------------------------------------------------------------

function drawRecycling(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const beltY = y0 + Math.floor(h / 2) - 4;
  const balerX = w - 46;
  panel(g, 6, beltY, balerX - 10, 5, PALETTE.detail.metalDark); // conveyor
  hline(g, 7, beltY + 1, balerX - 12, PALETTE.detail.metal);
  for (let x = 12; x + 4 < balerX - 6; x += 10) {
    panel(g, x, beltY + 5, 4, 4, PALETTE.detail.metal); // rollers
    vline(g, x + 2, beltY + 9, by - 26 - (beltY + 9), PALETTE.detail.metalDark); // legs
  }
  for (let i = 0, x = 10 + v * 5; x + 6 < balerX - 8; i++, x += 18) {
    panel(g, x, beltY - 5, 6, 5, pick([PALETTE.detail.shelfGoodsA, PALETTE.detail.shelfGoodsB, PALETTE.amber], i + v, PALETTE.detail.shelfGoodsA));
  }
  const bins = [PALETTE.detail.binGreen, PALETTE.detail.binBlue, PALETTE.detail.binAmber] as const;
  for (let i = 0, x = 6; i < 4 && x + 22 <= balerX - 4; i++, x += 26) {
    panel(g, x, by - 22, 22, 22, pick(bins, i + v, PALETTE.detail.binGreen)); // bins in a row
    panel(g, x - 1, by - 25, 24, 3, PALETTE.detail.metalDark); // lid
    hline(g, x + 2, by - 12, 18, INK);
    box(g, x + 8, by - 20, 6, 6, PALETTE.detail.linen, 0.8); // the recycling mark
    box(g, x + 9, by - 19, 4, 4, pick(bins, i + v, PALETTE.detail.binGreen));
  }
  panel(g, balerX, y0 + 4, 42, by - 12 - (y0 + 4), PALETTE.detail.metal); // baler
  panel(g, balerX + 4, y0 + 8, 34, 10, PALETTE.detail.metalDark); // hopper
  hline(g, balerX + 8, y0 + 18, 26, INK);
  panel(g, balerX + 14, y0 + 20, 14, 10, PALETTE.detail.stripe); // ram
  vline(g, balerX + 20, y0 + 30, 8, PALETTE.detail.metalDark);
  vline(g, balerX + 22, y0 + 30, 8, PALETTE.detail.metalDark);
  if (lit) box(g, balerX + 34, y0 + 8, 3, 3, PALETTE.detail.glow);
  for (let i = 0; i < 2; i++) {
    const x = balerX + 6 + i * 18;
    panel(g, x, by - 12, 16, 12, PALETTE.detail.shelfGoodsA); // baled output
    hline(g, x + 4, by - 12, 1, INK);
    vline(g, x + 5, by - 11, 10, PALETTE.detail.metal);
    vline(g, x + 11, by - 11, 10, PALETTE.detail.metal);
  }
}

// --- metro ------------------------------------------------------------------

function drawMetro(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const tunnelTop = by - 44;
  box(g, 0, tunnelTop, w, by - tunnelTop, PALETTE.detail.metalDark, 0.35); // the cut into the tunnel
  hline(g, 0, tunnelTop, w);
  const platW = Math.floor(w * 0.46);
  const platTop = by - 16;
  panel(g, 0, platTop, platW, 16, PALETTE.detail.tile); // platform
  box(g, platW - 5, platTop + 1, 4, 14, PALETTE.amber); // the yellow line at the edge
  for (let x = 6; x + 10 <= platW - 8; x += 14) hline(g, x, platTop + 8, 10, PALETTE.detail.marbleVein);
  const railY = by - 4;
  for (let x = platW + 2; x + 4 < w - 2; x += 8) box(g, x, railY + 1, 5, 3, PALETTE.detail.woodDark); // sleepers
  hline(g, platW, railY, w - platW, PALETTE.detail.rail);
  hline(g, platW, railY + 4, w - platW, PALETTE.detail.rail);

  const trainX = platW + 4;
  const trainW = w - trainX - 4;
  const trainTop = railY - 34;
  panel(g, trainX, trainTop, trainW, 30, PALETTE.detail.metal); // train
  box(g, trainX + trainW - 6, trainTop, 6, 4, PALETTE.wall.metro); // the nose tapers
  box(g, trainX + trainW - 4, trainTop + 4, 4, 3, PALETTE.wall.metro);
  hline(g, trainX + trainW - 6, trainTop + 4, 6);
  hline(g, trainX + trainW - 4, trainTop + 7, 4);
  box(g, trainX + 1, trainTop + 20, trainW - 2, 4, v === 0 ? PALETTE.detail.chairA : PALETTE.detail.cross); // livery band
  for (let i = 0, x = trainX + 4; x + 14 <= trainX + trainW - 8; i++, x += 20) {
    if (i % 2 === 0) {
      panel(g, x, trainTop + 5, 14, 12, lit ? PALETTE.windowLit : PALETTE.detail.glass); // windows
    } else {
      panel(g, x, trainTop + 4, 14, 22, PALETTE.detail.metalDark); // doors
      box(g, x + 1, trainTop + 6, 12, 8, lit ? PALETTE.windowLit : PALETTE.detail.glass);
      vline(g, x + 7, trainTop + 5, 20, PALETTE.detail.metal);
    }
  }
  for (let x = trainX + 6; x + 10 <= trainX + trainW - 6; x += 26) {
    box(g, x, trainTop + 30, 10, 4, INK); // bogies
  }
  panel(g, 8, y0 + 8, 62, 14, PALETTE.detail.chairA); // station sign
  vline(g, 20, y0 + 2, 6, PALETTE.detail.metalDark);
  vline(g, 58, y0 + 2, 6, PALETTE.detail.metalDark);
  for (let i = 0; 12 + i * 8 + 6 <= 68; i++) box(g, 12 + i * 8, y0 + 12, 6, 6, PALETTE.detail.linen);
  // a flight down from the concourse, so the platform is not a field of empty gray
  const stW = 6;
  const stH = 5;
  for (let i = 0; i < 6; i++) {
    const sx = platW - 10 - (i + 1) * stW;
    const sy = platTop - 30 + i * stH;
    if (sx < 4) break;
    box(g, sx, sy, stW + 1, 2, PALETTE.detail.metal);
    hline(g, sx, sy, stW + 1);
    vline(g, sx, sy + 2, stH - 2, PALETTE.detail.metalDark);
  }
  panel(g, 12, platTop - 9, 20, 3, PALETTE.detail.wood); // a bench on the platform
  vline(g, 13, platTop - 6, 6, PALETTE.detail.metalDark);
  vline(g, 30, platTop - 6, 6, PALETTE.detail.metalDark);
  for (let x = 14; x + 4 < platW - 10; x += 34) {
    panel(g, x, y0 + 26, 4, platTop - (y0 + 26), PALETTE.detail.metal); // pillars
    box(g, x - 3, y0 + 22, 10, 4, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
    outline(g, x - 3, y0 + 22, 10, 4, INK);
  }
}

// --- cathedral --------------------------------------------------------------

function drawCathedral(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const organX = w - 40;
  const winTop = y0 + 14;
  const winBot = by - 40;
  const panes = [PALETTE.detail.curtain, PALETTE.detail.glass, PALETTE.amber, PALETTE.detail.leaf] as const;
  for (let i = 0, x = 10; x + 30 <= organX - 6; i++, x += 46) {
    // a tall window, arched at the top, with colored panes
    const stepH = 3;
    for (let s = 0; s < 4; s++) {
      const inset = [11, 7, 4, 2][s] as number;
      box(g, x + inset, winTop + s * stepH, 30 - inset * 2, stepH, PALETTE.detail.stone);
      box(g, x + inset + 1, winTop + s * stepH + 1, 28 - inset * 2, stepH, lit ? PALETTE.windowLit : pick(panes, i + v + s, PALETTE.detail.glass));
    }
    box(g, x + 1, winTop + 12, 28, winBot - winTop - 12, PALETTE.detail.stone);
    for (let py = winTop + 13; py + 6 <= winBot - 1; py += 7) {
      for (let px = x + 3; px + 6 <= x + 27; px += 7) {
        const c = pick(panes, px + py + v, PALETTE.detail.glass);
        box(g, px, py, 6, 6, c);
        if (lit) box(g, px, py, 6, 6, PALETTE.windowLit, 0.4);
      }
    }
    outline(g, x, winTop + 11, 30, winBot - winTop - 10, PALETTE.detail.stoneDark);
  }
  for (let x = 4; x + 6 <= organX - 2; x += 46) {
    panel(g, x, winTop, 6, by - winTop, PALETTE.detail.stone, PALETTE.detail.stoneDark); // columns
    panel(g, x - 1, winTop, 8, 4, PALETTE.detail.stoneDark, PALETTE.detail.stoneDark); // capital
  }
  // the organ: a case of pipes at the right end
  panel(g, organX, y0 + 10, 34, by - 20 - (y0 + 10), PALETTE.detail.woodDark);
  for (let i = 0, x = organX + 3; x + 4 <= organX + 31; i++, x += 5) {
    const ph = 10 + ((i * 7) % 4) * 6;
    box(g, x, y0 + 14 + (24 - ph), 4, ph, PALETTE.detail.gold);
    outline(g, x, y0 + 14 + (24 - ph), 4, ph, INK);
  }
  panel(g, organX + 2, by - 24, 30, 4, PALETTE.detail.wood); // the console shelf
  panel(g, organX + 8, by - 20, 18, 20, PALETTE.detail.woodDark);
  box(g, organX + 10, by - 18, 14, 3, PALETTE.detail.linen); // keyboard
  outline(g, organX + 10, by - 18, 14, 3, INK);
  for (let x = organX + 11; x < organX + 23; x += 3) vline(g, x, by - 18, 3);
  hline(g, organX + 10, by - 12, 14, PALETTE.detail.wood); // stop rails
  hline(g, organX + 10, by - 8, 14, PALETTE.detail.wood);
  // the altar on its steps, with a cross above it
  const ax = Math.floor(organX / 2) - 12;
  hline(g, ax - 4, by - 3, 32, PALETTE.detail.stone);
  hline(g, ax - 2, by - 5, 28, PALETTE.detail.stone);
  box(g, ax - 4, by - 4, 32, 4, PALETTE.detail.stone);
  box(g, ax - 2, by - 6, 28, 2, PALETTE.detail.stone);
  panel(g, ax, by - 16, 24, 10, PALETTE.detail.linen);
  box(g, ax + 10, by - 34, 4, 18, PALETTE.detail.gold);
  box(g, ax + 5, by - 29, 14, 4, PALETTE.detail.gold);
  outline(g, ax + 10, by - 34, 4, 18, INK);
  // pews in rows, stepping toward the front
  for (let r = 0; r < 3; r++) {
    const py = by - 8 - r * 10;
    if (py - 8 < winBot) break;
    for (let x = 6; x + 22 <= organX - 4; x += 26) {
      if (x < ax + 26 && x + 22 > ax - 6) continue; // leave the altar clear
      box(g, x, py - 10, 22, 4, PALETTE.detail.wood); // back rest
      outline(g, x, py - 10, 22, 4, INK);
      box(g, x, py - 4, 22, 3, PALETTE.detail.wood); // seat
      outline(g, x, py - 4, 22, 3, INK);
      vline(g, x + 1, py - 10, 10, PALETTE.detail.woodDark); // end frames
      vline(g, x + 20, py - 10, 10, PALETTE.detail.woodDark);
    }
  }
  if (lit) box(g, 0, y0 + 1, w, 2, PALETTE.detail.glow, 0.25);
}

// --- lobby, sky lobby, stairs, escalator -------------------------------------

function marbleFloor(g: Graphics, by: number, w: number, narrow: boolean): void {
  box(g, 0, by - 6, w, 6, PALETTE.detail.marble);
  hline(g, 0, by - 6, w, PALETTE.detail.marbleVein);
  if (narrow) return; // a one tile segment is all joint and no floor if it keeps the veining
  for (let x = 6; x < w - 2; x += 10) vline(g, x, by - 5, 5, PALETTE.detail.marbleVein);
}

function columnPair(g: Graphics, x: number, top: number, bot: number): void {
  for (const cx of [x, x + 4]) {
    box(g, cx, top + 2, 3, bot - top - 4, PALETTE.detail.column);
    box(g, cx - 1, top, 5, 2, PALETTE.detail.column); // capital
    box(g, cx - 1, bot - 2, 5, 2, PALETTE.detail.column); // base
  }
}

/** One tile of a lobby run. The run alternates variant every six tiles, so a variant has
 *  to tile seamlessly: piers in one stretch, a length of the front desk in the next. */
function narrowLobbySegment(g: Graphics, w: number, ty: number, by: number, v: number): void {
  if (v === 0) {
    box(g, 3, ty + 2, 2, by - 8 - ty, PALETTE.detail.column); // a pier
    box(g, 2, ty, 4, 2, PALETTE.detail.column);
    box(g, 2, by - 8, 4, 2, PALETTE.detail.column);
  } else {
    box(g, 0, by - 16, w, 3, PALETTE.detail.wood); // a length of the front desk
    hline(g, 0, by - 16, w);
    box(g, 0, by - 13, w, 7, PALETTE.detail.woodDark);
    hline(g, 0, by - 7, w);
  }
}

function drawLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const ty = y0 + INTERIOR_TOP;
  const narrow = w < 24;
  marbleFloor(g, by, w, narrow);
  hline(g, 0, ty - 1, w, PALETTE.detail.marbleVein); // the soffit over the hall
  if (!narrow) {
    columnPair(g, 3, ty, by - 6);
    panel(g, 16, by - 16, Math.min(26, w - 28), 3, PALETTE.detail.wood); // front desk
    panel(g, 17, by - 13, Math.min(24, w - 30), 7, PALETTE.detail.woodDark);
    if (w >= 48) plantIcon(g, w - 20, by - 6);
    columnPair(g, w - 10, ty, by - 6);
  } else {
    narrowLobbySegment(g, w, ty, by, v);
  }
  if (lit) box(g, 0, ty, w, 1, PALETTE.detail.glow, 0.5);
}

function drawSkyLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const ty = y0 + INTERIOR_TOP;
  const narrow = w < 24;
  marbleFloor(g, by, w, narrow);
  const mezz = y0 + h - FLOOR_PX; // the mezzanine deck, one floor up
  box(g, 0, mezz - 3, w, 3, PALETTE.slab);
  hline(g, 0, mezz - 3, w, PALETTE.slabEdge);
  hline(g, 0, mezz - 10, w, PALETTE.detail.column); // the mezzanine rail
  hline(g, 0, mezz - 6, w, PALETTE.detail.column);
  for (let x = 3; x < w; x += 8) vline(g, x, mezz - 9, 6, PALETTE.detail.column); // balusters
  hline(g, 0, ty - 1, w, PALETTE.detail.marbleVein);
  if (!narrow) {
    columnPair(g, 3, mezz, by - 6);
    panel(g, 16, by - 16, Math.min(26, w - 28), 3, PALETTE.detail.wood);
    panel(g, 17, by - 13, Math.min(24, w - 30), 7, PALETTE.detail.woodDark);
    if (w >= 48) plantIcon(g, w - 20, by - 6);
    columnPair(g, w - 10, mezz, by - 6);
  } else {
    narrowLobbySegment(g, w, mezz + 2, by, v);
  }
  if (lit) box(g, 0, ty, w, 1, PALETTE.detail.glow, 0.5);
}

function drawStairs(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const steps = 10;
  const x0 = 4;
  const x1 = w - 8;
  const yTop = y0 + 16; // the rail and the balusters live in the 12 px above the top tread
  const stepW = Math.max(2, Math.floor((x1 - x0) / steps));
  const stepH = Math.max(2, Math.floor((by - 2 - yTop) / steps));
  box(g, 0, by - 2, x0 + 2, 2, PALETTE.detail.metal); // bottom landing
  hline(g, 0, by - 3, x0 + 2);
  for (let i = 0; i < steps; i++) {
    const x = x0 + i * stepW;
    const y = by - 2 - (i + 1) * stepH;
    box(g, x, y, stepW + 1, 2, PALETTE.detail.metal); // tread
    hline(g, x, y, stepW + 1);
    vline(g, x, y + 2, stepH - 2, PALETTE.detail.metalDark); // riser
    vline(g, x + stepW, y + 2, stepH - 2, INK);
  }
  const rail = v === 0 ? PALETTE.detail.metalDark : PALETTE.amber;
  for (let i = 0; i <= steps; i += 2) {
    const x = x0 + i * stepW;
    const y = by - 2 - i * stepH;
    const bTop = Math.max(y0 + 1, y - 12);
    vline(g, x, bTop, y - bTop, PALETTE.detail.metal); // balusters
  }
  stripe(g, x0, by - 14, x0 + steps * stepW, Math.max(y0 + 2, by - 2 - steps * stepH - 12), rail, 2);
  const topY = by - 2 - steps * stepH;
  box(g, x0 + steps * stepW, topY, w - x0 - steps * stepW, 2, PALETTE.detail.metal); // top landing
  hline(g, x0 + steps * stepW, topY, w - x0 - steps * stepW);
  // a stair light over each landing, the only thing in a stair well that can glow
  for (const lx of [1, w - 7]) {
    const ly = lx === 1 ? y0 + 4 : topY - 9;
    hline(g, lx, ly, 6, PALETTE.detail.metalDark); // the fitting
    box(g, lx, ly + 1, 6, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
    hline(g, lx, ly + 3, 6);
  }
}

function drawEscalator(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const x0 = 4;
  const x1 = w - 4;
  const y1 = by - 3;
  const y2 = y0 + 16;
  stripe(g, x0, y1 + 3, x1, y2 + 3, INK, 1); // the truss under the steps
  stripe(g, x0, y1, x1, y2, PALETTE.detail.metalDark, 6);
  stripe(g, x0, y1 - 3, x1, y2 - 3, PALETTE.detail.metal, 2);
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y1 + (y2 - y1) * t;
    box(g, x - 1, y - 3, 2, 3, INK); // step cleats
  }
  stripe(g, x0, y1 - 8, x1, y2 - 8, PALETTE.detail.glass, 5); // balustrade
  stripe(g, x0, y1 - 11, x1, y2 - 11, v === 0 ? INK : PALETTE.detail.chairB, 2); // handrail
  box(g, 0, by - 3, x0 + 2, 3, PALETTE.detail.metal); // landings
  hline(g, 0, by - 4, x0 + 2);
  box(g, x1 - 2, y2, w - x1 + 2, 3, PALETTE.detail.metal);
  hline(g, x1 - 2, y2, w - x1 + 2);
  if (lit) {
    box(g, 1, by - 6, 5, 2, PALETTE.detail.glow);
    box(g, w - 6, y2 - 3, 5, 2, PALETTE.detail.glow);
  }
}


// ---------------------------------------------------------------------------
// Non-room textures
// ---------------------------------------------------------------------------

function drawSlab(g: Graphics, w: number): void {
  box(g, 0, 0, w, 4, PALETTE.slab);
  box(g, 0, 0, w, 1, PALETTE.slabEdge);
  for (let x = 4; x < w; x += 16) box(g, x, 1, 1, 3, PALETTE.slabEdge, 0.5); // rib marks
}

function drawShaft(g: Graphics, kind: ShaftKind, w: number, h: number): void {
  box(g, 0, 0, w, h, PALETTE.shaftCavity);
  box(g, 0, 0, 1, h, PALETTE.shaftFloorMark);
  box(g, w - 1, 0, 1, h, PALETTE.shaftFloorMark);
  box(g, 3, 0, 2, h, PALETTE.shaftRail); // guide rails
  box(g, w - 5, 0, 2, h, PALETTE.shaftRail);
  if (kind === 'express') box(g, Math.floor(w / 2) - 1, 0, 2, h, PALETTE.shaftRail, 0.6);
  for (let y = 0; y + 1 <= h; y += FLOOR_PX) {
    box(g, 0, y, w, 1, PALETTE.shaftFloorMark);
    box(g, 1, y + 1, 2, 2, kind === 'service' ? PALETTE.detail.metalDark : PALETTE.shaftRail, 0.8);
  }
}

function drawCar(g: Graphics, kind: ShaftKind, w: number, h: number, doorsOpen: boolean): void {
  box(g, 0, 0, w, h, PALETTE.carTrim);
  box(g, 1, 1, w - 2, h - 2, PALETTE.carBody);
  box(g, 1, 1, w - 2, 2, PALETTE.carLight); // ceiling light strip
  box(g, 0, h - 2, w, 2, PALETTE.carTrim);
  const inset = 3;
  const openW = doorsOpen ? Math.max(4, Math.floor((w - inset * 2) / 3)) : 0;
  const panelW = Math.floor((w - inset * 2 - openW) / 2);
  box(g, inset + panelW, 4, openW, h - 6, PALETTE.carInterior); // the gap when the doors are open
  box(g, inset, 4, panelW, h - 6, PALETTE.carDoor);
  box(g, inset + panelW + openW, 4, panelW, h - 6, PALETTE.carDoor);
  box(g, inset + panelW - 1, 4, 1, h - 6, PALETTE.carTrim);
  box(g, inset + panelW + openW, 4, 1, h - 6, PALETTE.carTrim);
  if (kind === 'service') box(g, inset + 1, 6, panelW - 2, 2, PALETTE.detail.metalDark);
  if (kind === 'express') box(g, inset + 1, h - 9, panelW - 2, 2, PALETTE.amber);
}

const SIM_W = TILE_PX; // 8: one tile wide, the way the original's people read
const SIM_H = 3 * TILE_PX; // 24: three tiles tall, head to feet

/**
 * A person, drawn on an 8 by 24 grid. The feet fill the bottom row so the sprite's lower
 * edge lands on the slab line, and the top two rows stay clear for the vip's hat.
 * Head 3 px (a 2 px crown over a 1 px neck notch, which is what reads as a head at this size),
 * torso 9, legs 10. Nothing may reach outside the box: at one tile wide the figures stand
 * shoulder to shoulder in a lift queue, so a stray pixel lands on the neighbor.
 */
function drawSim(g: Graphics, kind: SimKind, band: StressBand, frame: 0 | 1): void {
  const body = band === 'calm' ? PALETTE.sim.calm : band === 'pink' ? PALETTE.sim.pink : PALETTE.sim.red;
  box(g, 2, 2, 4, 2, body); // head
  box(g, 3, 4, 2, 1, body); // neck, the notch that separates head from shoulders
  box(g, 2, 5, 4, 9, body); // torso
  if (frame === 0) {
    box(g, 1, 6, 1, 7, body); // arms hanging
    box(g, 6, 6, 1, 7, body);
    box(g, 2, 14, 1, 10, body); // legs upright, a two pixel gap between them
    box(g, 5, 14, 1, 10, body);
  } else {
    box(g, 1, 7, 1, 6, body); // arms swinging, one forward one back
    box(g, 6, 5, 1, 6, body);
    box(g, 1, 14, 1, 5, body); // legs mid stride, feet planted wide
    box(g, 0, 19, 2, 5, body);
    box(g, 6, 14, 1, 5, body);
    box(g, 6, 19, 2, 5, body);
  }
  // small per kind accents, one or two pixels each, kept clear of the legs
  switch (kind) {
    case 'worker':
      box(g, 6, 11, 2, 3, PALETTE.detail.woodDark); // briefcase
      break;
    case 'guest':
      box(g, 6, 10, 2, 4, PALETTE.detail.chairA); // suitcase
      break;
    case 'shopper':
      box(g, 6, 11, 2, 3, PALETTE.detail.shelfGoodsA); // shopping bag
      break;
    case 'staff':
      box(g, 2, 5, 4, 1, PALETTE.simAccent); // uniform collar
      break;
    case 'vip':
      box(g, 1, 1, 6, 1, PALETTE.amber); // hat brim
      box(g, 2, 0, 4, 1, PALETTE.amber);
      break;
    case 'diner':
      box(g, 6, 11, 2, 2, PALETTE.detail.linen);
      break;
    case 'resident':
      box(g, 2, 5, 4, 1, PALETTE.detail.blanketA); // scarf
      break;
    case 'visitor':
      break;
  }
}

function drawGhost(g: Graphics, w: number, h: number, ok: boolean): void {
  const color = ok ? PALETTE.ghostOk : PALETTE.alert;
  box(g, 0, 0, w, h, color, 0.18);
  // Two pixels of edge, not one: at phone zoom a single pixel of outline all but disappears
  // against the tower behind it, and the outline is the whole point of the preview.
  outline(g, 0, 0, w, h, color);
  if (w > 2 && h > 2) outline(g, 1, 1, w - 2, h - 2, color);
  for (let x = 0; x < w; x += TILE_PX) box(g, x, 0, 1, h, color, 0.12); // tile guides
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createArt(renderer: Renderer): Art {
  const cache = new Map<string, Texture>();

  function bake(key: string, w: number, h: number, draw: (g: Graphics) => void): Texture {
    const hit = cache.get(key);
    if (hit) return hit;
    const g = new Graphics();
    draw(g);
    const texture = renderer.generateTexture({
      target: g,
      frame: new Rectangle(0, 0, w, h),
      resolution: 1,
      antialias: false,
      textureSourceOptions: { scaleMode: 'nearest' },
    });
    g.destroy();
    cache.set(key, texture);
    return texture;
  }

  return {
    room(kind, width, height, variant, lit) {
      const tiles = Math.max(1, Math.round(width));
      const floors = Math.max(1, Math.round(height));
      const v = ((Math.round(variant) % 2) + 2) % 2;
      const w = tiles * TILE_PX;
      const h = floors * FLOOR_PX;
      return bake(`room:${kind}:${tiles}:${floors}:${v}:${lit ? 1 : 0}`, w, h, (g) => {
        drawShell(g, kind, w, h, lit);
        if (FULL_HEIGHT.has(kind)) {
          drawInterior(g, kind, 0, w, h, v, lit);
        } else {
          for (let f = 0; f < floors; f++) drawInterior(g, kind, f * FLOOR_PX, w, FLOOR_PX, v, lit);
        }
        drawCellOutline(g, w, h, floors, !FULL_HEIGHT.has(kind));
      });
    },

    slab(widthTiles) {
      const tiles = Math.max(1, Math.round(widthTiles));
      const w = tiles * TILE_PX;
      return bake(`slab:${tiles}`, w, 4, (g) => drawSlab(g, w));
    },

    shaft(kind, floors) {
      const n = Math.max(1, Math.round(floors));
      const w = SHAFTS[kind].width * TILE_PX;
      const h = n * FLOOR_PX;
      return bake(`shaft:${kind}:${n}`, w, h, (g) => drawShaft(g, kind, w, h));
    },

    car(kind, doorsOpen) {
      const w = SHAFTS[kind].width * TILE_PX - 4;
      const h = FLOOR_PX - 6;
      return bake(`car:${kind}:${doorsOpen ? 1 : 0}`, w, h, (g) => drawCar(g, kind, w, h, doorsOpen));
    },

    sim(kind, band, frame) {
      return bake(`sim:${kind}:${band}:${frame}`, SIM_W, SIM_H, (g) => drawSim(g, kind, band, frame));
    },

    ghost(widthTiles, heightFloors, ok) {
      const tiles = Math.max(1, Math.round(widthTiles));
      const floors = Math.max(1, Math.round(heightFloors));
      const w = tiles * TILE_PX;
      const h = floors * FLOOR_PX;
      return bake(`ghost:${tiles}:${floors}:${ok ? 1 : 0}`, w, h, (g) => drawGhost(g, w, h, ok));
    },
  };
}

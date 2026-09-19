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

const SLAB_H = 3;
const WIN_Y = 4;
const WIN_H = 7;
const WIN_W = 5;
const WIN_STEP = 9;
const INTERIOR_TOP = 13; // first free pixel under the window band, relative to a floor band

type WindowMood = 'glass' | 'none';

const WINDOWS: Record<RoomKind, WindowMood> = {
  lobby: 'glass',
  skyLobby: 'glass',
  stairs: 'glass',
  escalator: 'glass',
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

function pick(list: readonly number[], i: number, fallback: number): number {
  return list[((i % list.length) + list.length) % list.length] ?? fallback;
}

// ---------------------------------------------------------------------------
// Shared furniture
// ---------------------------------------------------------------------------

function plant(g: Graphics, x: number, by: number): void {
  box(g, x, by - 4, 5, 4, PALETTE.detail.pot);
  box(g, x + 1, by - 10, 3, 6, PALETTE.detail.leaf);
  box(g, x - 1, by - 9, 2, 3, PALETTE.detail.leaf);
  box(g, x + 4, by - 9, 2, 3, PALETTE.detail.leaf);
}

function poster(g: Graphics, x: number, y: number, color: number): void {
  box(g, x, y, 7, 9, PALETTE.detail.metalDark);
  box(g, x + 1, y + 1, 5, 7, color);
}

function floorLamp(g: Graphics, x: number, by: number, lit: boolean): void {
  box(g, x, by - 2, 5, 2, PALETTE.detail.metalDark);
  box(g, x + 2, by - 13, 1, 11, PALETTE.detail.metal);
  box(g, x - 1, by - 17, 7, 4, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
}

function chair(g: Graphics, x: number, by: number, color: number, faceRight: boolean): void {
  box(g, x, by - 6, 4, 4, color);
  box(g, faceRight ? x : x + 3, by - 10, 1, 5, color);
  box(g, x, by - 2, 4, 2, PALETTE.detail.metalDark);
}

function desk(g: Graphics, x: number, by: number, lit: boolean, v: number): void {
  const top = by - 10;
  box(g, x, top, 15, 2, PALETTE.detail.wood);
  box(g, x + 1, top + 2, 2, 8, PALETTE.detail.woodDark);
  box(g, x + 12, top + 2, 2, 8, PALETTE.detail.woodDark);
  box(g, x + 4, top - 6, 7, 6, PALETTE.detail.metalDark);
  box(g, x + 5, top - 5, 5, 4, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  chair(g, x + 16, by, v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB, false);
}

function bed(g: Graphics, x: number, by: number, w: number, v: number): void {
  const blanket = v === 0 ? PALETTE.detail.blanketA : PALETTE.detail.blanketB;
  box(g, x, by - 6, w, 6, PALETTE.detail.woodDark);
  box(g, x, by - 11, 3, 11, PALETTE.detail.wood); // headboard
  box(g, x + 3, by - 8, w - 3, 3, PALETTE.detail.linen); // made: flat sheet
  box(g, x + 4, by - 9, 5, 2, PALETTE.detail.pillow);
  box(g, x + w - 8, by - 8, 7, 3, blanket); // folded blanket at the foot
}

function table(g: Graphics, x: number, by: number, w: number, v: number): void {
  box(g, x + 1, by - 8, w - 2, 1, PALETTE.detail.woodDark);
  box(g, x, by - 8, w, 5, PALETTE.detail.linen); // cloth
  box(g, x + Math.floor(w / 2) - 1, by - 3, 2, 3, PALETTE.detail.woodDark);
  box(g, x + Math.floor(w / 2) - 3, by - 1, 6, 1, PALETTE.detail.woodDark);
  box(g, x + Math.floor(w / 2) - 1, by - 10, 2, 2, v === 0 ? PALETTE.detail.leaf : PALETTE.detail.cross);
}

function shelfUnit(g: Graphics, x: number, by: number, h: number, v: number): void {
  box(g, x, by - h, 11, h, PALETTE.detail.woodDark);
  for (let s = 1; s * 5 < h; s++) {
    const y = by - h + s * 5;
    box(g, x, y, 11, 1, PALETTE.detail.wood);
    for (let i = 0; i < 3; i++) {
      const c = (i + s + v) % 2 === 0 ? PALETTE.detail.shelfGoodsA : PALETTE.detail.shelfGoodsB;
      box(g, x + 1 + i * 3, y - 3, 2, 3, c);
    }
  }
}

function carSilhouette(g: Graphics, x: number, by: number, color: number): void {
  box(g, x, by - 6, 22, 5, color);
  box(g, x + 5, by - 10, 12, 4, color);
  box(g, x + 6, by - 9, 4, 2, PALETTE.detail.glass);
  box(g, x + 11, by - 9, 5, 2, PALETTE.detail.glass);
  box(g, x + 3, by - 2, 4, 2, PALETTE.detail.dark);
  box(g, x + 15, by - 2, 4, 2, PALETTE.detail.dark);
}

// ---------------------------------------------------------------------------
// Room shell: wall, window band per floor, floor slabs
// ---------------------------------------------------------------------------

function drawWindowBand(g: Graphics, kind: RoomKind, y0: number, w: number, lit: boolean): void {
  const mood = WINDOWS[kind];
  if (mood === 'none') return;
  box(g, 0, y0 + WIN_Y - 1, w, WIN_H + 2, PALETTE.windowFrame);
  for (let x = 2; x + WIN_W <= w - 1; x += WIN_STEP) {
    box(g, x, y0 + WIN_Y, WIN_W, WIN_H, lit ? PALETTE.windowLit : PALETTE.windowUnlit);
    // The renderer only knows lit or unlit, so an unlit pane keeps a day sky reflection
    // in its upper half and the deep unlit blue below.
    if (!lit) box(g, x, y0 + WIN_Y, WIN_W, 3, PALETTE.windowDay);
  }
}

function drawShell(g: Graphics, kind: RoomKind, w: number, h: number, lit: boolean): void {
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
// (top of the floor slab), `ty` the first free row under the windows.
// ---------------------------------------------------------------------------

function drawInterior(g: Graphics, kind: RoomKind, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const ty = y0 + INTERIOR_TOP;
  switch (kind) {
    case 'lobby':
      drawLobby(g, y0, w, h, v, lit);
      break;
    case 'skyLobby':
      drawSkyLobby(g, y0, w, h, v, lit);
      break;
    case 'stairs':
      drawStairs(g, y0, w, h, v);
      break;
    case 'escalator':
      drawEscalator(g, y0, w, h, v, lit);
      break;
    case 'office':
      for (let x = 4; x + 15 <= w - 6; x += 24) desk(g, x, by, lit, v);
      if (v === 1 && w >= 40) plant(g, w - 8, by);
      if (v === 0 && w >= 40) poster(g, w - 10, ty, PALETTE.detail.chairB);
      break;
    case 'condo': {
      box(g, 4, by - 1, w - 8, 1, PALETTE.detail.carpet);
      const sofaW = Math.min(34, Math.max(14, w - 40));
      box(g, 8, by - 11, sofaW, 5, PALETTE.detail.chairA); // back
      box(g, 8, by - 6, sofaW, 6, PALETTE.detail.chairB);
      box(g, 8, by - 9, 3, 9, PALETTE.detail.chairA);
      box(g, 8 + sofaW - 3, by - 9, 3, 9, PALETTE.detail.chairA);
      floorLamp(g, 8 + sofaW + 4, by, lit);
      plant(g, w - 10, by);
      if (v === 1) plant(g, w - 20, by);
      else poster(g, w - 22, ty, PALETTE.detail.leaf);
      break;
    }
    case 'hotelSingle':
      bed(g, 3, by, Math.max(14, w - 12), v);
      floorLamp(g, w - 7, by, lit);
      break;
    case 'hotelTwin': {
      const bw = Math.floor((w - 12) / 2);
      bed(g, 3, by, bw, v);
      bed(g, 6 + bw, by, bw, v);
      floorLamp(g, w - 6, by, lit);
      break;
    }
    case 'hotelSuite': {
      bed(g, 3, by, Math.max(16, Math.floor(w * 0.45)), v);
      const sx = Math.max(20, Math.floor(w * 0.45)) + 10;
      box(g, sx, by - 10, 18, 4, PALETTE.detail.chairA);
      box(g, sx, by - 6, 18, 6, PALETTE.detail.chairB);
      floorLamp(g, sx + 22, by, lit);
      if (v === 1) plant(g, w - 8, by);
      else poster(g, w - 10, ty, PALETTE.detail.gold);
      break;
    }
    case 'fastFood': {
      const cw = Math.floor(w * 0.45);
      box(g, 4, by - 12, cw, 3, PALETTE.detail.tile); // counter top
      box(g, 4, by - 9, cw, 9, PALETTE.detail.counter);
      for (let x = 8; x < cw; x += 8) box(g, x, by - 8, 1, 7, PALETTE.detail.woodDark);
      box(g, 6, ty, cw - 4, 8, v === 0 ? PALETTE.amber : PALETTE.detail.cross); // menu board
      for (let x = 9; x < cw - 2; x += 5) box(g, x, ty + 2, 3, 4, PALETTE.detail.dark);
      for (let x = cw + 10; x + 5 <= w - 3; x += 12) {
        box(g, x, by - 8, 5, 2, PALETTE.detail.metal); // stool seat
        box(g, x + 2, by - 6, 1, 6, PALETTE.detail.metalDark);
        box(g, x, by - 1, 5, 1, PALETTE.detail.metalDark);
      }
      break;
    }
    case 'restaurant': {
      for (let x = 8; x + 18 <= w - 4; x += 30) {
        table(g, x + 5, by, 14, v);
        chair(g, x, by, v === 0 ? PALETTE.detail.woodDark : PALETTE.detail.chairB, true);
        chair(g, x + 20, by, v === 0 ? PALETTE.detail.woodDark : PALETTE.detail.chairB, false);
      }
      if (w >= 64) box(g, w - 6, ty, 3, 10, PALETTE.detail.curtain);
      break;
    }
    case 'shop': {
      box(g, 3, ty - 1, w - 6, 7, v === 0 ? PALETTE.amber : PALETTE.detail.shelfGoodsB); // sign
      for (let x = 7; x + 4 < w - 4; x += 7) box(g, x, ty + 1, 4, 3, PALETTE.detail.dark); // lettering
      for (let x = 4; x + 11 <= w - 4; x += 15) shelfUnit(g, x, by, 16, v);
      break;
    }
    case 'cinema':
      drawCinema(g, y0, w, h, v, lit);
      break;
    case 'partyHall':
      drawPartyHall(g, y0, w, h, v, lit);
      break;
    case 'medical': {
      for (let x = 6; x + 22 <= w - 26; x += 28) {
        bed(g, x, by, 20, 0);
        box(g, x + 22, by - 14, 1, 14, PALETTE.detail.metal); // curtain rail post
        box(g, x + 22, by - 14, 4, 10, v === 0 ? PALETTE.detail.glass : PALETTE.detail.linen);
      }
      const cx = w - 18;
      box(g, cx + 5, ty, 4, 12, PALETTE.detail.cross); // the cross
      box(g, cx + 1, ty + 4, 12, 4, PALETTE.detail.cross);
      box(g, cx, by - 8, 14, 8, PALETTE.detail.tile); // nurse counter
      break;
    }
    case 'security': {
      const bankW = Math.min(w - 20, 56);
      for (let r = 0; r < 2; r++) {
        for (let x = 5; x + 12 <= bankW; x += 14) {
          const y = ty + r * 10;
          box(g, x, y, 12, 9, PALETTE.detail.metalDark);
          box(g, x + 1, y + 1, 10, 7, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
          box(g, x + 2, y + 2 + ((r + v) % 3), 8, 1, PALETTE.detail.metal, 0.5); // scan line
        }
      }
      box(g, 4, by - 8, bankW, 3, PALETTE.detail.metal); // console
      box(g, 5, by - 5, bankW - 2, 5, PALETTE.detail.metalDark);
      chair(g, bankW + 4, by, v === 0 ? PALETTE.detail.chairA : PALETTE.detail.chairB, false);
      break;
    }
    case 'housekeeping': {
      for (let x = 4; x + 11 <= Math.floor(w / 2); x += 15) shelfUnit(g, x, by, 15, v);
      let cx = Math.floor(w / 2) + 4;
      for (let i = 0; i < 2 && cx + 14 <= w - 2; i++, cx += 18) {
        box(g, cx, by - 12, 14, 2, PALETTE.detail.metal); // cart handle bar
        box(g, cx + 1, by - 10, 12, 8, i % 2 === v ? PALETTE.detail.chairA : PALETTE.detail.metalDark);
        box(g, cx + 2, by - 9, 10, 3, PALETTE.detail.linen); // folded towels
        box(g, cx + 2, by - 2, 3, 2, PALETTE.detail.dark);
        box(g, cx + 9, by - 2, 3, 2, PALETTE.detail.dark);
      }
      break;
    }
    case 'parkingRamp': {
      for (let x = 3; x + 6 <= w - 3; x += 10) box(g, x, by - 1, 6, 1, PALETTE.detail.stripe); // bay stripes
      stripe(g, 3, by - 2, Math.min(w - 3, 40), ty + 2, PALETTE.detail.stripe, 2); // the ramp
      box(g, 0, ty, 3, h - INTERIOR_TOP - SLAB_H, PALETTE.detail.dark);
      for (let x = 10; x + 6 <= w - 4; x += 26) box(g, x, ty - 4, 6, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark); // ceiling lamps
      carSilhouette(g, w - 28, by, v === 0 ? PALETTE.detail.carRed : PALETTE.detail.carBlue);
      break;
    }
    case 'parkingSpace': {
      box(g, 1, by - 12, 1, 12, PALETTE.detail.stripe);
      box(g, w - 2, by - 12, 1, 12, PALETTE.detail.stripe);
      box(g, 3, by - 1, w - 6, 1, PALETTE.detail.stripe);
      box(g, Math.floor(w / 2) - 3, ty - 2, 6, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark); // ceiling lamp
      carSilhouette(g, Math.max(2, Math.floor((w - 22) / 2)), by, v === 0 ? PALETTE.detail.carBlue : PALETTE.detail.carRed);
      break;
    }
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

function marbleFloor(g: Graphics, y0: number, w: number, h: number): void {
  const by = y0 + h - SLAB_H;
  box(g, 0, by - 4, w, 4, PALETTE.detail.marble);
  for (let x = 3; x < w; x += 12) box(g, x, by - 4, 1, 4, PALETTE.detail.marbleVein);
}

function drawLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const ty = y0 + INTERIOR_TOP;
  marbleFloor(g, y0, w, h);
  for (let x = 2; x + 3 <= w; x += 16) box(g, x, y0 + INTERIOR_TOP, 3, h - INTERIOR_TOP - SLAB_H - 4, PALETTE.detail.column);
  if (w >= 48) {
    box(g, 6, by - 13, 22, 3, PALETTE.detail.wood); // reception desk
    box(g, 7, by - 10, 20, 6, PALETTE.detail.woodDark);
    plant(g, 32, by);
  }
  if (w >= 24 && v === 1) box(g, w - 14, by - 6, 10, 2, PALETTE.detail.wood); // bench
  if (w < 24) {
    // A lobby is built one tile at a time, so the variant has to read at 8 px: a wall sconce.
    if (v === 1) box(g, 3, ty, 2, 3, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
    else box(g, 2, by - 5, 4, 1, PALETTE.detail.marbleVein);
  }
  if (lit) box(g, 0, y0 + 1, w, 1, PALETTE.detail.glow, 0.35);
}

function drawSkyLobby(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  marbleFloor(g, y0, w, h);
  const mezz = y0 + h - FLOOR_PX - 6; // balcony one floor above the main floor
  box(g, 0, mezz, w, 3, PALETTE.slab);
  box(g, 0, mezz, w, 1, PALETTE.slabEdge);
  box(g, 0, mezz - 6, w, 1, PALETTE.detail.column); // handrail
  for (let x = 2; x < w; x += 5) box(g, x, mezz - 6, 1, 6, PALETTE.detail.column, 0.7);
  const by = y0 + h - SLAB_H;
  if (w >= 40) {
    box(g, 5, by - 12, 18, 3, PALETTE.detail.wood);
    box(g, 6, by - 9, 16, 6, PALETTE.detail.woodDark);
  }
  if (w >= 20) plant(g, w - 12, by);
  if (w >= 34 && v === 1) plant(g, w - 24, by);
  if (w < 20) box(g, 2, by - 8, 4, 5, v === 0 ? PALETTE.detail.pot : PALETTE.detail.wood); // planter in a narrow segment
  if (lit) box(g, 0, y0 + 1, w, 1, PALETTE.detail.glow, 0.35);
}

function drawStairs(g: Graphics, y0: number, w: number, h: number, v: number): void {
  const by = y0 + h - SLAB_H;
  const steps = 8;
  const stepW = Math.max(2, Math.floor((w - 8) / steps));
  const stepH = Math.max(2, Math.floor((h - 12) / steps));
  for (let i = 0; i < steps; i++) {
    const x = 4 + i * stepW;
    const y = by - (i + 1) * stepH;
    box(g, x, y, stepW, 2, PALETTE.detail.metal); // tread
    box(g, x, y, 1, stepH, PALETTE.detail.metalDark); // riser
  }
  stripe(g, 4, by - stepH - 6, 4 + steps * stepW, by - steps * stepH - 6, v === 0 ? PALETTE.detail.metal : PALETTE.amber, 1);
  box(g, 0, by - 1, 6, 1, PALETTE.detail.metalDark);
  box(g, 4 + steps * stepW, y0 + 10, w - (4 + steps * stepW), 2, PALETTE.detail.metal); // top landing
}

function drawEscalator(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const x1 = 4;
  const x2 = w - 4;
  const y1 = by - 2;
  const y2 = y0 + 10;
  stripe(g, x1, y1, x2, y2, PALETTE.detail.metalDark, 7);
  stripe(g, x1, y1 - 1, x2, y2 - 1, PALETTE.detail.metal, 2);
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    box(g, x1 + (x2 - x1) * t - 1, y1 + (y2 - y1) * t - 3, 2, 2, PALETTE.detail.metalDark);
  }
  stripe(g, x1, y1 - 9, x2, y2 - 9, v === 0 ? PALETTE.detail.dark : PALETTE.detail.chairA, 2); // handrail
  if (lit) box(g, x1, y2 - 2, 6, 2, PALETTE.detail.glow);
}

function drawCinema(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const sw = Math.min(28, Math.floor(w / 6));
  box(g, 4, y0 + 8, sw, h - 20, PALETTE.detail.metalDark);
  box(g, 6, y0 + 10, sw - 4, h - 24, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff); // screen
  const seat = v === 0 ? PALETTE.detail.seatA : PALETTE.detail.seatB;
  const rows = Math.max(1, Math.floor((h - 20) / 12));
  for (let r = 0; r < rows; r++) {
    const ry = by - 2 - r * 12;
    box(g, sw + 8, ry - 1, w - sw - 12, 1, PALETTE.detail.dark); // raked floor
    for (let x = sw + 10; x + 6 <= w - 4; x += 8) {
      box(g, x, ry - 6, 6, 5, seat);
      box(g, x, ry - 9, 6, 3, PALETTE.detail.metalDark);
    }
  }
  box(g, w - 8, y0 + 6, 5, 6, lit ? PALETTE.amber : PALETTE.detail.metalDark); // projector
}

function drawPartyHall(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  box(g, 0, by - 2, w, 2, PALETTE.detail.wood); // dance floor
  const stageW = Math.min(40, Math.floor(w / 4));
  box(g, 2, by - 10, stageW, 8, PALETTE.detail.woodDark); // stage
  box(g, 2, by - 11, stageW, 1, PALETTE.detail.gold);
  box(g, 2, y0 + 6, stageW, by - 11 - (y0 + 6), PALETTE.detail.curtain); // backdrop
  for (let x = 4; x < stageW; x += 5) box(g, x, y0 + 6, 1, by - 17 - y0, PALETTE.detail.dark, 0.35);
  for (let i = 0; i < 2; i++) {
    const ty = by - 8 - i * 12;
    const tx = stageW + 8;
    const tw = w - tx - 6;
    if (tw < 12) break;
    box(g, tx, ty, tw, 1, PALETTE.detail.woodDark);
    box(g, tx, ty, tw, 4, PALETTE.detail.linen); // long table under a cloth
    for (let x = tx + 4; x < tx + tw; x += 10) box(g, x, ty - 2, 2, 2, v === 0 ? PALETTE.detail.leaf : PALETTE.detail.cross);
  }
  for (let x = stageW + 14; x < w - 6; x += 22) {
    box(g, x, y0 + 5, 2, 5, PALETTE.detail.gold);
    box(g, x - 3, y0 + 10, 8, 3, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark); // chandelier
  }
}

function drawRecycling(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  const beltY = y0 + Math.floor(h / 2);
  box(g, 4, beltY, w - 8, 4, PALETTE.detail.metalDark); // conveyor
  box(g, 4, beltY, w - 8, 1, PALETTE.detail.metal);
  for (let x = 8; x < w - 8; x += 8) box(g, x, beltY + 4, 3, 3, PALETTE.detail.metal); // rollers
  for (let x = 10 + v * 4; x < w - 12; x += 16) box(g, x, beltY - 3, 4, 3, PALETTE.detail.shelfGoodsA); // parcels on the belt
  const bins = [PALETTE.detail.binGreen, PALETTE.detail.binBlue, PALETTE.detail.binAmber] as const;
  for (let i = 0; i < 4; i++) {
    const x = 8 + i * 22;
    if (x + 16 > w - 4) break;
    box(g, x, by - 16, 16, 16, pick(bins, i + v, PALETTE.detail.binGreen));
    box(g, x - 1, by - 18, 18, 2, PALETTE.detail.metalDark); // lid
    box(g, x + 4, by - 12, 8, 6, PALETTE.detail.dark, 0.4);
  }
  box(g, w - 12, y0 + 4, 8, beltY - y0 - 4, PALETTE.detail.metalDark); // chute
  if (lit) box(g, 6, y0 + 3, 6, 2, PALETTE.detail.screenOn);
}

function drawMetro(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  box(g, 0, by - 26, w, 26, PALETTE.detail.dark, 0.5); // the cut into the tunnel
  const platW = Math.floor(w * 0.55);
  const platY = by - 12;
  box(g, 0, platY, platW, 12, PALETTE.detail.tile); // platform
  box(g, 0, platY, platW, 1, PALETTE.detail.metal);
  box(g, platW - 3, platY + 1, 3, 11, PALETTE.amber, 0.8); // platform edge line
  const railY = by - 3;
  box(g, platW, railY - 2, w - platW, 5, PALETTE.detail.dark);
  for (let x = platW + 2; x < w - 2; x += 6) box(g, x, railY, 3, 3, PALETTE.detail.woodDark); // sleepers
  box(g, platW, railY, w - platW, 1, PALETTE.detail.rail);
  box(g, platW, railY + 3, w - platW, 1, PALETTE.detail.rail);
  if (v === 1) {
    box(g, w - 26, railY - 14, 24, 14, PALETTE.detail.metal); // a train waiting
    box(g, w - 24, railY - 12, 8, 5, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
    box(g, w - 13, railY - 12, 8, 5, lit ? PALETTE.detail.screenOn : PALETTE.detail.screenOff);
  }
  box(g, 6, y0 + 6, 26, 7, PALETTE.detail.chairA); // station sign
  for (let x = 9; x < 30; x += 5) box(g, x, y0 + 8, 3, 3, PALETTE.detail.linen);
  for (let x = 12; x < platW - 8; x += 18) {
    box(g, x, platY - 14, 1, 14, PALETTE.detail.metal); // pillars
    box(g, x - 2, platY - 16, 5, 2, lit ? PALETTE.detail.glow : PALETTE.detail.metalDark);
  }
}

function drawCathedral(g: Graphics, y0: number, w: number, h: number, v: number, lit: boolean): void {
  const by = y0 + h - SLAB_H;
  box(g, 0, y0 + 1, w, h - 1 - SLAB_H, PALETTE.detail.stoneDark, 0.5);
  // tall windows, arched at the top
  const glass = v === 0 ? PALETTE.detail.glass : PALETTE.detail.curtain;
  for (let x = 6; x + 11 <= w - 6; x += 22) {
    const top = y0 + 12;
    const bot = by - 30;
    box(g, x, top + 4, 10, bot - top - 4, lit ? PALETTE.windowLit : PALETTE.windowUnlit);
    box(g, x + 2, top, 6, 5, lit ? PALETTE.windowLit : PALETTE.windowUnlit); // arch
    if (!lit) box(g, x, top + 4, 10, Math.max(3, Math.floor((bot - top) / 3)), PALETTE.windowDay); // day sky through the glass
    box(g, x + 4, top + 4, 2, bot - top - 4, glass); // tracery
    box(g, x, top + Math.floor((bot - top) / 2), 10, 2, glass);
    outline(g, x - 1, top - 1, 12, bot - top + 6, PALETTE.detail.stone);
  }
  // columns
  for (let x = 2; x + 3 <= w; x += 22) box(g, x, by - 30, 3, 30, PALETTE.detail.stone);
  // altar
  const ax = Math.floor(w / 2) - 7;
  box(g, ax, by - 10, 14, 4, PALETTE.detail.linen);
  box(g, ax + 2, by - 6, 10, 6, PALETTE.detail.stone);
  box(g, ax + 6, by - 20, 2, 10, PALETTE.detail.gold); // cross above the altar
  box(g, ax + 3, by - 17, 8, 2, PALETTE.detail.gold);
  // pews, two banks with a center aisle
  for (let r = 0; r < 4; r++) {
    const py = by - 2 - r * 6;
    if (py < by - 26) break;
    box(g, 6, py - 3, ax - 12, 3, PALETTE.detail.wood);
    box(g, 6, py - 6, ax - 12, 2, PALETTE.detail.woodDark);
    box(g, ax + 18, py - 3, w - ax - 24, 3, PALETTE.detail.wood);
    box(g, ax + 18, py - 6, w - ax - 24, 2, PALETTE.detail.woodDark);
  }
  if (lit) box(g, 0, y0 + 2, w, 1, PALETTE.detail.glow, 0.3);
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

const SIM_W = 2 * TILE_PX; // 16
const SIM_H = 4 * TILE_PX; // 32

function drawSim(g: Graphics, kind: SimKind, band: StressBand, frame: 0 | 1): void {
  const body = band === 'calm' ? PALETTE.sim.calm : band === 'pink' ? PALETTE.sim.pink : PALETTE.sim.red;
  box(g, 5, 2, 6, 6, body); // head
  box(g, 4, 8, 8, 12, body); // torso
  if (frame === 0) {
    box(g, 2, 9, 2, 8, body); // arms down
    box(g, 12, 9, 2, 8, body);
    box(g, 5, 20, 2, 11, body); // legs together
    box(g, 9, 20, 2, 11, body);
  } else {
    box(g, 2, 10, 2, 7, body); // arms swinging
    box(g, 12, 8, 2, 7, body);
    box(g, 3, 20, 3, 8, body); // legs apart
    box(g, 4, 28, 3, 3, body);
    box(g, 10, 20, 3, 8, body);
    box(g, 9, 28, 3, 3, body);
  }
  // small per kind accents, one or two pixels each
  switch (kind) {
    case 'worker':
      box(g, 12, 16, 3, 5, PALETTE.detail.woodDark); // briefcase
      break;
    case 'guest':
      box(g, 12, 17, 4, 6, PALETTE.detail.chairA); // suitcase
      break;
    case 'shopper':
      box(g, 12, 16, 4, 6, PALETTE.detail.shelfGoodsA); // shopping bag
      break;
    case 'staff':
      box(g, 4, 8, 8, 2, PALETTE.simAccent); // uniform collar
      break;
    case 'vip':
      box(g, 3, 0, 10, 2, PALETTE.amber); // hat brim
      box(g, 5, 0, 6, 2, PALETTE.amber);
      break;
    case 'diner':
      box(g, 12, 15, 3, 3, PALETTE.detail.linen);
      break;
    case 'resident':
      box(g, 5, 8, 6, 2, PALETTE.detail.blanketA); // scarf
      break;
    case 'visitor':
      break;
  }
}

function drawGhost(g: Graphics, w: number, h: number, ok: boolean): void {
  const color = ok ? PALETTE.ghostOk : PALETTE.alert;
  box(g, 0, 0, w, h, color, 0.18);
  outline(g, 0, 0, w, h, color);
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

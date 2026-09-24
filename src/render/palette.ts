// Every colour the procedural art uses. World tokens come from docs/VISUAL.md; the furniture
// shades are kept muted so lit windows and stress tints carry the signal.

import type { RoomKind } from '../sim/types';

export const PALETTE = {
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
  carShade: 0xc09d14, // the car's right shadow face
  slabShadow: 0x333333, // cast under every slab at SLAB_SHADOW_ALPHA
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
    // Native 16 px detail: one pixel highlights the 8 px grid had no room for.
    woodLight: 0xc98a45,
    leafLight: 0x4fa55a,
    columnLight: 0x5c5c5c,
    led: 0x5fd38a,
  },
} as const;

/**
 * Far zoom (below 0.5): every room is one flat block in its category colour with a 1 px outline,
 * and the share of its capacity inside now fills it from the floor up in a lighter tint of the
 * same colour. Categories share a hue so the tower reads as districts: offices blue, homes warm,
 * hotels violet, food orange, shops green, services teal and slate.
 */
export const BLOCK: Record<RoomKind, number> = {
  lobby: 0xcfc9b8,
  skyLobby: 0xcfc9b8,
  stairs: 0x9aa3ae,
  escalator: 0x9aa3ae,
  office: 0x4f78b0,
  condo: 0xc2925a,
  hotelSingle: 0x8a67ad,
  hotelTwin: 0x7d5aa3,
  hotelSuite: 0x6c4b94,
  fastFood: 0xe0913c,
  restaurant: 0xcf5f3a,
  shop: 0x4c9a66,
  cinema: 0x4a4a7a,
  partyHall: 0xc46aa0,
  medical: 0x4fa89c,
  security: 0x5f7089,
  housekeeping: 0x9a8f6a,
  parkingRamp: 0x7d818a,
  parkingSpace: 0x7d818a,
  recycling: 0x6f9a5a,
  metro: 0x5a6f8f,
  cathedral: 0xb8a67a,
};
/** The block outline, one screen pixel at any zoom. */
export const BLOCK_OUTLINE = 0x222222;
/** How far the occupancy fill lifts the block colour toward white. */
export const BLOCK_FILL_LIFT = 0.45;

/** Every silhouette is inked in this against the light walls. */
export const INK = 0x222222;

/** Shadow faces for the four walls docs/reviews/2026-09-22-codex-astra-ui-graphics.md section 1 names. */
const WALL_SHADOW: Partial<Record<RoomKind, number>> = {
  office: 0xd6d4ce,
  hotelSingle: 0xced2d8,
  hotelTwin: 0xced2d8,
  hotelSuite: 0xced2d8,
  lobby: 0xd7d7d4,
  skyLobby: 0xd7d7d4,
};

/** The same wall about 13 percent darker, the ratio of the named pairs above. */
export function shade(color: number, factor = 0.866): number {
  const r = Math.round(((color >> 16) & 0xff) * factor);
  const g = Math.round(((color >> 8) & 0xff) * factor);
  const b = Math.round((color & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** The shadow face colour of a kind's wall. */
export function wallShadow(kind: RoomKind): number {
  return WALL_SHADOW[kind] ?? shade(PALETTE.wall[kind]);
}

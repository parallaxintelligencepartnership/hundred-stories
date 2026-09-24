// Illustrated interiors for every room kind (package 8b, extending package 2's venues). One
// registry, INTERIORS, says for each RoomKind how its illustrated layer is drawn over the plain
// structural shell (art.ts VENUE_SHELL): which rows it covers, how many variants it has, its
// closed-hours overlay if it keeps hours, who stands at its post, and whether warm pools of
// light hang under its ceiling at night. Offices, shops and restaurants delegate to
// illustrated.ts (their three treatments, signs and shutters); every other kind is drawn here.
//
// Same two texture classes and the same budget rule as package 2 (docs/VISUAL.md): anti-aliased
// canvas paths, a 2 px #222222 outline on every shape, baked by art.ts at twice the structural
// resolution, and each texture covers only the rows it draws. Pure drawing: no pixi, no DOM.

import { SCHEDULES, WASTE } from '../sim/rules';
import { clockOf, type Id, type RoomKind, type SimKind } from '../sim/types';
import { FLOOR_PX, INTERIOR_TOP, OPEN_TOP, SLAB_PX, TILE_PX, WIN_PANE_TOP, WIN_SILL } from './grid';
import {
  box,
  chair,
  closedBand,
  css,
  disc,
  drawClosed,
  drawVenueFixtures,
  INK,
  line,
  monitor,
  pendant,
  plant,
  poly,
  RESTAURANT_PASS_W,
  rrPath,
  scaleColour,
  SHOP_COUNTER_W,
  stool,
  VENUE_BAND,
  vgrad,
} from './illustrated';
import { isVenueKind, TREATMENTS, venueOf, venueOpen, type Treatment } from './venue';

type Ctx = CanvasRenderingContext2D;

const BASE = FLOOR_PX - SLAB_PX; // 66, the first row of the slab
const TY = INTERIOR_TOP; // 22

/** Rows of a room an illustrated texture covers, logical px from the room's top left. */
export interface Band {
  top: number;
  height: number;
}

/** A closed-hours overlay's rectangle in the room, logical px from its top left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Who stands at a room's post, and when. */
export interface Post {
  /** Whose clothes they wear (figure.ts wardrobeOf): a clerk, a nurse, a guard, a collector. */
  kind: SimKind;
  /** Where they stand, logical px from the room's left edge; `w` is the room's width in px. */
  x(w: number): number;
  /** 'open': whenever the room keeps its hours. 'occupied': open and somebody is inside. */
  when: 'open' | 'occupied';
}

export interface InteriorSpec {
  /** How many drawn variants; a room picks one with interiorVariant. Venues: their treatments. */
  variants: number;
  /** The rows the fixture texture covers, for a room `floors` tall. */
  band(floors: number): Band;
  /** The fixtures, in room coordinates (the bake crops to the band). `w` is the width in px. */
  draw(ctx: Ctx, w: number, floors: number, variant: number): void;
  /** Whether the room keeps its doors open at `minute`; absent means always open. */
  open?(minute: number): boolean;
  /** What a closed room shows over its fixtures, drawn in room coordinates inside `rect`. */
  closed?: { rect(w: number, floors: number): Rect; draw(ctx: Ctx, w: number, floors: number): void };
  post?: Post;
  /** Warm pools of light under the ceiling at night while it is lit (occupied, or staffed). */
  pools: boolean;
  /** Stairs and escalators: the illustrated texture is the whole room, drawn over the rooms it crosses. */
  overlay?: boolean;
  /**
   * Bake at the structural resolution instead of twice it, still anti-aliased and sampled linear:
   * the connectors, long straight flights that recede below zoom 0.75 (hierarchy.ts), where the
   * doubled resolution buys nothing a player sees (the texture budget, package 8b).
   */
  structuralScale?: boolean;
}

// ---------------------------------------------------------------- shared pieces

const FULL = (floors: number): Band => ({ top: 0, height: Math.max(1, floors) * FLOOR_PX });
/** A flight's rows: from its handrail at the head down to the slab at its foot. */
const FLIGHT_TOP = BASE - 34;
const FLIGHT = (floors: number): Band => ({ top: FLIGHT_TOP, height: Math.max(1, floors) * FLOOR_PX - FLIGHT_TOP });
const WINDOWLESS: Band = { top: OPEN_TOP - 2, height: BASE - (OPEN_TOP - 2) };

function flip(ctx: Ctx, w: number, on: boolean): void {
  if (!on) return;
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, lineW = 2): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineW > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lineW;
    ctx.stroke();
  }
}

function picture(ctx: Ctx, x: number, y: number, w: number, h: number, sky: string, hill: string): void {
  box(ctx, x, y, w, h, '#f7f5ee', 1);
  ctx.fillStyle = sky;
  ctx.fillRect(x + 2.5, y + 2.5, w - 5, h - 5);
  poly(ctx, [[x + 2.5, y + h - 2.5], [x + w * 0.4, y + h * 0.45], [x + w * 0.65, y + h - 5], [x + w - 2.5, y + h * 0.55], [x + w - 2.5, y + h - 2.5]], hill, 0);
}

function floorLamp(ctx: Ctx, x: number, by: number, top: number, shade: string): void {
  line(ctx, [[x, by], [x, top + 7]], '#333a44', 2);
  line(ctx, [[x - 4, by], [x + 4, by]], INK, 2);
  poly(ctx, [[x - 5, top + 8], [x - 3, top], [x + 3, top], [x + 5, top + 8]], shade, 1.5);
}

function tableLamp(ctx: Ctx, x: number, by: number, shade: string): void {
  line(ctx, [[x, by], [x, by - 6]], '#333a44', 1.5);
  poly(ctx, [[x - 4, by - 6], [x - 2.5, by - 11], [x + 2.5, by - 11], [x + 4, by - 6]], shade, 1.5);
}

function sofa(ctx: Ctx, x: number, by: number, w: number, colour: number): void {
  const c = css(colour);
  const dark = css(scaleColour(colour, 0.8));
  box(ctx, x + 3, by - 24, w - 6, 13, dark, 3); // the back
  box(ctx, x + 3, by - 13, w - 6, 7, c, 2); // the seat
  box(ctx, x, by - 18, 6, 13, c, 2.5); // the arms
  box(ctx, x + w - 6, by - 18, 6, 13, c, 2.5);
  for (let cx = x + 8; cx + 12 < x + w - 6; cx += 16) box(ctx, cx, by - 22, 12, 9, c, 3, 1.2); // cushions
  line(ctx, [[x + 3, by - 6], [x + 3, by]], INK, 2);
  line(ctx, [[x + w - 3, by - 6], [x + w - 3, by]], INK, 2);
}

function bed(ctx: Ctx, x: number, by: number, w: number, duvet: number, runner: number, wood: number): void {
  box(ctx, x, by - 28, 5, 28, css(wood), 1.5); // headboard
  box(ctx, x + 5, by - 12, w - 7, 6, '#f7f5ee', 1); // mattress
  box(ctx, x + w - 4, by - 16, 4, 16, css(wood), 1); // footboard
  box(ctx, x + 14, by - 16, w - 20, 7, css(duvet), 2); // duvet
  ctx.fillStyle = css(runner);
  ctx.fillRect(x + w - 16, by - 15, 5, 5); // the runner across the foot
  box(ctx, x + 6, by - 18, 10, 6, '#ffffff', 2.5, 1.5); // pillow
  line(ctx, [[x + 6, by - 6], [x + 6, by]], INK, 2);
  line(ctx, [[x + w - 3, by - 6], [x + w - 3, by]], INK, 2);
}

function nightstand(ctx: Ctx, x: number, by: number, wood: number, shade: string): void {
  box(ctx, x, by - 13, 10, 13, css(wood), 1);
  line(ctx, [[x + 2, by - 7], [x + 8, by - 7]], INK, 1);
  tableLamp(ctx, x + 5, by - 13, shade);
}

function shutter(ctx: Ctx, x: number, top: number, w: number, bottom: number): void {
  box(ctx, x, top, w, bottom - top, vgrad(ctx, top, bottom, '#b9c0ca', '#8a939e'), 1);
  for (let y = top + 4; y < bottom - 2; y += 4) line(ctx, [[x + 2, y], [x + w - 2, y]], 'rgba(34,34,34,0.35)', 1);
  box(ctx, x + w / 2 - 3, bottom - 8, 6, 5, '#c9a227', 1, 1.5);
}

function blinds(ctx: Ctx, w: number, y0: number, y1: number): void {
  box(ctx, 2, y0, w - 4, y1 - y0, '#e9dfc9', 0, 1.5);
  for (let y = y0 + 2.5; y < y1; y += 2.5) line(ctx, [[3, y], [w - 3, y]], 'rgba(120,100,70,0.55)', 0.8);
}

/** A car side on, wheels on `by`: a body, a cabin, windows, two wheels. */
function car(ctx: Ctx, x: number, by: number, w: number, colour: number): void {
  const h = 18;
  const top = by - h;
  ctx.beginPath();
  ctx.moveTo(x + 2, by - 4);
  ctx.lineTo(x + 1, top + 8);
  ctx.quadraticCurveTo(x + 2, top + 5, x + 8, top + 5);
  ctx.lineTo(x + w * 0.28, top + 5);
  ctx.lineTo(x + w * 0.36, top);
  ctx.lineTo(x + w * 0.7, top);
  ctx.lineTo(x + w * 0.8, top + 5);
  ctx.lineTo(x + w - 3, top + 6);
  ctx.quadraticCurveTo(x + w, top + 8, x + w - 1, top + 11);
  ctx.lineTo(x + w - 2, by - 4);
  ctx.closePath();
  ctx.fillStyle = css(colour);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  poly(ctx, [[x + w * 0.31, top + 5], [x + w * 0.38, top + 1.5], [x + w * 0.52, top + 1.5], [x + w * 0.52, top + 5]], '#9fc6e0', 1.2);
  poly(ctx, [[x + w * 0.55, top + 5], [x + w * 0.55, top + 1.5], [x + w * 0.68, top + 1.5], [x + w * 0.76, top + 5]], '#9fc6e0', 1.2);
  for (const wx of [x + w * 0.22, x + w * 0.8]) {
    disc(ctx, wx, by - 3.5, 3.5, '#1c1c1f');
    disc(ctx, wx, by - 3.5, 1.4, '#9aa3ae', 0);
  }
}

/** An exit sign: a small green box with a running figure, lit. */
function exitSign(ctx: Ctx, x: number, y: number): void {
  box(ctx, x, y, 14, 7, '#2f9e5a', 1, 1.5);
  line(ctx, [[x + 4, y + 5], [x + 6, y + 2.5], [x + 9, y + 4.5]], '#ffffff', 1);
}

// ---------------------------------------------------------------- homes and hotel rooms

const HOME_PALETTES = [
  { sofa: 0x2f7d7d, wood: 0xc98a45, accent: 0xe07a5f, rug: 0xd9c2a0, sky: '#8fd4ff', hill: '#4fa55a' },
  { sofa: 0xd9a441, wood: 0x6b4420, accent: 0x2f5c9e, rug: 0xb9c8d6, sky: '#ffd8a8', hill: '#b0417a' },
] as const;

function drawCondo(ctx: Ctx, w: number, _floors: number, variant: number): void {
  const p = HOME_PALETTES[variant % 2] as (typeof HOME_PALETTES)[number];
  const by = BASE;
  flip(ctx, w, variant % 2 === 1);
  // The kitchen: a fridge, a run of counter with cabinets over it, a kettle.
  box(ctx, 6, TY + 2, 17, by - TY - 2, '#e4e8ee', 2);
  line(ctx, [[8, TY + 16], [21, TY + 16]], INK, 1.2);
  line(ctx, [[20, TY + 6], [20, TY + 12]], '#5a6472', 1.2);
  const kx = 26;
  const kw = Math.min(54, w * 0.22);
  box(ctx, kx, TY + 1, kw, 10, css(p.wood), 1);
  line(ctx, [[kx + kw / 2, TY + 2], [kx + kw / 2, TY + 10]], INK, 1);
  box(ctx, kx, by - 21, kw, 4, '#f2efe6', 1);
  box(ctx, kx + 1, by - 17, kw - 2, 17, css(scaleColour(p.wood, 0.85)), 1);
  for (let x = kx + 4; x + 10 < kx + kw; x += 13) box(ctx, x, by - 15, 10, 13, css(scaleColour(p.wood, 0.95)), 1, 1);
  box(ctx, kx + 6, by - 27, 7, 6, css(p.accent), 2); // kettle
  // Dining: a table with two chairs under a pendant.
  const dx = kx + kw + 10;
  chair(ctx, dx, by, css(p.wood), true);
  box(ctx, dx + 10, by - 18, 32, 3.5, css(p.wood), 1);
  line(ctx, [[dx + 14, by - 15], [dx + 14, by]], INK, 2);
  line(ctx, [[dx + 38, by - 15], [dx + 38, by]], INK, 2);
  disc(ctx, dx + 26, by - 21, 2.5, css(p.accent), 1.2); // a bowl
  chair(ctx, dx + 42, by, css(p.wood), false);
  pendant(ctx, dx + 26, 3, '#f7f1d8', false);
  // Living: a rug, the sofa with a picture over it, a coffee table, a floor lamp, a plant.
  const lx = dx + 62;
  const sw = Math.max(40, Math.min(64, w - lx - 44));
  ellipse(ctx, lx + sw / 2 + 6, by - 1, sw / 2 + 12, 2.4, css(p.rug), 1.2);
  picture(ctx, lx + sw / 2 - 14, TY + 1, 28, 14, p.sky, p.hill);
  sofa(ctx, lx, by, sw, p.sofa);
  box(ctx, lx + 8, by - 9, sw - 16, 3, css(scaleColour(p.wood, 1.1)), 1); // coffee table
  line(ctx, [[lx + 11, by - 6], [lx + 11, by]], INK, 1.5);
  line(ctx, [[lx + sw - 11, by - 6], [lx + sw - 11, by]], INK, 1.5);
  floorLamp(ctx, lx + sw + 10, by, TY + 2, '#f7f1d8');
  if (lx + sw + 22 < w - 12) plant(ctx, w - 16, by);
}

const HOTEL_PALETTES = [
  { duvet: 0xf2efe6, runner: 0x8c1f3d, wood: 0x8a5a2b, sky: '#8fd4ff', hill: '#2f7d7d' },
  { duvet: 0xe6ecf2, runner: 0x2f5c9e, wood: 0xc98a45, sky: '#f6b98a', hill: '#6a3a97' },
] as const;

function drawHotel(kind: 'hotelSingle' | 'hotelTwin' | 'hotelSuite'): InteriorSpec['draw'] {
  return (ctx, w, _floors, variant) => {
    const p = HOTEL_PALETTES[variant % 2] as (typeof HOTEL_PALETTES)[number];
    const by = BASE;
    flip(ctx, w, variant % 2 === 1);
    if (kind === 'hotelSingle') {
      picture(ctx, 18, TY + 1, 22, 11, p.sky, p.hill);
      bed(ctx, 5, by, 40, p.duvet, p.runner, p.wood);
      nightstand(ctx, 46, by, p.wood, '#f7f1d8');
      return;
    }
    if (kind === 'hotelTwin') {
      picture(ctx, 14, TY + 1, 18, 10, p.sky, p.hill);
      picture(ctx, 58, TY + 1, 18, 10, p.sky, p.hill);
      bed(ctx, 4, by, 34, p.duvet, p.runner, p.wood);
      nightstand(ctx, 40, by, p.wood, '#f7f1d8');
      bed(ctx, 52, by, 34, p.duvet, p.runner, p.wood);
      return;
    }
    // The suite: a king bed, a nightstand, a sofa and coffee table under a picture, a plant.
    picture(ctx, 16, TY + 1, 30, 12, p.sky, p.hill);
    bed(ctx, 4, by, 54, p.duvet, p.runner, p.wood);
    nightstand(ctx, 60, by, p.wood, '#f7f1d8');
    picture(ctx, 96, TY + 1, 24, 13, p.sky, p.hill);
    sofa(ctx, 84, by, 48, p.runner);
    box(ctx, 92, by - 9, 32, 3, css(p.wood), 1);
    line(ctx, [[95, by - 6], [95, by]], INK, 1.5);
    line(ctx, [[121, by - 6], [121, by]], INK, 1.5);
    plant(ctx, w - 18, by);
  };
}

// ---------------------------------------------------------------- food and fun

function fastFoodCounterX(w: number): number {
  return Math.max(110, w - 138);
}

/**
 * The gap between the fast food's two menu boards, where the cook stands. People at a post are
 * drawn behind the fixtures (a clerk behind the counter), so every post stands where only the
 * counter or the desk is in front of them.
 */
const FAST_FOOD_COOK_GAP = 26;
const fastFoodCookX = (w: number): number => fastFoodCounterX(w) + 42 + FAST_FOOD_COOK_GAP / 2;

function drawFastFood(ctx: Ctx, w: number): void {
  const by = BASE;
  const counterX = fastFoodCounterX(w);
  // Menu boards over the counter, lit panels with the day's food, apart over the cook's spot.
  for (let i = 0, x = counterX + 4; i < 2; i++, x += FAST_FOOD_COOK_GAP + 38) {
    box(ctx, x, TY, 38, 14, '#2b2b2b', 1);
    const items = ['#d2761f', '#f4b942', '#c03028'];
    for (let k = 0; k < 3; k++) {
      disc(ctx, x + 7 + k * 12, TY + 6, 3, items[(k + i) % 3] as string, 1);
      line(ctx, [[x + 4 + k * 12, TY + 11], [x + 10 + k * 12, TY + 11]], '#f7f5ee', 1);
    }
  }
  // Behind the counter: a fryer and a drinks machine, either side of the cook.
  box(ctx, counterX + 80, by - 34, 22, 14, '#9aa3ae', 1);
  box(ctx, counterX + 84, by - 38, 14, 4, '#f4b942', 1, 1.5);
  box(ctx, w - 34, by - 44, 20, 24, '#c03028', 1.5);
  box(ctx, w - 31, by - 41, 14, 8, '#f7f5ee', 1, 1);
  for (let k = 0; k < 3; k++) line(ctx, [[w - 29 + k * 5, by - 32], [w - 29 + k * 5, by - 27]], INK, 1.2);
  // The counter, red and yellow, with a register and a tray.
  box(ctx, counterX, by - 22, w - counterX - 10, 5, '#f4b942', 1);
  box(ctx, counterX + 2, by - 17, w - counterX - 14, 17, '#c03028', 1);
  for (let x = counterX + 8; x < w - 16; x += 12) line(ctx, [[x, by - 14], [x, by - 3]], 'rgba(255,255,255,0.35)', 1.5);
  box(ctx, counterX + 6, by - 31, 14, 9, '#5a6472', 1.5);
  box(ctx, counterX + 26, by - 24, 16, 2.5, '#d9643a', 1, 1.2);
  // The seating: small tables with stools, a trash bin by the door.
  for (let x = 22; x + 30 < counterX - 6; x += 46) {
    stool(ctx, x - 9, by, '#f4b942');
    box(ctx, x - 2, by - 20, 22, 3, '#f2efe6', 1);
    line(ctx, [[x + 9, by - 17], [x + 9, by]], INK, 2);
    line(ctx, [[x + 4, by], [x + 14, by]], INK, 2);
    box(ctx, x + 2, by - 25, 6, 5, '#d2761f', 2, 1.2); // a burger in its box
    box(ctx, x + 11, by - 27, 4, 7, '#c03028', 1, 1.2); // a cup
    stool(ctx, x + 27, by, '#f4b942');
  }
}

/** Show times: the room is open (lights down, a picture on the screen) for each show. */
function cinemaOpen(minute: number): boolean {
  const m = clockOf(minute).minuteOfDay;
  return SCHEDULES.cinema.showTimes.some((t) => m >= t && m < t + SCHEDULES.cinema.showMinutes);
}

/** Where the usher stands: between the right curtain and the first row of seats. */
function cinemaUsherX(w: number): number {
  const s = cinemaScreen(w, 2);
  return s.x + s.w + 22;
}

/** The screen, in cinema room coordinates. */
function cinemaScreen(w: number, floors: number): Rect {
  const h = floors * FLOOR_PX;
  return { x: 22, y: 22, w: Math.min(150, Math.floor(w * 0.3)), h: Math.min(84, h - 60) };
}

function drawCinema(ctx: Ctx, w: number, floors: number): void {
  const by = floors * FLOOR_PX - SLAB_PX;
  // The marquee housing along the top; the ambient layer cycles its lights (ambient.ts).
  const mq = { x: 8, y: OPEN_TOP + 2, w: w - 24, h: 4 };
  box(ctx, mq.x - 2, mq.y - 2, mq.w + 4, mq.h + 4, '#3a3f4a', 1, 1.5);
  const s = cinemaScreen(w, floors);
  // Velvet curtains either side, the screen with a film still on it, the stage under it.
  for (const cx of [s.x - 14, s.x + s.w + 2]) {
    box(ctx, cx, s.y - 6, 12, s.h + 20, vgrad(ctx, s.y, s.y + s.h, '#b0243a', '#6e1424'), 1);
    for (let k = 3; k < 12; k += 4) line(ctx, [[cx + k, s.y - 4], [cx + k, s.y + s.h + 12]], 'rgba(0,0,0,0.25)', 1);
  }
  box(ctx, s.x, s.y, s.w, s.h, vgrad(ctx, s.y, s.y + s.h, '#7fc4f0', '#d8eefc'), 1);
  poly(ctx, [[s.x + 2, s.y + s.h - 2], [s.x + s.w * 0.3, s.y + s.h * 0.5], [s.x + s.w * 0.55, s.y + s.h * 0.75], [s.x + s.w * 0.8, s.y + s.h * 0.4], [s.x + s.w - 2, s.y + s.h * 0.6], [s.x + s.w - 2, s.y + s.h - 2]], '#3f8a4a', 0);
  disc(ctx, s.x + s.w * 0.75, s.y + s.h * 0.25, 6, '#ffd866', 0);
  box(ctx, s.x - 16, by - 10, s.w + 32, 10, '#6b4420', 1);
  // The raked seating, stepping up away from the screen, seats in red velvet facing it.
  const rows = 5;
  const from = s.x + s.w + 32;
  const rowW = Math.floor((w - from - 60) / rows);
  for (let r = 0; r < rows; r++) {
    const rx = from + r * rowW;
    const ry = by - r * 12;
    if (r > 0) box(ctx, rx, ry, rowW + 2, by - ry, '#3a3a4e', 0.5, 1.5);
    for (let x = rx + 4; x + 18 <= rx + rowW; x += 22) {
      box(ctx, x + 12, ry - 26, 6, 24, '#b0243a', 2); // seat back
      box(ctx, x + 1, ry - 12, 14, 5, '#c73a4f', 1.5); // seat
      line(ctx, [[x + 4, ry - 7], [x + 4, ry]], '#8a8aa0', 1.5);
    }
    disc(ctx, rx + 2, ry - 2, 1.2, '#ffd866', 0); // the aisle light
  }
  // The projection booth window and the exit.
  box(ctx, w - 50, 20, 30, 18, '#3a3f4a', 1.5);
  box(ctx, w - 46, 24, 12, 9, '#2a3550', 1, 1);
  disc(ctx, w - 26, 29, 3, '#fff3c4', 1.2);
  box(ctx, w - 44, by - 40, 20, 40, '#3a3f4a', 1);
  exitSign(ctx, w - 41, by - 50);
}

function drawCinemaClosed(ctx: Ctx, w: number, floors: number): void {
  const s = cinemaScreen(w, floors);
  // The house curtain drawn across the screen between shows.
  box(ctx, s.x - 2, s.y - 4, s.w + 4, s.h + 8, vgrad(ctx, s.y, s.y + s.h, '#b0243a', '#6e1424'), 1);
  for (let x = s.x + 6; x < s.x + s.w - 2; x += 8) line(ctx, [[x, s.y - 2], [x + 1, s.y + s.h + 2]], 'rgba(0,0,0,0.25)', 1.5);
  line(ctx, [[s.x + s.w / 2, s.y - 2], [s.x + s.w / 2, s.y + s.h + 2]], INK, 1.5);
}

/** The party hall runs on weekends from noon for the party's length. */
function partyOpen(minute: number): boolean {
  const c = clockOf(minute);
  const start = SCHEDULES.partyHall.weekendStart;
  return c.isWeekend && c.minuteOfDay >= start && c.minuteOfDay < start + SCHEDULES.partyHall.durationMinutes;
}

function drawPartyHall(ctx: Ctx, w: number, floors: number): void {
  const h = floors * FLOOR_PX;
  const by = h - SLAB_PX;
  // Bunting across the upper floor, balloons, a mirror ball.
  const flags = ['#e07a5f', '#f4b942', '#2f7d7d', '#b0417a', '#2f5c9e'];
  line(ctx, [[4, TY + 2], [w / 2, TY + 8], [w - 12, TY + 2]], '#333a44', 1);
  for (let x = 10, i = 0; x < w - 18; x += 16, i++) {
    const y = TY + 2 + 6 * Math.sin((x / (w - 12)) * Math.PI);
    poly(ctx, [[x - 4, y], [x + 4, y], [x, y + 8]], flags[i % flags.length] as string, 1.2);
  }
  const ballX = Math.round(w * 0.45);
  line(ctx, [[ballX, 20], [ballX, 44]], '#333a44', 1);
  disc(ctx, ballX, 51, 7, '#c4ccd6');
  for (let k = -4; k <= 4; k += 4) line(ctx, [[ballX + k, 45], [ballX + k, 57]], 'rgba(34,34,34,0.35)', 0.8);
  line(ctx, [[ballX - 7, 51], [ballX + 7, 51]], 'rgba(34,34,34,0.35)', 0.8);
  for (let i = 0; i < 4; i++) {
    const bx = 14 + i * 7;
    const byl = 44 + (i % 2) * 8;
    line(ctx, [[bx, byl + 5], [bx + 2, byl + 22]], '#5a6472', 0.8);
    ellipse(ctx, bx, byl, 5, 6, flags[(i + 2) % flags.length] as string, 1.5);
  }
  // The stage with its pleated backdrop, the DJ booth and two speakers.
  const stageX = w - 132;
  for (const [dx, dw] of [[4, 36], [84, 36]] as const) {
    box(ctx, stageX + dx, FLOOR_PX + 22, dw, by - 12 - (FLOOR_PX + 22), '#6a3a97', 1);
    for (let x = stageX + dx + 6; x < stageX + dx + dw - 2; x += 8) line(ctx, [[x, FLOOR_PX + 24], [x, by - 14]], 'rgba(0,0,0,0.22)', 1.5);
  }
  box(ctx, stageX, by - 12, 124, 12, '#6b4420', 1);
  box(ctx, stageX + 42, by - 30, 40, 18, '#2a2a2e', 1.5);
  disc(ctx, stageX + 52, by - 31, 4, '#1c1c1f', 1.2);
  disc(ctx, stageX + 72, by - 31, 4, '#1c1c1f', 1.2);
  for (const sx of [stageX + 10, stageX + 100]) {
    box(ctx, sx, by - 42, 14, 30, '#2a2a2e', 1.5);
    disc(ctx, sx + 7, by - 34, 4, '#5a6472', 1.2);
    disc(ctx, sx + 7, by - 20, 5, '#5a6472', 1.2);
  }
  // Banquet tables in white cloths with flowers, chairs either side.
  for (let x = 50; x + 56 < stageX - 20; x += 72) {
    chair(ctx, x, by, '#c9a227', true);
    poly(ctx, [[x + 12, by - 17], [x + 40, by - 17], [x + 43, by - 5], [x + 9, by - 5]], '#fbfbf8');
    line(ctx, [[x + 26, by - 5], [x + 26, by]], INK, 2);
    disc(ctx, x + 22, by - 22, 3, '#e07a5f', 1.2);
    disc(ctx, x + 29, by - 21, 2.6, '#f4b942', 1.2);
    chair(ctx, x + 42, by, '#c9a227', false);
  }
}

function drawPartyClosed(ctx: Ctx, w: number): void {
  // Blinds drawn over the lower window band while no party is on.
  blinds(ctx, w, FLOOR_PX + WIN_PANE_TOP - 1, FLOOR_PX + WIN_SILL);
}

// ---------------------------------------------------------------- services

function drawMedical(ctx: Ctx, w: number): void {
  const by = BASE;
  // Reception: a desk with a screen, the green cross on the wall over it.
  box(ctx, 42, TY + 1, 14, 14, '#ffffff', 1);
  ctx.fillStyle = '#2f9e5a';
  ctx.fillRect(47, TY + 3.5, 4, 9);
  ctx.fillRect(44.5, TY + 6, 9, 4);
  box(ctx, 8, by - 22, 58, 4, '#e4e8ee', 1);
  box(ctx, 10, by - 18, 54, 18, '#8fd4d0', 1);
  monitor(ctx, 48, by - 33, 12, 9, '#8fd4ff');
  // The waiting room: a row of chairs, a low table of magazines, a water cooler.
  for (let x = 80; x < 150; x += 17) {
    box(ctx, x, by - 20, 13, 10, '#2f7d7d', 2);
    box(ctx, x, by - 12, 13, 4, '#3f8f86', 1.5);
    line(ctx, [[x + 2, by - 8], [x + 2, by]], INK, 1.5);
    line(ctx, [[x + 11, by - 8], [x + 11, by]], INK, 1.5);
  }
  box(ctx, 152, by - 12, 18, 3, '#c98a45', 1);
  box(ctx, 155, by - 15, 6, 3, '#e07a5f', 0.5, 1);
  line(ctx, [[161, by - 9], [161, by]], INK, 1.5);
  box(ctx, 176, by - 26, 10, 26, '#e4e8ee', 1);
  box(ctx, 177, by - 36, 8, 10, 'rgba(143,212,255,0.8)', 3, 1.5);
  // The examination bays: a padded bed, a curtain on its rail, a drip stand, a cabinet.
  const bays = Math.max(1, Math.min(2, Math.floor((w - 200) / 104)));
  for (let b = 0; b < bays; b++) {
    const x = 200 + b * 104;
    line(ctx, [[x - 4, TY + 1], [x + 94, TY + 1]], '#5a6472', 1.5);
    for (let k = 0; k < 3; k++) box(ctx, x - 4 + k * 8, TY + 2, 8, by - TY - 6, 'rgba(159,211,245,0.85)', 1, 1.2);
    box(ctx, x + 28, by - 16, 46, 5, '#f7f5ee', 2);
    box(ctx, x + 30, by - 20, 12, 5, '#ffffff', 2.5, 1.5);
    line(ctx, [[x + 32, by - 11], [x + 32, by]], INK, 2);
    line(ctx, [[x + 70, by - 11], [x + 70, by]], INK, 2);
    line(ctx, [[x + 84, by], [x + 84, TY + 6]], '#5a6472', 1.5);
    box(ctx, x + 80, TY + 6, 8, 10, 'rgba(255,255,255,0.9)', 2, 1.2);
    box(ctx, x + 50, TY + 3, 18, 12, '#f7f5ee', 1);
    ctx.fillStyle = '#d23c2b';
    ctx.fillRect(x + 57.5, TY + 5, 3, 8);
    ctx.fillRect(x + 55, TY + 7.5, 8, 3);
  }
}

function drawSecurity(ctx: Ctx, w: number): void {
  const by = BASE;
  // The camera wall: six monitors over a long desk, a keyboard and a mug.
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const x = 36 + c * 26;
      const y = TY - 1 + r * 12;
      box(ctx, x, y, 24, 11, '#1f2733', 1);
      ctx.fillStyle = (r + c) % 2 ? '#5f9e8a' : '#4f7fa8';
      ctx.fillRect(x + 2, y + 2, 20, 7);
      line(ctx, [[x + 4, y + 7], [x + 10, y + 5], [x + 18, y + 7]], 'rgba(255,255,255,0.45)', 0.8);
    }
  }
  box(ctx, 8, by - 20, 108, 4, '#5a6472', 1);
  box(ctx, 10, by - 16, 20, 16, '#3a3f4a', 1);
  box(ctx, 94, by - 16, 20, 16, '#3a3f4a', 1);
  box(ctx, 60, by - 23, 18, 3, '#2a2a2e', 1, 1.2);
  box(ctx, 84, by - 26, 5, 6, '#f7f5ee', 1, 1.2);
  // Lockers, a key cabinet, a charging rack of radios, a coffee machine.
  for (let i = 0; i < 4; i++) {
    const x = 122 + i * 12;
    box(ctx, x, by - 46, 12, 46, '#6f7f95', 1);
    for (let k = 0; k < 3; k++) line(ctx, [[x + 3, by - 40 + k * 2], [x + 9, by - 40 + k * 2]], INK, 0.8);
    disc(ctx, x + 9, by - 24, 0.9, '#e4e8ee', 0);
  }
  if (w > 200) {
    box(ctx, 178, TY + 1, 20, 18, '#8a5a2b', 1);
    for (let k = 0; k < 6; k++) disc(ctx, 182 + (k % 3) * 6, TY + 6 + Math.floor(k / 3) * 7, 1, '#c9a227', 0.8);
    box(ctx, 202, by - 22, w - 222, 4, '#c4ccd6', 1);
    box(ctx, 204, by - 18, w - 226, 18, '#5a6472', 1);
    for (let k = 0; k < 2; k++) {
      box(ctx, 206 + k * 7, by - 31, 5, 9, '#2a2a2e', 1, 1.2);
      disc(ctx, 208.5 + k * 7, by - 28, 0.9, '#5fd38a', 0);
    }
    box(ctx, w - 36, by - 36, 14, 14, '#2a2a2e', 1.5);
    box(ctx, w - 33, by - 28, 6, 5, '#f7f5ee', 1, 1);
  }
}

function drawHousekeeping(ctx: Ctx, w: number): void {
  const by = BASE;
  // Linen shelves stacked with folded towels and sheets.
  box(ctx, 6, TY + 1, 58, by - TY - 1, '#c98a45', 1);
  const cloth = ['#f7f5ee', '#3f8f86', '#e4e8ee', '#8fd4d0'];
  for (let r = 0; r < 3; r++) {
    const y = TY + 4 + r * 13;
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(8, y, 54, 10);
    for (let k = 0; k < 4; k++) box(ctx, 10 + k * 13, y + 2 + (k % 2), 11, 8 - (k % 2), cloth[(k + r) % cloth.length] as string, 1, 1.2);
    line(ctx, [[8, y + 10], [62, y + 10]], INK, 1.5);
  }
  // A washer under a dryer, round doors.
  for (let k = 0; k < 2; k++) {
    const y = by - 44 + k * 22;
    box(ctx, 72, y, 22, 22, '#e4e8ee', 1);
    disc(ctx, 83, y + 12, 6, 'rgba(143,212,255,0.8)', 1.5);
  }
  // The laundry cart, a canvas bag of sheets on wheels.
  box(ctx, 104, by - 26, 38, 20, '#dccfb8', 2.5);
  box(ctx, 108, by - 30, 12, 6, '#f7f5ee', 2, 1.2);
  box(ctx, 120, by - 29, 12, 5, '#3f8f86', 2, 1.2);
  for (const x of [108, 138]) disc(ctx, x, by - 3, 3, '#2a2a2e', 1.2);
  // An ironing board, and a cleaning cart with bottles and a mop.
  if (w > 190) {
    poly(ctx, [[152, by - 22], [184, by - 22], [188, by - 19], [152, by - 19]], '#e07a5f', 1.5);
    line(ctx, [[158, by - 19], [176, by]], INK, 1.5);
    line(ctx, [[176, by - 19], [158, by]], INK, 1.5);
    const cx = Math.min(w - 36, 196);
    box(ctx, cx, by - 30, 24, 3, '#5a6472', 1);
    box(ctx, cx, by - 16, 24, 3, '#5a6472', 1);
    line(ctx, [[cx + 1, by - 30], [cx + 1, by - 4]], INK, 1.5);
    line(ctx, [[cx + 23, by - 30], [cx + 23, by - 4]], INK, 1.5);
    for (let k = 0; k < 3; k++) box(ctx, cx + 3 + k * 7, by - 38, 5, 8, ['#2f5c9e', '#f4b942', '#3f8a4a'][k] as string, 1.5, 1.2);
    box(ctx, cx + 4, by - 13, 16, 9, '#2f7d7d', 1.5, 1.2);
    for (const x of [cx + 3, cx + 21]) disc(ctx, x, by - 2.5, 2.5, '#2a2a2e', 1);
    line(ctx, [[cx + 28, by - 2], [cx + 32, by - 44]], '#c98a45', 2);
    box(ctx, cx + 24, by - 5, 10, 5, '#e4e8ee', 1.5, 1.2);
  }
}

// ---------------------------------------------------------------- underground

const CAR_COLOURS = [0xc03028, 0x2f5c9e, 0xe4e8ee, 0x3f8a4a] as const;

function drawParkingRamp(ctx: Ctx, w: number): void {
  const by = BASE;
  // Strip lights along the ceiling.
  for (let x = 16; x + 24 < w; x += 56) box(ctx, x, OPEN_TOP + 1, 24, 3, '#fff3c4', 1, 1.2);
  // The ramp deck climbing to the right, chevrons painted on it, a rail along its edge.
  const rx0 = 6;
  const rx1 = w - 44;
  const ry1 = by - 34;
  poly(ctx, [[rx0, by], [rx1, ry1], [rx1, ry1 + 6], [rx0 + 12, by]], '#b9bec6');
  for (let t = 0.15; t < 0.9; t += 0.18) {
    const x = rx0 + (rx1 - rx0) * t;
    const y = by + (ry1 - by) * t;
    line(ctx, [[x - 3, y + 1], [x + 1, y - 1.5], [x - 3, y - 4]], '#f4b942', 1.5);
  }
  line(ctx, [[rx0 + 2, by - 14], [rx1, ry1 - 14]], '#5a6472', 1.5);
  for (let t = 0.1; t < 1; t += 0.3) {
    const x = rx0 + (rx1 - rx0) * t;
    line(ctx, [[x, by + (ry1 - by) * t - 14], [x, by + (ry1 - by) * t]], '#5a6472', 1.2);
  }
  // A car on its way up.
  ctx.save();
  const cx = rx0 + (rx1 - rx0) * 0.45;
  const cy = by + (ry1 - by) * 0.45;
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(ry1 - by, rx1 - rx0));
  car(ctx, -24, 0, 48, CAR_COLOURS[0]);
  ctx.restore();
  // The P sign and the barrier arm at the top.
  box(ctx, w - 30, OPEN_TOP + 8, 16, 16, '#2f5c9e', 1.5);
  ctx.font = '700 12px "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('P', w - 22, OPEN_TOP + 16.5);
  box(ctx, w - 38, ry1 - 16, 6, 16, '#5a6472', 1);
  for (let k = 0; k < 4; k++) box(ctx, w - 38 - 30 + k * 7.5, ry1 - 14, 7.5, 3, k % 2 ? '#ffffff' : '#d23c2b', 0, 1);
  line(ctx, [[w - 68, ry1 - 14], [w - 38, ry1 - 14]], INK, 0.8);
}

function drawParkingSpace(ctx: Ctx, w: number, _floors: number, variant: number): void {
  const by = BASE;
  box(ctx, 4, OPEN_TOP + 4, 12, 7, '#e4e8ee', 1, 1.2); // the bay number plate
  line(ctx, [[7, OPEN_TOP + 7.5], [13, OPEN_TOP + 7.5]], INK, 1);
  box(ctx, w - 14, by - 4, 8, 4, '#f4b942', 1, 1.2); // the wheel stop
  car(ctx, 4, by, w - 10, CAR_COLOURS[variant % CAR_COLOURS.length] as number);
}

/** The collectors' shift: the loading bay door is up while they work. */
function recyclingOpen(minute: number): boolean {
  const m = clockOf(minute).minuteOfDay;
  return m >= WASTE.shiftStart && m < WASTE.shiftEnd;
}

function loadingBay(w: number, floors: number): Rect {
  const by = floors * FLOOR_PX - SLAB_PX;
  const top = Math.max(OPEN_TOP + 20, by - 70);
  return { x: w - 112, y: top, w: 96, h: by - top };
}

function hazard(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.save();
  rrPath(ctx, x, y, w, h, 0.5);
  ctx.clip();
  ctx.fillStyle = '#f4b942';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#222222';
  for (let k = -h; k < w + h; k += 6) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + h);
    ctx.lineTo(x + k + 3, y + h);
    ctx.lineTo(x + k + 3 + h, y);
    ctx.lineTo(x + k + h, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  rrPath(ctx, x, y, w, h, 0.5);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawRecycling(ctx: Ctx, w: number, floors: number): void {
  const by = floors * FLOOR_PX - SLAB_PX;
  for (let x = 20; x + 24 < w; x += 64) box(ctx, x, OPEN_TOP + 1, 24, 3, '#fff3c4', 1, 1.2);
  // The recycling mark on the wall: three chasing arrows.
  const mx = 40;
  const my = 36;
  for (let k = 0; k < 3; k++) {
    const a0 = (k * 2 * Math.PI) / 3 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(mx, my, 13, a0 + 0.25, a0 + 1.75);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = '#3f8a4a';
    ctx.lineWidth = 3.5;
    ctx.stroke();
    const tip = a0 + 1.95;
    const tx = mx + 13 * Math.cos(tip);
    const ty = my + 13 * Math.sin(tip);
    disc(ctx, tx, ty, 3, '#3f8a4a', 1.2);
  }
  // The sorting line: a conveyor climbing to the baler's hopper, cans and boxes riding it.
  const baler = { x: Math.min(w - 190, 190), top: by - 78 };
  const c0: [number, number] = [70, by - 22];
  const c1: [number, number] = [baler.x + 6, baler.top + 4];
  poly(ctx, [[c0[0], c0[1]], [c1[0], c1[1]], [c1[0], c1[1] + 6], [c0[0], c0[1] + 6]], '#5a6472', 1.5);
  for (let t = 0.1; t < 0.95; t += 0.14) {
    const x = c0[0] + (c1[0] - c0[0]) * t;
    const y = c0[1] + (c1[1] - c0[1]) * t;
    const colour = ['#2f5c9e', '#c9a227', '#3f8a4a', '#c03028'][Math.round(t * 10) % 4] as string;
    box(ctx, x - 3, y - 6, 6, 6, colour, 1, 1.2);
  }
  for (const t of [0.15, 0.5, 0.85]) {
    const x = c0[0] + (c1[0] - c0[0]) * t;
    line(ctx, [[x, c0[1] + (c1[1] - c0[1]) * t + 6], [x, by]], INK, 2);
  }
  // The baler, bales stacked beside it.
  box(ctx, baler.x, baler.top, 54, by - baler.top, '#6f7f95', 1);
  poly(ctx, [[baler.x + 2, baler.top], [baler.x + 18, baler.top - 10], [baler.x + 38, baler.top - 10], [baler.x + 52, baler.top]], '#8a939e');
  box(ctx, baler.x + 8, baler.top + 14, 38, 30, '#3a3f4a', 1);
  disc(ctx, baler.x + 44, baler.top + 54, 3, '#d23c2b', 1.2);
  hazard(ctx, baler.x + 2, by - 8, 50, 6);
  for (let k = 0; k < 3; k++) {
    const bx = baler.x + 62 + (k % 2) * 12;
    const byk = by - 16 - Math.floor(k / 2) * 16;
    box(ctx, bx, byk, 20, 16, '#b9a27a', 1, 1.5);
    line(ctx, [[bx + 6, byk + 1], [bx + 6, byk + 15]], '#6b4420', 1);
    line(ctx, [[bx + 14, byk + 1], [bx + 14, byk + 15]], '#6b4420', 1);
  }
  // The sorted bins along the front.
  const bins = ['#3f8a4a', '#2f5c9e', '#d2b21f', '#8a939e'];
  for (let i = 0; i < 4; i++) {
    const x = 14 + i * 22;
    if (x + 18 > baler.x - 4) break;
    box(ctx, x, by - 22, 18, 22, bins[i] as string, 1.5);
    box(ctx, x - 1, by - 25, 20, 4, css(scaleColour(parseInt((bins[i] as string).slice(1), 16), 0.75)), 1, 1.5);
  }
  // The loading bay: a hazard striped frame, dock bumpers, the collection truck backed up to it.
  const bay = loadingBay(w, floors);
  box(ctx, bay.x, bay.y, bay.w, bay.h, '#3a3f4a', 0.5);
  box(ctx, bay.x + 6, bay.y + 18, bay.w - 12, bay.h - 22, '#2f7d3a', 2);
  box(ctx, bay.x + 12, bay.y + 26, bay.w - 24, bay.h - 34, '#256630', 1, 1.5);
  line(ctx, [[bay.x + bay.w / 2, bay.y + 26], [bay.x + bay.w / 2, by - 8]], INK, 1.5);
  hazard(ctx, bay.x - 6, bay.y, 6, bay.h);
  hazard(ctx, bay.x + bay.w, bay.y, 6, bay.h);
  box(ctx, bay.x - 4, bay.y - 8, bay.w + 8, 8, '#5a6472', 1);
  for (const x of [bay.x + 4, bay.x + bay.w - 12]) box(ctx, x, by - 14, 8, 10, '#1c1c1f', 1.5, 1.5);
}

function drawRecyclingClosed(ctx: Ctx, w: number, floors: number): void {
  const bay = loadingBay(w, floors);
  shutter(ctx, bay.x, bay.y, bay.w, bay.y + bay.h);
}

/** The metro runs from 05:30 to midnight; the gates close overnight. Our call: no rule for it. */
const METRO_OPEN = { from: 5 * 60 + 30, to: 24 * 60 };
function metroOpen(minute: number): boolean {
  const m = clockOf(minute).minuteOfDay;
  return m >= METRO_OPEN.from && m < METRO_OPEN.to;
}

function metroGate(floors: number): Rect {
  const h = floors * FLOOR_PX;
  return { x: 4, y: 12, w: 48, h: Math.min(70, h - 40) };
}

function drawMetro(ctx: Ctx, w: number, floors: number): void {
  const h = floors * FLOOR_PX;
  const by = h - SLAB_PX;
  // Tiled walls, strip lights, the station roundel.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let y = 16; y < by - 60; y += 8) {
    ctx.beginPath();
    ctx.moveTo(4, y);
    ctx.lineTo(w - 12, y);
    ctx.stroke();
  }
  for (let x = 24; x + 30 < w; x += 72) box(ctx, x, OPEN_TOP + 1, 30, 3, '#fff3c4', 1, 1.2);
  const rx = Math.round(w * 0.55);
  const ry = 44;
  ctx.beginPath();
  ctx.arc(rx, ry, 16, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 9;
  ctx.stroke();
  ctx.strokeStyle = '#c03028';
  ctx.lineWidth = 6;
  ctx.stroke();
  box(ctx, rx - 26, ry - 5, 52, 10, '#1f3a5f', 1, 1.5);
  ctx.font = '700 7px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Tower Square', rx, ry + 0.5);
  // The stairs down from the street entrance to the platform, with a rail.
  const platformTop = by - 12;
  const st0: [number, number] = [8, 78];
  const st1: [number, number] = [118, platformTop];
  const steps = 14;
  const pts: [number, number][] = [[st0[0], st0[1]]];
  for (let i = 0; i < steps; i++) {
    const x = st0[0] + ((st1[0] - st0[0]) * (i + 1)) / steps;
    const y = st0[1] + ((st1[1] - st0[1]) * (i + 1)) / steps;
    pts.push([x - (st1[0] - st0[0]) / steps, y]);
    pts.push([x, y]);
  }
  pts.push([st1[0], st1[1] + 8]);
  pts.push([st0[0], st0[1] + 10]);
  poly(ctx, pts, '#b9bec6', 1.5);
  box(ctx, 2, st0[1] - 2, st0[0] + 2, 6, '#b9bec6', 0.5, 1.5);
  line(ctx, [[st0[0] + 4, st0[1] - 16], [st1[0], st1[1] - 16]], '#5a6472', 2);
  // The platform, its yellow edge, the ticket gates at the foot of the stairs.
  box(ctx, 0, platformTop, w - 8, 12, '#d8dbe0', 0.5);
  ctx.fillStyle = '#f4b942';
  ctx.fillRect(122, platformTop, w - 132, 2.5);
  for (let k = 0; k < 2; k++) {
    const gx = 124 + k * 18;
    box(ctx, gx, platformTop - 20, 6, 20, '#5a6472', 1.5);
    disc(ctx, gx + 3, platformTop - 16, 1.5, k ? '#5fd38a' : '#ff5c4d', 0.8);
  }
  // The departures board, hung from the ceiling of the middle level.
  const db = { x: 180, y: FLOOR_PX + 8, w: 110, h: 18 };
  line(ctx, [[db.x + 10, OPEN_TOP + 4], [db.x + 10, db.y]], '#333a44', 1);
  line(ctx, [[db.x + db.w - 10, OPEN_TOP + 4], [db.x + db.w - 10, db.y]], '#333a44', 1);
  box(ctx, db.x, db.y, db.w, db.h, '#1c1f26', 1.5);
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < 7; k++) box(ctx, db.x + 6 + k * 14, db.y + 4 + r * 6, 10, 3, '#ffb347', 0, 0);
  }
  // The train at the platform: a long silver car with a stripe, windows and doors.
  const tx = 166;
  const tw = w - tx - 18;
  const ty = platformTop - 52;
  box(ctx, tx, ty, tw, 50, vgrad(ctx, ty, ty + 50, '#eef0f3', '#b3bac4'), 8);
  ctx.fillStyle = '#c03028';
  ctx.fillRect(tx + 2, ty + 34, tw - 4, 5);
  for (let x = tx + 10; x + 22 < tx + tw - 6; x += 34) {
    if (((x - tx) / 34) % 3 === 1) {
      box(ctx, x, ty + 8, 22, 40, '#8a939e', 1, 1.5);
      line(ctx, [[x + 11, ty + 9], [x + 11, ty + 47]], INK, 1);
      box(ctx, x + 3, ty + 12, 7, 14, '#9fc6e0', 1, 1);
      box(ctx, x + 12, ty + 12, 7, 14, '#9fc6e0', 1, 1);
    } else {
      box(ctx, x, ty + 10, 24, 16, '#9fc6e0', 3, 1.5);
      line(ctx, [[x + 3, ty + 13], [x + 9, ty + 13]], 'rgba(255,255,255,0.8)', 1);
    }
  }
  for (const x of [tx + 30, tx + tw - 30]) {
    disc(ctx, x - 8, platformTop + 1, 4, '#1c1c1f', 1.5);
    disc(ctx, x + 8, platformTop + 1, 4, '#1c1c1f', 1.5);
  }
}

function drawMetroClosed(ctx: Ctx, _w: number, floors: number): void {
  const g = metroGate(floors);
  // A steel grille pulled across the entrance to the stairs.
  box(ctx, g.x, g.y, g.w, g.h, 'rgba(90,100,114,0.25)', 1, 2);
  for (let x = g.x + 5; x < g.x + g.w - 2; x += 6) line(ctx, [[x, g.y + 2], [x, g.y + g.h - 2]], '#5a6472', 1.5);
  for (let y = g.y + 10; y < g.y + g.h - 4; y += 16) line(ctx, [[g.x + 2, y], [g.x + g.w - 2, y]], '#5a6472', 1.5);
  box(ctx, g.x + g.w / 2 - 5, g.y + g.h / 2 - 4, 10, 8, '#c9a227', 1, 1.5);
}

function lancet(ctx: Ctx, x: number, top: number, w: number, bottom: number, glass: readonly string[]): void {
  const path = (): void => {
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, top + w * 0.7);
    ctx.quadraticCurveTo(x, top + w * 0.1, x + w / 2, top);
    ctx.quadraticCurveTo(x + w, top + w * 0.1, x + w, top + w * 0.7);
    ctx.lineTo(x + w, bottom);
    ctx.closePath();
  };
  ctx.save();
  path();
  ctx.clip();
  const bands = glass.length;
  const hh = (bottom - top) / bands;
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = glass[i] as string;
    ctx.fillRect(x, top + i * hh, w, hh + 0.5);
  }
  ctx.strokeStyle = 'rgba(34,34,34,0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i < bands; i++) {
    ctx.beginPath();
    ctx.moveTo(x, top + i * hh);
    ctx.lineTo(x + w, top + i * hh);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x + w / 2, top);
  ctx.lineTo(x + w / 2, bottom);
  ctx.stroke();
  ctx.restore();
  path();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawCathedral(ctx: Ctx, w: number, floors: number): void {
  const h = floors * FLOOR_PX;
  const by = h - SLAB_PX;
  // Ribs of the vault along the ceiling.
  ctx.strokeStyle = 'rgba(120,100,70,0.45)';
  ctx.lineWidth = 2;
  for (let x = 0; x < w; x += 112) {
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.quadraticCurveTo(x + 56, -8, x + 112, 40);
    ctx.stroke();
  }
  // The organ's pipes at the west end.
  for (let k = 0; k < 7; k++) {
    const ph = 34 + 8 * (3 - Math.abs(3 - k));
    box(ctx, 10 + k * 7, 70 - ph, 6, ph, vgrad(ctx, 70 - ph, 70, '#e4e8ee', '#9aa3ae'), 2.5, 1.5);
  }
  box(ctx, 6, 70, 54, 12, '#6b4420', 1);
  // Tall stained glass lancets along the nave.
  const glassSets = [
    ['#2f5c9e', '#c03028', '#f4b942', '#2f5c9e', '#3f8a4a', '#6a3a97'],
    ['#6a3a97', '#2f5c9e', '#e07a5f', '#f4b942', '#2f5c9e', '#c03028'],
  ];
  const altarW = 150;
  for (let i = 0, x = 80; x + 34 < w - altarW - 10; i++, x += 62) lancet(ctx, x, 60, 30, by - 70, glassSets[i % 2] as string[]);
  // The rose window over the altar.
  const cx = w - altarW / 2 - 16;
  const cy = 70;
  const r = 34;
  disc(ctx, cx, cy, r + 3, '#c9b89a');
  const petals = ['#2f5c9e', '#c03028', '#f4b942', '#3f8a4a'];
  for (let k = 0; k < 12; k++) {
    const a0 = (k * Math.PI * 2) / 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a0 + (Math.PI * 2) / 12);
    ctx.closePath();
    ctx.fillStyle = petals[k % petals.length] as string;
    ctx.fill();
    ctx.strokeStyle = 'rgba(34,34,34,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  disc(ctx, cx, cy, 9, '#f4b942', 1.5);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Two chandeliers of candles.
  for (const lx of [Math.round(w * 0.25), Math.round(w * 0.5)]) {
    line(ctx, [[lx, 0], [lx, 104]], '#333a44', 1);
    ellipse(ctx, lx, 108, 14, 3, '#c9a227', 1.5);
    for (let k = -2; k <= 2; k++) {
      box(ctx, lx + k * 6 - 1, 100, 2, 6, '#f7f5ee', 0.5, 1);
      disc(ctx, lx + k * 6, 98, 1.3, '#ffd866', 0);
    }
  }
  // The altar on its steps, a cloth, two candles, a small cross on the wall behind it.
  const ax = w - altarW - 4;
  for (let s = 0; s < 3; s++) box(ctx, ax + s * 10, by - 6 * (s + 1), altarW - 20 - s * 20, 6, '#d8cdb8', 0.5, 1.5);
  const tx = ax + altarW / 2 - 40;
  box(ctx, tx, by - 40, 60, 22, '#f7f5ee', 1);
  ctx.fillStyle = '#8c1f3d';
  ctx.fillRect(tx + 24, by - 38, 12, 18);
  for (const x of [tx + 8, tx + 50]) {
    box(ctx, x, by - 52, 3, 12, '#f7f5ee', 0.5, 1);
    disc(ctx, x + 1.5, by - 54, 1.6, '#ffd866', 0.8);
  }
  box(ctx, tx + 28, by - 82, 4, 22, '#c9a227', 0.5, 1.2);
  box(ctx, tx + 22, by - 76, 16, 4, '#c9a227', 0.5, 1.2);
  // The aisle runner and the pews, facing the altar.
  ctx.fillStyle = '#8c1f3d';
  ctx.fillRect(10, by - 2, ax - 10, 2);
  for (let x = 16; x + 30 < ax - 8; x += 34) {
    box(ctx, x, by - 28, 5, 28, '#6b4420', 1);
    box(ctx, x + 5, by - 14, 22, 4, '#8a5a2b', 1);
    line(ctx, [[x + 24, by - 10], [x + 24, by]], INK, 2);
  }
}

// ---------------------------------------------------------------- lobbies and connectors

/** Lobby tiles run in a six tile rhythm: a column, a sconce, a palm, a bench in two halves, a rest. */
export const LOBBY_RHYTHM = 6;
/** Sky lobby tiles run in a four tile rhythm. */
export const SKY_LOBBY_RHYTHM = 4;

function drawLobby(ctx: Ctx, w: number, _floors: number, variant: number): void {
  const by = BASE;
  const v = ((variant % LOBBY_RHYTHM) + LOBBY_RHYTHM) % LOBBY_RHYTHM;
  // A brass skirting along the marble at every tile.
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(0, by - 2, w, 1.5);
  if (v === 0) {
    box(ctx, 4, TY - 3, 8, by - TY + 1, vgrad(ctx, TY, by, '#fbfaf6', '#d8d4ca'), 0.5, 1.5);
    box(ctx, 2, TY - 3, 12, 4, '#e8e2d4', 0.5, 1.5);
    box(ctx, 2, by - 5, 12, 5, '#e8e2d4', 0.5, 1.5);
    line(ctx, [[6, TY + 6], [9, TY + 18], [7, TY + 30]], 'rgba(120,120,130,0.4)', 0.8);
    return;
  }
  if (v === 1) {
    disc(ctx, 8, TY + 6, 3.5, '#ffe7a8', 1.5);
    box(ctx, 6.5, TY + 9, 3, 4, '#c9a227', 0.5, 1);
    return;
  }
  if (v === 2) {
    // A potted palm.
    for (const [dx, a] of [[-5, -0.7], [5, 0.7], [0, 0], [-3, -0.3], [3, 0.3]] as const) {
      ctx.beginPath();
      ctx.ellipse(8 + dx, by - 30, 2.4, 8, a, 0, Math.PI * 2);
      ctx.fillStyle = '#2f7d3a';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    line(ctx, [[8, by - 12], [8, by - 26]], '#6b4420', 2);
    poly(ctx, [[3, by - 12], [13, by - 12], [11.5, by], [4.5, by]], '#3a3f4a', 1.5);
    return;
  }
  if (v === 3 || v === 4) {
    // A long leather bench across two tiles.
    const left = v === 3;
    box(ctx, left ? 3 : -2, by - 12, left ? 15 : 13, 5, '#6b4420', left ? 1.5 : 0.5, 1.5);
    line(ctx, [[left ? 6 : 10, by - 7], [left ? 6 : 10, by]], INK, 2);
    return;
  }
  // The sixth tile is plain marble: the rhythm needs a rest.
}

function drawSkyLobby(ctx: Ctx, w: number, floors: number, variant: number): void {
  const h = floors * FLOOR_PX;
  const by = h - SLAB_PX;
  const v = ((variant % SKY_LOBBY_RHYTHM) + SKY_LOBBY_RHYTHM) % SKY_LOBBY_RHYTHM;
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(0, by - 2, w, 1.5);
  if (v === 0) {
    box(ctx, 4, TY - 3, 8, by - TY + 1, vgrad(ctx, 0, by, '#fbfaf6', '#d8d4ca'), 0.5, 1.5);
    box(ctx, 2, TY - 3, 12, 4, '#e8e2d4', 0.5, 1.5);
    box(ctx, 2, by - 5, 12, 5, '#e8e2d4', 0.5, 1.5);
    return;
  }
  if (v === 1) {
    // A tall fig reaching up the atrium.
    line(ctx, [[8, by - 12], [8, by - 70]], '#6b4420', 2);
    for (let k = 0; k < 5; k++) ellipse(ctx, 8 + (k % 2 ? 3 : -3), by - 40 - k * 9, 4, 5, k % 2 ? '#2f7d3a' : '#3f8a4a', 1.5);
    poly(ctx, [[2, by - 14], [14, by - 14], [12, by], [4, by]], '#a4522c', 1.5);
    return;
  }
  if (v === 2) {
    // A banner hung down the atrium, and a bench at its foot.
    line(ctx, [[8, TY - 3], [8, TY + 4]], '#333a44', 1);
    poly(ctx, [[3, TY + 4], [13, TY + 4], [13, TY + 70], [8, TY + 64], [3, TY + 70]], '#1f3a5f', 1.5);
    disc(ctx, 8, TY + 20, 3, '#f4b942', 1);
    box(ctx, 1, by - 12, 14, 5, '#6b4420', 1.5, 1.5);
    line(ctx, [[3, by - 7], [3, by]], INK, 2);
    line(ctx, [[13, by - 7], [13, by]], INK, 2);
    return;
  }
  // A pendant lamp dropped down the atrium's height.
  line(ctx, [[8, TY - 3], [8, h * 0.45]], '#333a44', 1);
  poly(ctx, [[3, h * 0.45 + 8], [6, h * 0.45], [10, h * 0.45], [13, h * 0.45 + 8]], '#f7f1d8', 1.5);
}

function drawStairs(ctx: Ctx, w: number, floors: number): void {
  const h = floors * FLOOR_PX;
  const y0 = h - SLAB_PX; // the bottom floor's walking line
  const y1 = BASE; // the top floor's walking line
  const x0 = 18;
  const x1 = w - 18;
  const steps = Math.max(6, Math.round((y0 - y1) / 6));
  const run = (x1 - x0) / steps;
  const rise = (y0 - y1) / steps;
  // The flight as one sawtooth shape over a stringer, treads in concrete.
  const pts: [number, number][] = [[x0, y0]];
  for (let i = 0; i < steps; i++) {
    pts.push([x0 + i * run, y0 - (i + 1) * rise]);
    pts.push([x0 + (i + 1) * run, y0 - (i + 1) * rise]);
  }
  pts.push([x1, y1 + 8]);
  pts.push([x0 + 8, y0]);
  poly(ctx, pts, '#c4c9d1', 2);
  line(ctx, [[x0 + 8, y0], [x1, y1 + 8]], 'rgba(34,34,34,0.35)', 1);
  // Landings at the foot and the head.
  box(ctx, 2, y0 - 3, x0, 3, '#c4c9d1', 0.5, 1.5);
  box(ctx, x1, y1 - 3, w - x1 - 2, 3, '#c4c9d1', 0.5, 1.5);
  // The handrail on posts.
  const rail = 26;
  line(ctx, [[x0 - 6, y0 - rail], [x0, y0 - rail], [x1, y1 - rail], [x1 + 6, y1 - rail]], '#5a6472', 2.5);
  for (let i = 0; i <= steps; i += 3) {
    const x = x0 + i * run;
    const y = y0 - i * rise;
    line(ctx, [[x + run / 2, y - rise], [x + run / 2, y - rise - rail + 2]], '#5a6472', 1.5);
  }
}

function drawEscalator(ctx: Ctx, w: number, floors: number): void {
  const h = floors * FLOOR_PX;
  const y0 = h - SLAB_PX;
  const y1 = BASE;
  const x0 = 20;
  const x1 = w - 20;
  // The truss: a steel side panel running the diagonal, flat at both ends.
  const t = 12;
  poly(ctx, [[x0 - 16, y0], [x0, y0], [x1, y1], [x1 + 16, y1], [x1 + 16, y1 + t], [x1 + 4, y1 + t], [x0 + 4, y0 + 1], [x0 - 16, y0 + 1]], '#9aa3ae', 2);
  // Step teeth along the top edge.
  const n = 16;
  for (let i = 1; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    line(ctx, [[x, y], [x + 3, y], [x + 3, y - 2.5]], '#5a6472', 1);
  }
  // The glass balustrade and its black handrail.
  const g = 20;
  poly(ctx, [[x0 - 10, y0 - 2], [x0, y0 - 2], [x1, y1 - 2], [x1 + 10, y1 - 2], [x1 + 10, y1 - g], [x1, y1 - g], [x0, y0 - g], [x0 - 10, y0 - g]], 'rgba(159,211,245,0.45)', 1.5);
  line(ctx, [[x0 - 12, y0 - g], [x0, y0 - g], [x1, y1 - g], [x1 + 12, y1 - g]], '#1c1c1f', 3);
  disc(ctx, x0 - 12, y0 - g + 4, 4, 'rgba(0,0,0,0)', 2.5);
  disc(ctx, x1 + 12, y1 - g + 4, 4, 'rgba(0,0,0,0)', 2.5);
  // Comb plates at the landings.
  box(ctx, x0 - 18, y0 - 2, 16, 3, '#c9a227', 0.5, 1.2);
  box(ctx, x1 + 2, y1 - 2, 16, 3, '#c9a227', 0.5, 1.2);
}

// ---------------------------------------------------------------- the registry

/** Housekeepers stop taking rooms at 20:00 (src/sim/people.ts); their office closes then. */
const HOUSEKEEPING_END = 20 * 60;
function housekeepingOpen(minute: number): boolean {
  const m = clockOf(minute).minuteOfDay;
  return m >= SCHEDULES.housekeeping.start && m < HOUSEKEEPING_END;
}

function venueSpec(kind: 'office' | 'shop' | 'restaurant'): InteriorSpec {
  const behind = kind === 'shop' ? (w: number) => w - 6 - SHOP_COUNTER_W / 2 : (w: number) => w - 6 - RESTAURANT_PASS_W / 2 - 12;
  const band = closedBand(kind);
  const spec: InteriorSpec = {
    variants: TREATMENTS,
    band: () => VENUE_BAND,
    draw: (ctx, w, _floors, variant) => drawVenueFixtures(ctx, kind, (variant % TREATMENTS) as Treatment, w),
    open: (minute) => venueOpen(kind, minute),
    closed: { rect: (w) => ({ x: 0, y: band.top, w, h: band.height }), draw: (ctx, w) => drawClosed(ctx, kind, w) },
    pools: true,
  };
  // An office has no counter: nobody stands at a post there.
  if (kind !== 'office') spec.post = { kind: 'diner', x: behind, when: 'occupied' };
  return spec;
}

const PER_FLOOR = (): Band => VENUE_BAND;
/**
 * How many of the two drawn variants of a hotel room are baked: one, a cut for the texture budget
 * (package 8b). Condos keep both (a mirrored plan in a second palette): they bake at the
 * structural resolution (INTERIOR_2X_MAX_PX), so the second costs a quarter of a hotel's.
 */
export const HOTEL_VARIANTS = 1;
export const CONDO_VARIANTS = 2;

/**
 * The widest illustrated interior baked at twice the structural resolution. Wider rooms (condos,
 * fast food, the services, the halls, the underground and the cathedral) bake at the structural
 * resolution, still anti-aliased and sampled linear, as the connectors and every non venue
 * closed-hours overlay do: the texture budget (package 8b, docs/VISUAL.md).
 */
export const INTERIOR_2X_MAX_PX = 12 * TILE_PX;

/** Whether a kind's interior at `widthTiles` bakes at the structural resolution. */
export function bakesAtStructuralScale(kind: RoomKind, widthTiles: number): boolean {
  if (isVenueKind(kind)) return false;
  return !!INTERIORS[kind].structuralScale || widthTiles * TILE_PX > INTERIOR_2X_MAX_PX;
}
/** Fast food rolls its shutter down over the counter and the kitchen, not the seating. */
const fastFoodShutterRect = (w: number): Rect => ({ x: fastFoodCounterX(w) - 6, y: TY - 4, w: w - fastFoodCounterX(w) + 4, h: BASE - TY + 4 });
const blindsRect = (w: number): Rect => ({ x: 0, y: WIN_PANE_TOP - 2, w, h: WIN_SILL + 2 - (WIN_PANE_TOP - 2) });

/**
 * Every room kind's illustrated layer. A test holds that every RoomKind has one, and that each
 * bakes (art.ts interior).
 */
export const INTERIORS: Record<RoomKind, InteriorSpec> = {
  office: venueSpec('office'),
  shop: venueSpec('shop'),
  restaurant: venueSpec('restaurant'),
  // Homes and hotel rooms are drawn in two variants (a mirrored plan in a second palette).
  condo: { variants: CONDO_VARIANTS, band: PER_FLOOR, draw: drawCondo, pools: true },
  hotelSingle: { variants: HOTEL_VARIANTS, band: PER_FLOOR, draw: drawHotel('hotelSingle'), pools: true },
  hotelTwin: { variants: HOTEL_VARIANTS, band: PER_FLOOR, draw: drawHotel('hotelTwin'), pools: true },
  hotelSuite: { variants: HOTEL_VARIANTS, band: PER_FLOOR, draw: drawHotel('hotelSuite'), pools: true },
  fastFood: {
    variants: 1,
    band: PER_FLOOR,
    draw: drawFastFood,
    open: (minute) => venueOpen('restaurant', minute),
    closed: { rect: fastFoodShutterRect, draw: (ctx, w) => shutter(ctx, fastFoodCounterX(w) - 4, TY - 2, w - fastFoodCounterX(w) - 4, BASE) },
    post: { kind: 'diner', x: fastFoodCookX, when: 'occupied' },
    pools: true,
  },
  cinema: {
    variants: 1,
    band: FULL,
    draw: drawCinema,
    open: cinemaOpen,
    closed: {
      rect: (w, floors) => {
        const s = cinemaScreen(w, floors);
        return { x: s.x - 4, y: s.y - 6, w: s.w + 8, h: s.h + 12 };
      },
      draw: drawCinemaClosed,
    },
    post: { kind: 'diner', x: (w) => cinemaUsherX(w), when: 'occupied' },
    pools: false,
  },
  partyHall: {
    variants: 1,
    band: FULL,
    draw: drawPartyHall,
    open: partyOpen,
    closed: { rect: (w) => ({ x: 0, y: FLOOR_PX + WIN_PANE_TOP - 2, w, h: WIN_SILL - WIN_PANE_TOP + 4 }), draw: (ctx, w) => drawPartyClosed(ctx, w) },
    post: { kind: 'diner', x: (w) => w - 132 + 62, when: 'occupied' },
    pools: false,
  },
  medical: { variants: 1, band: PER_FLOOR, draw: drawMedical, post: { kind: 'staff', x: () => 24, when: 'open' }, pools: true },
  security: { variants: 1, band: PER_FLOOR, draw: drawSecurity, post: { kind: 'guard', x: () => 20, when: 'open' }, pools: true },
  housekeeping: {
    variants: 1,
    band: PER_FLOOR,
    draw: drawHousekeeping,
    open: housekeepingOpen,
    closed: { rect: blindsRect, draw: (ctx, w) => blinds(ctx, w, WIN_PANE_TOP - 1, WIN_SILL) },
    pools: true,
  },
  parkingRamp: { variants: 1, band: () => WINDOWLESS, draw: drawParkingRamp, pools: false },
  parkingSpace: { variants: CAR_COLOURS.length, band: () => WINDOWLESS, draw: drawParkingSpace, pools: false },
  recycling: {
    variants: 1,
    band: FULL,
    draw: drawRecycling,
    open: recyclingOpen,
    closed: {
      rect: (w, floors) => {
        const b = loadingBay(w, floors);
        return { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 2 };
      },
      draw: drawRecyclingClosed,
    },
    post: { kind: 'collector', x: () => 46, when: 'open' },
    pools: false,
  },
  metro: {
    variants: 1,
    band: FULL,
    draw: drawMetro,
    open: metroOpen,
    closed: {
      rect: (_w, floors) => {
        const g = metroGate(floors);
        return { x: g.x - 2, y: g.y - 2, w: g.w + 4, h: g.h + 4 };
      },
      draw: drawMetroClosed,
    },
    post: { kind: 'worker', x: () => 150, when: 'open' },
    pools: false,
  },
  cathedral: { variants: 1, band: FULL, draw: drawCathedral, pools: false },
  lobby: { variants: LOBBY_RHYTHM, band: PER_FLOOR, draw: drawLobby, pools: false },
  skyLobby: { variants: SKY_LOBBY_RHYTHM, band: FULL, draw: drawSkyLobby, pools: false },
  stairs: { variants: 1, band: FLIGHT, draw: drawStairs, pools: false, overlay: true, structuralScale: true },
  escalator: { variants: 1, band: FLIGHT, draw: drawEscalator, pools: false, overlay: true, structuralScale: true },
};

/**
 * Which variant a room is drawn in: a venue's treatment (venue.ts, from the seed and the id), a
 * lobby tile's place in its rhythm (by x, so a run reads as one lobby), otherwise by id.
 */
export function interiorVariant(seed: number, room: { id: Id; kind: RoomKind; x: number }): number {
  const kind = room.kind;
  if (isVenueKind(kind)) return venueOf(seed, room.id, kind).treatment;
  const n = INTERIORS[kind].variants;
  if (kind === 'lobby' || kind === 'skyLobby') return ((room.x % n) + n) % n;
  return ((room.id % n) + n) % n;
}

/** Whether a room keeps its doors open at `minute`: always, for a kind with no hours. */
export function interiorOpen(kind: RoomKind, minute: number): boolean {
  const open = INTERIORS[kind].open;
  return open ? open(minute) : true;
}

/** Where a room's post stands, logical px from its left edge, or null for a kind with none. */
export function postX(kind: RoomKind, widthTiles: number): number | null {
  const post = INTERIORS[kind].post;
  return post ? post.x(widthTiles * TILE_PX) : null;
}

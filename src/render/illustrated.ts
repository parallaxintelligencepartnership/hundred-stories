// The illustrated texture class (package 2, decision of 2026-09-23): venue fixtures, signs, the
// closed-hours shutter and blinds, warm light pools, the elevator car, and the curb scene's
// umbrella and vehicles. Drawn with anti-aliased canvas paths and gradients, a 2 px dark outline
// on every shape, baked by art.ts at twice the structural resolution with linear sampling.
//
// Everything is drawn in the same logical pixels as the structural art (grid.ts), so a fixture
// texture lies exactly over its room's shell. Pure drawing: the context is passed in.

import { FLOOR_PX, INTERIOR_TOP, SLAB_PX, WIN_PANE_TOP, WIN_SILL, WIN_TOP } from './grid';
import type { Treatment, VenueKind } from './venue';

type Ctx = CanvasRenderingContext2D;

const INK = '#222222';
const BASE = FLOOR_PX - SLAB_PX; // 66, the first row of the slab
const TY = INTERIOR_TOP; // 22, the first free row under the windows

export function css(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

function scaleColour(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

function mixColour(a: number, b: number, t: number): number {
  const ch = (s: number): number => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

// ---------------------------------------------------------------- primitives

function rrPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** A filled rounded box with the 2 px dark outline: the unit most fixtures are built from. */
function box(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string | CanvasGradient, r = 1.5, line = 2): void {
  rrPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = line;
    ctx.stroke();
  }
}

function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, line = 2): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = line;
    ctx.stroke();
  }
}

function line(ctx: Ctx, pts: readonly (readonly [number, number])[], color = INK, width = 2): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function poly(ctx: Ctx, pts: readonly (readonly [number, number])[], fill: string, lineW = 2): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineW > 0) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = lineW;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function vgrad(ctx: Ctx, y0: number, y1: number, top: string, bottom: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  return g;
}

function plant(ctx: Ctx, x: number, by: number, big = false): void {
  const s = big ? 1.3 : 1;
  const leaf = '#2f7d3a';
  const light = '#4fa55a';
  for (const [dx, dy, rx, ry, a] of [
    [-5, -20, 5, 2.6, -0.6],
    [5, -21, 5, 2.6, 0.6],
    [-3, -26, 4.4, 2.4, -1.1],
    [3, -27, 4.4, 2.4, 1.1],
    [0, -30, 2.6, 4.2, 0],
  ] as const) {
    ctx.beginPath();
    ctx.ellipse(x + dx * s, by + dy * s + (big ? 4 : 0), rx * s, ry * s, a, 0, Math.PI * 2);
    ctx.fillStyle = leaf;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  line(ctx, [[x - 2, by - 18 * s], [x + 2, by - 24 * s]], light, 1);
  poly(ctx, [[x - 6, by - 11], [x + 6, by - 11], [x + 4.5, by], [x - 4.5, by]], '#a4522c');
}

function pendant(ctx: Ctx, x: number, drop: number, shade: string, lit: boolean): void {
  line(ctx, [[x, 20], [x, TY + drop]], '#333a44', 1);
  poly(ctx, [[x - 5, TY + drop + 5], [x - 2, TY + drop], [x + 2, TY + drop], [x + 5, TY + drop + 5]], shade);
  if (lit) disc(ctx, x, TY + drop + 6, 1.5, '#fff3b0', 0);
}

function chair(ctx: Ctx, x: number, by: number, color: string, faceRight: boolean): void {
  const back = faceRight ? x : x + 9;
  box(ctx, back - 1, by - 22, 3, 22, color, 1);
  box(ctx, x, by - 12, 10, 3, color, 1);
  line(ctx, [[faceRight ? x + 9 : x + 1, by - 9], [faceRight ? x + 9 : x + 1, by]], INK, 2);
}

function stool(ctx: Ctx, x: number, by: number, seat: string): void {
  box(ctx, x - 4, by - 15, 8, 3, seat, 1.5);
  line(ctx, [[x - 3, by - 12], [x - 4, by]], INK, 1.5);
  line(ctx, [[x + 3, by - 12], [x + 4, by]], INK, 1.5);
}

function monitor(ctx: Ctx, x: number, y: number, w: number, h: number, glow: string, chart = false): void {
  box(ctx, x, y, w, h, '#1f2733', 1);
  ctx.fillStyle = glow;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  if (chart) line(ctx, [[x + 2.5, y + h - 3], [x + w * 0.35, y + h * 0.55], [x + w * 0.6, y + h * 0.7], [x + w - 2.5, y + 3]], '#5fd38a', 1);
  line(ctx, [[x + w / 2, y + h], [x + w / 2, y + h + 3]], INK, 2);
}

// ---------------------------------------------------------------- venue fixtures

/** Where a sign's board sits in its room, logical px from the room's top left. */
export function signBoard(kind: 'shop' | 'restaurant', w: number): { x: number; y: number; w: number; h: number } {
  if (kind === 'shop') return { x: 10, y: WIN_TOP, w: Math.min(112, w - 20), h: 14 };
  return { x: 16, y: WIN_TOP, w: Math.min(156, w - 32), h: 14 };
}


/** The shop's counter, and where the kitchen pass steams in a restaurant (ambient.ts). */
export const SHOP_COUNTER_W = 62;
export const RESTAURANT_PASS_W = 80;

/** The palette each treatment's fixtures are drawn in: [accent, secondary, material]. */
const TREATMENT_PALETTE: Record<VenueKind, readonly (readonly [number, number, number])[]> = {
  office: [
    [0x2f7d7d, 0xffd866, 0xf2efe6], // studio: teal, sticky yellow, pale birch
    [0x1f3a5f, 0x5fd38a, 0x6b4420], // finance: navy, ticker green, walnut
    [0xd9643a, 0xb0417a, 0xc98a45], // creative: orange, magenta, oak
  ],
  shop: [
    [0xb0417a, 0xe8c1d4, 0xf2e6ee],
    [0x2f5c9e, 0xc9a227, 0x8a5a2b],
    [0x2f7d3a, 0xd28c1f, 0xb98a4a],
  ],
  restaurant: [
    [0x8c1f3d, 0xf7f7f2, 0x6b4420],
    [0xc03028, 0xd9a441, 0x2b2b2b],
    [0x6b4420, 0xd9643a, 0x3a2a20],
  ],
};

/** A venue's fixtures over its shell: the interior only, transparent elsewhere. `w` is the room's width in px. */
export function drawVenueFixtures(ctx: Ctx, kind: VenueKind, treatment: Treatment, w: number): void {
  const [accent, second, material] = TREATMENT_PALETTE[kind][treatment] as readonly [number, number, number];
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'office') drawOffice(ctx, treatment, w, accent, second, material);
  else if (kind === 'shop') drawShop(ctx, treatment, w, accent, second, material);
  else drawRestaurant(ctx, treatment, w, accent, second, material);
}

function drawOffice(ctx: Ctx, t: Treatment, w: number, accent: number, second: number, material: number): void {
  const by = BASE;
  if (t === 0) {
    // Studio: a pinboard of sticky notes, one long shared bench of laptops, pendant lamps, a plant.
    box(ctx, 6, TY + 1, 30, 15, '#c9a06a', 1);
    const notes = ['#ffd866', '#8fd4ff', '#ff9ec4', '#9be08a', css(second), '#ffffff'];
    for (let i = 0; i < 6; i++) box(ctx, 9 + (i % 3) * 8.5, TY + 3.5 + Math.floor(i / 3) * 6, 5.5, 4.5, notes[i] as string, 0.5, 1);
    const tableR = w - 30;
    box(ctx, 8, by - 19, tableR - 8, 3.5, css(material), 1);
    line(ctx, [[14, by - 15.5], [11, by]], INK, 2);
    line(ctx, [[tableR - 6, by - 15.5], [tableR - 3, by]], INK, 2);
    for (let x = 18; x + 16 < tableR; x += 30) {
      poly(ctx, [[x, by - 19], [x + 12, by - 19], [x + 14, by - 30], [x + 2, by - 30]], '#c4ccd6');
      ctx.fillStyle = '#8fd4ff';
      ctx.fillRect(x + 3.5, by - 28.5, 8, 7.5);
      box(ctx, x + 18, by - 24, 4, 5, css(accent), 1, 1.5); // a mug
      pendant(ctx, x + 8, 2, css(accent), false);
    }
    plant(ctx, w - 16, by, true);
    return;
  }
  if (t === 1) {
    // Finance: a wall screen with the ticker, rows of walnut desks with twin monitors, a credenza.
    box(ctx, 6, TY, 34, 16, '#1b2433', 1);
    line(ctx, [[9, TY + 12], [16, TY + 8], [22, TY + 10], [30, TY + 4], [37, TY + 5]], css(second), 1.4);
    ctx.fillStyle = css(accent);
    ctx.fillRect(8, TY + 13.5, 30, 1.5);
    const credX = w - 24;
    for (let x = 8; x + 30 <= credX - 4; x += 34) {
      box(ctx, x, by - 17, 28, 3, css(material), 1);
      box(ctx, x + 2, by - 14, 24, 14, css(scaleColour(material, 0.8)), 1);
      monitor(ctx, x + 2, by - 29, 11, 9, '#1d3a5c', true);
      monitor(ctx, x + 15, by - 29, 11, 9, '#1d3a5c', false);
      // A high backed chair in front of each desk.
      box(ctx, x + 10, by - 16, 8, 11, '#2a2a2e', 2.5);
      line(ctx, [[x + 14, by - 5], [x + 14, by - 1]], INK, 2);
      line(ctx, [[x + 10, by], [x + 18, by]], INK, 2);
    }
    box(ctx, credX, by - 20, 20, 20, css(material), 1);
    line(ctx, [[credX + 2, by - 10], [credX + 18, by - 10]], INK, 1.5);
    disc(ctx, credX + 10, TY + 6, 5, '#f7f5ee'); // the clock
    line(ctx, [[credX + 10, TY + 6], [credX + 10, TY + 3]], INK, 1);
    line(ctx, [[credX + 10, TY + 6], [credX + 12.5, TY + 6]], INK, 1);
    return;
  }
  // Creative: a bold poster, a whiteboard on an easel, a beanbag, a round table with stools.
  box(ctx, 6, TY, 22, 18, css(accent), 1);
  disc(ctx, 14, TY + 7, 4, css(second), 1.5);
  poly(ctx, [[18, TY + 15], [24, TY + 5], [26, TY + 15]], '#ffd866', 1.5);
  ctx.beginPath();
  ctx.ellipse(18, by - 6, 11, 7, 0, Math.PI, Math.PI * 2);
  ctx.lineTo(29, by);
  ctx.lineTo(7, by);
  ctx.closePath();
  ctx.fillStyle = css(second);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  const wb = Math.min(w - 60, 44);
  box(ctx, 38, TY + 2, wb, 22, '#fbfbf8', 1);
  line(ctx, [[42, TY + 8], [50, TY + 6], [58, TY + 9]], '#2f5c9e', 1.2);
  line(ctx, [[44, TY + 14], [56, TY + 13]], css(accent), 1.2);
  disc(ctx, 38 + wb - 9, TY + 12, 4, 'rgba(0,0,0,0)', 1.2);
  line(ctx, [[42, TY + 24], [38, by]], INK, 2);
  line(ctx, [[38 + wb - 4, TY + 24], [38 + wb, by]], INK, 2);
  const tx = Math.min(w - 36, 38 + wb + 18);
  if (tx > 90) {
    box(ctx, tx - 12, by - 17, 24, 3, css(material), 1.5);
    line(ctx, [[tx, by - 14], [tx, by]], INK, 2);
    line(ctx, [[tx - 5, by], [tx + 5, by]], INK, 2);
    poly(ctx, [[tx - 8, by - 17], [tx - 1, by - 17], [tx, by - 24], [tx - 7, by - 24]], '#c4ccd6');
    stool(ctx, tx - 17, by, css(accent));
  }
  plant(ctx, w - 12, by);
  // String lights along the ceiling.
  line(ctx, [[4, TY - 1], [w / 2, TY + 2], [w - 4, TY - 1]], '#333a44', 0.8);
  for (let x = 10; x < w - 6; x += 12) disc(ctx, x, TY - 0.5 + 3 * Math.sin((x / w) * Math.PI), 1.2, x % 24 < 12 ? '#ffd866' : css(second), 0.8);
}

function drawShop(ctx: Ctx, t: Treatment, w: number, accent: number, second: number, material: number): void {
  const by = BASE;
  const counterX = w - SHOP_COUNTER_W - 6;
  // Every shop: an awning over the front and a counter with a register at the back.
  for (let x = 4, i = 0; x < w - 4; x += 8, i++) {
    poly(ctx, [[x, TY - 2], [x + 8, TY - 2], [x + 8, TY + 3], [x + 4, TY + 5], [x, TY + 3]], i % 2 ? '#fbfbf8' : css(accent), 1.2);
  }
  box(ctx, counterX, by - 22, SHOP_COUNTER_W, 5, css(scaleColour(material, 0.9)), 1);
  box(ctx, counterX + 2, by - 17, SHOP_COUNTER_W - 4, 17, css(scaleColour(material, 0.72)), 1);
  box(ctx, counterX + SHOP_COUNTER_W - 22, by - 33, 16, 11, '#5a6472', 1.5);
  ctx.fillStyle = '#8fd4ff';
  ctx.fillRect(counterX + SHOP_COUNTER_W - 20, by - 31, 12, 4);
  const floorX = counterX - 4;
  if (t === 0) {
    // Boutique: a mannequin in the window, a rail of garments, a tall mirror.
    line(ctx, [[16, by - 6], [16, by - 34]], '#5a6472', 2);
    line(ctx, [[10, by], [22, by]], INK, 2);
    disc(ctx, 16, by - 42, 3.5, '#e8e2da');
    poly(ctx, [[11, by - 37], [21, by - 37], [24, by - 14], [8, by - 14]], css(accent));
    line(ctx, [[12, by - 30], [20, by - 30]], css(second), 1.2);
    const railL = 34;
    const railR = Math.min(floorX - 22, railL + 64);
    line(ctx, [[railL, TY + 8], [railR, TY + 8]], '#5a6472', 2);
    line(ctx, [[railL, TY + 8], [railL, by]], '#5a6472', 2);
    line(ctx, [[railR, TY + 8], [railR, by]], '#5a6472', 2);
    const cols = [accent, second, 0x2f5c9e, 0xf7f5ee, 0x3a3f4a, mixColour(accent, 0xffffff, 0.4)];
    for (let x = railL + 5, i = 0; x + 8 < railR; x += 9, i++) {
      line(ctx, [[x + 4, TY + 8], [x + 4, TY + 11]], '#333a44', 1);
      poly(ctx, [[x, TY + 11], [x + 8, TY + 11], [x + 9, TY + 30 + (i % 2) * 5], [x - 1, TY + 30 + (i % 2) * 5]], css(cols[i % cols.length] as number), 1.5);
    }
    if (floorX - railR > 18) {
      ctx.beginPath();
      ctx.ellipse(railR + 11, by - 22, 6, 18, 0, 0, Math.PI * 2);
      ctx.fillStyle = vgrad(ctx, by - 40, by - 4, '#dfe9f2', '#a9b8c6');
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      line(ctx, [[railR + 8, by - 34], [railR + 10, by - 30]], '#ffffff', 1);
    }
    return;
  }
  if (t === 1) {
    // Bookshop: two tall shelves of spines, a table of stacks with a tent card, a reading chair.
    const spines = [0x8c3050, 0x2f5c9e, 0xc9a227, 0x2f7d3a, 0xd2761f, 0x1f7d7d, 0xf7f5ee, 0x6a3a97];
    for (let s = 0; s < 2; s++) {
      const x = 6 + s * 34;
      if (x + 30 > floorX - 30) break;
      box(ctx, x, TY + 1, 30, by - TY - 1, css(material), 1);
      for (let r = 0; r < 3; r++) {
        const y = TY + 4 + r * 13;
        ctx.fillStyle = css(scaleColour(material, 0.6));
        ctx.fillRect(x + 2, y, 26, 10);
        for (let b = 0, bx = x + 3; bx + 3 < x + 28; b++, bx += 3.4) {
          const h = 7 + ((b * 7 + r * 3 + s) % 4);
          ctx.fillStyle = css(spines[(b + r * 3 + s) % spines.length] as number);
          ctx.fillRect(bx, y + 10 - h, 2.8, h);
        }
        line(ctx, [[x + 2, y + 10], [x + 28, y + 10]], INK, 1.5);
      }
    }
    const tx = 78;
    if (tx + 34 < floorX) {
      box(ctx, tx, by - 16, 34, 3, css(scaleColour(material, 1.2)), 1);
      line(ctx, [[tx + 3, by - 13], [tx + 3, by]], INK, 2);
      line(ctx, [[tx + 31, by - 13], [tx + 31, by]], INK, 2);
      for (let i = 0; i < 3; i++) box(ctx, tx + 3 + i * 10, by - 22 + (i % 2) * 2, 8, 6 - (i % 2) * 2, css(spines[i + 2] as number), 0.5, 1.2);
      poly(ctx, [[tx + 24, by - 16], [tx + 30, by - 16], [tx + 27, by - 24]], css(accent), 1.2);
    }
    return;
  }
  // Grocer: angled produce crates in the window, leafy greens, a drinks fridge by the counter.
  const produce = [0xd23c2b, 0xf08a1f, 0x7cc243, 0xd2b21f];
  for (let i = 0, x = 6; i < 4 && x + 22 < floorX - 30; i++, x += 24) {
    poly(ctx, [[x, by - 14], [x + 22, by - 20], [x + 22, by - 10], [x, by - 4]], css(material), 1.5);
    for (let k = 0; k < 4; k++) disc(ctx, x + 4 + k * 5, by - 18 + k * -1.4 + 2, 2.4, css(produce[(i + k) % produce.length] as number), 1);
    line(ctx, [[x + 2, by - 4], [x + 2, by]], INK, 2);
    line(ctx, [[x + 20, by - 10], [x + 20, by]], INK, 2);
  }
  const fx = floorX - 26;
  if (fx > 100) {
    box(ctx, fx, TY + 2, 22, by - TY - 2, '#e4e8ee', 1.5);
    ctx.fillStyle = 'rgba(143,212,255,0.55)';
    ctx.fillRect(fx + 3, TY + 5, 16, by - TY - 12);
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        const c = [0xd23c2b, 0x2f7d3a, second, 0xf7f5ee][k] as number;
        box(ctx, fx + 4 + k * 3.8, TY + 8 + r * 12, 2.6, 8, css(c), 0.8, 0.8);
      }
    }
  }
  // A crate of greens and a basket stack by the door.
  for (let k = 0; k < 3; k++) disc(ctx, floorX - 42 + k * 5, by - 22, 3, '#3f8a4a', 1.2);
  box(ctx, floorX - 48, by - 20, 18, 20, css(accent), 1);
}

function drawRestaurant(ctx: Ctx, t: Treatment, w: number, accent: number, second: number, material: number): void {
  const by = BASE;
  const passX = w - RESTAURANT_PASS_W - 6;
  // Every restaurant: a kitchen pass at the back with a steaming pot (ambient.ts puffs over it).
  box(ctx, passX, by - 26, RESTAURANT_PASS_W, 5, '#c4ccd6', 1);
  box(ctx, passX + 2, by - 21, RESTAURANT_PASS_W - 4, 21, '#8a939e', 1);
  const steam = restaurantSteamPoint(w);
  box(ctx, steam.x - 7, by - 34, 14, 8, '#5a6472', 2); // the pot
  box(ctx, steam.x + 10, by - 30, 12, 4, '#f7f7f2', 1.5); // a plate up
  box(ctx, passX + 4, TY + 1, RESTAURANT_PASS_W - 8, 10, css(second === 0xf7f7f2 ? 0x333a44 : second), 1); // the menu board
  for (let i = 0; i < 4; i++) line(ctx, [[passX + 8 + i * 18, TY + 6], [passX + 18 + i * 18, TY + 6]], '#f7f5ee', 1);
  const room = passX - 8;
  if (t === 0) {
    // Bistro: round clothed tables with bentwood chairs, globe pendants, a chalkboard, a wine rack.
    box(ctx, 6, TY + 1, 26, 18, '#2b2f2c', 1);
    for (let i = 0; i < 4; i++) line(ctx, [[9, TY + 5 + i * 3.6], [14 + ((i * 7) % 12), TY + 5 + i * 3.6]], '#f7f5ee', 1);
    for (let x = 42; x + 44 < room; x += 58) {
      chair(ctx, x, by, css(material), true);
      poly(ctx, [[x + 12, by - 16], [x + 34, by - 16], [x + 36, by - 8], [x + 10, by - 8]], '#f7f7f2');
      line(ctx, [[x + 23, by - 8], [x + 23, by]], INK, 2);
      line(ctx, [[x + 18, by], [x + 28, by]], INK, 2);
      disc(ctx, x + 19, by - 18, 2, css(accent), 1);
      box(ctx, x + 26, by - 22, 2.4, 6, '#f7f7f2', 0.6, 1); // a candle
      chair(ctx, x + 36, by, css(material), false);
      pendant(ctx, x + 23, 4, '#f7f1d8', false);
    }
    return;
  }
  if (t === 1) {
    // Noodle bar: a long counter of stools, red paper lanterns, bowls on the counter.
    const cl = 14;
    const cr = room - 4;
    box(ctx, cl, by - 20, cr - cl, 4, css(material), 1);
    box(ctx, cl + 2, by - 16, cr - cl - 4, 5, css(scaleColour(material, 1.6)), 0.5, 1.5);
    for (let x = cl + 12; x < cr - 6; x += 22) {
      stool(ctx, x, by, css(accent));
      box(ctx, x - 4, by - 24, 8, 4, '#f7f7f2', 2, 1.5);
      line(ctx, [[x + 2, by - 27], [x + 5, by - 31]], '#6b4420', 1);
    }
    for (let x = 26; x < room - 10; x += 44) {
      line(ctx, [[x, 20], [x, TY + 2]], '#333a44', 1);
      ctx.beginPath();
      ctx.ellipse(x, TY + 8, 5, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = css(accent);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      line(ctx, [[x - 4.5, TY + 8], [x + 4.5, TY + 8]], css(second), 1);
    }
    return;
  }
  // Grill: high backed booths, an exposed brick wall, bare bulbs, the grill's glow at the pass.
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 5; k++) box(ctx, 6 + k * 9 + (r % 2) * 4, TY + 1 + r * 5, 8, 4, '#a4522c', 0.5, 1);
  }
  for (let x = 58; x + 54 < room; x += 62) {
    box(ctx, x, by - 30, 6, 30, css(accent), 2);
    box(ctx, x + 6, by - 13, 8, 4, css(scaleColour(accent, 1.3)), 1, 1.5);
    box(ctx, x + 16, by - 18, 22, 3, css(material), 1);
    line(ctx, [[x + 27, by - 15], [x + 27, by]], INK, 2);
    box(ctx, x + 40, by - 13, 8, 4, css(scaleColour(accent, 1.3)), 1, 1.5);
    box(ctx, x + 48, by - 30, 6, 30, css(accent), 2);
    line(ctx, [[x + 27, 20], [x + 27, TY + 6]], '#333a44', 1);
    disc(ctx, x + 27, TY + 8, 2.5, '#ffd88a', 1.5);
  }
  const glow = ctx.createRadialGradient(passX + 16, by - 24, 1, passX + 16, by - 24, 14);
  glow.addColorStop(0, 'rgba(255,160,60,0.85)');
  glow.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(passX + 2, by - 38, 28, 16);
}

/** Where the pot on the kitchen pass sits, the source of the restaurant's steam (ambient.ts). */
export function restaurantSteamPoint(w: number): { x: number; y: number } {
  return { x: w - RESTAURANT_PASS_W + 14, y: BASE - 36 };
}

/** The strip under a shop's sign board, the one that blinks at night (ambient.ts). */
export function shopSignStrip(w: number): { x: number; y: number; w: number; h: number } {
  const b = signBoard('shop', w);
  return { x: b.x + 4, y: b.y + b.h + 1, w: b.w - 8, h: 2 };
}

// ---------------------------------------------------------------- signs

/**
 * What a sign shows. Day: the accent board. Lit, open at night: the same board over a warm glow.
 * Dark, closed: the same board dimmed by a tint. One texture per sign serves all three.
 */
export type SignState = 'day' | 'lit' | 'dark';
/** The tint a closed venue's sign is dimmed by. */
export const SIGN_DARK_TINT = 0x6e6e6e;
/** The glow behind a lit sign and the pools of light in a lit venue: the shared glow, tinted. */
export const SIGN_GLOW_TINT = 0xffe08a;
export const POOL_TINT = 0xffd678;
export const POOL_ALPHA = 0.5;
/** Pools of light hang every POOL_STEP px along a lit venue's ceiling, each POOL_W by POOL_H. */
export const POOL_STEP = 48;
export const POOL_W = 72;
export const POOL_H = BASE - TY + 2;

/** A sign board with the brand on it, the board's own size. */
export function drawSign(ctx: Ctx, board: { w: number; h: number }, name: string, accent: number): void {
  box(ctx, 1, 1, board.w - 2, board.h - 2, vgrad(ctx, 0, board.h, css(scaleColour(accent, 1.15)), css(accent)), 2.5);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  rrPath(ctx, 3, 3, board.w - 6, board.h - 6, 1.5);
  ctx.stroke();
  let size = 9;
  ctx.font = `700 ${size}px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif`;
  const room = board.w - 12;
  const measured = ctx.measureText(name).width;
  if (measured > room) {
    size = Math.max(6, (size * room) / measured);
    ctx.font = `700 ${size}px "Bricolage Grotesque", "Trebuchet MS", system-ui, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fbfaf5';
  ctx.fillText(name, board.w / 2, board.h / 2 + 0.5);
}

/** The shared soft glow: white at the centre fading to nothing, tinted where it is used. */
export const GLOW_PX = 32;
export function drawGlow(ctx: Ctx): void {
  const g = ctx.createRadialGradient(GLOW_PX / 2, GLOW_PX / 2, 0, GLOW_PX / 2, GLOW_PX / 2, GLOW_PX / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GLOW_PX, GLOW_PX);
}

// ---------------------------------------------------------------- closed hours and light

/**
 * The rows of a room each illustrated venue texture covers, so a texture holds only what it
 * draws: the fixtures from just over the awning to the slab, the shutter over the shop front,
 * the blinds over the window band (and a restaurant's Closed card under it).
 */
export const VENUE_BAND = { top: TY - 3, height: BASE - (TY - 3) };
export function closedBand(kind: VenueKind): { top: number; height: number } {
  if (kind === 'shop') return VENUE_BAND;
  const top = WIN_PANE_TOP - 2;
  return { top, height: (kind === 'restaurant' ? TY + 16 : WIN_SILL + 2) - top };
}

/** What a closed venue shows: a roll-down shutter over a shop, blinds drawn in an office or restaurant. */
export function drawClosed(ctx: Ctx, kind: VenueKind, w: number): void {
  if (kind === 'shop') {
    const top = TY - 2;
    box(ctx, 3, top, w - 6, BASE - top, vgrad(ctx, top, BASE, '#b9c0ca', '#8a939e'), 1);
    for (let y = top + 4; y < BASE - 2; y += 4) line(ctx, [[5, y], [w - 5, y]], 'rgba(34,34,34,0.35)', 1);
    box(ctx, w / 2 - 3, BASE - 8, 6, 5, '#c9a227', 1, 1.5);
    return;
  }
  // Blinds across the window band: slats drawn over the panes.
  const y0 = WIN_PANE_TOP - 1;
  const y1 = WIN_SILL;
  box(ctx, 2, y0, w - 4, y1 - y0, '#e9dfc9', 0, 1.5);
  for (let y = y0 + 2.5; y < y1; y += 2.5) line(ctx, [[3, y], [w - 3, y]], 'rgba(120,100,70,0.55)', 0.8);
  if (kind === 'restaurant') {
    line(ctx, [[20, TY], [16, TY + 6]], '#333a44', 1);
    line(ctx, [[20, TY], [24, TY + 6]], '#333a44', 1);
    box(ctx, 10, TY + 6, 20, 9, '#f7f5ee', 1, 1.5);
    ctx.font = '700 5px "Trebuchet MS", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#8c1f3d';
    ctx.fillText('Closed', 20, TY + 10.8);
  }
}

// ---------------------------------------------------------------- the elevator car

export type CarKind = 'standard' | 'express' | 'service';

/** The floor indicator's housing, above the doors, relative to the car texture. */
export function carIndicator(w: number, top: number): { x: number; y: number; w: number; h: number } {
  return { x: w / 2 - 11, y: top + 3, w: 22, h: 8 };
}

/**
 * The car: a shaped cab with a rounded crown, a warm lit interior behind two brushed metal door
 * panels that slide out by `door` (0 closed, 1 open), the indicator housing above the doors, a
 * 4 px cast shadow on top. `bodyH` excludes the shadow.
 */
export function drawCarIllustrated(ctx: Ctx, kind: CarKind, w: number, bodyH: number, door: number, shadowPx: number): void {
  ctx.fillStyle = 'rgba(51,51,51,0.25)';
  ctx.fillRect(2, 0, w - 4, shadowPx);
  const top = shadowPx;
  const body = kind === 'service' ? ['#b6bec8', '#8a939e'] : ['#f7d34d', '#dcae1c'];
  rrPath(ctx, 1, top + 1, w - 2, bodyH - 2, 5);
  ctx.fillStyle = vgrad(ctx, top, top + bodyH, body[0] as string, body[1] as string);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,80,0,0.18)';
  ctx.fillRect(w - 9, top + 4, 6, bodyH - 8); // the shadow face
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  rrPath(ctx, 1, top + 1, w - 2, bodyH - 2, 5);
  ctx.stroke();
  if (kind === 'express') {
    ctx.fillStyle = '#222222';
    ctx.fillRect(2, top + bodyH - 12, w - 4, 3);
  }
  const ind = carIndicator(w, top);
  box(ctx, ind.x, ind.y, ind.w, ind.h, '#2a2320', 1.5, 1.5);
  // The opening: a warm interior, a handrail, then the door panels over it.
  const ox = 6;
  const oy = top + 13;
  const ow = w - 12;
  const oh = bodyH - 19;
  box(ctx, ox, oy, ow, oh, vgrad(ctx, oy, oy + oh, '#fff3c4', '#f0bf62'), 1, 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(ox + 2, oy + 2, ow - 4, 3);
  line(ctx, [[ox + 3, oy + oh * 0.55], [ox + ow - 3, oy + oh * 0.55]], 'rgba(120,80,20,0.6)', 1.2);
  const open = Math.min(1, Math.max(0, door));
  const panelW = ow / 2;
  const slide = panelW * 0.8 * open;
  const metal = vgrad(ctx, oy, oy + oh, '#eef0f3', '#b3bac4');
  if (panelW - slide > 0.5) {
    box(ctx, ox, oy, panelW - slide, oh, metal, 0.5, 1.5);
    box(ctx, ox + panelW + slide, oy, panelW - slide, oh, metal, 0.5, 1.5);
    if (open < 0.05) line(ctx, [[ox + panelW, oy + 1], [ox + panelW, oy + oh - 1]], INK, 1.5);
  }
  ctx.fillStyle = '#333333';
  ctx.fillRect(3, top + bodyH - 5, w - 6, 3); // the sill plate
}

// ---------------------------------------------------------------- curb scene

export const UMBRELLA_COLOURS = [0x2f5c9e, 0xc03028, 0x2f7d3a, 0x222222] as const;
export const UMBRELLA_W = 22;
export const UMBRELLA_H = 14;

/** An open umbrella, canopy and shaft, in a UMBRELLA_W by UMBRELLA_H box; the shaft ends at the bottom middle. */
export function drawUmbrella(ctx: Ctx, color: number): void {
  const cx = UMBRELLA_W / 2;
  ctx.beginPath();
  ctx.moveTo(2, 8);
  ctx.quadraticCurveTo(cx, -4, UMBRELLA_W - 2, 8);
  for (let i = 3; i >= 0; i--) {
    const x0 = 2 + ((i + 1) * (UMBRELLA_W - 4)) / 4;
    const x1 = 2 + (i * (UMBRELLA_W - 4)) / 4;
    ctx.quadraticCurveTo((x0 + x1) / 2, 5.5, x1, 8);
  }
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  line(ctx, [[cx, 3], [cx, UMBRELLA_H - 0.5]], INK, 1.5);
}

export type VehicleKind = 'vip' | 'fire' | 'police';
export const VEHICLE_SIZE: Record<VehicleKind, { w: number; h: number }> = {
  vip: { w: 70, h: 24 },
  fire: { w: 88, h: 36 },
  police: { w: 66, h: 26 },
};

/** A vehicle side on, wheels on the bottom row of its box. */
export function drawVehicle(ctx: Ctx, kind: VehicleKind): void {
  const { w, h } = VEHICLE_SIZE[kind];
  ctx.lineJoin = 'round';
  const wheel = (x: number): void => {
    disc(ctx, x, h - 5, 4.5, '#1c1c1f');
    disc(ctx, x, h - 5, 1.8, '#9aa3ae', 0);
  };
  if (kind === 'fire') {
    box(ctx, 2, 8, w - 4, h - 14, vgrad(ctx, 8, h - 6, '#e0442f', '#a82a1c'), 3);
    box(ctx, w - 26, 12, 20, 9, '#bfe3f7', 1.5, 1.5); // the cab window
    line(ctx, [[6, 5], [w - 32, 5]], '#c4ccd6', 2); // the ladder
    for (let x = 10; x < w - 32; x += 6) line(ctx, [[x, 3], [x, 7]], '#c4ccd6', 1);
    box(ctx, w - 22, 4, 10, 4, '#ff5c4d', 1, 1.5); // light bar
    ctx.fillStyle = '#f4b942';
    ctx.fillRect(4, h - 14, w - 30, 2);
    wheel(14);
    wheel(w - 16);
    return;
  }
  const bodyTop = kind === 'police' ? 10 : 9;
  const bodyCol = kind === 'police' ? '#f7f7f2' : '#1c1f26';
  // The body, with a cabin rising over its middle.
  ctx.beginPath();
  ctx.moveTo(4, h - 6);
  ctx.lineTo(3, bodyTop + 4);
  ctx.quadraticCurveTo(4, bodyTop, 12, bodyTop);
  ctx.lineTo(18, bodyTop);
  ctx.lineTo(24, 3);
  ctx.lineTo(w - 24, 3);
  ctx.lineTo(w - 16, bodyTop);
  ctx.lineTo(w - 6, bodyTop + 1);
  ctx.quadraticCurveTo(w - 2, bodyTop + 3, w - 2, bodyTop + 7);
  ctx.lineTo(w - 3, h - 6);
  ctx.closePath();
  ctx.fillStyle = bodyCol;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  poly(ctx, [[21, bodyTop], [26, 5], [w / 2 - 1, 5], [w / 2 - 1, bodyTop]], '#9fc6e0', 1.5);
  poly(ctx, [[w / 2 + 1, bodyTop], [w / 2 + 1, 5], [w - 26, 5], [w - 19, bodyTop]], '#9fc6e0', 1.5);
  if (kind === 'police') {
    ctx.fillStyle = '#2f5c9e';
    ctx.fillRect(4, bodyTop + 5, w - 8, 4);
    box(ctx, w / 2 - 8, 0, 16, 3.5, '#ff5c4d', 1, 1.2);
    ctx.fillStyle = '#2f5c9e';
    ctx.fillRect(w / 2, 0.6, 7, 2.4);
  } else {
    line(ctx, [[6, bodyTop + 6], [w - 6, bodyTop + 6]], '#9aa3ae', 1);
    disc(ctx, w - 4, bodyTop + 5, 1.4, '#fff3b0', 0);
  }
  wheel(15);
  wheel(w - 15);
}

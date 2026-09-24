// People, illustrated (package 2, decision of 2026-09-23): five adult builds, eight looks from the
// stable identity look key (src/sim/identity.ts), role props, and eight baked frames (anim.ts
// PersonFrame). Drawn with anti-aliased canvas paths on a 16 by 48 box, feet on the bottom row,
// the same box and anchor the 0.4 figures used, so picking and the selection ring are unchanged.
//
// Every shape is drawn twice: first an ink pass (each shape grown by OUTLINE_PX in INK), then a
// fill pass. The union of the ink shapes is a 2 px dark outline around the whole figure, the
// rule that keeps the cutaway readable, while shapes inside the figure meet without a seam.
//
// The same drawPerson feeds the texture bake (art.ts) and the person panel's portrait
// (ui/panels.ts), so the card always shows the sprite in the world. Pure: no pixi, no DOM, and
// the context is any object with the canvas 2D methods used here.

import { LOOK_KEYS, personIdentity } from '../sim/identity';
import type { SimKind, StressBand } from '../sim/types';
import { canonicalFrame, FRAME, mix, type PersonFrame } from './anim';
import { SIM_H, SIM_W } from './grid';

/** The subset of CanvasRenderingContext2D the figure is drawn with. */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'ellipse'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'translate'
  | 'scale'
  | 'fillRect'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'globalAlpha'
>;

export const INK_CSS = '#222222';
/** How far the ink pass grows each shape: the visible outline. */
export const OUTLINE_PX = 2;

// ---------------------------------------------------------------- builds and looks

/** Five adult builds. No child height: every person in the tower is a grown up. */
export const BODY_SHAPES = ['average', 'tall', 'short', 'broad', 'slim'] as const;
export type BodyShape = (typeof BODY_SHAPES)[number];
export const BODY_COUNT = BODY_SHAPES.length;

interface Build {
  /** Top of the skull, from the top of the 48 px box. */
  top: number;
  head: number;
  shoulder: number;
  hip: number;
  limb: number;
}

const BUILDS: readonly Build[] = [
  { top: 8, head: 3.3, shoulder: 8.4, hip: 7, limb: 2.2 }, // average
  { top: 4.5, head: 3.3, shoulder: 8.6, hip: 7, limb: 2.2 }, // tall
  { top: 12, head: 3.3, shoulder: 8, hip: 7.6, limb: 2.2 }, // short
  { top: 8, head: 3.5, shoulder: 10.6, hip: 9.4, limb: 2.8 }, // broad
  { top: 6, head: 3.0, shoulder: 6.6, hip: 5.6, limb: 1.8 }, // slim
];

type Hair = 'short' | 'long' | 'bun' | 'curly' | 'bob' | 'puffs' | 'buzz';
type Cut = 'jacket' | 'sweater' | 'dress' | 'hoodie' | 'cardigan' | 'tee';

interface Look {
  skin: string;
  hair: Hair;
  hairColour: string;
  cut: Cut;
  top: string;
  bottom: 'trousers' | 'skirt';
  bottomColour: string;
}

/** Eight looks, one per identity look key: skin tone, hairstyle, clothing cut and colours. */
export const LOOKS: readonly Look[] = [
  { skin: '#f1c7a5', hair: 'short', hairColour: '#3b2a1e', cut: 'jacket', top: '#2f4f7f', bottom: 'trousers', bottomColour: '#3a3f4a' },
  { skin: '#8d5a3b', hair: 'curly', hairColour: '#1d1512', cut: 'sweater', top: '#d9a441', bottom: 'trousers', bottomColour: '#3d5a80' },
  { skin: '#e8b48f', hair: 'long', hairColour: '#8a3b1f', cut: 'dress', top: '#1f7d7d', bottom: 'skirt', bottomColour: '#1f7d7d' },
  { skin: '#5a3a28', hair: 'buzz', hairColour: '#141010', cut: 'hoodie', top: '#3f8a4a', bottom: 'trousers', bottomColour: '#2b3548' },
  { skin: '#c68a5e', hair: 'bun', hairColour: '#2a1d16', cut: 'cardigan', top: '#7b3f6e', bottom: 'skirt', bottomColour: '#555b63' },
  { skin: '#fbd9c0', hair: 'bob', hairColour: '#d9b35f', cut: 'jacket', top: '#b8402f', bottom: 'trousers', bottomColour: '#22252b' },
  { skin: '#a8714a', hair: 'puffs', hairColour: '#3b2417', cut: 'tee', top: '#e07a5f', bottom: 'trousers', bottomColour: '#9c8a63' },
  { skin: '#d7a27c', hair: 'short', hairColour: '#9a9a9a', cut: 'sweater', top: '#4f6272', bottom: 'trousers', bottomColour: '#2b3548' },
];

/** Every look code: a build and a look key, 0 to LOOK_CODES - 1. */
export const LOOK_CODES = BODY_COUNT * LOOK_KEYS;

/** Which build a person has: a pure function of the seed and the id, like the look key. */
export function bodyOf(seed: number, simId: number): number {
  return mix(((seed | 0) ^ 0x3c6ef372) + Math.trunc(simId) * 7) % BODY_COUNT;
}

export function lookCode(body: number, lookKey: number): number {
  const b = ((Math.trunc(body) % BODY_COUNT) + BODY_COUNT) % BODY_COUNT;
  const k = ((Math.trunc(lookKey) % LOOK_KEYS) + LOOK_KEYS) % LOOK_KEYS;
  return b * LOOK_KEYS + k;
}

/**
 * A person's look code: their build and their identity look key (src/sim/identity.ts), both pure
 * functions of the seed and the id, so the sprite and the panel portrait always agree.
 */
export function personLookCode(seed: number, simId: number, kind: SimKind): number {
  return lookCode(bodyOf(seed, simId), personIdentity(seed, simId, kind).lookKey);
}

export function decodeLook(code: number): { body: number; look: number } {
  const c = ((Math.trunc(code) % LOOK_CODES) + LOOK_CODES) % LOOK_CODES;
  return { body: Math.floor(c / LOOK_KEYS), look: c % LOOK_KEYS };
}

/** The cache key of one baked person. Stress is not in it: stress is a mark over the head. */
export function personKey(kind: SimKind, frame: PersonFrame, code: number): string {
  return `person:${wardrobeOf(kind)}:${code}:${canonicalFrame(frame)}`;
}

// ---------------------------------------------------------------- stress mark

export type StressMark = 'dot' | 'bang' | null;

/** A pink dot over the head in the middle band, a red exclamation in the top band, nothing when calm. */
export function stressMarkOf(band: StressBand): StressMark {
  return band === 'pink' ? 'dot' : band === 'red' ? 'bang' : null;
}

/** The mark is this wide at zoom 1. */
export const STRESS_MARK_PX = 4;
/** The mark's texture box, logical px: a 4 px mark with its 1 px outline, and the exclamation's height. */
export const MARK_W = 6;
export const MARK_H = 12;
export const MARK_COLOURS = { dot: '#ff7ad9', bang: '#ff2d2d' } as const;

/** Where a mark's box bottom sits over the feet, in px: two px above the top of the hair. */
export function markBottomAboveFeet(code: number): number {
  const { body } = decodeLook(code);
  const b = BUILDS[body] as Build;
  return SIM_H - b.top + 3;
}

export function drawStressMark(ctx: Ctx2D, mark: 'dot' | 'bang'): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const cx = MARK_W / 2;
  ctx.fillStyle = INK_CSS;
  if (mark === 'dot') {
    const cy = MARK_H - 3;
    circlePath(ctx, cx, cy, STRESS_MARK_PX / 2 + 1);
    ctx.fill();
    ctx.fillStyle = MARK_COLOURS.dot;
    circlePath(ctx, cx, cy, STRESS_MARK_PX / 2);
    ctx.fill();
    return;
  }
  // The exclamation: a tapered bar and a dot, 4 px wide, inked 1 px around.
  const bar = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx - 2 - grow, 1 - grow);
    ctx.lineTo(cx + 2 + grow, 1 - grow);
    ctx.lineTo(cx + 0.9 + grow, 7 + grow);
    ctx.lineTo(cx - 0.9 - grow, 7 + grow);
    ctx.closePath();
  };
  bar(1);
  ctx.fill();
  circlePath(ctx, cx, 9.6, 2.2);
  ctx.fill();
  ctx.fillStyle = MARK_COLOURS.bang;
  bar(0);
  ctx.fill();
  circlePath(ctx, cx, 9.6, 1.2);
  ctx.fill();
}

// ---------------------------------------------------------------- parts

type Pt = readonly [number, number];

type Part =
  | { t: 'cap'; pts: Pt[]; w: number; c: string; edge?: boolean }
  | { t: 'poly'; pts: Pt[]; c: string }
  | { t: 'circle'; x: number; y: number; r: number; c: string }
  | { t: 'seg'; x: number; y: number; r: number; from: number; to: number; c: string };

type Detail = { t: 'line'; pts: Pt[]; w: number; c: string } | { t: 'dot'; x: number; y: number; r: number; c: string } | { t: 'poly'; pts: Pt[]; c: string };

interface Figure {
  parts: Part[];
  details: Detail[];
  /** Where the hands are, in the box: the left and right of the picture. */
  hands: { left: Pt; right: Pt };
  feetY: number;
  shoulderY: number;
}

/**
 * What a person wears, as far as the baked texture cares: the four wardrobes. Everyone else's
 * role shows in what they carry (PropKind), an overlay, so one baked person serves every role.
 */
export type Wardrobe = 'casual' | 'worker' | 'staff' | 'vip';
export function wardrobeOf(kind: SimKind): Wardrobe {
  return kind === 'worker' || kind === 'staff' || kind === 'vip' ? kind : 'casual';
}
const WARDROBE_KIND: Record<Wardrobe, SimKind> = { casual: 'visitor', worker: 'worker', staff: 'staff', vip: 'vip' };

const SHOE = '#2a2a2e';
const DEG = Math.PI / 180;

/** Darken a css hex colour, for sleeve edges and shadow sides. */
export function darker(css: string, f = 0.78): string {
  const n = parseInt(css.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** A role's clothes over the look: office wear for workers, the uniform, the VIP's long coat. */
function outfitFor(kind: SimKind, look: Look): Look & { apron: boolean; coat: string | null } {
  const out = { ...look, apron: false, coat: null as string | null };
  if (kind === 'worker' && (look.cut === 'tee' || look.cut === 'hoodie')) out.cut = 'jacket';
  if (kind === 'staff') {
    out.cut = 'sweater';
    out.top = '#3f8f86';
    out.bottom = 'trousers';
    out.bottomColour = '#2f3a44';
    out.apron = true;
  }
  if (kind === 'vip') out.coat = '#b8864b';
  return out;
}

function clampX(x: number, half: number): number {
  const lo = OUTLINE_PX + half;
  const hi = SIM_W - OUTLINE_PX - half;
  return Math.min(hi, Math.max(lo, x));
}

/** The figure for one kind, look code and frame, as parts in drawing order. */
export function figureOf(kind: SimKind, code: number, frame: PersonFrame): Figure {
  const { body, look } = decodeLook(code);
  const B = BUILDS[body] as Build;
  const o = outfitFor(WARDROBE_KIND[wardrobeOf(kind)], LOOKS[look] as Look);
  const parts: Part[] = [];
  const details: Detail[] = [];
  const cx = SIM_W / 2;
  const sit = frame === FRAME.sit;
  const feetY = SIM_H - OUTLINE_PX - 1.3;

  // Vertical landmarks.
  let headCy = B.top + B.head;
  let shoulderY = headCy + B.head + 1.6;
  const legLen = (feetY - shoulderY) * 0.5;
  let hipY = feetY - legLen;
  if (sit) {
    const seat = SIM_H - 15;
    const drop = seat - hipY;
    headCy += drop;
    shoulderY += drop;
    hipY = seat;
  }
  const kneeY = sit ? hipY + 1.2 : hipY + legLen * 0.5;

  // Weight shift and mirroring.
  const shift = frame === FRAME.shiftLeft ? -0.7 : frame === FRAME.shiftRight ? 0.7 : 0;
  const mirror = frame === FRAME.strideMirrored || frame === FRAME.shiftRight;
  const mx = (x: number): number => (mirror ? 2 * cx - x : x);
  const sw = B.shoulder;
  const hw = B.hip;
  const limb = B.limb;
  const legW = Math.min(hw / 2 + 0.3, 3.2);

  // Head tilt: the glance tilts the head down toward the watch, browsing lifts it to a shelf.
  const tilt = frame === FRAME.glance ? 12 * DEG : frame === FRAME.browse ? -6 * DEG : 0;
  const neckX = cx + shift;
  const neckY = headCy + B.head;
  const rot = (x: number, y: number): Pt => {
    if (tilt === 0) return [x, y];
    const dx = x - neckX;
    const dy = y - neckY;
    return [neckX + dx * Math.cos(tilt) - dy * Math.sin(tilt), neckY + dx * Math.sin(tilt) + dy * Math.cos(tilt)];
  };
  const [hx, hy] = rot(cx + shift * 0.7, headCy);
  const r = B.head;

  // Seated: a plain chair behind the person, so a sitter never sits on air.
  if (sit) {
    const chair = '#5a6472';
    parts.push({ t: 'poly', pts: [[cx - 5.5, hipY - 0.5], [cx + 5.5, hipY - 0.5], [cx + 5.5, hipY + 1.6], [cx - 5.5, hipY + 1.6]], c: chair });
    parts.push({ t: 'cap', pts: [[cx - 4.6, hipY + 1.6], [cx - 4.6, feetY + 0.5]], w: 1.2, c: chair });
    parts.push({ t: 'cap', pts: [[cx + 4.6, hipY + 1.6], [cx + 4.6, feetY + 0.5]], w: 1.2, c: chair });
  }

  // Hair that falls behind the head and shoulders goes first.
  if (o.hair === 'long') {
    const [ax, ay] = rot(hx - r - 0.6, hy - 0.4);
    const [bx, by] = rot(hx + r + 0.6, hy - 0.4);
    parts.push({ t: 'poly', pts: [[ax, ay], [bx, by], [bx + 0.4, shoulderY + 3.5], [ax - 0.4, shoulderY + 3.5]], c: o.hairColour });
  } else if (o.hair === 'bob') {
    const [ax, ay] = rot(hx - r - 0.5, hy - 0.4);
    const [bx, by] = rot(hx + r + 0.5, hy - 0.4);
    const [cx2, cy2] = rot(hx + r + 0.6, hy + r * 0.85);
    const [dx2, dy2] = rot(hx - r - 0.6, hy + r * 0.85);
    parts.push({ t: 'poly', pts: [[ax, ay], [bx, by], [cx2, cy2], [dx2, dy2]], c: o.hairColour });
  } else if (o.hair === 'puffs') {
    // Two puffs, one each side: symmetric, like every look, so a mirrored frame reads the same.
    for (const side of [-1, 1]) {
      const [px, py] = rot(hx + side * r * 0.95, hy - r * 0.55);
      parts.push({ t: 'circle', x: clampX(px, r * 0.5), y: py, r: r * 0.5, c: o.hairColour });
    }
  }
  if (o.cut === 'hoodie') parts.push({ t: 'circle', x: neckX, y: shoulderY + 0.4, r: sw / 2 - 0.8, c: darker(o.top, 0.85) });

  // Legs, then shoes. Trousers colour the legs; under a skirt or a dress the legs are skin.
  const legColour = o.bottom === 'trousers' ? o.bottomColour : o.skin;
  const legShift = mirror ? -shift : shift; // legs are drawn unmirrored, then mirrored
  const hipL: Pt = [cx - hw / 4 + legShift, hipY];
  const hipR: Pt = [cx + hw / 4 + legShift, hipY];
  let legA: Pt[];
  let legB: Pt[];
  if (frame === FRAME.stride || frame === FRAME.strideMirrored) {
    legA = [hipL, [hipL[0] - 1.3, kneeY], [hipL[0] - 3, feetY - 0.4]];
    legB = [hipR, [hipR[0] + 1.4, kneeY + 0.5], [hipR[0] + 2.4, feetY - 1.6]];
  } else if (frame === FRAME.shiftLeft || frame === FRAME.shiftRight) {
    legA = [hipL, [hipL[0], kneeY], [hipL[0] - 0.2, feetY - 0.4]];
    legB = [hipR, [hipR[0] + 0.9, kneeY], [hipR[0] + 1.3, feetY - 1.2]];
  } else if (sit) {
    legA = [hipL, [hipL[0] - 0.8, kneeY], [hipL[0] - 0.6, feetY - 0.4]];
    legB = [hipR, [hipR[0] + 0.8, kneeY], [hipR[0] + 0.6, feetY - 0.4]];
  } else {
    legA = [hipL, [hipL[0] - 0.1, kneeY], [hipL[0] - 0.3, feetY - 0.4]];
    legB = [hipR, [hipR[0] + 0.1, kneeY], [hipR[0] + 0.3, feetY - 0.4]];
  }
  const limbPts = (pts: Pt[], half: number): Pt[] => pts.map(([x, y]) => [clampX(mx(x), half), y] as Pt);
  const legs = [limbPts(legA, legW / 2), limbPts(legB, legW / 2)];
  for (const leg of legs) parts.push({ t: 'cap', pts: leg, w: legW, c: legColour });
  for (const leg of legs) {
    const foot = leg[leg.length - 1] as Pt;
    parts.push({ t: 'cap', pts: [[clampX(foot[0] - 0.7, 1.3), foot[1] + 0.3], [clampX(foot[0] + 0.7, 1.3), foot[1] + 0.3]], w: 2.2, c: SHOE });
  }

  // Torso, and the skirt or dress below it.
  const shoulderL: Pt = [cx - sw / 2 + shift, shoulderY + 1.2];
  const torso: Pt[] = [
    shoulderL,
    [cx - sw / 2 + 1.2 + shift, shoulderY],
    [cx + sw / 2 - 1.2 + shift, shoulderY],
    [cx + sw / 2 + shift, shoulderY + 1.2],
    [cx + hw / 2 + shift, hipY + 0.6],
    [cx - hw / 2 + shift, hipY + 0.6],
  ];
  const skirtColour = o.cut === 'dress' ? o.top : o.bottom === 'skirt' ? o.bottomColour : null;
  if (skirtColour) {
    const hem = sit ? hipY + 2.6 : kneeY + 1.5;
    parts.push({ t: 'poly', pts: [[cx - hw / 2 + shift, hipY - 0.5], [cx + hw / 2 + shift, hipY - 0.5], [clampX(cx + hw / 2 + 1.6 + shift, 0), hem], [clampX(cx - hw / 2 - 1.6 + shift, 0), hem]], c: skirtColour });
  }
  parts.push({ t: 'cap', pts: [[neckX, neckY - 0.5], [neckX, shoulderY + 0.5]], w: 1.9, c: o.skin });
  parts.push({ t: 'poly', pts: torso, c: o.top });

  // The VIP's long coat: over the torso to below the knee, wider at the hem.
  if (o.coat) {
    const hem = sit ? hipY + 3 : kneeY + 3;
    parts.push({
      t: 'poly',
      pts: [
        [clampX(cx - sw / 2 - 0.4 + shift, 0), shoulderY + 1],
        [cx - sw / 2 + 1 + shift, shoulderY - 0.3],
        [cx + sw / 2 - 1 + shift, shoulderY - 0.3],
        [clampX(cx + sw / 2 + 0.4 + shift, 0), shoulderY + 1],
        [clampX(cx + hw / 2 + 2 + shift, 0), hem],
        [clampX(cx - hw / 2 - 2 + shift, 0), hem],
      ],
      c: o.coat,
    });
    details.push({ t: 'line', pts: [[cx + shift, shoulderY + 0.5], [cx + shift, hem - 0.5]], w: 0.7, c: darker(o.coat, 0.7) });
    details.push({ t: 'line', pts: [[cx - 2 + shift, shoulderY], [cx + shift, shoulderY + 4]], w: 0.7, c: darker(o.coat, 0.7) });
    details.push({ t: 'line', pts: [[cx + 2 + shift, shoulderY], [cx + shift, shoulderY + 4]], w: 0.7, c: darker(o.coat, 0.7) });
  }

  // Clothing cut details, drawn inside the torso with no outline.
  const top = o.coat ?? o.top;
  if (!o.coat) {
    if (o.cut === 'jacket') {
      details.push({ t: 'poly', pts: [[cx - 1.4 + shift, shoulderY], [cx + 1.4 + shift, shoulderY], [cx + shift, shoulderY + 4]], c: '#f4f1ea' });
      details.push({ t: 'line', pts: [[cx - 1.8 + shift, shoulderY], [cx + shift, shoulderY + 5]], w: 0.8, c: darker(o.top, 0.6) });
      details.push({ t: 'line', pts: [[cx + 1.8 + shift, shoulderY], [cx + shift, shoulderY + 5]], w: 0.8, c: darker(o.top, 0.6) });
    } else if (o.cut === 'sweater' || o.cut === 'dress') {
      details.push({ t: 'line', pts: [[cx - 1.5 + shift, shoulderY + 0.4], [cx + shift, shoulderY + 1.4], [cx + 1.5 + shift, shoulderY + 0.4]], w: 0.8, c: darker(o.top, 0.7) });
    } else if (o.cut === 'cardigan') {
      details.push({ t: 'poly', pts: [[cx - 1 + shift, shoulderY], [cx + 1 + shift, shoulderY], [cx + 1 + shift, hipY], [cx - 1 + shift, hipY]], c: '#efe6d8' });
    } else if (o.cut === 'hoodie') {
      details.push({ t: 'line', pts: [[cx - 2 + shift, hipY - 2.5], [cx + 2 + shift, hipY - 2.5]], w: 0.8, c: darker(o.top, 0.7) });
    }
    if (o.bottom === 'trousers' && o.cut !== 'dress') details.push({ t: 'line', pts: [[cx - hw / 2 + 0.4 + shift, hipY], [cx + hw / 2 - 0.4 + shift, hipY]], w: 0.9, c: darker(o.bottomColour, 0.6) });
  }
  if (o.apron) {
    details.push({ t: 'poly', pts: [[cx - hw / 2 + 0.8 + shift, shoulderY + 3.5], [cx + hw / 2 - 0.8 + shift, shoulderY + 3.5], [cx + hw / 2 + shift, hipY + 3.5], [cx - hw / 2 + shift, hipY + 3.5]], c: '#f4f1ea' });
  }

  // Head, then hair on top of it.
  parts.push({ t: 'circle', x: hx, y: hy, r, c: o.skin });
  const hairTop = (from: number, to: number, grow: number): void => {
    parts.push({ t: 'seg', x: hx, y: hy, r: r + grow, from: from + tilt, to: to + tilt, c: o.hairColour });
  };
  if (o.hair === 'short') hairTop(188 * DEG, 352 * DEG, 0.4);
  else if (o.hair === 'long' || o.hair === 'bob') hairTop(175 * DEG, 365 * DEG, 0.5);
  else if (o.hair === 'buzz') hairTop(196 * DEG, 344 * DEG, 0.2);
  else if (o.hair === 'puffs') hairTop(185 * DEG, 355 * DEG, 0.4);
  else if (o.hair === 'bun') {
    hairTop(185 * DEG, 355 * DEG, 0.4);
    const [bx, by] = rot(hx, hy - r - 0.6);
    parts.push({ t: 'circle', x: bx, y: by, r: r * 0.5, c: o.hairColour });
  } else if (o.hair === 'curly') {
    for (let a = 190; a <= 350; a += 32) {
      const ang = a * DEG + tilt;
      parts.push({ t: 'circle', x: hx + Math.cos(ang) * r * 0.8, y: hy + Math.sin(ang) * r * 0.8, r: r * 0.5, c: o.hairColour });
    }
  }

  // The face: two eyes, looking where the pose looks.
  const gaze: readonly [number, number] = frame === FRAME.glance ? [0.5, 0.7] : frame === FRAME.browse ? [0, -0.5] : [0, 0];
  for (const side of [-1, 1]) {
    const [ex, ey] = rot(hx + side * r * 0.36 + gaze[0], hy + r * 0.12 + gaze[1]);
    details.push({ t: 'dot', x: ex, y: ey, r: 0.5, c: '#1a1a1a' });
  }
  if (kind === 'vip') {
    const [ax, ay] = rot(hx - r * 0.7, hy + r * 0.1);
    const [bx, by] = rot(hx + r * 0.7, hy + r * 0.1);
    details.push({ t: 'line', pts: [[ax, ay], [bx, by]], w: 1.3, c: '#111111' }); // sunglasses
  }

  // Arms: sleeves in the top's colour, skin at the hand; a tee shows the forearm.
  const armX = sw / 2 - limb / 2 + 0.2;
  const shoulderAt = (side: -1 | 1): Pt => [cx + side * armX + shift, shoulderY + limb / 2 + 0.2];
  const midY = (shoulderY + hipY) / 2;
  const armPts = (side: -1 | 1): Pt[] => {
    const s = shoulderAt(side);
    const logical = mirror ? -side : side; // the arm's role, before the frame is mirrored
    if (sit) return [s, [s[0] + side * 0.3, midY + 1], [cx + side * 2.6 + shift, hipY - 0.6]];
    if (frame === FRAME.glance && side === 1) return [s, [s[0] + 0.6, shoulderY + 5.5], [cx + 1 + shift, shoulderY + 4.2]];
    if (frame === FRAME.browse && side === -1) return [s, [s[0] - 0.6, shoulderY - 0.5], [s[0] - 0.4, shoulderY - 5]];
    if (frame === FRAME.stride || frame === FRAME.strideMirrored) {
      // The arm opposite the leading leg swings forward (up and in), the other back.
      return logical === 1 ? [s, [s[0] - 0.2, midY - 0.5], [s[0] - 1.2 * side, hipY - 2]] : [s, [s[0] + 0.4 * side, midY + 0.3], [s[0] + 0.9 * side, hipY + 1.2]];
    }
    return [s, [s[0] + side * 0.3, midY], [s[0] + side * 0.4, hipY + 1.5]];
  };
  const hands: Record<'-1' | '1', Pt> = { '-1': [0, 0], '1': [0, 0] };
  for (const side of [-1, 1] as const) {
    const pts = armPts(side).map(([x, y]) => [clampX(x, limb / 2), y] as Pt);
    const hand = pts[pts.length - 1] as Pt;
    hands[side === -1 ? '-1' : '1'] = hand;
    const sleeve = o.cut === 'tee' && !o.coat ? pts.slice(0, 2) : pts;
    if (o.cut === 'tee' && !o.coat) parts.push({ t: 'cap', pts, w: limb * 0.9, c: o.skin, edge: true });
    parts.push({ t: 'cap', pts: sleeve, w: limb, c: top, edge: true });
    parts.push({ t: 'circle', x: clampX(hand[0], limb * 0.55), y: hand[1] + 0.3, r: limb * 0.55, c: o.skin });
  }
  if (frame === FRAME.glance) details.push({ t: 'dot', x: hands['1'][0] - 0.6, y: hands['1'][1] - 0.2, r: 0.7, c: '#e8ecf2' }); // the watch face

  return { parts, details, hands: { left: hands['-1'], right: hands['1'] }, feetY, shoulderY };
}

// ---------------------------------------------------------------- props

/** What a role carries: the worker's briefcase, the resident's bag, the guest's suitcase. */
export type PropKind = 'briefcase' | 'handbag' | 'suitcase' | 'shopping' | 'camera';
export const PROP_KINDS: readonly PropKind[] = ['briefcase', 'handbag', 'suitcase', 'shopping', 'camera'];
const PROP_OF: Partial<Record<SimKind, PropKind>> = { worker: 'briefcase', resident: 'handbag', guest: 'suitcase', shopper: 'shopping', visitor: 'camera' };

export function propOf(kind: SimKind): PropKind | null {
  return PROP_OF[kind] ?? null;
}

/** Each prop's texture box, logical px, outline included. */
export const PROP_SIZE: Record<PropKind, { w: number; h: number }> = {
  briefcase: { w: 9, h: 9 },
  handbag: { w: 8, h: 9 },
  suitcase: { w: 9, h: 18 },
  shopping: { w: 8, h: 10 },
  camera: { w: 8, h: 7 },
};

/**
 * Where a person's prop goes, as the prop box's top left in the person's 16 by 48 box, for the
 * frame drawn (mirrored frames included). A prop stays in the right hand across the walk cycle;
 * a busy hand (the glance, the reach) hands its load to the other; a sitter sets it down.
 */
export function propPlacement(kind: SimKind, code: number, frame: PersonFrame): { prop: PropKind; x: number; y: number } | null {
  const prop = propOf(kind);
  if (!prop) return null;
  const key = `${kind}|${code}|${frame}`;
  const hit = PLACEMENTS.get(key);
  if (hit) return hit;
  const placed = placeProp(prop, kind, code, frame);
  PLACEMENTS.set(key, placed);
  return placed;
}

/** Placements are a pure function of kind, look and frame: worked out once each. */
const PLACEMENTS = new Map<string, { prop: PropKind; x: number; y: number }>();

function placeProp(prop: PropKind, kind: SimKind, code: number, frame: PersonFrame): { prop: PropKind; x: number; y: number } {
  const canonical = canonicalFrame(frame);
  const f = figureOf(kind, code, canonical);
  const mirrorX = (p: Pt): Pt => (canonical !== frame ? [SIM_W - p[0], p[1]] : p);
  const right = canonical !== frame ? mirrorX(f.hands.left) : f.hands.right;
  const left = canonical !== frame ? mirrorX(f.hands.right) : f.hands.left;
  const { w, h } = PROP_SIZE[prop];
  const cx = SIM_W / 2;
  if (prop === 'camera') return { prop, x: cx - w / 2, y: f.shoulderY + 1.5 };
  if (frame === FRAME.sit) return { prop, x: SIM_W - 3, y: f.feetY + 1.4 - h };
  if (prop === 'suitcase') return { prop, x: right[0] + 0.5, y: f.feetY + 1.4 - h };
  const hand = frame === FRAME.glance ? left : right;
  return { prop, x: hand[0] - w / 2, y: hand[1] - 1 };
}

/** One prop in its PROP_SIZE box, with the 2 px outline. */
export function drawProp(ctx: Ctx2D, prop: PropKind): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const shape = (pts: readonly Pt[], fill: string): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = INK_CSS;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const rect = (x: number, y: number, w: number, h: number, fill: string): void => shape([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill);
  const strap = (pts: readonly Pt[], colour: string, width: number): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  switch (prop) {
    case 'briefcase':
      strap([[3.2, 3], [3.2, 1.6], [5.8, 1.6], [5.8, 3]], INK_CSS, 1.2);
      rect(1.5, 3, 6, 4.5, '#6b4420');
      strap([[3.5, 5], [5.5, 5]], '#c9a227', 0.8);
      return;
    case 'handbag':
      strap([[2.5, 3.5], [4, 1.2], [5.5, 3.5]], '#8a5a2b', 1);
      rect(1.5, 3.5, 5, 4.2, '#c98a45');
      return;
    case 'suitcase':
      strap([[4.5, 1.2], [4.5, 7]], '#5a6472', 1.2);
      strap([[3, 1.2], [6, 1.2]], INK_CSS, 1.4);
      rect(1.5, 7, 6, 9, '#2b5ea8');
      strap([[3, 10], [6, 10]], '#1d3f73', 0.8);
      return;
    case 'shopping':
      strap([[2.8, 3.5], [4, 1.4], [5.2, 3.5]], '#6b3a10', 1);
      shape([[1.5, 3.5], [6.5, 3.5], [6.2, 8.5], [1.8, 8.5]], '#d2761f');
      return;
    case 'camera':
      rect(1.5, 1.5, 5, 4, '#2a2a2e');
      circlePath(ctx, 4, 3.5, 1.1);
      ctx.fillStyle = '#7fb6e0';
      ctx.fill();
      return;
  }
}


// ---------------------------------------------------------------- drawing

function circlePath(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  ctx.closePath();
}

function polyPath(ctx: Ctx2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
}

function linePath(ctx: Ctx2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  if (pts.length === 1) ctx.lineTo((pts[0] as Pt)[0], (pts[0] as Pt)[1]);
}

function segPath(ctx: Ctx2D, x: number, y: number, r: number, from: number, to: number): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), from, to);
  ctx.closePath();
}

function inkPart(ctx: Ctx2D, p: Part): void {
  ctx.strokeStyle = INK_CSS;
  ctx.fillStyle = INK_CSS;
  switch (p.t) {
    case 'cap':
      ctx.lineWidth = p.w + 2 * OUTLINE_PX;
      linePath(ctx, p.pts);
      ctx.stroke();
      return;
    case 'poly':
      ctx.lineWidth = 2 * OUTLINE_PX;
      polyPath(ctx, p.pts);
      ctx.fill();
      ctx.stroke();
      return;
    case 'circle':
      circlePath(ctx, p.x, p.y, p.r + OUTLINE_PX);
      ctx.fill();
      return;
    case 'seg':
      ctx.lineWidth = 2 * OUTLINE_PX;
      segPath(ctx, p.x, p.y, p.r, p.from, p.to);
      ctx.fill();
      ctx.stroke();
      return;
  }
}

function fillPart(ctx: Ctx2D, p: Part): void {
  switch (p.t) {
    case 'cap':
      if (p.edge) {
        ctx.strokeStyle = darker(p.c, 0.62);
        ctx.lineWidth = p.w + 1;
        linePath(ctx, p.pts);
        ctx.stroke();
      }
      ctx.strokeStyle = p.c;
      ctx.lineWidth = p.w;
      linePath(ctx, p.pts);
      ctx.stroke();
      return;
    case 'poly':
      ctx.fillStyle = p.c;
      polyPath(ctx, p.pts);
      ctx.fill();
      return;
    case 'circle':
      ctx.fillStyle = p.c;
      circlePath(ctx, p.x, p.y, p.r);
      ctx.fill();
      return;
    case 'seg':
      ctx.fillStyle = p.c;
      segPath(ctx, p.x, p.y, p.r, p.from, p.to);
      ctx.fill();
      return;
  }
}

function drawDetail(ctx: Ctx2D, d: Detail): void {
  if (d.t === 'dot') {
    ctx.fillStyle = d.c;
    circlePath(ctx, d.x, d.y, d.r);
    ctx.fill();
  } else if (d.t === 'poly') {
    ctx.fillStyle = d.c;
    polyPath(ctx, d.pts);
    ctx.fill();
  } else {
    ctx.strokeStyle = d.c;
    ctx.lineWidth = d.w;
    linePath(ctx, d.pts);
    ctx.stroke();
  }
}

/** One person, in the 16 by 48 box at the context's origin. */
export function drawPerson(ctx: Ctx2D, kind: SimKind, code: number, frame: PersonFrame): void {
  const { parts, details } = figureOf(kind, code, frame);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of parts) inkPart(ctx, p);
  for (const p of parts) fillPart(ctx, p);
  for (const d of details) drawDetail(ctx, d);
}

/** The bounding box of everything a person draws, outline included, in the 16 by 48 box. */
export function figureExtents(kind: SimKind, code: number, frame: PersonFrame): { left: number; top: number; right: number; bottom: number } {
  const { parts } = figureOf(kind, code, frame);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const grow = (x: number, y: number, pad: number): void => {
    left = Math.min(left, x - pad);
    right = Math.max(right, x + pad);
    top = Math.min(top, y - pad);
    bottom = Math.max(bottom, y + pad);
  };
  for (const p of parts) {
    if (p.t === 'cap') for (const [x, y] of p.pts) grow(x, y, p.w / 2 + OUTLINE_PX);
    else if (p.t === 'poly') for (const [x, y] of p.pts) grow(x, y, OUTLINE_PX);
    else grow(p.x, p.y, p.r + OUTLINE_PX);
  }
  return { left, top, right, bottom };
}

/** Where the top of a person's head is, px down from the top of the box. */
export function headTopOf(code: number): number {
  return (BUILDS[decodeLook(code).body] as Build).top;
}

/**
 * The person panel's portrait: the same figure, standing, cropped to head and shoulders and
 * scaled to fill a `size` px square on the room wall colour.
 */
export function drawPortrait(ctx: Ctx2D, kind: SimKind, code: number, size: number): void {
  const crop = 22;
  const top = headTopOf(code) - 3.5;
  ctx.fillStyle = '#e9edf2';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / crop, size / crop);
  ctx.translate(crop / 2 - SIM_W / 2, -top);
  drawPerson(ctx, kind, code, FRAME.stand);
  ctx.restore();
}

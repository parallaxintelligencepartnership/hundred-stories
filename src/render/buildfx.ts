// Build feedback: a newly placed room drops 4 px with a 120 ms settle (docs/VISUAL.md Motion),
// puffs six 2 px specks of dust at its base that fade over 300 ms, and flashes soft white for
// 200 ms. D-14: its window band lights left to right over 360 ms, and its price rises out of it
// in the elevator indicator's face, 16 px over 900 ms, fading from 600 ms. All of it is off
// under reduced motion: the room simply appears.
//
// buildFxAt is the pure timing rule; createBuildFx binds it to the room's sprites and two layers:
// the effects layer over the rooms, and the overlay over the light layer for the price, so the
// price is never graded by the hour.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { drawLedText, ledTextWidth } from './led';

export const SETTLE_PX = 4;
export const SETTLE_MS = 120;
export const FLASH_MS = 200;
export const FLASH_ALPHA = 0.5;
export const DUST_MS = 300;
export const DUST_COUNT = 6;
const DUST_PX = 2;
const DUST_COLOUR = 0xd9d4c7;
/** D-14: the window band lights left to right over this long, easing out. */
export const REVEAL_MS = 360;
/** The unlit window band the reveal wipes away (the vacant pane colour). */
export const REVEAL_COLOUR = 0x2a3550;
/** D-14: the price rises this far over FLOAT_MS, fading out from FLOAT_FADE_MS. */
export const FLOAT_MS = 900;
export const FLOAT_FADE_MS = 600;
export const FLOAT_RISE_PX = 16;
const FLOAT_GAP_PX = 8; // the plate's foot over the room's top
const PLATE_PAD_PX = 4;
const PLATE_H_PX = 18;
const PLATE_COLOUR = 0x1c1f26;
const LED_CELL_PX = 2;
const LED_COLOUR = 0xffb347;
export const BUILD_FX_MS = 900;

/** The price a placement shows, en-US: `-$40,000`. */
export function priceLabel(cost: number): string {
  return '-$' + cost.toLocaleString('en-US');
}

export interface BuildFxFrame {
  /** How far above its resting place the room is drawn. */
  settleDy: number;
  flashAlpha: number;
  /** Each speck's offset from the room's base centre, and its alpha. */
  dust: { dx: number; dy: number; alpha: number }[];
  /** How much of the window band, from the left, is lit (0 to the room's width). */
  revealed: number;
  /** How far the price has risen, and its alpha. */
  floatDy: number;
  floatAlpha: number;
}

/** The build feedback `elapsedMs` after a room of `widthPx` lands. */
export function buildFxAt(elapsedMs: number, widthPx: number): BuildFxFrame {
  const t = Math.max(0, elapsedMs);
  const settle = Math.min(1, t / SETTLE_MS);
  const settleDy = Math.round(SETTLE_PX * (1 - settle) * (1 - settle)); // eases onto the slab
  const flashAlpha = t >= FLASH_MS ? 0 : FLASH_ALPHA * (1 - t / FLASH_MS);
  const dust: BuildFxFrame['dust'] = [];
  if (t < DUST_MS) {
    const k = t / DUST_MS;
    const half = widthPx / 2;
    for (let i = 0; i < DUST_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const lane = Math.floor(i / 2); // three pairs, from the corners inward
      const from = side * (half - 4 - lane * Math.max(4, half / 4));
      dust.push({ dx: Math.round(from + side * k * (6 + lane * 3)), dy: -Math.round(k * (4 + lane * 2)), alpha: 1 - k });
    }
  }
  const k = Math.min(1, t / REVEAL_MS);
  const revealed = widthPx * (1 - (1 - k) * (1 - k));
  const floatDy = -FLOAT_RISE_PX * Math.min(1, t / FLOAT_MS);
  const floatAlpha = t < FLOAT_FADE_MS ? 1 : Math.max(0, 1 - (t - FLOAT_FADE_MS) / (FLOAT_MS - FLOAT_FADE_MS));
  return { settleDy, flashAlpha, dust, revealed, floatDy, floatAlpha };
}

/** One floor's window band, in world pixels. */
export interface RevealBand {
  y: number;
  h: number;
}

export interface BuildFx {
  /**
   * Play the feedback on a room just placed. `nodes` are the sprites that settle (room and slab);
   * `bands` each floor's window band (none for a kind without one); `label` the price to float,
   * centred over `over` when given (the union of rooms placed together, which share one price)
   * and over this room otherwise.
   */
  start(nodes: Sprite[], x: number, y: number, w: number, h: number, bands?: readonly RevealBand[], label?: string, over?: { x: number; y: number; w: number }): void;
  /** Advance by `dtMs` of real time. */
  update(dtMs: number): void;
  /** Drop every running effect at once, leaving the rooms where they rest. */
  clear(): void;
  /** How many effects are running, for the tests. */
  count(): number;
}

interface Running {
  nodes: Sprite[];
  rest: number[];
  x: number;
  y: number;
  w: number;
  h: number;
  t: number;
  root: Container;
  flash: Sprite;
  dust: Sprite[];
  bands: readonly RevealBand[];
  covers: Sprite[];
  floater: Graphics | null;
  floaterY: number;
}

export function createBuildFx(layer: Container, floaterLayer: Container = layer): BuildFx {
  const running: Running[] = [];

  function finish(r: Running): void {
    r.nodes.forEach((n, i) => {
      if (!n.destroyed) n.y = r.rest[i] ?? n.y;
    });
    r.root.destroy({ children: true });
    r.floater?.destroy();
  }

  function apply(r: Running): void {
    const f = buildFxAt(r.t, r.w);
    r.nodes.forEach((n, i) => {
      if (!n.destroyed) n.y = (r.rest[i] ?? n.y) - f.settleDy;
    });
    r.flash.position.set(r.x, r.y - f.settleDy);
    r.flash.alpha = f.flashAlpha;
    r.flash.visible = f.flashAlpha > 0;
    r.dust.forEach((s, i) => {
      const d = f.dust[i];
      s.visible = d !== undefined;
      if (!d) return;
      s.position.set(r.x + r.w / 2 + d.dx - DUST_PX / 2, r.y + r.h + d.dy - DUST_PX);
      s.alpha = d.alpha;
    });
    const rest = r.w - f.revealed;
    r.covers.forEach((c, i) => {
      const band = r.bands[i];
      c.visible = band !== undefined && rest > 0;
      if (!band || rest <= 0) return;
      c.position.set(r.x + f.revealed, band.y - f.settleDy);
      c.setSize(rest, band.h);
    });
    if (r.floater) {
      r.floater.y = r.floaterY + f.floatDy;
      r.floater.alpha = f.floatAlpha;
    }
  }

  return {
    start(nodes, x, y, w, h, bands = [], label = '', over = { x, y, w }) {
      const root = new Container();
      const flash = new Sprite(Texture.WHITE);
      flash.setSize(w, h);
      flash.tint = 0xffffff;
      const dust: Sprite[] = [];
      for (let i = 0; i < DUST_COUNT; i++) {
        const s = new Sprite(Texture.WHITE);
        s.setSize(DUST_PX, DUST_PX);
        s.tint = DUST_COLOUR;
        dust.push(s);
      }
      const covers = bands.map(() => {
        const c = new Sprite(Texture.WHITE);
        c.tint = REVEAL_COLOUR;
        return c;
      });
      root.addChild(...covers, flash, ...dust);
      layer.addChild(root);
      let floater: Graphics | null = null;
      let floaterY = 0;
      if (label) {
        const plateW = ledTextWidth(label, LED_CELL_PX) + 2 * PLATE_PAD_PX;
        floater = new Graphics().rect(0, 0, plateW, PLATE_H_PX).fill(PLATE_COLOUR);
        floater.label = `price ${label}`;
        drawLedText(floater, label, PLATE_PAD_PX, PLATE_PAD_PX, LED_CELL_PX, LED_COLOUR);
        floater.x = over.x + over.w / 2 - plateW / 2;
        floaterY = over.y - FLOAT_GAP_PX - PLATE_H_PX;
        floaterLayer.addChild(floater);
      }
      const r: Running = { nodes, rest: nodes.map((n) => n.y), x, y, w, h, t: 0, root, flash, dust, bands, covers, floater, floaterY };
      running.push(r);
      apply(r);
    },

    update(dtMs) {
      for (let i = running.length - 1; i >= 0; i--) {
        const r = running[i];
        if (!r) continue;
        r.t += Math.max(0, dtMs);
        if (r.t >= BUILD_FX_MS) {
          finish(r);
          running.splice(i, 1);
        } else {
          apply(r);
        }
      }
    },

    clear() {
      for (const r of running) finish(r);
      running.length = 0;
    },

    count() {
      return running.length;
    },
  };
}

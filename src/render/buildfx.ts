// Build feedback: a newly placed room drops 4 px with a 120 ms settle (docs/VISUAL.md Motion),
// puffs six 2 px specks of dust at its base that fade over 300 ms, and flashes soft white for
// 200 ms. All of it is off under reduced motion: the room simply appears.
//
// buildFxAt is the pure timing rule; createBuildFx binds it to the room's sprites and a layer.

import { Container, Sprite, Texture } from 'pixi.js';

export const SETTLE_PX = 4;
export const SETTLE_MS = 120;
export const FLASH_MS = 200;
export const FLASH_ALPHA = 0.5;
export const DUST_MS = 300;
export const DUST_COUNT = 6;
const DUST_PX = 2;
const DUST_COLOUR = 0xd9d4c7;
export const BUILD_FX_MS = Math.max(SETTLE_MS, FLASH_MS, DUST_MS);

export interface BuildFxFrame {
  /** How far above its resting place the room is drawn. */
  settleDy: number;
  flashAlpha: number;
  /** Each speck's offset from the room's base centre, and its alpha. */
  dust: { dx: number; dy: number; alpha: number }[];
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
  return { settleDy, flashAlpha, dust };
}

export interface BuildFx {
  /** Play the feedback on a room just placed. `nodes` are the sprites that settle (room and slab). */
  start(nodes: Sprite[], x: number, y: number, w: number, h: number): void;
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
}

export function createBuildFx(layer: Container): BuildFx {
  const running: Running[] = [];

  function finish(r: Running): void {
    r.nodes.forEach((n, i) => {
      if (!n.destroyed) n.y = r.rest[i] ?? n.y;
    });
    r.root.destroy({ children: true });
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
  }

  return {
    start(nodes, x, y, w, h) {
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
      root.addChild(flash, ...dust);
      layer.addChild(root);
      const r: Running = { nodes, rest: nodes.map((n) => n.y), x, y, w, h, t: 0, root, flash, dust };
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

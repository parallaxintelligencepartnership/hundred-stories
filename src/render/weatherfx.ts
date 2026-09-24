// The weather layers the renderer draws outside the tower: the sun's glint and the lightning
// flash in the sky layer, the distant rain sheet over the horizon bands and behind the tower,
// and the wet street band under the street line. Every rule they follow is in weather.ts; this
// file only binds them to pixi. The static parts are drawn once (the rain lattice per viewport
// size and angle, the street band per basement span); a frame moves positions and alphas.
//
// Deferred: exterior window streaks (windows are inside the room textures, package 2 owns the
// room art) and umbrellas at the entrance (package 2 owns people art).

import { Container, Graphics } from 'pixi.js';
import { TOWER_WIDTH } from '../sim/types';
import { floorTopY } from './camera';
import { TILE_PX } from './grid';
import {
  LIGHTNING_ALPHA,
  LIGHTNING_FRAMES,
  lightningDue,
  rainSheetRects,
  sheetStyle,
  wetness,
  wetStreetRects,
  WET_BAND_PX,
  type Rect,
  type WeatherView,
} from './weather';

/** The sun's glint: a warm soft disc in the upper left of the sky, 20 percent at clear noon. */
export const SUN_ALPHA = 0.2;
const SUN_COLOR = 0xfff0c0;
const SUN_RINGS = 8;
const SUN_RADIUS = 90;

/** Rain lattice: a dash every RAIN_PX_X across and RAIN_PX_Y down, staggered every other row. */
const RAIN_PX_X = 22;
const RAIN_PX_Y = 36;
const RAIN_DASH = 12;
const RAIN_COLOR = 0xd4dde8;

const STREET_DARK = 0x1e2633;
const STREET_SHEEN = 0xc4d2e2;
/** The ground floor's windows, dimly mirrored in the wet pavement under the tower. */
const STREET_MIRROR = 0x7fb6e0;
/** Past either end of the lot, like the ground in sky.ts. */
const STREET_LEFT = -200 * TILE_PX;
const STREET_RIGHT = (TOWER_WIDTH + 200) * TILE_PX;

/**
 * The tower's rectangle in world px: from the leftmost to the rightmost built tile above the
 * street, from the top of the highest floor down to the street line (y 0). Null with nothing
 * built above the street.
 */
export function towerRectOf(extents: ReadonlyMap<number, { min: number; max: number }>): Rect | null {
  let min = Infinity;
  let max = -Infinity;
  let top = -Infinity;
  for (const [floor, e] of extents) {
    if (floor < 1) continue;
    if (e.min < min) min = e.min;
    if (e.max > max) max = e.max;
    if (floor > top) top = floor;
  }
  if (top === -Infinity) return null;
  const y = floorTopY(top);
  return { x: min * TILE_PX, y, w: (max - min) * TILE_PX, h: -y };
}

/** The x span in world px of anything built below the street, or null. */
export function basementSpanOf(extents: ReadonlyMap<number, { min: number; max: number }>): { left: number; right: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const [floor, e] of extents) {
    if (floor > -1) continue;
    if (e.min < min) min = e.min;
    if (e.max > max) max = e.max;
  }
  return min === Infinity ? null : { left: min * TILE_PX, right: max * TILE_PX };
}

const EDGE_SLACK = 1e-3;

/** The tower's world rectangle on screen, rounded outward to whole pixels so no edge creeps in. */
export function towerOnScreen(tower: Rect, originX: number, originY: number, zoom: number): Rect {
  // A hair of slack before rounding, so float error on an exact pixel edge rounds outward too.
  const x0 = Math.floor(originX + tower.x * zoom - EDGE_SLACK);
  const y0 = Math.floor(originY + tower.y * zoom - EDGE_SLACK);
  const x1 = Math.ceil(originX + (tower.x + tower.w) * zoom + EDGE_SLACK);
  const y1 = Math.ceil(originY + (tower.y + tower.h) * zoom + EDGE_SLACK);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The rain sheet's clip rectangles in screen px: the view above the street, less the tower,
 * on whole pixels rounded away from the tower and the street, so a basement top on the street
 * line is never touched either.
 */
export function sheetRectsOnScreen(
  tower: Rect | null,
  originX: number,
  originY: number,
  zoom: number,
  viewW: number,
  viewH: number,
): Rect[] {
  return rainSheetRects(tower ? towerOnScreen(tower, originX, originY, zoom) : null, { x: 0, y: 0, w: viewW, h: viewH }, Math.floor(originY - EDGE_SLACK));
}

export interface WeatherFrame {
  view: WeatherView;
  seed: number;
  /** 0 by day, 1 at night (sky.ts nightness). */
  night: number;
  viewW: number;
  viewH: number;
  /** The world root's screen transform: screen = origin + world * zoom. */
  originX: number;
  originY: number;
  zoom: number;
  /** World px, from towerRectOf. */
  tower: Rect | null;
  basement: { left: number; right: number } | null;
  dtMs: number;
  reducedMotion: boolean;
}

export interface WeatherFx {
  update(frame: WeatherFrame): void;
  /** For the tests: is a flash on screen now. */
  flashing(): boolean;
  /** For the tests: the rain sheet's clip rectangles last frame, in screen px. */
  sheetRects(): readonly Rect[];
  destroy(): void;
}

export function createWeatherFx(layers: { sky: Container; sheet: Container; ground: Container }): WeatherFx {
  const sun = new Graphics();
  for (let i = SUN_RINGS; i >= 1; i--) sun.circle(0, 0, (SUN_RADIUS * i) / SUN_RINGS).fill({ color: SUN_COLOR, alpha: 1 / SUN_RINGS });
  sun.visible = false;
  const flash = new Graphics();
  flash.visible = false;
  layers.sky.addChild(sun, flash);

  const sheet = new Container();
  sheet.visible = false;
  const lattice = new Graphics();
  const mask = new Graphics();
  sheet.addChild(lattice, mask);
  lattice.mask = mask;
  layers.sheet.addChild(sheet);

  const street = new Graphics();
  street.visible = false;
  layers.ground.addChild(street);

  let latticeKey = '';
  let streetKey = '';
  let flashW = -1;
  let flashH = -1;
  let clock = 0;
  let lastFlash = -Infinity;
  let flashFrames = 0;
  let scroll = 0;
  let rects: Rect[] = [];

  function drawLattice(w: number, h: number, angleDeg: number): void {
    const key = `${w}|${h}|${angleDeg}`;
    if (key === latticeKey) return;
    latticeKey = key;
    lattice.clear();
    const rad = (angleDeg * Math.PI) / 180;
    const dx = -Math.cos(rad) * RAIN_DASH;
    const dy = Math.sin(rad) * RAIN_DASH;
    // One period of margin on every side, so any scroll offset inside a period still covers.
    for (let row = -2; row * RAIN_PX_Y < h + 2 * RAIN_PX_Y; row++) {
      const stagger = (row & 1) * (RAIN_PX_X / 2);
      for (let x = -2 * RAIN_PX_X + stagger; x < w + 2 * RAIN_PX_X; x += RAIN_PX_X) {
        const y = row * RAIN_PX_Y;
        lattice.moveTo(x, y).lineTo(x + dx, y + dy);
      }
    }
    lattice.stroke({ width: 1, color: RAIN_COLOR, alpha: 1, pixelLine: true });
  }

  function drawStreet(basement: { left: number; right: number } | null, tower: Rect | null): void {
    const key = `${basement ? `${basement.left}|${basement.right}` : 'none'}|${tower ? `${tower.x}|${tower.w}` : 'none'}`;
    if (key === streetKey) return;
    streetKey = key;
    street.clear();
    for (const r of wetStreetRects(basement, STREET_LEFT, STREET_RIGHT)) {
      street.rect(r.x, r.y, r.w, r.h).fill({ color: STREET_DARK, alpha: 0.7 });
      // Under the tower, the ground floor's panes mirrored in the wet pavement.
      if (tower) {
        const x0 = Math.max(r.x, tower.x);
        const x1 = Math.min(r.x + r.w, tower.x + tower.w);
        if (x1 > x0) street.rect(x0, r.y + 2, x1 - x0, 6).fill({ color: STREET_MIRROR, alpha: 0.3 });
      }
      // Two lighter streaks: the sheen off the wet pavement, 30 percent.
      street.rect(r.x, r.y + 3, r.w, 2).fill({ color: STREET_SHEEN, alpha: 0.3 });
      street.rect(r.x, r.y + WET_BAND_PX - 6, r.w, 2).fill({ color: STREET_SHEEN, alpha: 0.3 });
    }
  }

  return {
    update(f) {
      const dt = Math.max(0, f.dtMs);
      clock += dt;

      // Sun: clear days only, fading with the night.
      const sunAlpha = SUN_ALPHA * f.view.weights.clear * (1 - f.night);
      sun.visible = sunAlpha > 0.001;
      if (sun.visible) {
        sun.alpha = sunAlpha;
        sun.position.set(Math.round(f.viewW * 0.14), Math.round(f.viewH * 0.14));
      }

      // Lightning: the sky layer alone, two frames, never under reduced motion.
      if (flashFrames > 0) flashFrames--;
      else if (lightningDue(f.seed, clock, lastFlash, f.view.weights.storm, f.reducedMotion)) {
        lastFlash = clock;
        flashFrames = LIGHTNING_FRAMES;
      }
      if (f.reducedMotion) flashFrames = 0;
      if (flashFrames > 0 && (f.viewW !== flashW || f.viewH !== flashH)) {
        flash.clear();
        flash.rect(0, 0, f.viewW, f.viewH).fill({ color: 0xffffff, alpha: 1 });
        flashW = f.viewW;
        flashH = f.viewH;
      }
      flash.visible = flashFrames > 0;
      flash.alpha = LIGHTNING_ALPHA;

      // The distant rain sheet: behind the tower, above the horizon, never over the tower.
      const style = sheetStyle(f.view);
      sheet.visible = style.alpha > 0.001;
      if (sheet.visible) {
        drawLattice(f.viewW, f.viewH, style.angleDeg);
        if (!f.reducedMotion) scroll += (dt / 1000) * style.speed;
        if (scroll > 1e6) scroll -= 1e6;
        const rad = (style.angleDeg * Math.PI) / 180;
        const periodY = 2 * RAIN_PX_Y;
        const ox = (((-scroll * Math.cos(rad)) % RAIN_PX_X) + RAIN_PX_X) % RAIN_PX_X;
        const oy = (((scroll * Math.sin(rad)) % periodY) + periodY) % periodY;
        lattice.position.set(Math.round(ox) - RAIN_PX_X, Math.round(oy) - periodY);
        sheet.alpha = style.alpha;

        rects = sheetRectsOnScreen(f.tower, f.originX, f.originY, f.zoom, f.viewW, f.viewH);
        mask.clear();
        for (const r of rects) mask.rect(r.x, r.y, r.w, r.h);
        if (rects.length > 0) mask.fill(0xffffff);
        else sheet.visible = false;
      } else rects = [];

      // The wet street.
      const wet = wetness(f.view) * f.view.intensity;
      street.visible = wet > 0.001;
      if (street.visible) {
        drawStreet(f.basement, f.tower);
        street.alpha = wet;
      }
    },
    flashing() {
      return flash.visible;
    },
    sheetRects() {
      return rects;
    },
    destroy() {
      sun.destroy();
      flash.destroy();
      sheet.destroy({ children: true });
      street.destroy();
    },
  };
}

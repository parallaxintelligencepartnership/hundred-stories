// The weather layers the renderer draws outside the tower: the sun's glint and the lightning
// flash in the sky layer, the rain behind the tower, and the wet street band under the street
// line. Every rule they follow is in weather.ts; this file only binds them to pixi. The static
// parts are drawn once (the rain lattices per viewport size and angle, the street band per
// basement span, ground floor and doors, the rain clip per camera position); a frame moves
// positions, alphas and tints, and recycles a fixed pool of puddle ripples.
//
// The rain, the ripples and the curb's umbrellas all read rainFalling (weather.ts), so rain is
// on screen exactly when umbrellas are up. Deferred: exterior window streaks (windows are
// inside the room textures, which package 2 owns).

import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { TOWER_WIDTH } from '../sim/types';
import { floorTopY } from './camera';
import { FLOOR_PX, TILE_PX } from './grid';
import { lerpColor } from './light';
import {
  LIGHTNING_ALPHA,
  LIGHTNING_FRAMES,
  lightningDue,
  rainFalling,
  rainSheetRects,
  REDUCED_RAIN_SPEED,
  settledStreetWet,
  sheetStyle,
  stepStreetWet,
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

/**
 * The rain: up to three lattices of two-tone streaks (a pale core with a dark edge beside it,
 * so a streak reads on a bright sky and a dark one alike), each a dash every `px` across and
 * `py` down, staggered every other row. The first always shows while rain falls, the second
 * fills in between it except under reduced motion, and the third comes in with a storm.
 */
interface Lattice {
  px: number;
  py: number;
  dash: number;
  /** Offset of the whole lattice, css px, so the second sits between the first's streaks. */
  shiftX: number;
  shiftY: number;
  /** Fall speed relative to the style's, for a little depth. */
  speed: number;
  alpha: number;
}
const LATTICES: readonly Lattice[] = [
  { px: 26, py: 44, dash: 20, shiftX: 0, shiftY: 0, speed: 1, alpha: 1 },
  { px: 26, py: 44, dash: 15, shiftX: 13, shiftY: 22, speed: 0.8, alpha: 0.75 },
  { px: 20, py: 36, dash: 24, shiftX: 7, shiftY: 11, speed: 1.25, alpha: 0.9 },
];
const RAIN_CORE = 0xeef4fa;
const RAIN_EDGE = 0x2a3546;
const RAIN_WIDTH = 1.25;

const STREET_DARK = 0x121924;
const STREET_DARK_ALPHA = 0.72;
const STREET_SHEEN = 0xf0f6fc;
/** The ground floor's panes mirrored in the wet pavement: pale by day, lamp warm at night. */
const MIRROR_DAY = 0xc4dcf2;
const MIRROR_NIGHT = 0xffd27a;
/** The light spilling out of the lobby doors, pooled on the wet pavement. */
const DOOR_GLOW = 0xffcf7a;
/** Past either end of the lot, like the ground in sky.ts. */
const STREET_LEFT = -200 * TILE_PX;
const STREET_RIGHT = (TOWER_WIDTH + 200) * TILE_PX;

/** Puddle ripples where drops land on the wet street: a fixed pool, recycled. */
export const RIPPLE_MAX = 28;
const RIPPLE_LIFE_MS = 650;
/** Below this zoom a ripple is under two screen pixels, so none are drawn. */
const RIPPLE_MIN_ZOOM = 0.35;

/** Each built floor above the street as a world px rectangle, one per floor. */
export function floorRectsOf(extents: ReadonlyMap<number, { min: number; max: number }>): Rect[] {
  const out: Rect[] = [];
  for (const [floor, e] of extents) {
    if (floor < 1 || e.max <= e.min) continue;
    out.push({ x: e.min * TILE_PX, y: floorTopY(floor), w: (e.max - e.min) * TILE_PX, h: FLOOR_PX });
  }
  return out;
}

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
 * The rain sheet's clip rectangles in screen px: the view above the street, less every built
 * floor (or one tower rectangle), each rounded outward to whole pixels, so a basement top on
 * the street line is never touched either.
 */
export function sheetRectsOnScreen(
  floors: readonly Rect[] | Rect | null,
  originX: number,
  originY: number,
  zoom: number,
  viewW: number,
  viewH: number,
): Rect[] {
  const list: readonly Rect[] = floors === null ? [] : Array.isArray(floors) ? floors : [floors as Rect];
  const onScreen = list.map((r) => towerOnScreen(r, originX, originY, zoom));
  return rainSheetRects(onScreen, { x: 0, y: 0, w: viewW, h: viewH }, Math.floor(originY - EDGE_SLACK));
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
  /** World px, one rectangle per built floor above the street (floorRectsOf). */
  floors: readonly Rect[];
  basement: { left: number; right: number } | null;
  /** The ground lobby's two doors, world px (curb.ts lobbyDoors), or null. */
  doors: { left: number; right: number } | null;
  /** The sky's color this frame, weather graded, for its reflection in the wet street. */
  skyColor: number;
  dtMs: number;
  reducedMotion: boolean;
}

export interface WeatherFx {
  update(frame: WeatherFrame): void;
  /** For the tests: is a flash on screen now. */
  flashing(): boolean;
  /** For the tests: the rain sheet's clip rectangles last frame, in screen px. */
  sheetRects(): readonly Rect[];
  /** For the tests: the rain's opacity, how many streak lattices show, and their speed, last frame. */
  rain(): { alpha: number; lattices: number; speed: number };
  /** For the tests: how wet the street is, 0 to 1, and its drawn opacity. */
  street(): { wet: number; alpha: number };
  /** For the tests: the world px centres of the ripples showing now. */
  ripplePoints(): { x: number; y: number }[];
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
  const drops = new Container();
  const lattices = LATTICES.map(() => new Graphics());
  drops.addChild(...lattices);
  const mask = new Graphics();
  sheet.addChild(drops, mask);
  drops.mask = mask;
  layers.sheet.addChild(sheet);

  const street = new Container();
  street.visible = false;
  const dark = new Graphics();
  const skyMirror = new Graphics();
  const windows = new Graphics();
  const glow = new Graphics();
  const sheen = new Graphics();
  const rippleLayer = new Container();
  street.addChild(dark, skyMirror, windows, glow, sheen, rippleLayer);
  layers.ground.addChild(street);

  // One ripple shape shared by the whole pool; a frame only moves, scales and fades them.
  const rippleShape = new GraphicsContext().ellipse(0, 0, 7, 2).stroke({ width: 1, color: 0xe8f0f8, alpha: 1 });
  const ripples: Graphics[] = [];
  const rippleAge = new Float64Array(RIPPLE_MAX);
  /** 0 for a ripple not yet placed. */
  const rippleLife = new Float64Array(RIPPLE_MAX);
  for (let i = 0; i < RIPPLE_MAX; i++) {
    const g = new Graphics(rippleShape);
    g.visible = false;
    ripples.push(g);
    rippleLayer.addChild(g);
  }
  let bandRects: Rect[] = [];
  let rand = 0x2545f491;
  const random = (): number => {
    rand = (Math.imul(rand, 1664525) + 1013904223) >>> 0;
    return rand / 4294967296;
  };

  let latticeKey = '';
  let streetKey = '';
  let flashW = -1;
  let flashH = -1;
  let clock = 0;
  let lastFlash = -Infinity;
  let flashFrames = 0;
  let scroll = 0;
  let rects: Rect[] = [];
  let clipFloors: readonly Rect[] | null = null;
  let clipX = NaN;
  let clipY = NaN;
  let clipZoom = NaN;
  let clipW = -1;
  let clipH = -1;
  let wet = -1;
  let rainAlpha = 0;
  let rainLattices = 0;
  let rainSpeed = 0;

  function drawLattices(w: number, h: number, angleDeg: number): void {
    const key = `${w}|${h}|${angleDeg}`;
    if (key === latticeKey) return;
    latticeKey = key;
    const rad = (angleDeg * Math.PI) / 180;
    LATTICES.forEach((spec, i) => {
      const g = lattices[i] as Graphics;
      g.clear();
      const dx = -Math.cos(rad) * spec.dash;
      const dy = Math.sin(rad) * spec.dash;
      // Two periods of margin on every side, so any scroll offset inside a period still covers.
      const streaks = (ox: number): void => {
        for (let row = -2; row * spec.py < h + 2 * spec.py; row++) {
          const stagger = (row & 1) * (spec.px / 2);
          for (let x = -2 * spec.px + stagger; x < w + 2 * spec.px; x += spec.px) {
            const y = row * spec.py;
            g.moveTo(x + ox, y).lineTo(x + ox + dx, y + dy);
          }
        }
      };
      streaks(1);
      g.stroke({ width: RAIN_WIDTH, color: RAIN_EDGE, alpha: 0.6 });
      streaks(0);
      g.stroke({ width: RAIN_WIDTH, color: RAIN_CORE, alpha: 1 });
    });
  }

  function drawStreet(f: WeatherFrame): void {
    const ground = f.floors.find((r) => r.y + r.h === 0) ?? null;
    const b = f.basement;
    const d = f.doors;
    const key = `${b ? `${b.left}|${b.right}` : 'none'}|${ground ? `${ground.x}|${ground.w}` : 'none'}|${d ? `${d.left}|${d.right}` : 'none'}`;
    if (key === streetKey) return;
    streetKey = key;
    for (const g of [dark, skyMirror, windows, glow, sheen]) g.clear();
    bandRects = wetStreetRects(b, STREET_LEFT, STREET_RIGHT);
    const H = WET_BAND_PX;
    for (const r of bandRects) {
      dark.rect(r.x, r.y, r.w, r.h).fill({ color: STREET_DARK, alpha: STREET_DARK_ALPHA });
      // The sky mirrored in the water, brightest at the curb and fading down the band; drawn in
      // white and tinted with the sky's color each frame.
      skyMirror.rect(r.x, r.y, r.w, 3).fill({ color: 0xffffff, alpha: 0.5 });
      skyMirror.rect(r.x, r.y + 3, r.w, 5).fill({ color: 0xffffff, alpha: 0.3 });
      skyMirror.rect(r.x, r.y + 8, r.w, 7).fill({ color: 0xffffff, alpha: 0.14 });
      // Gloss: broken highlight streaks across the pavement.
      for (const [y, on, off, phase] of [
        [r.y + 2, 26, 12, 0],
        [r.y + Math.round(H * 0.55), 18, 22, 9],
        [r.y + H - 4, 34, 16, 20],
      ] as const) {
        const period = on + off;
        for (let x = Math.floor((r.x - phase) / period) * period + phase; x < r.x + r.w; x += period) {
          const x0 = Math.max(x, r.x);
          const x1 = Math.min(x + on, r.x + r.w);
          if (x1 > x0) sheen.rect(x0, y, x1 - x0, 1).fill({ color: STREET_SHEEN, alpha: 0.55 });
        }
      }
      // Under the ground floor, its panes mirrored upside down: a bar per tile, fading with depth.
      if (ground) {
        const x0 = Math.max(r.x, ground.x);
        const x1 = Math.min(r.x + r.w, ground.x + ground.w);
        for (let x = ground.x + 3; x + 10 <= ground.x + ground.w; x += TILE_PX) {
          const a = Math.max(x, x0);
          const z = Math.min(x + 10, x1);
          if (z <= a) continue;
          windows.rect(a, r.y + 1, z - a, 6).fill({ color: 0xffffff, alpha: 0.6 });
          windows.rect(a, r.y + 7, z - a, 6).fill({ color: 0xffffff, alpha: 0.35 });
          windows.rect(a, r.y + 13, z - a, 6).fill({ color: 0xffffff, alpha: 0.15 });
        }
      }
      // The light out of each lobby door, pooled on the wet pavement just outside it.
      if (d) {
        for (const [door, out] of [
          [d.left, -1],
          [d.right, 1],
        ] as const) {
          for (const [w, a] of [
            [44, 0.2],
            [28, 0.3],
            [12, 0.45],
          ] as const) {
            const cx = door + out * 16;
            const a0 = Math.max(r.x, cx - w / 2);
            const a1 = Math.min(r.x + r.w, cx + w / 2);
            if (a1 > a0) glow.rect(a0, r.y, a1 - a0, H - 4).fill({ color: DOOR_GLOW, alpha: a });
          }
        }
      }
    }
  }

  /** Place ripple i on the visible wet band, world px; false if none of the band is in view. */
  function spawnRipple(i: number, viewLeft: number, viewRight: number, reduced: boolean): boolean {
    let total = 0;
    for (const r of bandRects) total += Math.max(0, Math.min(r.x + r.w, viewRight) - Math.max(r.x, viewLeft));
    if (total <= 0) return false;
    let at = random() * total;
    for (const r of bandRects) {
      const x0 = Math.max(r.x, viewLeft);
      const len = Math.max(0, Math.min(r.x + r.w, viewRight) - x0);
      if (at > len) {
        at -= len;
        continue;
      }
      const g = ripples[i] as Graphics;
      const x = len > 16 ? Math.min(len - 8, Math.max(8, at)) : len / 2;
      g.position.set(Math.round(x0 + x), Math.round(r.y + 4 + random() * (WET_BAND_PX - 8)));
      const fresh = rippleLife[i] === 0;
      rippleLife[i] = RIPPLE_LIFE_MS * (reduced ? 3 : 0.75 + random() * 0.5);
      // The first wave starts part way through, so the pool never pulses in step.
      rippleAge[i] = fresh ? random() * (rippleLife[i] as number) : 0;
      return true;
    }
    return false;
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

      // The rain: behind the tower, above the street, never over a built floor. It shows exactly
      // when rainFalling says so, the same test the umbrellas use.
      const style = sheetStyle(f.view);
      rainAlpha = style.alpha;
      rainLattices = 0;
      rainSpeed = 0;
      sheet.visible = style.alpha > 0;
      if (sheet.visible) {
        drawLattices(f.viewW, f.viewH, style.angleDeg);
        rainSpeed = style.speed * (f.reducedMotion ? REDUCED_RAIN_SPEED : 1);
        scroll += (dt / 1000) * rainSpeed;
        if (scroll > 1e6) scroll -= 1e6;
        const rad = (style.angleDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        for (let i = 0; i < LATTICES.length; i++) {
          const spec = LATTICES[i] as Lattice;
          const g = lattices[i] as Graphics;
          // Reduced motion: fewer streaks (the first lattice, and the storm's at half), never none.
          const weight = i === 0 ? 1 : i === 1 ? (f.reducedMotion ? 0 : 1) : style.storm * (f.reducedMotion ? 0.5 : 1);
          g.visible = weight > 0.01;
          if (!g.visible) continue;
          rainLattices++;
          g.alpha = spec.alpha * weight;
          const s = scroll * spec.speed;
          const periodY = 2 * spec.py;
          const ox = (((spec.shiftX - s * cos) % spec.px) + spec.px) % spec.px;
          const oy = (((spec.shiftY + s * sin) % periodY) + periodY) % periodY;
          g.position.set(Math.round(ox) - spec.px, Math.round(oy) - periodY);
        }
        sheet.alpha = style.alpha;

        // The clip moves only with the camera, the viewport or what is built.
        if (f.floors !== clipFloors || f.originX !== clipX || f.originY !== clipY || f.zoom !== clipZoom || f.viewW !== clipW || f.viewH !== clipH) {
          clipFloors = f.floors;
          clipX = f.originX;
          clipY = f.originY;
          clipZoom = f.zoom;
          clipW = f.viewW;
          clipH = f.viewH;
          rects = sheetRectsOnScreen(f.floors, f.originX, f.originY, f.zoom, f.viewW, f.viewH);
          mask.clear();
          for (const r of rects) mask.rect(r.x, r.y, r.w, r.h);
          if (rects.length > 0) mask.fill(0xffffff);
        }
        if (rects.length === 0) sheet.visible = false;
      }

      // The wet street: soaks while rain falls, lingers and dries after it stops.
      wet = wet < 0 ? settledStreetWet(f.view) : stepStreetWet(wet, f.view, dt);
      street.visible = wet > 0.001;
      if (street.visible) {
        drawStreet(f);
        street.alpha = wet;
        skyMirror.tint = f.skyColor;
        windows.tint = lerpColor(MIRROR_DAY, MIRROR_NIGHT, f.night);
        glow.alpha = 0.35 + 0.65 * f.night;
      }

      // Ripples where the drops land: only while rain falls, on the wet band in view.
      const falling = rainFalling(f.view);
      const want =
        street.visible && falling > 0 && f.zoom >= RIPPLE_MIN_ZOOM
          ? Math.round(RIPPLE_MAX * falling * (0.6 + 0.4 * style.storm) * (f.reducedMotion ? 0.5 : 1))
          : 0;
      const viewLeft = -f.originX / f.zoom;
      const viewRight = (f.viewW - f.originX) / f.zoom;
      for (let i = 0; i < RIPPLE_MAX; i++) {
        const g = ripples[i] as Graphics;
        if (i >= want) {
          g.visible = false;
          rippleLife[i] = 0;
          continue;
        }
        rippleAge[i] = (rippleAge[i] as number) + dt;
        if (rippleLife[i] === 0 || (rippleAge[i] as number) >= (rippleLife[i] as number)) {
          if (!spawnRipple(i, viewLeft, viewRight, f.reducedMotion)) {
            g.visible = false;
            rippleLife[i] = 0;
            continue;
          }
        }
        const t = (rippleAge[i] as number) / (rippleLife[i] as number);
        g.visible = true;
        g.scale.set(0.35 + 1.05 * t);
        g.alpha = 0.9 * (1 - t);
      }
    },
    flashing() {
      return flash.visible;
    },
    sheetRects() {
      return rects;
    },
    rain() {
      return { alpha: sheet.visible ? rainAlpha : 0, lattices: sheet.visible ? rainLattices : 0, speed: sheet.visible ? rainSpeed : 0 };
    },
    street() {
      return { wet: Math.max(0, wet), alpha: street.visible ? street.alpha : 0 };
    },
    ripplePoints() {
      const out: { x: number; y: number }[] = [];
      for (const g of ripples) if (g.visible && street.visible) out.push({ x: g.position.x, y: g.position.y });
      return out;
    },
    destroy() {
      sun.destroy();
      flash.destroy();
      sheet.destroy({ children: true });
      street.destroy({ children: true });
      rippleShape.destroy();
    },
  };
}

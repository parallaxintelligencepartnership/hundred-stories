// Sky, horizon strip and the ground.
//
// Palette per the corrected "Color (world, procedural art)" section of docs/VISUAL.md
// (2026-09-19): the world reads like the original SimTower, bright, flat and daytime
// dominant. Day holds a flat gradient for most of the day, dawn and dusk are short
// one hour transitions, night is deep blue and never black.
//
// Nothing here touches world.rng: the horizon uses its own seeded generator so the
// simulation stays reproducible.

import { Container, FillGradient, Graphics } from 'pixi.js';
import { createRng } from '../sim/rng';
import { MIN_FLOOR, TOWER_WIDTH } from '../sim/types';
import { FLOOR_PX, LINE_PX, TILE_PX } from './art';
import { floorBaseY } from './camera';

export interface SkyColors {
  top: number;
  bottom: number;
}

interface Keyframe {
  minute: number;
  top: number;
  bottom: number;
}

const NIGHT_TOP = 0x0d1b3d;
const NIGHT_BOTTOM = 0x1c2f5c;
const DAY_TOP = 0x9fd3f5;
const DAY_BOTTOM = 0xdcefff;
const DAWN_BOTTOM = 0xf6b98a;
const DUSK_BOTTOM = 0xe08a7a;

// Flat day for most of the day, one hour of dawn and one hour of dusk.
const KEYFRAMES: readonly Keyframe[] = [
  { minute: 0, top: NIGHT_TOP, bottom: NIGHT_BOTTOM },
  { minute: 5 * 60 + 30, top: NIGHT_TOP, bottom: NIGHT_BOTTOM },
  { minute: 6 * 60, top: 0x9ab6d8, bottom: DAWN_BOTTOM },
  { minute: 6 * 60 + 30, top: DAY_TOP, bottom: DAY_BOTTOM },
  { minute: 18 * 60, top: DAY_TOP, bottom: DAY_BOTTOM },
  { minute: 18 * 60 + 30, top: 0xa3aecb, bottom: DUSK_BOTTOM },
  { minute: 19 * 60, top: NIGHT_TOP, bottom: NIGHT_BOTTOM },
  { minute: 24 * 60, top: NIGHT_TOP, bottom: NIGHT_BOTTOM },
];

const CITY_MARGIN = 200 * TILE_PX; // past either end of the lot
const CITY_LEFT = -CITY_MARGIN;
const CITY_RIGHT = TOWER_WIDTH * TILE_PX + CITY_MARGIN;
const HORIZON_PARALLAX = 0.35;

/** One low distant skyline, three tiles at most, no tall silhouettes and no haze. */
const SKYLINE_HEIGHT = 3 * TILE_PX;
const SKYLINE_BASE = (3 * TILE_PX) / 8; // the continuous strip every rooftop stands on
const SKYLINE_COLOR = 0xb9cfe0;

const CONCRETE_COLOR = 0x6b6f78;
const CONCRETE_LINE = 0x4c5058;
const SIDEWALK_COLOR = 0x343a44;
const STREET_EDGE_COLOR = 0x6b7482;

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Sky gradient for a minute of day, interpolated between the keyframes. */
export function skyAt(minuteOfDay: number): SkyColors {
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    const a = KEYFRAMES[i] as Keyframe;
    const b = KEYFRAMES[i + 1] as Keyframe;
    if (minute >= a.minute && minute <= b.minute) {
      const t = (minute - a.minute) / (b.minute - a.minute);
      return { top: lerpColor(a.top, b.top, t), bottom: lerpColor(a.bottom, b.bottom, t) };
    }
  }
  const last = KEYFRAMES[KEYFRAMES.length - 1] as Keyframe;
  return { top: last.top, bottom: last.bottom };
}

/** The canvas clear color: the top of the sky gradient. */
export function skyBackground(minuteOfDay: number): number {
  return skyAt(minuteOfDay).top;
}

/** 0 in daylight, 1 at night, ramped across the dawn and dusk hours. */
export function nightness(minuteOfDay: number): number {
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  if (minute < 5 * 60 + 45) return 1;
  if (minute < 6 * 60 + 30) return 1 - (minute - (5 * 60 + 45)) / 45;
  if (minute < 18 * 60) return 0;
  if (minute < 18 * 60 + 45) return (minute - 18 * 60) / 45;
  return 1;
}

/** Rooms show lit windows once it is dark enough. */
export function isNight(minuteOfDay: number): boolean {
  return nightness(minuteOfDay) >= 0.5;
}

export interface SkyLayers {
  sky: Container;
  cityFar: Container;
  cityNear: Container;
  ground: Container;
}

export interface Sky {
  update(minuteOfDay: number, cam: { x: number; y: number; zoom: number }, viewW: number, viewH: number): void;
  destroy(): void;
}

/** A three tile band of distant rooftops standing on the ground line. */
function buildSkyline(parent: Container): Graphics {
  const rng = createRng(0x5eed1);
  const g = new Graphics();
  g.rect(CITY_LEFT, -SKYLINE_BASE, CITY_RIGHT - CITY_LEFT, SKYLINE_BASE).fill(SKYLINE_COLOR);
  // Widths, heights and gaps were drawn in eighths of a tile on the 0.3 grid; the same draws,
  // scaled to the tile, keep the skyline's rhythm now that a tile is twice the pixels.
  const unit = TILE_PX / 8;
  let x = CITY_LEFT;
  while (x < CITY_RIGHT) {
    const width = rng.int(26, 90) * unit;
    const height = rng.int(9, SKYLINE_HEIGHT / unit) * unit;
    g.rect(x, -height, width, height).fill(SKYLINE_COLOR);
    x += width + rng.int(0, 6) * unit;
  }
  parent.addChild(g);
  return g;
}

/**
 * Below the street: flat concrete with a line at every underground slab, so a
 * player can see where B1 to B10 sit before anything is built.
 */
function buildGround(ground: Container): Graphics {
  const g = new Graphics();
  const left = CITY_LEFT;
  const width = CITY_RIGHT - CITY_LEFT;
  const depth = floorBaseY(MIN_FLOOR) + FLOOR_PX * 2;

  g.rect(left, 0, width, depth).fill(CONCRETE_COLOR);
  for (let floor = -1; floor >= MIN_FLOOR; floor--) {
    g.rect(left, floorBaseY(floor) - LINE_PX, width, LINE_PX).fill(CONCRETE_LINE);
  }
  g.rect(left, 0, width, 3 * LINE_PX).fill(SIDEWALK_COLOR);
  // The street edge: where the ground floor can be built, visible with an empty lot.
  g.rect(left, 0, width, LINE_PX).fill(STREET_EDGE_COLOR);
  ground.addChild(g);
  return g;
}

export function createSky(layers: SkyLayers): Sky {
  const gradient = new Graphics();
  layers.sky.addChild(gradient);
  const skyline = buildSkyline(layers.cityFar);
  const ground = buildGround(layers.ground);

  let lastMinute = -1;
  let lastW = -1;
  let lastH = -1;
  let lastTop = NaN;
  let lastBottom = NaN;
  // The gradient on screen now. A FillGradient owns a texture, so the old one is destroyed once
  // the new one is drawn, or every colour change would leak one.
  let fill: FillGradient | null = null;

  function redrawGradient(top: number, bottom: number, viewW: number, viewH: number): void {
    const next = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: top },
        { offset: 1, color: bottom },
      ],
    });
    gradient.clear();
    gradient.rect(0, 0, viewW, viewH).fill(next);
    fill?.destroy();
    fill = next;
  }

  return {
    update(minuteOfDay, cam, viewW, viewH): void {
      const colors = skyAt(minuteOfDay);
      if (colors.top !== lastTop || colors.bottom !== lastBottom || viewW !== lastW || viewH !== lastH) {
        redrawGradient(colors.top, colors.bottom, viewW, viewH);
        lastTop = colors.top;
        lastBottom = colors.bottom;
        lastW = viewW;
        lastH = viewH;
      }

      const rounded = Math.round(minuteOfDay);
      if (rounded !== lastMinute) {
        // The horizon settles toward the night sky instead of glowing after dark.
        skyline.tint = lerpColor(0xffffff, 0x5c6f96, nightness(minuteOfDay));
        lastMinute = rounded;
      }

      layers.cityFar.scale.set(cam.zoom);
      layers.cityFar.position.set(viewW / 2 - cam.x * cam.zoom * HORIZON_PARALLAX, viewH / 2 - cam.y * cam.zoom);
    },
    destroy(): void {
      gradient.destroy();
      fill?.destroy();
      fill = null;
      skyline.destroy();
      ground.destroy();
    },
  };
}

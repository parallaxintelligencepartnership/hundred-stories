// Sky, city silhouettes and the ground line.
//
// The sky is a screen space gradient interpolated between the four keyframes in
// docs/VISUAL.md. The two city bands sit behind the tower and parallax in x only,
// so the ground line always meets the tower's floor 1 slab. Their windows light up
// at night by fading a prebuilt window layer in.
//
// Nothing here touches world.rng: the skyline uses its own seeded generator so the
// simulation stays reproducible.

import { Container, FillGradient, Graphics } from 'pixi.js';
import { createRng } from '../sim/rng';
import { MIN_FLOOR, TOWER_WIDTH } from '../sim/types';
import { FLOOR_PX, TILE_PX } from './art';
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

// "A over B" in VISUAL reads top over bottom.
const KEYFRAMES: readonly Keyframe[] = [
  { minute: 0, top: 0x070b1a, bottom: 0x070b1a }, // night
  { minute: 6 * 60, top: 0xf0a070, bottom: 0x4a5a9a }, // dawn
  { minute: 12 * 60, top: 0x8fc4f0, bottom: 0xd8ecfa }, // day
  { minute: 18 * 60, top: 0xf06a4a, bottom: 0x2a2f6a }, // dusk
  { minute: 24 * 60, top: 0x070b1a, bottom: 0x070b1a }, // night again
];

const CITY_LEFT = -1600;
const CITY_RIGHT = TOWER_WIDTH * TILE_PX + 1600;
const FAR_PARALLAX = 0.35;
const NEAR_PARALLAX = 0.6;

const EARTH_COLOR = 0x2a2016;
const SIDEWALK_COLOR = 0x343a44;
const STREET_EDGE_COLOR = 0x6b7482;
const WINDOW_WARM = 0xffd27a;

// The backdrop sits well under the tower: lower, softer, hazier.
const FAR_ALPHA = 0.45;
const NEAR_ALPHA = 0.7;
const FAR_MAX_HEIGHT = 126; // 60 percent of the old far band
const NEAR_MAX_HEIGHT = 247; // 75 percent of the old near band

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

/** Sky gradient for a minute of day, interpolated between the four keyframes. */
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

/** 0 in broad daylight, 1 in the dead of night, ramped across dusk and dawn. */
export function nightness(minuteOfDay: number): number {
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  if (minute < 5 * 60 + 30) return 1;
  if (minute < 7 * 60) return 1 - (minute - (5 * 60 + 30)) / 90;
  if (minute < 17 * 60 + 30) return 0;
  if (minute < 19 * 60 + 30) return (minute - (17 * 60 + 30)) / 120;
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

interface CityBand {
  silhouette: Graphics;
  windows: Graphics;
}

function buildCity(
  parent: Container,
  seed: number,
  options: { color: number; minHeight: number; maxHeight: number; minWidth: number; maxWidth: number; windows: boolean },
): CityBand {
  const rng = createRng(seed);
  const silhouette = new Graphics();
  const windows = new Graphics();
  let x = CITY_LEFT;
  while (x < CITY_RIGHT) {
    const width = rng.int(options.minWidth, options.maxWidth);
    const height = rng.int(options.minHeight, options.maxHeight);
    silhouette.rect(x, -height, width, height).fill(options.color);
    if (options.windows) {
      // Irregular per building: the backdrop must not read as graph paper.
      const stepX = rng.int(8, 14);
      const stepY = rng.int(11, 17);
      const density = 0.16 + rng.next() * 0.12;
      const inset = rng.int(3, 6);
      for (let wx = x + inset; wx + 2 <= x + width - inset; wx += stepX) {
        for (let wy = -height + rng.int(7, 12); wy + 2 <= -6; wy += stepY) {
          if (rng.next() > density) continue;
          windows.rect(wx, wy, 2, 2).fill(WINDOW_WARM);
        }
      }
    } else {
      const dots = Math.max(1, Math.floor(width / 34));
      for (let d = 0; d < dots; d++) {
        if (rng.next() > 0.4) continue;
        windows.rect(x + rng.int(3, Math.max(4, width - 5)), -rng.int(8, Math.max(9, height - 4)), 2, 2).fill(WINDOW_WARM);
      }
    }
    x += width + rng.int(2, 14);
  }
  windows.alpha = 0;
  parent.addChild(silhouette);
  parent.addChild(windows);
  return { silhouette, windows };
}

/**
 * The lot below the street: a sidewalk band, layered soil with a floor guide at
 * every underground slab, and a speckle so it reads as earth rather than a void.
 * It stays far darker than any room so the tower keeps the eye.
 */
function buildGround(ground: Container): Graphics {
  const g = new Graphics();
  const left = CITY_LEFT;
  const width = CITY_RIGHT - CITY_LEFT;
  const depth = floorBaseY(MIN_FLOOR) + FLOOR_PX * 2;

  g.rect(left, 0, width, depth).fill(EARTH_COLOR);
  // Soil darkens with depth.
  for (let band = 0; band * FLOOR_PX < depth; band++) {
    const y = band * FLOOR_PX;
    const shade = Math.min(0.28, band * 0.022);
    g.rect(left, y, width, FLOOR_PX).fill({ color: 0x000000, alpha: shade });
  }
  // A guide at every underground slab line, so B1 to B10 are readable before anything is built.
  for (let floor = -1; floor >= MIN_FLOOR; floor--) {
    g.rect(left, floorBaseY(floor) - 1, width, 1).fill({ color: 0xffffff, alpha: 0.08 });
  }
  // Speckle.
  const rng = createRng(0x50112);
  for (let i = 0; i < 1400; i++) {
    const sx = left + rng.next() * width;
    const sy = rng.next() * depth;
    const light = rng.next() > 0.5;
    g.rect(Math.round(sx), Math.round(sy), 1, rng.next() > 0.8 ? 2 : 1).fill({
      color: light ? 0xffffff : 0x000000,
      alpha: light ? 0.05 : 0.12,
    });
  }

  g.rect(left, 0, width, 6).fill(SIDEWALK_COLOR);
  // The street edge: where the ground floor can be built, visible with an empty lot.
  g.rect(left, 0, width, 2).fill(STREET_EDGE_COLOR);
  ground.addChild(g);
  return g;
}

export function createSky(layers: SkyLayers): Sky {
  const gradient = new Graphics();
  layers.sky.addChild(gradient);

  const far = buildCity(layers.cityFar, 0x5eed1, {
    color: 0x1d2740,
    minHeight: 42,
    maxHeight: FAR_MAX_HEIGHT,
    minWidth: 40,
    maxWidth: 120,
    windows: false,
  });
  // Haze sits on top of the far band only, so distance reads as atmosphere.
  const haze = new Graphics();
  haze.rect(CITY_LEFT, -FAR_MAX_HEIGHT, CITY_RIGHT - CITY_LEFT, FAR_MAX_HEIGHT).fill(0xffffff);
  haze.alpha = 0.35;
  layers.cityFar.addChild(haze);
  layers.cityFar.alpha = FAR_ALPHA;

  const near = buildCity(layers.cityNear, 0x13a7c3, {
    color: 0x121a2b,
    minHeight: 82,
    maxHeight: NEAR_MAX_HEIGHT,
    minWidth: 56,
    maxWidth: 150,
    windows: true,
  });
  layers.cityNear.alpha = NEAR_ALPHA;
  const ground = buildGround(layers.ground);

  let lastMinute = -1;
  let lastW = -1;
  let lastH = -1;

  function redrawGradient(minuteOfDay: number, viewW: number, viewH: number): void {
    const colors = skyAt(minuteOfDay);
    const fill = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: colors.top },
        { offset: 1, color: colors.bottom },
      ],
    });
    gradient.clear();
    gradient.rect(0, 0, viewW, viewH).fill(fill);
  }

  return {
    update(minuteOfDay, cam, viewW, viewH): void {
      const rounded = Math.round(minuteOfDay);
      if (rounded !== lastMinute || viewW !== lastW || viewH !== lastH) {
        redrawGradient(minuteOfDay, viewW, viewH);
        const lit = nightness(minuteOfDay);
        far.windows.alpha = lit * 0.6;
        near.windows.alpha = lit * 0.9;
        const dim = 1 - lit * 0.35;
        far.silhouette.tint = lerpColor(0x000000, 0xffffff, dim);
        near.silhouette.tint = lerpColor(0x000000, 0xffffff, dim);
        haze.tint = skyAt(minuteOfDay).bottom;
        lastMinute = rounded;
        lastW = viewW;
        lastH = viewH;
      }

      for (const [band, parallax] of [
        [layers.cityFar, FAR_PARALLAX],
        [layers.cityNear, NEAR_PARALLAX],
      ] as const) {
        band.scale.set(cam.zoom);
        band.position.set(viewW / 2 - cam.x * cam.zoom * parallax, viewH / 2 - cam.y * cam.zoom);
      }
    },
    destroy(): void {
      gradient.destroy();
      haze.destroy();
      far.silhouette.destroy();
      far.windows.destroy();
      near.silhouette.destroy();
      near.windows.destroy();
      ground.destroy();
    },
  };
}

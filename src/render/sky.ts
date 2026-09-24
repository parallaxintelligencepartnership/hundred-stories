// Sky, the low horizon and the ground.
//
// Palette per the corrected "Color (world, procedural art)" section of docs/VISUAL.md
// (2026-09-19): the world reads like the original SimTower, bright, flat and daytime
// dominant. Day holds a flat gradient for most of the day, dawn and dusk are short
// one hour transitions, night is deep blue and never black.
//
// The low horizon (decision 2026-09-22, replacing the single skyline strip; the rule against
// a tall city backdrop stands): far hills and near two to four storey roofs as two parallax
// bands on the ground line, and six clouds drifting across the sky.
//
// Nothing here touches world.rng: the horizon uses its own seeded generator so the
// simulation stays reproducible.

import { Container, FillGradient, Graphics } from 'pixi.js';
import { createRng } from '../sim/rng';
import { MIN_FLOOR, TOWER_WIDTH } from '../sim/types';
import { FLOOR_PX, LINE_PX, TILE_PX } from './art';
import { DEFAULT_GROUND_LINE, floorBaseY } from './camera';
import { lerpColor } from './light';
import { CLOUD_DARK, cloudDarkening, extraCloudCover, EXTRA_CLOUDS, weatherSkyColor, type WeatherView } from './weather';

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

/** Far hills: a smooth low curve, 40 px at its highest at zoom 1. */
export const HILLS_HEIGHT = 40;
export const HILLS_PARALLAX = 0.15;
const HILLS_COLOR = 0xc7d6e3;
/**
 * The hills stand this far above the near band's base line, hidden behind the roofs' base,
 * so the curve shows over the two and three storey roofs instead of sitting wholly behind them.
 */
const HILLS_LIFT = 24;
/** Near roofs: two to four storey silhouettes with flat roofs, 64 px at the tallest. */
export const ROOFS_HEIGHT = 64;
export const ROOFS_PARALLAX = 0.3;
const ROOFS_COLOR = 0xb9cfe0;
const STOREY_PX = ROOFS_HEIGHT / 4;
/** Clouds: six soft ellipses, 55 percent white, drifting right to left. */
export const CLOUD_COUNT = 6;
export const CLOUD_PARALLAX = 0.1;
export const CLOUD_SPEED = 4; // CSS px per second
const CLOUD_ALPHA = 0.55;
/** Each band runs well past the lot, so the widest zoom never shows its end. */
const BAND_LEFT = -12000;
const BAND_RIGHT = TOWER_WIDTH * TILE_PX + 12000;
/**
 * Below its skyline each band fills down this far. The bands move slower than the street, so
 * when the camera climbs they rise off it; the fill is the distant ground between, and the
 * street and the concrete in front cover whatever is left.
 */
const BAND_FILL = 6000;
/** Everything on the horizon settles toward the night sky instead of glowing after dark. */
const HORIZON_NIGHT = 0x5c6f96;

const CONCRETE_COLOR = 0x6b6f78;
const CONCRETE_LINE = 0x4c5058;
const SIDEWALK_COLOR = 0x343a44;
const STREET_EDGE_COLOR = 0x6b7482;

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
  /** dtMs is real time since the last frame; pass 0 to hold the clouds still (reduced motion). */
  update(
    minuteOfDay: number,
    cam: { x: number; y: number; zoom: number },
    viewW: number,
    viewH: number,
    dtMs?: number,
    /** The eased weather (render/weather.ts) and the tower's seed; none keeps the clear sky. */
    weather?: { view: WeatherView; seed: number },
  ): void;
  destroy(): void;
}

/**
 * Screen y of a band's base line. The bands turn about a fixed horizon line at the default
 * ground line of the view: with the street there (the opening shot) every band stands on the
 * street, and as the camera climbs the street drops by d and a band by factor * d, so the far
 * bands stay near the horizon and sink out of view slowly as the tower rises. With the street
 * above that line (zoomed out, or looking at the basements) a band stands on the street, never
 * behind the concrete.
 */
export function bandBaseY(streetY: number, viewH: number, factor: number): number {
  const horizon = viewH * DEFAULT_GROUND_LINE;
  return Math.min(streetY, horizon + factor * (streetY - horizon));
}

/** Height of the far hills at world x: two slow sines, never above HILLS_HEIGHT. */
export function hillHeight(x: number): number {
  const wave = 0.6 * Math.sin(x / 347) + 0.4 * Math.sin(x / 131 + 1.3); // -1 to 1
  return Math.round(HILLS_HEIGHT * (0.6 + 0.4 * wave));
}

/** The far hills, a smooth curve on the ground line, filled down to hide the gap below. */
function buildHills(): Graphics {
  const g = new Graphics();
  const points: number[] = [BAND_LEFT, BAND_FILL];
  for (let x = BAND_LEFT; x <= BAND_RIGHT; x += TILE_PX) points.push(x, -HILLS_LIFT - hillHeight(x));
  points.push(BAND_RIGHT, BAND_FILL);
  g.poly(points).fill(HILLS_COLOR);
  return g;
}

/** The near roofs: flat topped blocks two to four storeys tall standing on a continuous base. */
function buildRoofs(): Graphics {
  const rng = createRng(0x5eed1);
  const g = new Graphics();
  g.rect(BAND_LEFT, -STOREY_PX / 2, BAND_RIGHT - BAND_LEFT, BAND_FILL + STOREY_PX / 2).fill(ROOFS_COLOR);
  let x = BAND_LEFT;
  while (x < BAND_RIGHT) {
    const width = rng.int(3, 9) * TILE_PX;
    const storeys = rng.int(2, 4);
    const height = storeys * STOREY_PX;
    g.rect(x, -height, width, height).fill(ROOFS_COLOR);
    // A plant room on some of the lower roofs, still under the band's 64 px.
    if (storeys < 4 && rng.int(0, 2) === 0) {
      g.rect(x + TILE_PX, -height - STOREY_PX / 2, TILE_PX, STOREY_PX / 2).fill(ROOFS_COLOR);
    }
    x += width + rng.int(0, 2) * TILE_PX;
  }
  return g;
}

interface Cloud {
  node: Graphics;
  /** Where it starts along the wrap, in CSS px. */
  x0: number;
  /** Height above the (parallaxed) horizon, in CSS px. */
  altitude: number;
}

/** Six clouds with fixed shapes and places, from their own seed. */
function buildClouds(parent: Container): Cloud[] {
  const rng = createRng(0xc10d5);
  const clouds: Cloud[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const width = rng.int(56, 140);
    const height = rng.int(14, 26);
    const node = new Graphics().ellipse(0, 0, width / 2, height / 2).fill({ color: 0xffffff, alpha: CLOUD_ALPHA });
    parent.addChild(node);
    clouds.push({ node, x0: i * 360 + rng.int(0, 200), altitude: rng.int(150, 420) });
  }
  return clouds;
}

/** Rain and storm clouds: four more, larger and grayer, placed from the tower's seed. */
function buildExtraClouds(parent: Container): Graphics[] {
  const nodes: Graphics[] = [];
  for (let i = 0; i < EXTRA_CLOUDS; i++) {
    const node = new Graphics().ellipse(0, 0, 90 + 12 * i, 16 + 2 * i).fill({ color: 0xdde2e8, alpha: CLOUD_ALPHA });
    node.visible = false;
    node.alpha = 0;
    parent.addChild(node);
    nodes.push(node);
  }
  return nodes;
}

/** Where the extra clouds start and how high they sit, from the seed: never from world.rng. */
export function extraCloudPlaces(seed: number): { x0: number; altitude: number }[] {
  const rng = createRng((seed | 0) ^ 0x7a1c1);
  const out: { x0: number; altitude: number }[] = [];
  for (let i = 0; i < EXTRA_CLOUDS; i++) out.push({ x0: i * 540 + 180 + rng.int(0, 240), altitude: rng.int(120, 380) });
  return out;
}

/** Wrap span for the clouds: at least the viewport plus a cloud either side, and the six spaced over it. */
function cloudSpan(viewW: number): number {
  return Math.max(viewW + 320, CLOUD_COUNT * 360);
}

/**
 * Screen x of a cloud: its start, minus the drift, minus the camera at the cloud factor,
 * wrapped so it leaves on the left and comes back on the right. Exported for the test.
 */
export function cloudX(x0: number, driftPx: number, camX: number, zoom: number, viewW: number): number {
  const span = cloudSpan(viewW);
  const raw = x0 - driftPx - camX * zoom * CLOUD_PARALLAX;
  return (((raw % span) + span) % span) - 160;
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
  // cityFar holds the clouds (screen space) and the far hills; cityNear the near roofs.
  const cloudLayer = new Container();
  const hills = buildHills();
  layers.cityFar.addChild(cloudLayer, hills);
  const clouds = buildClouds(cloudLayer);
  const extraClouds = buildExtraClouds(cloudLayer);
  let extraSeed: number | null = null;
  let extraPlaces: { x0: number; altitude: number }[] = [];
  let lastCloudTint = NaN;
  let cloudNightTint = 0xffffff;
  const roofs = buildRoofs();
  layers.cityNear.addChild(roofs);
  const ground = buildGround(layers.ground);

  let lastMinute = -1;
  let lastW = -1;
  let lastH = -1;
  let lastTop = NaN;
  let lastBottom = NaN;
  let drift = 0;
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

  /** A band at a parallax factor: scaled with the zoom, standing on its own horizon line. */
  function placeBand(
    node: Container,
    factor: number,
    cam: { x: number; y: number; zoom: number },
    viewW: number,
    viewH: number,
  ): void {
    node.scale.set(cam.zoom);
    const street = viewH / 2 - cam.y * cam.zoom;
    node.position.set(viewW / 2 - cam.x * cam.zoom * factor, bandBaseY(street, viewH, factor));
  }

  return {
    update(minuteOfDay, cam, viewW, viewH, dtMs = 0, weather): void {
      const clear = skyAt(minuteOfDay);
      // Clear weather at weight 1 grades by exactly nothing: today's colours, byte for byte.
      const colors = weather
        ? { top: weatherSkyColor(clear.top, weather.view), bottom: weatherSkyColor(clear.bottom, weather.view) }
        : clear;
      if (colors.top !== lastTop || colors.bottom !== lastBottom || viewW !== lastW || viewH !== lastH) {
        redrawGradient(colors.top, colors.bottom, viewW, viewH);
        lastTop = colors.top;
        lastBottom = colors.bottom;
        lastW = viewW;
        lastH = viewH;
      }

      const rounded = Math.round(minuteOfDay);
      if (rounded !== lastMinute) {
        const night = nightness(minuteOfDay);
        const tint = lerpColor(0xffffff, HORIZON_NIGHT, night);
        hills.tint = tint;
        roofs.tint = tint;
        cloudNightTint = lerpColor(0xffffff, HORIZON_NIGHT, night * 0.8);
        lastMinute = rounded;
      }
      const cloudTint = lerpColor(
        cloudNightTint,
        CLOUD_DARK,
        weather ? cloudDarkening(weather.view) : 0,
      );
      if (cloudTint !== lastCloudTint) {
        cloudLayer.tint = cloudTint;
        lastCloudTint = cloudTint;
      }

      placeBand(hills, HILLS_PARALLAX, cam, viewW, viewH);
      placeBand(roofs, ROOFS_PARALLAX, cam, viewW, viewH);

      drift += (Math.max(0, dtMs) / 1000) * CLOUD_SPEED;
      if (drift > 1e6) drift -= 1e6;
      const horizon = bandBaseY(viewH / 2 - cam.y * cam.zoom, viewH, CLOUD_PARALLAX);
      for (const cloud of clouds) {
        cloud.node.position.set(
          Math.round(cloudX(cloud.x0, drift, cam.x, cam.zoom, viewW)),
          Math.round(horizon - cloud.altitude),
        );
      }
      const cover = weather ? extraCloudCover(weather.view) : 0;
      if (weather && weather.seed !== extraSeed) {
        extraSeed = weather.seed;
        extraPlaces = extraCloudPlaces(weather.seed);
      }
      for (let i = 0; i < extraClouds.length; i++) {
        const node = extraClouds[i] as Graphics;
        const alpha = Math.max(0, Math.min(1, cover - i));
        node.visible = alpha > 0;
        if (!node.visible) continue;
        node.alpha = alpha;
        const place = extraPlaces[i] ?? { x0: i * 540, altitude: 200 };
        node.position.set(
          Math.round(cloudX(place.x0, drift, cam.x, cam.zoom, viewW)),
          Math.round(horizon - place.altitude),
        );
      }
    },
    destroy(): void {
      gradient.destroy();
      fill?.destroy();
      fill = null;
      cloudLayer.destroy({ children: true });
      hills.destroy();
      roofs.destroy();
      ground.destroy();
    },
  };
}

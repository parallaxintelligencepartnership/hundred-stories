// Weather as the renderer shows it: the one snapshot from src/game/weather.ts, eased in real
// time so a change takes four seconds of wall time whatever the game speed, and the pure rules
// every weather layer reads (sky grading, cloud darkening, light tint, the rain sheet and wet
// street rectangles, lightning). No pixi here, so the rules are testable without a GPU; the
// layers themselves live in weatherfx.ts.
//
// Weather is outside the tower: every rectangle below is placed by the tower's bounds so no
// drop, streak or puddle ever lands on a room cell or a shaft.

import { weatherAt, type WeatherKind, type WeatherSnapshot } from '../game/weather';
import { lerpColor } from './light';

export const WEATHER_KINDS: readonly WeatherKind[] = ['clear', 'overcast', 'rain', 'storm'];

/** Weight per real second: a change completes in four seconds of wall time. */
export const WEATHER_EASE_PER_SECOND = 0.25;

export interface WeatherView {
  /** Per kind, 0 to 1: 1 for the kind showing, easing toward it in real time. */
  weights: Record<WeatherKind, number>;
  /** The snapshot's intensity, eased at the same rate. */
  intensity: number;
}

/** A view settled on a snapshot, for the first frame (no fade on load). */
export function settledView(snapshot: WeatherSnapshot): WeatherView {
  const weights = { clear: 0, overcast: 0, rain: 0, storm: 0 };
  weights[snapshot.kind] = 1;
  return { weights, intensity: snapshot.intensity };
}

function toward(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return value;
}

/**
 * Ease a view toward a snapshot by `dtMs` of real time. Only real time moves it: the game's
 * speed, and how many game minutes passed, do not enter. It still runs under reduced motion,
 * because it is a fade, not motion.
 */
export function easeView(view: WeatherView, snapshot: WeatherSnapshot, dtMs: number): WeatherView {
  const step = (Math.max(0, dtMs) / 1000) * WEATHER_EASE_PER_SECOND;
  const weights = { ...view.weights };
  for (const kind of WEATHER_KINDS) weights[kind] = toward(weights[kind], kind === snapshot.kind ? 1 : 0, step);
  return { weights, intensity: toward(view.intensity, snapshot.intensity, step) };
}

/** How wet it is outside: rain and storm weights, 0 to 1 (or a little more mid change). */
export function wetness(view: WeatherView): number {
  return Math.min(1, view.weights.rain + view.weights.storm);
}

// ---------------------------------------------------------------- sky

/** How far each kind pulls the sky toward gray. Clear keeps the sky exactly. */
export const SKY_GRAY: Record<WeatherKind, number> = { clear: 0, overcast: 0.25, rain: 0.35, storm: 0.5 };

function grayOf(color: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  // A slightly cool, slightly darker gray of the same brightness, so night stays night.
  const l = Math.round((0.3 * r + 0.59 * g + 0.11 * b) * 0.85);
  const clamp = (n: number): number => Math.max(0, Math.min(255, n));
  return (clamp(l - 4) << 16) | (clamp(l) << 8) | clamp(l + 8);
}

/** A sky color graded by the weather: toward its own gray by the weighted amount. */
export function weatherSkyColor(color: number, view: WeatherView): number {
  let amount = 0;
  for (const kind of WEATHER_KINDS) amount += view.weights[kind] * SKY_GRAY[kind];
  if (amount <= 0) return color;
  return lerpColor(color, grayOf(color), Math.min(1, amount));
}

/** How much the clouds darken toward CLOUD_DARK. */
export const CLOUD_DARKEN: Record<WeatherKind, number> = { clear: 0, overcast: 0.3, rain: 0.45, storm: 0.6 };
export const CLOUD_DARK = 0x5d6673;

export function cloudDarkening(view: WeatherView): number {
  let amount = 0;
  for (const kind of WEATHER_KINDS) amount += view.weights[kind] * CLOUD_DARKEN[kind];
  return Math.min(1, amount);
}

/** Up to four more clouds: two in rain, four in storm. */
export const EXTRA_CLOUDS = 4;
export function extraCloudCover(view: WeatherView): number {
  return Math.min(EXTRA_CLOUDS, EXTRA_CLOUDS * (0.5 * view.weights.rain + view.weights.storm));
}

// -------------------------------------------------------------- light

const COOL_GRAY = 0xa9b3c4;
/** The cool gray's reach over the light tint: 12 percent in rain, 20 in storm. */
export const LIGHT_COOL: Record<WeatherKind, number> = { clear: 0, overcast: 0, rain: 0.12, storm: 0.2 };

function multiply(a: number, b: number): number {
  const ch = (s: number): number => Math.round((((a >> s) & 0xff) * ((b >> s) & 0xff)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The light layer's tint under the weather: the hour's tint, multiplied toward a cool gray. */
export function weatherLightTint(tint: number, view: WeatherView): number {
  let amount = 0;
  for (const kind of WEATHER_KINDS) amount += view.weights[kind] * LIGHT_COOL[kind];
  if (amount <= 0) return tint;
  return lerpColor(tint, multiply(tint, COOL_GRAY), Math.min(1, amount));
}

// ---------------------------------------------------------- rain sheet

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The distant sheet's drops: 60 degrees at 120 css px a second in rain, 70 and 200 in storm. */
export const RAIN_SHEET = {
  rain: { angleDeg: 60, speed: 120 },
  storm: { angleDeg: 70, speed: 200 },
  alpha: 0.25,
} as const;

export function sheetStyle(view: WeatherView): { angleDeg: number; speed: number; alpha: number } {
  const style = view.weights.storm > view.weights.rain ? RAIN_SHEET.storm : RAIN_SHEET.rain;
  return { ...style, alpha: RAIN_SHEET.alpha * view.intensity * wetness(view) };
}

/**
 * Where the rain sheet may draw: the view above the street, less the tower's rectangle. Up to
 * three rectangles, left of the tower, right of it, and above the roof, none of them touching
 * the tower. Any coordinate space works as long as all three inputs share it. With no tower,
 * the whole view above the street.
 */
export function rainSheetRects(tower: Rect | null, view: Rect, streetY: number): Rect[] {
  const bottom = Math.min(view.y + view.h, streetY);
  if (bottom <= view.y) return [];
  const out: Rect[] = [];
  const add = (x0: number, y0: number, x1: number, y1: number): void => {
    const x = Math.max(x0, view.x);
    const y = Math.max(y0, view.y);
    const r = Math.min(x1, view.x + view.w);
    const b = Math.min(y1, bottom);
    if (r > x && b > y) out.push({ x, y, w: r - x, h: b - y });
  };
  if (!tower) {
    add(view.x, view.y, view.x + view.w, bottom);
    return out;
  }
  add(view.x, view.y, tower.x, bottom); // left of the tower
  add(tower.x + tower.w, view.y, view.x + view.w, bottom); // right of it
  add(tower.x, view.y, tower.x + tower.w, tower.y); // above the roof
  return out;
}

/** How tall the wet street band is, in world px under the street line. */
export const WET_BAND_PX = 18;

/**
 * Where the wet street may draw: the band under the street line, less the x span of anything
 * built below the street (a basement's top reaches the street line). World px.
 */
export function wetStreetRects(basement: { left: number; right: number } | null, left: number, right: number): Rect[] {
  if (!basement) return [{ x: left, y: 0, w: right - left, h: WET_BAND_PX }];
  const out: Rect[] = [];
  if (basement.left > left) out.push({ x: left, y: 0, w: basement.left - left, h: WET_BAND_PX });
  if (right > basement.right) out.push({ x: basement.right, y: 0, w: right - basement.right, h: WET_BAND_PX });
  return out;
}

// ------------------------------------------------------------ lightning

export const LIGHTNING_GAP_MS = 8000;
/** Frames a flash holds for. */
export const LIGHTNING_FRAMES = 2;
export const LIGHTNING_ALPHA = 0.6;

function hash01(a: number, b: number): number {
  let h = (a ^ 0x27d4eb2d) >>> 0;
  h = Math.imul(h ^ b, 0x165667b1) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Should a flash start now? Each eight second slot of real time may hold one, at a place and
 * with a chance fixed by the seed and the slot, only in a storm, never under reduced motion,
 * and never within eight seconds of the last.
 */
export function lightningDue(
  seed: number,
  realMs: number,
  lastFlashMs: number,
  stormWeight: number,
  reducedMotion: boolean,
): boolean {
  if (reducedMotion || stormWeight < 0.5) return false;
  if (realMs - lastFlashMs < LIGHTNING_GAP_MS) return false;
  const slot = Math.floor(realMs / LIGHTNING_GAP_MS);
  if (hash01(seed | 0, slot) >= 0.6 * stormWeight) return false;
  const at = slot * LIGHTNING_GAP_MS + hash01((seed | 0) ^ 0x9e3779b9, slot) * (LIGHTNING_GAP_MS - 500);
  return realMs >= at;
}

// ------------------------------------------------------ dev capture path

let forced: WeatherSnapshot | null = null;

/**
 * Pin the weather for a capture (the DEV only ?weather= query in src/main.ts). Null returns
 * to the forecast.
 */
export function setForcedWeather(snapshot: WeatherSnapshot | null): void {
  forced = snapshot;
}

/** The snapshot to show: the pinned one in a dev capture, else the forecast. */
export function weatherNow(seed: number, minute: number): WeatherSnapshot {
  return forced ?? weatherAt(seed, minute);
}

/** Parse ?weather= and ?hour=; anything unknown is null. */
export function parseWeatherQuery(search: string): { kind: WeatherKind | null; hour: number | null } {
  const params = new URLSearchParams(search);
  const w = params.get('weather');
  const kind = w !== null && (WEATHER_KINDS as readonly string[]).includes(w) ? (w as WeatherKind) : null;
  const h = params.get('hour');
  const n = h === null || h.trim() === '' ? NaN : Number(h);
  const hour = Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  return { kind, hour };
}

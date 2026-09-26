// The sky by minute of day, and the low horizon (look round L2): far hills, near roofs, clouds.
// Design pass P3: the stars on a clear night (D-6) and the distant downtown after dark (BB-4).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, FillGradient, Graphics, Matrix, Texture, type Circle, type GraphicsPath } from 'pixi.js';
import {
  CLOUD_PARALLAX,
  createSky,
  DOWNTOWN_MAX_H,
  DOWNTOWN_MIN_H,
  DOWNTOWN_PARALLAX,
  DOWNTOWN_WINDOW_PX,
  downtownLook,
  downtownTowers,
  HILLS_PARALLAX,
  ROOFS_PARALLAX,
  bandBaseY,
  HILLS_HEIGHT,
  cloudX,
  hillHeight,
  isNight,
  nightness,
  skyAt,
  skyBackground,
  STAR_COUNT,
  STAR_FIELD_H,
  STAR_FIELD_W,
  starAlpha,
  starField,
  starsTop,
  starsX,
} from '../../src/render/sky';
import { DEFAULT_GROUND_LINE } from '../../src/render/camera';
import type { WeatherView } from '../../src/render/weather';

const at = (h: number, m = 0): number => h * 60 + m;

describe('sky colour at each anchor minute', () => {
  it('is night, never black, from midnight to 05:30', () => {
    expect(skyAt(0)).toEqual({ top: 0x0d1b3d, bottom: 0x1c2f5c });
    expect(skyAt(at(5, 30))).toEqual({ top: 0x0d1b3d, bottom: 0x1c2f5c });
  });

  it('passes through dawn at 06:00 and reaches day at 06:30', () => {
    expect(skyAt(at(6))).toEqual({ top: 0x9ab6d8, bottom: 0xf6b98a });
    expect(skyAt(at(6, 30))).toEqual({ top: 0x9fd3f5, bottom: 0xdcefff });
  });

  it('holds day to 18:00, dusk at 18:30, night at 19:00 and midnight', () => {
    expect(skyAt(at(12))).toEqual({ top: 0x9fd3f5, bottom: 0xdcefff });
    expect(skyAt(at(18))).toEqual({ top: 0x9fd3f5, bottom: 0xdcefff });
    expect(skyAt(at(18, 30))).toEqual({ top: 0xa3aecb, bottom: 0xe08a7a });
    expect(skyAt(at(19))).toEqual({ top: 0x0d1b3d, bottom: 0x1c2f5c });
    expect(skyAt(at(24))).toEqual({ top: 0x0d1b3d, bottom: 0x1c2f5c });
  });

  it('clears the canvas to the top of the gradient', () => {
    expect(skyBackground(at(12))).toBe(0x9fd3f5);
  });

  it('calls it night from dusk to dawn', () => {
    expect(isNight(at(12))).toBe(false);
    expect(isNight(at(23))).toBe(true);
    expect(nightness(at(12))).toBe(0);
    expect(nightness(at(23))).toBe(1);
  });
});

describe('the low horizon', () => {
  it('keeps the far hills under 40 px and never flat to the ground', () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -5000; x < 12000; x += 16) {
      const h = hillHeight(x);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi).toBeLessThanOrEqual(HILLS_HEIGHT);
    expect(lo).toBeGreaterThan(0);
    expect(hi - lo).toBeGreaterThan(HILLS_HEIGHT / 3); // a curve, not a strip
  });

  it('drifts clouds right to left and wraps them inside the view span', () => {
    const w = 1440;
    const a = cloudX(500, 0, 0, 1, w);
    const b = cloudX(500, 4, 0, 1, w); // one second at 4 px a second
    expect(b).toBe(a - 4);
    for (let drift = 0; drift < 10000; drift += 97) {
      const x = cloudX(500, drift, 0, 1, w);
      expect(x).toBeGreaterThanOrEqual(-160);
      expect(x).toBeLessThan(Math.max(w + 320, 2160) - 160);
    }
  });

  it('stands the bands on the street at the opening shot and moves them at their factor', () => {
    const h = 900;
    const horizon = h * DEFAULT_GROUND_LINE;
    for (const f of [CLOUD_PARALLAX, HILLS_PARALLAX, ROOFS_PARALLAX]) {
      expect(bandBaseY(horizon, h, f)).toBeCloseTo(horizon);
      // the camera climbs 1,000 px: the street drops 1,000, the band a fraction of it
      expect(bandBaseY(horizon + 1000, h, f) - bandBaseY(horizon, h, f)).toBeCloseTo(1000 * f);
      // the street above the horizon line (zoomed out): the band stands on the street
      expect(bandBaseY(horizon - 200, h, f)).toBeCloseTo(horizon - 200);
    }
  });

  it('moves clouds at a tenth of the camera', () => {
    const w = 1440;
    expect(cloudX(500, 0, 0, 1, w) - cloudX(500, 0, 100, 1, w)).toBeCloseTo(100 * CLOUD_PARALLAX);
  });
});

const weights = (kind: 'clear' | 'overcast' | 'rain' | 'storm'): WeatherView['weights'] => ({ clear: 0, overcast: 0, rain: 0, storm: 0, [kind]: 1 });
const view = (kind: 'clear' | 'overcast' | 'rain' | 'storm'): WeatherView => ({ weights: weights(kind), intensity: 0.5 });

describe('D-6: stars in the clear night sky', () => {
  it('places 90 stars once from their own seed, in a 2048 by 640 field, 0.6 to 1.2 px, at 0.4 to 0.9', () => {
    const stars = starField();
    expect([STAR_COUNT, STAR_FIELD_W, STAR_FIELD_H]).toEqual([90, 2048, 640]);
    expect(stars).toHaveLength(90);
    expect(starField()).toEqual(stars); // the same every time: no world.rng, no Math.random
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(2048);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(640);
      expect([0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2].some((r) => Math.abs(s.r - r) < 1e-9)).toBe(true);
      expect([0.4, 0.5, 0.6, 0.7, 0.8, 0.9].some((a) => Math.abs(s.alpha - a) < 1e-9)).toBe(true);
    }
    expect(new Set(stars.map((s) => `${s.x},${s.y}`)).size).toBeGreaterThan(85); // scattered, not stacked
  });

  it('shows them by the night and puts them out by the clouds: overcast dims, rain and storm hide', () => {
    expect(starAlpha(12 * 60, weights('clear'))).toBe(0);
    expect(starAlpha(23 * 60, weights('clear'))).toBe(1);
    expect(starAlpha(18 * 60 + 30, weights('clear'))).toBeCloseTo(nightness(18 * 60 + 30));
    expect(starAlpha(23 * 60, weights('overcast'))).toBeCloseTo(0.3);
    expect(starAlpha(23 * 60, weights('rain'))).toBe(0);
    expect(starAlpha(23 * 60, weights('storm'))).toBe(0);
    expect(starAlpha(23 * 60, { clear: 0.5, overcast: 0, rain: 0.5, storm: 0 })).toBeCloseTo(0.5);
  });

  it('slides at a twentieth of the camera and tiles every 2048 px, with no motion of its own', () => {
    expect(starsX(0, 1)).toBeCloseTo(0);
    expect(starsX(1000, 1)).toBeCloseTo(-50);
    expect(starsX(1000, 2)).toBeCloseTo(-100);
    expect(starsX(50_000, 1)).toBeCloseTo(-(2500 % 2048));
    for (const camX of [-480, -1, 0, 7, 3000, 6480]) {
      for (const zoom of [0.175, 0.5, 1, 3]) {
        expect(starsX(camX, zoom)).toBeLessThanOrEqual(0);
        expect(starsX(camX, zoom)).toBeGreaterThan(-2048);
      }
    }
    // The field's bottom sits 60 px over the clouds' horizon.
    expect(starsTop(600) + STAR_FIELD_H).toBe(540);
  });
});

describe('BB-4: a distant downtown after dark', () => {
  it('stands flat topped towers 120 to 360 px tall at parallax 0.06, behind the hills, from its own seed', () => {
    expect(DOWNTOWN_PARALLAX).toBe(0.06);
    expect(DOWNTOWN_PARALLAX).toBeLessThan(HILLS_PARALLAX);
    const towers = downtownTowers();
    expect(downtownTowers()).toEqual(towers);
    expect(towers.length).toBeGreaterThan(20);
    let right = -Infinity;
    for (const t of towers) {
      expect(t.height).toBeGreaterThanOrEqual(DOWNTOWN_MIN_H);
      expect(t.height).toBeLessThanOrEqual(DOWNTOWN_MAX_H);
      expect(t.width).toBeGreaterThan(0);
      expect(t.x).toBeGreaterThanOrEqual(right); // side by side, never overlapping
      right = t.x + t.width;
    }
    expect([DOWNTOWN_MIN_H, DOWNTOWN_MAX_H]).toEqual([120, 360]);
    // Every height in the range turns up, not one skyline repeated.
    expect(new Set(towers.map((t) => t.height)).size).toBeGreaterThan(10);
  });

  it('lights a sparse grid of 2 by 2 px windows inside each tower', () => {
    expect(DOWNTOWN_WINDOW_PX).toBe(2);
    let windows = 0;
    let cells = 0;
    for (const t of downtownTowers()) {
      for (const [x, y] of t.windows) {
        expect(x).toBeGreaterThanOrEqual(t.x);
        expect(x + DOWNTOWN_WINDOW_PX).toBeLessThanOrEqual(t.x + t.width);
        expect(y).toBeGreaterThanOrEqual(-t.height);
        expect(y + DOWNTOWN_WINDOW_PX).toBeLessThanOrEqual(0);
      }
      windows += t.windows.length;
      cells += t.cells;
    }
    expect(windows).toBeGreaterThan(0);
    expect(windows / cells).toBeLessThan(0.35); // sparse
  });

  it('is #aebdd0 at 35 percent by day and #243457 with its windows at 60 percent at night', () => {
    expect(downtownLook(0)).toEqual({ tint: 0xaebdd0, alpha: 0.35, windows: 0 });
    expect(downtownLook(1)).toEqual({ tint: 0x243457, alpha: 1, windows: 0.6 });
    const dusk = downtownLook(0.5);
    expect(dusk.windows).toBeCloseTo(0.3);
  });
});

describe('createSky (D-6, BB-4)', () => {
  beforeEach(() => {
    // The gradient's texture needs a DOM canvas: hand it a blank one instead.
    vi.spyOn(FillGradient.prototype, 'buildLinearGradient').mockImplementation(function (this: FillGradient) {
      this.texture ??= new Texture();
      (this as unknown as { transform: Matrix }).transform ??= new Matrix();
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const layers = () => ({ sky: new Container(), cityFar: new Container(), cityNear: new Container(), ground: new Container() });
  const cam = { x: 3000, y: -300, zoom: 0.5 };
  const W = 1440;
  const H = 900;
  const byLabel = (root: Container, label: string): Container => root.children.find((c) => c.label === label) as Container;
  const circles = (g: Graphics): Circle[] =>
    g.context.instructions.flatMap((i) => (i.data as { path: GraphicsPath }).path.shapePath.shapePrimitives.map((p) => p.shape as Circle));

  it('adds the stars to the sky right after the gradient, twice side by side, lit on a clear night and gone by day', () => {
    const l = layers();
    const sky = createSky(l);
    const stars = l.sky.children[1] as Graphics;
    expect(stars.label).toBe('stars');
    const drawn = circles(stars);
    expect(drawn).toHaveLength(2 * STAR_COUNT);
    const field = starField();
    expect(drawn.slice(0, STAR_COUNT).map((c) => [c.x, c.y])).toEqual(field.map((s) => [s.x, s.y]));
    expect(drawn.slice(STAR_COUNT).map((c) => [c.x, c.y])).toEqual(field.map((s) => [s.x + 2048, s.y]));

    sky.update(23 * 60, cam, W, H, 16, { view: view('clear'), seed: 3 });
    expect(stars.visible).toBe(true);
    expect(stars.alpha).toBe(1);
    const street = H / 2 - cam.y * cam.zoom;
    expect(stars.y + STAR_FIELD_H).toBe(Math.round(bandBaseY(street, H, CLOUD_PARALLAX) - 60));
    expect(stars.x).toBe(Math.round(starsX(cam.x, cam.zoom)));
    const x = stars.x;
    sky.update(23 * 60, cam, W, H, 5000, { view: view('clear'), seed: 3 });
    expect(stars.x).toBe(x); // five seconds later: the clouds drifted, the stars did not

    sky.update(23 * 60, cam, W, H, 16, { view: view('rain'), seed: 3 });
    expect(stars.alpha).toBe(0);
    sky.update(12 * 60, cam, W, H, 16, { view: view('clear'), seed: 3 });
    expect(stars.visible).toBe(false);
  });

  it('stands the downtown behind the hills at its own parallax, pale by day and lit at night', () => {
    const l = layers();
    const sky = createSky(l);
    const downtown = byLabel(l.cityFar, 'downtown');
    expect(downtown).toBeDefined();
    const hillsAt = l.cityFar.children.findIndex((c) => c instanceof Graphics && c.label !== 'downtown');
    expect(l.cityFar.children.indexOf(downtown)).toBeLessThan(hillsAt);
    const [body, windows] = downtown.children as Graphics[];
    sky.update(12 * 60, cam, W, H, 16, { view: view('clear'), seed: 3 });
    expect(downtown.scale.x).toBe(cam.zoom);
    expect(downtown.x).toBeCloseTo(W / 2 - cam.x * cam.zoom * DOWNTOWN_PARALLAX);
    expect(downtown.y).toBeCloseTo(bandBaseY(H / 2 - cam.y * cam.zoom, H, DOWNTOWN_PARALLAX));
    expect([body!.tint, body!.alpha]).toEqual([0xaebdd0, 0.35]);
    expect(windows!.visible).toBe(false);
    sky.update(22 * 60, cam, W, H, 16, { view: view('clear'), seed: 3 });
    expect([body!.tint, body!.alpha]).toEqual([0x243457, 1]);
    expect(windows!.visible).toBe(true);
    expect(windows!.alpha).toBeCloseTo(0.6);
    // Only the camera moves it: no motion of its own.
    const before = downtown.x;
    sky.update(22 * 60, cam, W, H, 5000, { view: view('clear'), seed: 3 });
    expect(downtown.x).toBe(before);
  });
});

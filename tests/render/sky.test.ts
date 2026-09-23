// The sky by minute of day, and the low horizon (look round L2): far hills, near roofs, clouds.

import { describe, expect, it } from 'vitest';
import {
  CLOUD_PARALLAX,
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
} from '../../src/render/sky';
import { DEFAULT_GROUND_LINE } from '../../src/render/camera';

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

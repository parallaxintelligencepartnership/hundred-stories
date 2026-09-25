// Each store scene's key-step count, run through the real camera zoom step and snap logic,
// must land on a distinct zoom from every other scene. "closer" used to take one step, the same
// snap stop as "tower" (zoom 1); see verify-H S6.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nearestSnap } from '../../src/render/camera';

const KEY_ZOOM_DELTA = 120; // one wheel notch, mirrors src/render/camera.ts

/** Applies `steps` wheel notches (positive zooms in, negative zooms out) starting from zoom 1,
 * snapping after each step the way the camera does once the wheel goes idle. */
function applySteps(steps: number): number {
  let zoom = 1;
  const direction = steps < 0 ? -1 : 1;
  for (let i = 0; i < Math.abs(steps); i++) {
    const factor = Math.exp(direction * KEY_ZOOM_DELTA * 0.0022);
    zoom = zoom * factor;
  }
  return nearestSnap(zoom);
}

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'make-store-shots.mjs');

async function loadSteps(): Promise<Record<string, number>> {
  const text = await import('node:fs').then((fs) => fs.readFileSync(SCRIPT, 'utf8'));
  const match = text.match(/const steps = \{([^}]*)\}\[scene\] \?\? 0;/);
  expect(match, 'steps map not found in make-store-shots.mjs').toBeTruthy();
  const body = match![1]!;
  const out: Record<string, number> = {};
  for (const m of body.matchAll(/(\w+):\s*(-?\d+)/g)) {
    out[m[1]!] = Number(m[2]);
  }
  return out;
}

describe('store scene zooms are distinct', () => {
  it('gives tower, wide, close and closer four distinct snapped zooms', async () => {
    const steps = await loadSteps();
    const zoomFor: Record<string, number> = { tower: applySteps(0) };
    for (const scene of ['wide', 'close', 'closer']) {
      expect(steps[scene], scene).toBeDefined();
      zoomFor[scene] = applySteps(steps[scene]!);
    }
    expect(zoomFor.tower).toBe(1);
    expect(zoomFor.wide).toBe(0.5);
    expect(zoomFor.close).toBe(2);
    const zooms = Object.values(zoomFor);
    expect(new Set(zooms).size, JSON.stringify(zoomFor)).toBe(zooms.length);
  });
});

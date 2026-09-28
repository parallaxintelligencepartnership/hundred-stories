import { Easing } from 'remotion';
import { lerp, ramp } from './anim';

export type Cam = { x: number; y: number; s: number };

/** Camera from keyframes [frame, cam]; eases between neighbours and holds past either end. */
export const keyCam = (f: number, keys: [number, Cam][]): Cam => {
  if (f <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, c1] = keys[i];
    if (f < t1) {
      const [t0, c0] = keys[i - 1];
      const p = ramp(f, t0, t1 - t0, Easing.inOut(Easing.cubic));
      return { x: lerp(c0.x, c1.x, p), y: lerp(c0.y, c1.y, p), s: lerp(c0.s, c1.s, p) };
    }
  }
  return keys[keys.length - 1][1];
};

type PegPose = { x: number; y: number; scale?: number; facing?: 1 | -1; squash?: number; lean?: number; bob?: number };

/** World position of a point given in a TenantPeg's local frame (mirrors TenantPeg's transform). */
export const pegPoint = (p: PegPose, lx: number, ly: number) => {
  const { x, y, scale = 1, facing = 1, squash = 1, lean = 0 } = p;
  const a = (lean * Math.PI) / 180;
  const ry0 = ly + 30;
  const rx = lx * Math.cos(a) - ry0 * Math.sin(a);
  const ry = lx * Math.sin(a) + ry0 * Math.cos(a) - 30;
  return { x: x + rx * scale * facing * (1 / Math.sqrt(squash)), y: y + ry * scale * squash };
};

/** World position of a peg's front hand for arm angle `deg` (TenantPeg's armFront convention). */
export const pegHand = (p: PegPose, deg: number) => {
  const r = (deg * Math.PI) / 180;
  return pegPoint(p, Math.sin(r) * 28, -60 + (p.bob ?? 0) + Math.cos(r) * 28);
};

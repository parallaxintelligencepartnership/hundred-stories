import { Easing, interpolate } from 'remotion';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0..1 over [start, start+dur], clamped. */
export const ramp = (f: number, start: number, dur: number, ease: (t: number) => number = Easing.inOut(Easing.cubic)) =>
  interpolate(f, [start, start + dur], [0, 1], { ...clamp, easing: ease });

/** Bouncy back-out scale-in from 0 to 1. */
export const popIn = (f: number, start: number, dur = 14) => ramp(f, start, dur, Easing.out(Easing.back(2.2)));

/** Fade in then optionally out. */
export const fade = (f: number, inStart: number, inDur: number, outStart = Infinity, outDur = 1) =>
  Math.min(ramp(f, inStart, inDur, Easing.out(Easing.quad)), Number.isFinite(outStart) ? 1 - ramp(f, outStart, outDur, Easing.in(Easing.quad)) : 1);

/** Damped wobble after an impact at `t`: used for the camera bob as floors land. */
export const wobble = (f: number, t: number, amp = 8, decay = 7, freq = 0.7) =>
  f < t ? 0 : amp * Math.exp(-(f - t) / decay) * Math.sin((f - t) * freq);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export { clamp };

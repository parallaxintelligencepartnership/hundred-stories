// The pointer decisions the renderer and the game shell have to agree on: was that press a
// click or a pan, is this wheel a scroll or a zoom, was that touch a tap, and what did two
// fingers just do.

import { describe, expect, it } from 'vitest';
import {
  classifyPress,
  isTap,
  pinchGesture,
  PRESS_SLOP_PX,
  TOUCH_SLOP_PX,
  wheelGesture,
  type FingerPair,
  type WheelLike,
} from '../../src/render/input';

const wheel = (over: Partial<WheelLike>): WheelLike => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

describe('classifyPress', () => {
  it('calls a press that holds still a click, on either axis', () => {
    const down = { x: 200, y: 150 };
    expect(classifyPress(down, { x: 200, y: 150 })).toBe('click');
    expect(classifyPress(down, { x: 200 + PRESS_SLOP_PX, y: 150 })).toBe('click');
    expect(classifyPress(down, { x: 200, y: 150 - PRESS_SLOP_PX })).toBe('click');
  });

  it('calls a press that travels past the slop a pan', () => {
    const down = { x: 200, y: 150 };
    expect(classifyPress(down, { x: 200 + PRESS_SLOP_PX + 1, y: 150 })).toBe('pan');
    expect(classifyPress(down, { x: 200, y: 150 + PRESS_SLOP_PX + 1 })).toBe('pan');
    expect(classifyPress(down, { x: 100, y: 400 })).toBe('pan');
  });

  it('takes the slop as an argument for a coarser pointer', () => {
    expect(classifyPress({ x: 0, y: 0 }, { x: 8, y: 0 }, 12)).toBe('click');
    expect(classifyPress({ x: 0, y: 0 }, { x: 8, y: 0 }, 2)).toBe('pan');
  });
});

describe('wheelGesture', () => {
  it('scrolls the view up and down on a plain wheel', () => {
    expect(wheelGesture(wheel({ deltaY: 120 }), 900)).toEqual({ zoom: false, dx: 0, dy: 120, dz: 0 });
  });

  it('zooms only while ctrl or meta is held, which is how a pinch arrives', () => {
    expect(wheelGesture(wheel({ deltaY: -120, ctrlKey: true }), 900)).toEqual({ zoom: true, dx: 0, dy: 0, dz: -120 });
    expect(wheelGesture(wheel({ deltaY: 40, metaKey: true }), 900)).toEqual({ zoom: true, dx: 0, dy: 0, dz: 40 });
  });

  it('moves sideways on a shift wheel and on a trackpad deltaX', () => {
    expect(wheelGesture(wheel({ deltaY: 120, shiftKey: true }), 900)).toEqual({ zoom: false, dx: 120, dy: 0, dz: 0 });
    // A trackpad sends both axes: they are both kept, shift or no shift.
    expect(wheelGesture(wheel({ deltaX: -30, deltaY: 12 }), 900)).toEqual({ zoom: false, dx: -30, dy: 12, dz: 0 });
    expect(wheelGesture(wheel({ deltaX: -30, deltaY: 12, shiftKey: true }), 900)).toEqual({ zoom: false, dx: -30, dy: 12, dz: 0 });
  });

  it('normalizes lines and pages to pixels', () => {
    expect(wheelGesture(wheel({ deltaY: 3, deltaMode: 1 }), 900).dy).toBe(48);
    expect(wheelGesture(wheel({ deltaY: 1, deltaMode: 2 }), 900).dy).toBe(900);
    expect(wheelGesture(wheel({ deltaY: 2, deltaMode: 1, ctrlKey: true }), 900).dz).toBe(32);
  });
});

describe('isTap', () => {
  const down = { x: 200, y: 400 };

  it('takes a quick press that held still, with the coarser touch slop', () => {
    expect(isTap(down, { x: 200, y: 400 }, 80)).toBe(true);
    expect(isTap(down, { x: 200 + TOUCH_SLOP_PX, y: 400 }, 120)).toBe(true);
    expect(isTap(down, { x: 200, y: 400 - TOUCH_SLOP_PX }, 399)).toBe(true);
  });

  it('refuses a finger that travelled', () => {
    expect(isTap(down, { x: 200 + TOUCH_SLOP_PX + 1, y: 400 }, 80)).toBe(false);
    expect(isTap(down, { x: 260, y: 500 }, 80)).toBe(false);
  });

  it('a slow touch press that holds still is still a tap', () => {
    expect(isTap(down, { x: 200, y: 400 }, 400)).toBe(true);
    expect(isTap(down, { x: 200, y: 400 }, 5000)).toBe(true);
  });

  it('refuses a duration it cannot read rather than guessing', () => {
    expect(isTap(down, { x: 200, y: 400 }, Number.NaN)).toBe(false);
    expect(isTap(down, { x: 200, y: 400 }, -1)).toBe(false);
  });

  it('takes its own slop and window, so the mouse can keep a longer click', () => {
    expect(isTap(down, { x: 200 + PRESS_SLOP_PX + 1, y: 400 }, 80, PRESS_SLOP_PX)).toBe(false);
    expect(isTap(down, { x: 200, y: 400 }, 500, TOUCH_SLOP_PX, 600)).toBe(true);
  });
});

describe('pinchGesture', () => {
  const pair = (ax: number, ay: number, bx: number, by: number): FingerPair => ({
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
  });

  it('reads spreading fingers as a zoom in, around the midpoint they hold', () => {
    const g = pinchGesture(pair(100, 300, 200, 300), pair(50, 300, 250, 300));
    expect(g.scale).toBe(2);
    expect(g.mid).toEqual({ x: 150, y: 300 });
    expect(g.dx).toBe(0);
    expect(g.dy).toBe(0);
  });

  it('reads closing fingers as a zoom out', () => {
    expect(pinchGesture(pair(0, 0, 0, 400), pair(0, 100, 0, 300)).scale).toBe(0.5);
  });

  it('reads two fingers sliding together as a pan and no zoom', () => {
    const g = pinchGesture(pair(100, 300, 200, 300), pair(130, 260, 230, 260));
    expect(g.scale).toBe(1);
    expect(g.dx).toBe(30);
    expect(g.dy).toBe(-40);
    expect(g.mid).toEqual({ x: 180, y: 260 });
  });

  it('does both at once when the hand spreads and slides', () => {
    const g = pinchGesture(pair(100, 300, 200, 300), pair(100, 300, 300, 300));
    expect(g.scale).toBe(2);
    expect(g.dx).toBe(50);
    expect(g.dy).toBe(0);
  });

  it('measures the span on both axes, not just sideways', () => {
    expect(pinchGesture(pair(0, 0, 30, 40), pair(0, 0, 60, 80)).scale).toBe(2);
  });

  it('holds the zoom still when the fingers are too close to measure', () => {
    expect(pinchGesture(pair(100, 300, 104, 300), pair(100, 300, 140, 300)).scale).toBe(1);
    expect(pinchGesture(pair(100, 300, 200, 300), pair(100, 300, 105, 300)).scale).toBe(1);
    // A smudge still pans: the midpoint is readable even when the span is not.
    expect(pinchGesture(pair(100, 300, 104, 300), pair(120, 300, 124, 300)).dx).toBe(20);
  });
});

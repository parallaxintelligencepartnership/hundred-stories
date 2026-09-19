// The two pointer decisions the renderer and the game shell have to agree on:
// was that press a click or a pan, and is this wheel a scroll or a zoom.

import { describe, expect, it } from 'vitest';
import { classifyPress, PRESS_SLOP_PX, wheelGesture, type WheelLike } from '../../src/render/input';

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

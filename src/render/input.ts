// Pointer and wheel gestures, as pure decisions.
//
// Two listeners have to agree on one question: was that press a click or the start of a
// pan? The renderer owns the camera, the game shell owns the build, and both ask here, so
// there is a single threshold and it can be tested without a canvas.

/** How far a press may travel and still count as a click, in css pixels. */
export const PRESS_SLOP_PX = 4;

export interface Point {
  x: number;
  y: number;
}

export type PressKind = 'click' | 'pan';

/** A press stays a click while it holds inside the slop and becomes a pan the moment it leaves. */
export function classifyPress(down: Point, now: Point, slop: number = PRESS_SLOP_PX): PressKind {
  return Math.abs(now.x - down.x) > slop || Math.abs(now.y - down.y) > slop ? 'pan' : 'click';
}

/** A wheel or trackpad gesture, normalized to css pixels and split into zoom or pan. */
export interface WheelGesture {
  /** Zoom toward the cursor rather than move the view. */
  zoom: boolean;
  /** Screen pixels to move the view by, zero while zooming. */
  dx: number;
  dy: number;
  /** Wheel pixels to zoom by, positive to zoom out. Zero while panning. */
  dz: number;
}

/** The parts of a WheelEvent this reads, so tests can pass a plain object. */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const LINE_PX = 16; // deltaMode 1 counts lines

/**
 * Scrolling moves the view, ctrl scrolling zooms.
 *
 * A trackpad pinch arrives as a wheel event with ctrlKey set in Chrome and Safari, which is
 * why the zoom test is the modifier and not the axis. A mouse wheel sends deltaY only, so
 * shift borrows deltaY for the sideways move; a trackpad sends both axes and keeps them.
 */
export function wheelGesture(event: WheelLike, pageHeightPx: number): WheelGesture {
  const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? pageHeightPx : 1;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;
  if (event.ctrlKey || event.metaKey) return { zoom: true, dx: 0, dy: 0, dz: dy };
  if (event.shiftKey && dx === 0) return { zoom: false, dx: dy, dy: 0, dz: 0 };
  return { zoom: false, dx, dy, dz: 0 };
}

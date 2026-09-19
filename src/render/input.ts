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

// ------------------------------------------------------------------- touch

/**
 * How far a finger may travel and still count as a tap, in css pixels.
 *
 * A finger is a fat, shaky pointer: a press that would be a click from a mouse arrives from a
 * thumb with a few pixels of travel in it, so touch gets its own, coarser slop.
 */
export const TOUCH_SLOP_PX = 10;

/**
 * Was that press a tap: held inside the slop, however long that took?
 *
 * A still finger is a placement no matter how long it rested, so only the slop decides. The
 * renderer asks before it picks and the game shell asks before it builds, so a finger that
 * wandered past the slop, or one that was only the first half of a pinch, places nothing. The
 * time window stays as a parameter so a caller with its own duration rule, such as a mouse
 * click, can still pass one in.
 */
export function isTap(
  down: Point,
  up: Point,
  elapsedMs: number,
  slop: number = TOUCH_SLOP_PX,
  maxMs: number = Infinity,
): boolean {
  if (!(elapsedMs >= 0) || elapsedMs >= maxMs) return false; // a NaN duration is not a tap
  return classifyPress(down, up, slop) === 'click';
}

/** Two fingers on the view, in the order they went down. */
export interface FingerPair {
  a: Point;
  b: Point;
}

/** What two fingers did between one move and the next. */
export interface PinchGesture {
  /** Multiply the zoom by this: above 1 the fingers spread, below 1 they closed. */
  scale: number;
  /** Screen pixels the midpoint travelled, the pan half of the gesture. */
  dx: number;
  dy: number;
  /** Where the fingers point now: the world under it is the point the zoom holds still. */
  mid: Point;
}

/** Fingers this close together are one smudge: their span is too noisy to zoom by. */
const MIN_PINCH_SPAN_PX = 12;

function midpointOf(pair: FingerPair): Point {
  return { x: (pair.a.x + pair.b.x) / 2, y: (pair.a.y + pair.b.y) / 2 };
}

function spanOf(pair: FingerPair): number {
  return Math.hypot(pair.a.x - pair.b.x, pair.a.y - pair.b.y);
}

/**
 * One step of a two finger gesture, split into a zoom and a pan.
 *
 * The span between the fingers is the zoom and the midpoint is the pan, so a pinch that also
 * slides does both at once, which is what a hand actually does. The two are read from the same
 * pair of points, which is why this is one function and not two.
 */
export function pinchGesture(prev: FingerPair, next: FingerPair): PinchGesture {
  const before = spanOf(prev);
  const after = spanOf(next);
  const from = midpointOf(prev);
  const mid = midpointOf(next);
  const scale = before < MIN_PINCH_SPAN_PX || after < MIN_PINCH_SPAN_PX ? 1 : after / before;
  return { scale, dx: mid.x - from.x, dy: mid.y - from.y, mid };
}

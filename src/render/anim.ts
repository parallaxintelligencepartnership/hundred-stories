// Motion rules for the things that move in the world: elevator doors, the walk cycle, the
// waiting weight shift and the impatient glance, and the held activity poses. Pure functions, no pixi, so
// the rules are testable without a GPU. See docs/reviews/2026-09-22-look-round-spec.md ship L3.
//
// Everything here runs on real elapsed time, never on sim ticks, and never touches world.rng:
// the renderer calls these with performance time and ids the sim already exposes.

// ---------------------------------------------------------------------------
// Elevator doors
// ---------------------------------------------------------------------------

/** A door takes this long to slide fully open, and as long again to close. */
export const DOOR_TWEEN_MS = 240;

/** The door positions baked per car kind: 0 closed, 1 fully open. */
export const DOOR_FRAMES = [0, 0.25, 0.5, 0.75, 1] as const;
export type DoorFrame = 0 | 1 | 2 | 3 | 4;

/** The baked frame nearest a door position, clamped to [0, 1]. */
export function doorFrameOf(position: number): DoorFrame {
  const p = Number.isFinite(position) ? Math.min(1, Math.max(0, position)) : 0;
  return Math.round(p * (DOOR_FRAMES.length - 1)) as DoorFrame;
}

/**
 * The door position after `dtMs` of real time sliding toward open (1) or closed (0).
 * Under reduced motion the door snaps to its target, as the two state doors always did.
 */
export function stepDoor(position: number, open: boolean, dtMs: number, reducedMotion: boolean): number {
  const target = open ? 1 : 0;
  if (reducedMotion) return target;
  const step = Math.max(0, dtMs) / DOOR_TWEEN_MS;
  return open ? Math.min(target, position + step) : Math.max(target, position - step);
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/** The three walk frames: standing, stride, and the stride mirrored. */
export type SimFrame = 0 | 1 | 2;
export const SIM_FRAMES: readonly SimFrame[] = [0, 1, 2];

/**
 * Every frame a person is baked in (figure.ts). 0 to 2 are the walk cycle, so a walker's frame
 * is its walk frame; the rest are held poses: the waiting weight shift to either side, the
 * impatient glance, and the two activities inside a room.
 */
export type PersonFrame = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FRAME = {
  stand: 0,
  stride: 1,
  strideMirrored: 2,
  shiftLeft: 3,
  shiftRight: 4,
  glance: 5,
  sit: 6,
  browse: 7,
} as const satisfies Record<string, PersonFrame>;
export const PERSON_FRAME_COUNT = 8;

/**
 * The mirrored stride and the right weight shift are the stride and the left shift flipped:
 * one baked texture each, drawn with the sprite mirrored (every look is symmetric, and what a
 * person carries is an overlay that stays in its hand), so a walker costs two textures, not three.
 */
export function isMirrored(frame: PersonFrame): boolean {
  return frame === FRAME.strideMirrored || frame === FRAME.shiftRight;
}

/** The frame actually baked for `frame`: its unmirrored twin. */
export function canonicalFrame(frame: PersonFrame): PersonFrame {
  return frame === FRAME.strideMirrored ? FRAME.stride : frame === FRAME.shiftRight ? FRAME.shiftLeft : frame;
}

export const WALK_FRAME_MS = 120;
/** A waiting person moves their weight from one foot to the other this often. */
export const SHIFT_MS = 1400;
/** An impatient waiter glances at their watch once in this long, for GLANCE_MS. */
export const GLANCE_EVERY_MS = 3200;
export const GLANCE_MS = 700;

/**
 * A small per person offset into every cycle, so a queue does not step, shift or glance in
 * lockstep. A pure function of the id.
 */
export function phaseOf(id: number, periodMs: number): number {
  return (mix(id) % 997) * (periodMs / 997);
}

/** The walk frame `elapsedMs` into the cycle: stand, stride, mirrored stride, 120 ms each. */
export function walkFrameAt(elapsedMs: number): SimFrame {
  const t = Math.max(0, Math.floor(elapsedMs / WALK_FRAME_MS));
  return (t % SIM_FRAMES.length) as SimFrame;
}

/**
 * A walker counts as stepping while its position changed this recently. At 1x a tick is 100 ms,
 * so a walker on the move always qualifies; a paused game, or a walker held up, stands still
 * instead of walking on the spot.
 */
export const WALK_HOLD_MS = 300;
export function isStepping(lastMoveMs: number | undefined, nowMs: number): boolean {
  return lastMoveMs !== undefined && nowMs - lastMoveMs < WALK_HOLD_MS;
}

/**
 * What a person on screen is doing, as far as the drawing cares. walk: on the move. wait: at a
 * hall call. impatient: waiting past STORY.longWaitMinutes. sit and browse: an activity inside a
 * room. still: standing, nothing to show.
 */
export type Pose = 'walk' | 'wait' | 'impatient' | 'sit' | 'browse' | 'still';

/**
 * The frame one person shows at `nowMs`. walk: the three frame cycle. wait: the weight shift,
 * one side then the other every SHIFT_MS. impatient: the same shift, with a glance at the watch
 * for GLANCE_MS once every GLANCE_EVERY_MS. sit, browse, still: held.
 *
 * Under reduced motion every pose holds its first frame (a walker stands, a waiter rests on one
 * side) and the impatient glance is held as a static tilt, so impatience still reads.
 * dx and dy are kept for the renderer's draw offset; the illustrated poses move inside the art.
 */
export function poseAt(
  pose: Pose,
  id: number,
  nowMs: number,
  reducedMotion: boolean,
): { frame: PersonFrame; dx: number; dy: number } {
  const still = (frame: PersonFrame): { frame: PersonFrame; dx: number; dy: number } => ({ frame, dx: 0, dy: 0 });
  switch (pose) {
    case 'sit':
      return still(FRAME.sit);
    case 'browse':
      return still(FRAME.browse);
    case 'still':
      return still(FRAME.stand);
    case 'walk':
      return still(reducedMotion ? FRAME.stand : walkFrameAt(nowMs + phaseOf(id, WALK_FRAME_MS * 3)));
    case 'wait':
    case 'impatient': {
      if (reducedMotion) return still(pose === 'impatient' ? FRAME.glance : FRAME.shiftLeft);
      if (pose === 'impatient') {
        const g = (nowMs + phaseOf(id, GLANCE_EVERY_MS)) % GLANCE_EVERY_MS;
        if (g < GLANCE_MS) return still(FRAME.glance);
      }
      const side = Math.floor((nowMs + phaseOf(id, SHIFT_MS * 2)) / SHIFT_MS) & 1;
      return still(side ? FRAME.shiftRight : FRAME.shiftLeft);
    }
  }
}

/** An integer hash, so neighbouring ids do not get neighbouring phases. */
export function mix(id: number): number {
  let h = (Math.trunc(id) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

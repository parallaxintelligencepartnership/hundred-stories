// Motion rules for the things that move in the world: elevator doors, the walk cycle, the idle
// sway and the impatience shuffle, and the outfit a person wears. Pure functions, no pixi, so
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
export const WALK_FRAME_MS = 120;
export const SWAY_MS = 800;
export const SHUFFLE_MS = 400;
/** The idle sway lifts a waiting person this far, in art pixels. */
export const SWAY_PX = 1;
/** The impatience shuffle swings a red band person this far side to side, in art pixels. */
export const SHUFFLE_PX = 2;

/**
 * A small per person offset into every cycle, so a queue does not step, bob or shuffle in
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

/** What a person on screen is doing, as far as the drawing cares. */
export type Pose = 'walk' | 'wait' | 'fret' | 'still';

/**
 * The frame and the pixel offset for one person at `nowMs`. walk: the three frame cycle. wait:
 * standing, lifted SWAY_PX every other SWAY_MS. fret (waiting in the red band): standing,
 * swinging SHUFFLE_PX side to side every SHUFFLE_MS. still, or any pose under reduced
 * motion: standing, no offset.
 */
export function poseAt(
  pose: Pose,
  id: number,
  nowMs: number,
  reducedMotion: boolean,
): { frame: SimFrame; dx: number; dy: number } {
  if (reducedMotion || pose === 'still') return { frame: 0, dx: 0, dy: 0 };
  if (pose === 'walk') return { frame: walkFrameAt(nowMs + phaseOf(id, WALK_FRAME_MS * 3)), dx: 0, dy: 0 };
  if (pose === 'wait') {
    const up = Math.floor((nowMs + phaseOf(id, SWAY_MS * 2)) / SWAY_MS) & 1;
    return { frame: 0, dx: 0, dy: up ? -SWAY_PX : 0 };
  }
  const side = Math.floor((nowMs + phaseOf(id, SHUFFLE_MS * 2)) / SHUFFLE_MS) & 1;
  return { frame: 0, dx: side ? SHUFFLE_PX / 2 : -SHUFFLE_PX / 2, dy: 0 };
}

// ---------------------------------------------------------------------------
// Outfits
// ---------------------------------------------------------------------------

/** Four colour sets: a main colour (coat, hat) and a trim (belt, bag). */
export const OUTFIT_COLOURS = [
  { main: 0x2f5c9e, trim: 0xc98a45 }, // navy and tan
  { main: 0x2f7d3a, trim: 0xf7f7f2 }, // green and cream
  { main: 0x8c3050, trim: 0xc9a227 }, // maroon and gold
  { main: 0x1f7d7d, trim: 0x8e87a3 }, // teal and heather
] as const;

export interface Outfit {
  hat: boolean;
  bag: boolean;
  coat: boolean;
  colours: 0 | 1 | 2 | 3;
}

/** Every outfit packs into five bits: two for the colour set, then coat, hat, bag. */
export const OUTFIT_COUNT = 32;

/** An integer hash, so neighbouring ids do not get neighbouring outfits. */
function mix(id: number): number {
  let h = (Math.trunc(id) ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The outfit code a person wears, 0 to OUTFIT_COUNT - 1, a pure function of their id: stable
 * across frames and across saves, because the id is saved and nothing else is consulted.
 */
export function outfitCodeOf(id: number): number {
  return mix(id) % OUTFIT_COUNT;
}

export function decodeOutfit(code: number): Outfit {
  const c = ((Math.trunc(code) % OUTFIT_COUNT) + OUTFIT_COUNT) % OUTFIT_COUNT;
  return { colours: (c & 3) as Outfit['colours'], coat: (c & 4) !== 0, hat: (c & 8) !== 0, bag: (c & 16) !== 0 };
}

export function outfitOf(id: number): Outfit {
  return decodeOutfit(outfitCodeOf(id));
}

/**
 * The crowd atlas's share of an outfit: the colour set and the coat, the two parts that read
 * at crowd zoom. Hat and bag are drawn on sprites only (the atlas budget, see renderer.ts).
 */
export const PARTICLE_OUTFIT_MASK = 7;
export const PARTICLE_OUTFITS = PARTICLE_OUTFIT_MASK + 1;
export function particleOutfitOf(code: number): number {
  return code & PARTICLE_OUTFIT_MASK;
}

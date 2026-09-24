// Motion rules: the door frame picker and the door tween (look round ship L3), the walk cycle by
// elapsed time, and the package 2 poses: the waiting weight shift, the impatient glance, the held
// activity poses, reduced motion, and the mirrored frames that share a texture.

import { describe, expect, it } from 'vitest';
import {
  canonicalFrame,
  DOOR_FRAMES,
  DOOR_TWEEN_MS,
  doorFrameOf,
  FRAME,
  GLANCE_EVERY_MS,
  GLANCE_MS,
  isMirrored,
  isStepping,
  poseAt,
  SHIFT_MS,
  stepDoor,
  walkFrameAt,
  WALK_FRAME_MS,
} from '../../src/render/anim';
import { poseOf } from '../../src/render/renderer';
import { STORY } from '../../src/sim/rules';
import type { Sim } from '../../src/sim/types';

describe('door frames', () => {
  it('bakes five positions from closed to open', () => {
    expect(DOOR_FRAMES).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });

  it('picks the nearest baked frame for a position', () => {
    expect(doorFrameOf(0)).toBe(0);
    expect(doorFrameOf(0.12)).toBe(0);
    expect(doorFrameOf(0.13)).toBe(1);
    expect(doorFrameOf(0.25)).toBe(1);
    expect(doorFrameOf(0.5)).toBe(2);
    expect(doorFrameOf(0.74)).toBe(3);
    expect(doorFrameOf(0.9)).toBe(4);
    expect(doorFrameOf(1)).toBe(4);
  });

  it('clamps positions outside 0 to 1 and treats nonsense as closed', () => {
    expect(doorFrameOf(-3)).toBe(0);
    expect(doorFrameOf(7)).toBe(4);
    expect(doorFrameOf(Number.NaN)).toBe(0);
  });

  it('slides fully open in 240 ms and fully closed in 240 ms', () => {
    expect(DOOR_TWEEN_MS).toBe(240);
    expect(stepDoor(0, true, 120, false)).toBeCloseTo(0.5);
    expect(stepDoor(0, true, 240, false)).toBe(1);
    expect(stepDoor(0.5, true, 1000, false)).toBe(1); // never past open
    expect(stepDoor(1, false, 60, false)).toBeCloseTo(0.75);
    expect(stepDoor(1, false, 240, false)).toBe(0);
    expect(stepDoor(0.2, false, 1000, false)).toBe(0); // never past closed
  });

  it('walks through every baked frame on the way open at 60 fps', () => {
    let p = 0;
    const frames = new Set<number>();
    for (let t = 0; t < DOOR_TWEEN_MS + 20; t += 1000 / 60) {
      frames.add(doorFrameOf(p));
      p = stepDoor(p, true, 1000 / 60, false);
    }
    frames.add(doorFrameOf(p));
    expect([...frames].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('snaps under reduced motion', () => {
    expect(stepDoor(0, true, 0, true)).toBe(1);
    expect(stepDoor(1, false, 0, true)).toBe(0);
    expect(stepDoor(0.4, true, 16, true)).toBe(1);
  });
});

describe('walk cycle', () => {
  it('steps stand, stride, mirrored stride at 120 ms a frame', () => {
    expect(WALK_FRAME_MS).toBe(120);
    expect(walkFrameAt(0)).toBe(0);
    expect(walkFrameAt(119)).toBe(0);
    expect(walkFrameAt(120)).toBe(1);
    expect(walkFrameAt(239)).toBe(1);
    expect(walkFrameAt(240)).toBe(2);
    expect(walkFrameAt(360)).toBe(0);
    expect(walkFrameAt(360 * 100 + 250)).toBe(2);
  });

  it('walks a walker through all three frames and holds a standing person still', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 360; t += 40) seen.add(poseAt('walk', 11, t, false).frame);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    for (let t = 0; t < 2000; t += 50) expect(poseAt('still', 11, t, false)).toEqual({ frame: 0, dx: 0, dy: 0 });
  });

  it('counts a walker as stepping only while its position keeps changing', () => {
    expect(isStepping(undefined, 1000)).toBe(false);
    expect(isStepping(1000, 1100)).toBe(true); // moved a tick ago at 1x
    expect(isStepping(1000, 1299)).toBe(true);
    expect(isStepping(1000, 1300)).toBe(false); // paused, or held up
  });

  it('puts neighbours out of step', () => {
    const frames = new Set<number>();
    for (let id = 0; id < 12; id++) frames.add(poseAt('walk', id, 1000, false).frame);
    expect(frames.size).toBeGreaterThan(1);
  });
});

describe('waiting, impatience and activity poses (package 2)', () => {
  it('shifts a waiting person from one foot to the other every 1.4 s, and never glances', () => {
    const at = (t: number): number => poseAt('wait', 4, t, false).frame;
    const seen = new Set<number>();
    let changes = 0;
    for (let t = 0; t < 8 * SHIFT_MS; t += 10) {
      seen.add(at(t));
      if (at(t) !== at(t + 10)) changes++;
    }
    expect([...seen].sort()).toEqual([FRAME.shiftLeft, FRAME.shiftRight].sort());
    expect(changes).toBe(8);
  });

  it('adds a glance at the watch for 700 ms in every 3.2 s once impatient', () => {
    let glancing = 0;
    const samples = GLANCE_EVERY_MS * 5;
    for (let t = 0; t < samples; t += 10) if (poseAt('impatient', 9, t, false).frame === FRAME.glance) glancing += 10;
    expect(glancing / samples).toBeCloseTo(GLANCE_MS / GLANCE_EVERY_MS, 1);
    const others = new Set<number>();
    for (let t = 0; t < samples; t += 10) others.add(poseAt('impatient', 9, t, false).frame);
    expect(others.has(FRAME.shiftLeft) || others.has(FRAME.shiftRight)).toBe(true);
  });

  it('holds activity poses: sitting and browsing do not move', () => {
    for (let t = 0; t < 3000; t += 70) {
      expect(poseAt('sit', 3, t, false).frame).toBe(FRAME.sit);
      expect(poseAt('browse', 3, t, false).frame).toBe(FRAME.browse);
    }
  });

  it('holds every pose on its first frame under reduced motion, the impatient glance as a static tilt', () => {
    const first: Record<string, number> = { walk: FRAME.stand, still: FRAME.stand, wait: FRAME.shiftLeft, impatient: FRAME.glance, sit: FRAME.sit, browse: FRAME.browse };
    for (const pose of ['walk', 'wait', 'impatient', 'still', 'sit', 'browse'] as const) {
      for (let t = 0; t < 5000; t += 70) expect(poseAt(pose, 9, t, true)).toEqual({ frame: first[pose], dx: 0, dy: 0 });
    }
  });

  it('bakes the mirrored stride and the right shift as their twins, flipped', () => {
    expect(canonicalFrame(FRAME.strideMirrored)).toBe(FRAME.stride);
    expect(canonicalFrame(FRAME.shiftRight)).toBe(FRAME.shiftLeft);
    for (const f of [FRAME.stand, FRAME.stride, FRAME.shiftLeft, FRAME.glance, FRAME.sit, FRAME.browse]) {
      expect(canonicalFrame(f)).toBe(f);
      expect(isMirrored(f)).toBe(false);
    }
    expect(isMirrored(FRAME.strideMirrored)).toBe(true);
    expect(isMirrored(FRAME.shiftRight)).toBe(true);
  });
});

describe('poseOf: what a person is doing, from their state', () => {
  function sim(state: Sim['state'], waitStart: number | null = null): Sim {
    return {
      id: 4, kind: 'worker', homeRoomId: null, pos: { floor: 2, x: 10 }, inCarId: null, inRoomId: 1, route: [], state, stress: 0,
      waitStart, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
    };
  }

  it('walks while stepping, stands when held up', () => {
    expect(poseOf(sim('walking'), true, 100)).toBe('walk');
    expect(poseOf(sim('leaving'), false, 100)).toBe('still');
  });

  it('turns impatient once a wait passes STORY.longWaitMinutes', () => {
    expect(poseOf(sim('waiting', 100), false, 100 + STORY.longWaitMinutes)).toBe('wait');
    expect(poseOf(sim('waiting', 100), false, 101 + STORY.longWaitMinutes)).toBe('impatient');
  });

  it('sits at an office or a restaurant, browses in a shop, stands in a hotel room', () => {
    expect(poseOf(sim('inRoom'), false, 0, 'office')).toBe('sit');
    expect(poseOf(sim('inRoom'), false, 0, 'restaurant')).toBe('sit');
    expect(poseOf(sim('inRoom'), false, 0, 'shop')).toBe('browse');
    expect(poseOf(sim('inRoom'), false, 0, 'hotelSingle')).toBe('still');
  });

  it('sits at home on the sofa, in a cinema seat and in the medical waiting room (package 8b)', () => {
    expect(poseOf(sim('inRoom'), false, 0, 'condo')).toBe('sit');
    expect(poseOf(sim('inRoom'), false, 0, 'cinema')).toBe('sit');
    expect(poseOf(sim('inRoom'), false, 0, 'medical')).toBe('sit');
    expect(poseOf(sim('inRoom'), false, 0, 'security')).toBe('still');
  });
});

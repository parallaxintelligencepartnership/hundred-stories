// Motion rules from look round ship L3: the door frame picker and the door tween, the walk
// cycle by elapsed time, the sway and the shuffle, and the outfit as a pure function of the id.

import { describe, expect, it } from 'vitest';
import {
  decodeOutfit,
  DOOR_FRAMES,
  DOOR_TWEEN_MS,
  doorFrameOf,
  OUTFIT_COUNT,
  outfitCodeOf,
  outfitOf,
  PARTICLE_OUTFITS,
  particleOutfitOf,
  isStepping,
  poseAt,
  SHUFFLE_MS,
  stepDoor,
  SWAY_MS,
  walkFrameAt,
  WALK_FRAME_MS,
} from '../../src/render/anim';

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

  it('walks a walker through all three frames and holds everyone else still', () => {
    const seen = new Set<number>();
    for (let t = 0; t < 360; t += 40) seen.add(poseAt('walk', 11, t, false).frame);
    expect([...seen].sort()).toEqual([0, 1, 2]);
    for (let t = 0; t < 2000; t += 50) {
      expect(poseAt('wait', 11, t, false).frame).toBe(0);
      expect(poseAt('fret', 11, t, false).frame).toBe(0);
      expect(poseAt('still', 11, t, false)).toEqual({ frame: 0, dx: 0, dy: 0 });
    }
  });

  it('bobs a waiting person 1 px every 800 ms', () => {
    const at = (t: number): number => poseAt('wait', 4, t, false).dy;
    const values = new Set<number>();
    for (let t = 0; t < 4 * SWAY_MS; t += 100) values.add(at(t));
    expect([...values].sort()).toEqual([-1, 0]);
    // a change happens only on an 800 ms boundary of this person's phase
    let changes = 0;
    for (let t = 0; t < 8 * SWAY_MS; t += 10) if (at(t) !== at(t + 10)) changes++;
    expect(changes).toBe(8);
  });

  it('shuffles a red band waiter 2 px side to side every 400 ms', () => {
    const at = (t: number): number => poseAt('fret', 4, t, false).dx;
    const values = new Set<number>();
    for (let t = 0; t < 4 * SHUFFLE_MS; t += 50) values.add(at(t));
    expect(Math.max(...values) - Math.min(...values)).toBe(2);
    let changes = 0;
    for (let t = 0; t < 8 * SHUFFLE_MS; t += 10) if (at(t) !== at(t + 10)) changes++;
    expect(changes).toBe(8);
  });

  it('holds every pose still under reduced motion', () => {
    for (const pose of ['walk', 'wait', 'fret', 'still'] as const) {
      for (let t = 0; t < 2000; t += 70) expect(poseAt(pose, 9, t, true)).toEqual({ frame: 0, dx: 0, dy: 0 });
    }
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

describe('outfits', () => {
  it('is a pure function of the id, the same on every call', () => {
    for (let id = 0; id < 500; id++) {
      expect(outfitCodeOf(id)).toBe(outfitCodeOf(id));
      expect(outfitOf(id)).toEqual(outfitOf(id));
      expect(outfitCodeOf(id)).toBeGreaterThanOrEqual(0);
      expect(outfitCodeOf(id)).toBeLessThan(OUTFIT_COUNT);
    }
  });

  it('is the same across a save round trip, which keeps only the id', () => {
    const ids = [1, 2, 3, 97, 4096, 123457];
    const before = ids.map(outfitCodeOf);
    const reloaded = (JSON.parse(JSON.stringify(ids)) as number[]).map(outfitCodeOf);
    expect(reloaded).toEqual(before);
  });

  it('pins a few ids so the look of a saved tower cannot drift', () => {
    expect([1, 2, 3, 4, 5, 1000].map(outfitCodeOf)).toEqual([18, 7, 17, 15, 18, 15]);
  });

  it('spreads hat, bag, coat and all four colour sets across a crowd', () => {
    const codes = new Set<number>();
    const colours = new Set<number>();
    let hats = 0;
    let bags = 0;
    let coats = 0;
    for (let id = 1; id <= 400; id++) {
      codes.add(outfitCodeOf(id));
      const o = outfitOf(id);
      colours.add(o.colours);
      if (o.hat) hats++;
      if (o.bag) bags++;
      if (o.coat) coats++;
    }
    expect(codes.size).toBe(OUTFIT_COUNT);
    expect([...colours].sort()).toEqual([0, 1, 2, 3]);
    for (const n of [hats, bags, coats]) {
      expect(n).toBeGreaterThan(120);
      expect(n).toBeLessThan(280);
    }
  });

  it('decodes every code and keeps the colour set and coat for the crowd atlas', () => {
    for (let c = 0; c < OUTFIT_COUNT; c++) {
      const o = decodeOutfit(c);
      const p = decodeOutfit(particleOutfitOf(c));
      expect(p.colours).toBe(o.colours);
      expect(p.coat).toBe(o.coat);
      expect(p.hat).toBe(false);
      expect(p.bag).toBe(false);
      expect(particleOutfitOf(c)).toBeLessThan(PARTICLE_OUTFITS);
    }
  });
});

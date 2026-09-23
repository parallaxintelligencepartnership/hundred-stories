// Motion: the commit-before-the-last-tick interpolation the renderer draws moving things with.
// Pure, so the frame loop is simulated here by hand: no pixi, no game.

import { describe, expect, it } from 'vitest';
import { Motion, TELEPORT_TILES } from '../../src/render/interpolate';
import { TILE_PX } from '../../src/render/grid';

const TILE = TILE_PX;
const TELEPORT_PX = TELEPORT_TILES * TILE;
const Y = 100;

describe('Motion', () => {
  it('draws a night 4x walk as uniform, monotonic motion, and holds still on a batch that does not move', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    const key = 1;
    let tile = 0; // one tile a tick
    let accumulator = 0;
    motion.target(key, tile * TILE, Y);
    let prev = motion.at(key, 0)!.x;

    // 320 ticks a second at 60 frames a second: 5.33 ticks a frame, batches of five and six.
    const perFrame = 320 / 60;
    const batches: number[] = [];
    for (let frame = 0; frame < 12; frame++) {
      accumulator += perFrame;
      const n = Math.floor(accumulator);
      accumulator -= n;
      batches.push(n);
      for (let t = 0; t < n; t++) {
        if (t === n - 1) motion.commit(key, tile * TILE, Y); // before the last tick
        tile++;
      }
      expect(motion.target(key, tile * TILE, Y)).toBe(false);
      const x = motion.at(key, accumulator)!.x;
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(x - prev - n * TILE)).toBeLessThanOrEqual(TILE);
      prev = x;
    }
    expect(batches).toContain(5);
    expect(batches).toContain(6);

    // A batch in which the entity stands still: commit and target agree, so every alpha is the target.
    accumulator += perFrame;
    const n = Math.floor(accumulator);
    accumulator -= n;
    for (let t = 0; t < n; t++) if (t === n - 1) motion.commit(key, tile * TILE, Y);
    motion.target(key, tile * TILE, Y);
    for (const alpha of [0, 0.25, 0.5, 0.999]) {
      expect(motion.at(key, alpha)).toEqual({ x: tile * TILE, y: Y });
    }
    expect(motion.at(key, 0)!.x).toBeGreaterThanOrEqual(prev);
  });

  it('snaps a 13 tile jump and lerps a 5 tile one', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.target(1, 0, Y);
    motion.commit(1, 0, Y);
    expect(motion.target(1, 13 * TILE, Y)).toBe(true);
    expect(motion.at(1, 0)).toEqual({ x: 13 * TILE, y: Y });

    motion.target(2, 0, Y);
    motion.commit(2, 0, Y);
    expect(motion.target(2, 5 * TILE, Y)).toBe(false);
    expect(motion.at(2, 0)).toEqual({ x: 0, y: Y });
    expect(motion.at(2, 0.5)).toEqual({ x: 2.5 * TILE, y: Y });
  });

  it('snaps a vertical jump past the threshold too', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.target(1, 0, 0);
    motion.commit(1, 0, 0);
    expect(motion.target(1, 0, TELEPORT_PX + 1)).toBe(true);
    expect(motion.at(1, 0)).toEqual({ x: 0, y: TELEPORT_PX + 1 });
  });

  it('places a new key without motion and ignores a commit for a key it has never drawn', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.commit(1, 0, 0);
    expect(motion.has(1)).toBe(false);
    motion.target(1, 5 * TILE, Y);
    expect(motion.at(1, 0)).toEqual({ x: 5 * TILE, y: Y });
  });

  it('parks a key on a fixed point at every alpha', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.target(1, 0, Y);
    motion.commit(1, 0, Y);
    motion.target(1, 3 * TILE, Y);
    motion.park(1, 40, 60);
    expect(motion.at(1, 0)).toEqual({ x: 40, y: 60 });
    expect(motion.at(1, 0.7)).toEqual({ x: 40, y: 60 });
  });

  it('forgets one key, and reset forgets them all', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.target(1, 0, 0);
    motion.target(2, 8, 0);
    motion.target(3, 16, 0);

    motion.forget(2);
    expect(motion.has(1)).toBe(true);
    expect(motion.has(2)).toBe(false);
    expect(motion.at(2, 0.5)).toBeUndefined();
    expect(motion.has(3)).toBe(true);

    motion.reset();
    expect(motion.has(1)).toBe(false);
    expect(motion.has(3)).toBe(false);
  });

  it('after a reset, a far target is a fresh placement, not a slide', () => {
    const motion = new Motion<number>(TELEPORT_PX);
    motion.target(1, 0, Y);
    motion.commit(1, 0, Y);
    motion.reset();
    motion.target(1, 5 * TILE, Y);
    expect(motion.at(1, 0)).toEqual({ x: 5 * TILE, y: Y });
  });
});

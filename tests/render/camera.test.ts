// Pure math behind the tower view: the floor axis, the camera and the sky keyframes.
// No DOM and no pixi objects are constructed here.

import { describe, expect, it } from 'vitest';
import { FLOOR_PX, TILE_PX } from '../../src/render/art';
import {
  createCamera,
  floorBand,
  floorBandFloat,
  floorBaseY,
  floorTopY,
  MAX_ZOOM,
  MIN_ZOOM,
  nearestSnap,
  xToTile,
  yToFloor,
} from '../../src/render/camera';
import { nightness, skyAt, skyBackground } from '../../src/render/sky';

describe('floor axis', () => {
  it('puts the floor 1 slab at y = 0 and stacks floors upward', () => {
    expect(floorBaseY(1)).toBe(0);
    expect(floorTopY(1)).toBe(-FLOOR_PX);
    expect(floorTopY(2)).toBe(-2 * FLOOR_PX);
    expect(floorBaseY(10)).toBe(-9 * FLOOR_PX);
  });

  it('runs underground floors down from y = 0 with no floor 0', () => {
    expect(floorTopY(-1)).toBe(0);
    expect(floorBaseY(-1)).toBe(FLOOR_PX);
    expect(floorTopY(-2)).toBe(FLOOR_PX);
    expect(floorBand(-3)).toBe(-2);
  });

  it('round trips a world y back to its floor', () => {
    for (const floor of [-10, -3, -1, 1, 2, 17, 100]) {
      expect(yToFloor(floorTopY(floor) + FLOOR_PX / 2)).toBe(floor);
    }
    expect(yToFloor(0)).toBe(-1); // the slab line belongs to the floor below it
    expect(yToFloor(-1)).toBe(1);
  });

  it('keeps a car crossing the ground line monotone', () => {
    const samples = [-1, -0.5, 0, 0.5, 1].map(floorBandFloat);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i] as number).toBeGreaterThan(samples[i - 1] as number);
    }
    expect(floorBandFloat(1)).toBe(floorBand(1));
    expect(floorBandFloat(-1)).toBe(floorBand(-1));
  });

  it('maps world x to tiles', () => {
    expect(xToTile(0)).toBe(0);
    expect(xToTile(TILE_PX * 3 + 2)).toBe(3);
    expect(xToTile(-1)).toBe(-1);
  });
});

describe('camera', () => {
  it('centers on a floor and tile', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(3, 100);
    expect(cam.x).toBeCloseTo(100.5 * TILE_PX);
    expect(cam.y).toBeCloseTo(floorTopY(3) + FLOOR_PX / 2);
    const screen = cam.worldToScreen(cam.x, cam.y);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeCloseTo(300);
  });

  it('pans by screen pixels scaled by zoom', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(5, 150);
    const before = cam.x;
    cam.zoomAt(2, 400, 300);
    cam.panBy(100, 0);
    expect(cam.x).toBeCloseTo(before + 50);
  });

  it('holds the world point under the cursor while zooming and clamps the range', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(4, 120);
    const before = cam.screenToWorld(700, 120);
    cam.zoomAt(1.8, 700, 120);
    const after = cam.screenToWorld(700, 120);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);

    cam.zoomAt(100, 400, 300);
    expect(cam.zoom).toBe(MAX_ZOOM);
    cam.zoomAt(0.001, 400, 300);
    expect(cam.zoom).toBe(MIN_ZOOM);
  });

  it('snaps the zoom to a crisp step once the wheel stops', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.wheel(-120, 400, 300); // zoom in a little, off the snap steps
    expect(cam.zoom).toBeGreaterThan(1);
    expect(cam.zoom).toBeLessThan(2);
    for (let i = 0; i < 60; i++) cam.update(16);
    expect(cam.zoom).toBe(nearestSnap(cam.zoom));
    expect([MIN_ZOOM, 0.5, 1, 2, 3]).toContain(cam.zoom);
  });

  it('glides after a drag and stops, unless reduced motion is on', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(3, 150);
    cam.dragStart(400, 300, 0);
    cam.dragMove(340, 300, 16);
    cam.dragMove(280, 300, 32);
    cam.dragEnd();
    const released = cam.x;
    cam.update(16);
    expect(cam.x).toBeGreaterThan(released);
    for (let i = 0; i < 200; i++) cam.update(16);
    const resting = cam.x;
    cam.update(16);
    expect(cam.x).toBe(resting);

    const still = createCamera();
    still.setViewport(800, 600);
    still.setReducedMotion(true);
    still.centerOn(3, 150);
    still.dragStart(400, 300, 0);
    still.dragMove(340, 300, 16);
    still.dragEnd();
    const stopped = still.x;
    still.update(16);
    expect(still.x).toBe(stopped);
  });

  it('pans while a key is held and stops when it is released', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(3, 150);
    const start = cam.x;
    cam.setKey('KeyD', true);
    cam.update(100);
    expect(cam.x).toBeGreaterThan(start);
    cam.setKey('KeyD', false);
    const held = cam.x;
    cam.update(100);
    expect(cam.x).toBe(held);
  });
});

describe('sky', () => {
  it('lands exactly on the VISUAL keyframes', () => {
    expect(skyAt(0)).toEqual({ top: 0x070b1a, bottom: 0x070b1a });
    expect(skyAt(6 * 60)).toEqual({ top: 0xf0a070, bottom: 0x4a5a9a });
    expect(skyAt(12 * 60)).toEqual({ top: 0x8fc4f0, bottom: 0xd8ecfa });
    expect(skyAt(18 * 60)).toEqual({ top: 0xf06a4a, bottom: 0x2a2f6a });
    expect(skyBackground(12 * 60)).toBe(0x8fc4f0);
  });

  it('interpolates between keyframes and wraps around midnight', () => {
    const mid = skyAt(9 * 60);
    expect(mid.top).not.toBe(skyAt(6 * 60).top);
    expect(mid.top).not.toBe(skyAt(12 * 60).top);
    expect(skyAt(1440)).toEqual(skyAt(0));
    expect(skyAt(-60)).toEqual(skyAt(23 * 60));
  });

  it('reports night for window lighting', () => {
    expect(nightness(2 * 60)).toBe(1);
    expect(nightness(12 * 60)).toBe(0);
    expect(nightness(18 * 60 + 30)).toBeGreaterThan(0);
    expect(nightness(18 * 60 + 30)).toBeLessThan(1);
  });
});

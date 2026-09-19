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

  it('frames the opening shot with the street about two thirds down', () => {
    const cam = createCamera();
    cam.setViewport(1280, 900);
    cam.zoom = 1;
    cam.centerOn(6, 187);
    cam.setGroundLine(0.68);
    expect(cam.worldToScreen(0, 0).y).toBeCloseTo(0.68 * 900, 4);
    expect(cam.zoom).toBe(1);
    // Sky above the street, earth below it.
    expect(cam.screenToWorld(640, 10).y).toBeLessThan(0);
    expect(cam.screenToWorld(640, 890).y).toBeGreaterThan(0);
  });

  it('resets back to the opening shot after the player scrolls into the concrete', () => {
    const cam = createCamera();
    cam.setViewport(1280, 900);
    cam.setGroundLine(0.68);
    cam.zoomAt(2.5, 640, 450);
    cam.panBy(4000, 4000); // lost underground
    expect(cam.worldToScreen(0, 0).y).not.toBeCloseTo(0.68 * 900, 1);
    cam.reset();
    expect(cam.zoom).toBe(1);
    expect(cam.worldToScreen(0, 0).y).toBeCloseTo(0.68 * 900, 4);
    cam.update(16);
    expect(cam.worldToScreen(0, 0).y).toBeCloseTo(0.68 * 900, 4); // no leftover inertia
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

  it('ignores a left drag while panning is off, and still pans on a forced drag', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(3, 150);
    cam.setPanEnabled(false);
    expect(cam.isPanEnabled()).toBe(false);

    const start = cam.x;
    cam.dragStart(400, 300, 0);
    cam.dragMove(300, 300, 16);
    cam.dragEnd();
    cam.update(16);
    expect(cam.x).toBe(start); // the build tool owns the left button

    // Middle button and space held force the drag through.
    cam.dragStart(400, 300, 0, true);
    cam.dragMove(300, 300, 16);
    cam.dragEnd();
    expect(cam.x).toBeGreaterThan(start);
  });

  it('keeps keys and wheel working while panning is off', () => {
    const cam = createCamera();
    cam.setViewport(800, 600);
    cam.centerOn(3, 150);
    cam.setPanEnabled(false);
    const start = cam.x;
    const zoom = cam.zoom;
    cam.setKey('KeyD', true);
    cam.update(100);
    cam.setKey('KeyD', false);
    expect(cam.x).toBeGreaterThan(start);
    cam.wheel(-120, 400, 300);
    expect(cam.zoom).toBeGreaterThan(zoom);
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
  it('lands exactly on the corrected VISUAL keyframes', () => {
    // Bright flat day for most of the day, deep blue night, never black.
    expect(skyAt(12 * 60)).toEqual({ top: 0x9fd3f5, bottom: 0xdcefff });
    expect(skyAt(9 * 60)).toEqual(skyAt(12 * 60));
    expect(skyAt(0)).toEqual({ top: 0x0d1b3d, bottom: 0x1c2f5c });
    expect(skyAt(6 * 60).bottom).toBe(0xf6b98a); // dawn
    expect(skyAt(18 * 60 + 30).bottom).toBe(0xe08a7a); // dusk
    expect(skyBackground(12 * 60)).toBe(0x9fd3f5);
  });

  it('keeps dawn and dusk to about one hour and wraps around midnight', () => {
    const dawn = skyAt(6 * 60 + 15);
    expect(dawn.bottom).not.toBe(0xf6b98a);
    expect(dawn.bottom).not.toBe(0xdcefff);
    expect(skyAt(6 * 60 + 30)).toEqual(skyAt(12 * 60)); // day by half past six
    expect(skyAt(19 * 60)).toEqual(skyAt(0)); // night by seven
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

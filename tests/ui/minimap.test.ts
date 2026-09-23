// The minimap: when it shows, what it spans, where a click sends the camera, and what it redraws.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCamera, floorTopY } from '../../src/render/camera';
import { FLOOR_PX } from '../../src/render/grid';
import {
  MINIMAP_W,
  cameraTarget,
  createMinimap,
  minimapGeometry,
  minimapVisible,
  readView,
  towerExtent,
  viewportRect,
} from '../../src/ui/minimap';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

let nextId = 1;
function tower(floors: number, opts: { basement?: number } = {}): { rooms: Map<number, unknown>; shafts: Map<number, unknown>; structureVersion: number } {
  const rooms = new Map<number, unknown>();
  rooms.set(nextId, { id: nextId++, kind: 'lobby', floor: 1, x: 180, width: 20, height: 1 });
  for (let f = 2; f <= floors; f += 1) rooms.set(nextId, { id: nextId++, kind: 'office', floor: f, x: 185, width: 9, height: 1 });
  if (opts.basement) rooms.set(nextId, { id: nextId++, kind: 'parkingRamp', floor: -opts.basement, x: 170, width: 16, height: 1 });
  const shafts = new Map<number, unknown>();
  shafts.set(nextId, { id: nextId++, kind: 'standard', x: 200, width: 4, floorMin: 1, floorMax: floors });
  return { rooms, shafts, structureVersion: 1 };
}

describe('visibility rule', () => {
  // A 900 px view with 56 px of status bar and 28 px of ticker leaves a 816 px free band.
  const band = 900 - 56 - 28;
  it.each([
    ['a 5 floor tower fits at zoom 1', 5, 1, false],
    ['an 11 floor tower fits at zoom 1 (792 px)', 11, 1, false],
    ['a 12 floor tower does not (864 px)', 12, 1, true],
    ['a 30 floor tower does not', 30, 1, true],
    ['a 30 floor tower fits zoomed out to 0.35 (756 px)', 30, 0.35, false],
    ['a 100 floor tower does not even then', 100, 0.35, true],
  ])('%s', (_name, floors, zoom, visible) => {
    expect(minimapVisible(floors, zoom, band)).toBe(visible);
    expect(floors * FLOOR_PX * zoom > band).toBe(visible);
  });

  it('shows nothing for an empty lot', () => {
    expect(towerExtent({ rooms: new Map(), shafts: new Map() } as never)).toBeNull();
    expect(minimapVisible(0, 1, 100)).toBe(false);
  });
});

describe('extent and geometry', () => {
  it('spans rooms, shafts and basements in bands, floor 0 skipped', () => {
    const extent = towerExtent(tower(30, { basement: 2 }) as never);
    expect(extent).toEqual({ bandTop: 30, bandBottom: -1, xMin: 170, xMax: 204 });
    const g = minimapGeometry(extent!, MINIMAP_W, 280);
    expect(g.rowPx).toBe(4); // 32 floors fit at the tallest row
    expect(g.height).toBe(32 * 4);
    // A tower taller than the map squeezes its rows rather than grow past it.
    const tall = minimapGeometry({ bandTop: 400, bandBottom: -9, xMin: 0, xMax: 375 }, MINIMAP_W, 280);
    expect(tall.height).toBe(280);
  });
});

describe('camera', () => {
  function setup(): { camera: ReturnType<typeof createCamera>; chrome: { top: number; bottom: number } } {
    const camera = createCamera();
    camera.setViewport(1440, 900);
    const chrome = { top: 56, bottom: 28 };
    camera.setObstruction(chrome.top, chrome.bottom);
    return { camera, chrome };
  }

  it('reads the viewport from the camera without measuring the page', () => {
    const { camera, chrome } = setup();
    const view = readView(camera, chrome);
    expect(view.viewW).toBeCloseTo(1440);
    expect(view.viewH).toBeCloseTo(900);
    expect(dom.measures).toBe(0);
  });

  it('maps a click to the camera y that centres that floor in the free band', () => {
    const { camera, chrome } = setup();
    const extent = towerExtent(tower(30) as never)!;
    const g = minimapGeometry(extent, MINIMAP_W, 280);
    // The middle of floor 20's row: rows count down from the top band.
    const my = (extent.bandTop - 20 + 0.5) * g.rowPx;
    const target = cameraTarget(g, MINIMAP_W / 2, my, readView(camera, chrome));
    camera.panBy((target.x - camera.x) * camera.zoom, (target.y - camera.y) * camera.zoom);
    const floorMid = floorTopY(20) + FLOOR_PX / 2;
    const bandMid = chrome.top + (900 - chrome.top - chrome.bottom) / 2;
    expect(camera.worldToScreen(camera.x, floorMid).y).toBeCloseTo(bandMid);
    // And the outline now straddles that row.
    const rect = viewportRect(g, readView(camera, chrome));
    expect(rect.y).toBeLessThan(my);
    expect(rect.y + rect.h).toBeGreaterThan(my);
  });

  it('moves the camera from a pointer press and a drag on the map', () => {
    const { camera, chrome } = setup();
    const world = tower(30);
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => chrome });
    map.refresh();
    expect(map.isVisible()).toBe(true);
    const overlay = map.node.children[1] as unknown as FakeElement;
    const fire = (type: string, offsetY: number): void => {
      for (const fn of overlay.listeners.get(type) ?? []) fn({ pointerId: 1, offsetX: MINIMAP_W / 2, offsetY, preventDefault() {} });
    };
    const rowPx = 4;
    fire('pointerdown', (30 - 25 + 0.5) * rowPx);
    const bandMid = chrome.top + (900 - chrome.top - chrome.bottom) / 2;
    expect(camera.worldToScreen(0, floorTopY(25) + FLOOR_PX / 2).y).toBeCloseTo(bandMid);
    fire('pointermove', (30 - 10 + 0.5) * rowPx);
    expect(camera.worldToScreen(0, floorTopY(10) + FLOOR_PX / 2).y).toBeCloseTo(bandMid);
    fire('pointerup', 0);
    fire('pointermove', (30 - 2 + 0.5) * rowPx); // no longer dragging
    expect(camera.worldToScreen(0, floorTopY(10) + FLOOR_PX / 2).y).toBeCloseTo(bandMid);
    map.destroy();
  });
});

describe('redraws', () => {
  it('draws the tower on a structure change and the outline on a camera move, nothing otherwise', () => {
    const camera = createCamera();
    camera.setViewport(1440, 900);
    const world = tower(30);
    const chrome = { top: 56, bottom: 28 };
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => chrome });
    const counts = { tower: 0, outline: 0 };
    const ctx = (layer: 'tower' | 'outline'): unknown => ({
      setTransform() {},
      clearRect() {
        counts[layer] += 1;
      },
      fillRect() {},
      strokeRect() {},
    });
    const [base, overlay] = map.node.children as unknown as [Record<string, unknown>, Record<string, unknown>];
    base['getContext'] = () => ctx('tower');
    overlay['getContext'] = () => ctx('outline');

    dom.runFrame();
    expect(counts).toEqual({ tower: 1, outline: 1 });
    dom.runFrame();
    dom.runFrame();
    expect(counts).toEqual({ tower: 1, outline: 1 });

    camera.panBy(0, -200);
    dom.runFrame();
    expect(counts).toEqual({ tower: 1, outline: 2 });

    world.structureVersion += 1;
    dom.runFrame();
    expect(counts).toEqual({ tower: 2, outline: 2 });

    // Zoomed out far enough that the tower fits: hidden, and nothing drawn.
    camera.zoomAt(0.3, 720, 450);
    dom.runFrame();
    expect(map.isVisible()).toBe(false);
    expect((map.node as unknown as FakeElement).classList.contains('is-hidden')).toBe(true);
    expect(dom.measures).toBe(0);
    map.destroy();
  });
});

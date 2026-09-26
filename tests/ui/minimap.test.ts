// The minimap: when it shows, what it spans, where a click sends the camera, and what it redraws.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCamera, floorTopY } from '../../src/render/camera';
import { FLOOR_PX } from '../../src/render/grid';
import {
  MINIMAP_MOVE_MS,
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
  // A 900 px view with 84 px of chrome over it leaves a 816 px free band.
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

describe('on a phone and beside a card', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the phone map only while the camera moves and 1.5 s after, then goes at once', () => {
    (globalThis as { window: { matchMedia: unknown } }).window.matchMedia = () => ({ matches: true }); // a phone
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const camera = createCamera();
    camera.setViewport(390, 844);
    const world = tower(30); // far taller than the screen at zoom 1
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => ({ top: 64, bottom: 0 }) });
    const hidden = (): boolean => (map.node as unknown as FakeElement).classList.contains('is-hidden');

    map.refresh();
    expect([map.isVisible(), hidden()]).toEqual([false, true]); // the player is watching, not travelling
    now = 100;
    camera.panBy(0, -200);
    map.refresh();
    expect([map.isVisible(), hidden()]).toEqual([true, false]);
    now = 100 + MINIMAP_MOVE_MS - 1;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now = 100 + MINIMAP_MOVE_MS;
    map.refresh();
    expect([map.isVisible(), hidden()]).toEqual([false, true]); // no fade: gone on the frame
    now = 5000;
    camera.panBy(40, 0);
    map.refresh();
    expect(map.isVisible()).toBe(true);
    expect(MINIMAP_MOVE_MS).toBe(1500);
    map.destroy();
  });

  it('keeps the phone map through a pan held still, and counts the 1.5 s from the lift', () => {
    (globalThis as { window: { matchMedia: unknown } }).window.matchMedia = () => ({ matches: true }); // a phone
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const camera = createCamera();
    camera.setViewport(390, 844);
    const world = tower(30);
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => ({ top: 64, bottom: 0 }) });
    map.refresh();
    // A finger goes down and pans, then holds still for far longer than 1.5 s.
    now = 100;
    dom.fireWindow('pointerdown', { pointerId: 7 });
    now = 150;
    camera.panBy(0, -200);
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now = 150 + 3 * MINIMAP_MOVE_MS;
    map.refresh();
    expect(map.isVisible()).toBe(true); // mid drag: never hidden
    // The lift starts the count.
    const lift = now;
    dom.fireWindow('pointerup', { pointerId: 7 });
    now = lift + MINIMAP_MOVE_MS - 1;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now = lift + MINIMAP_MOVE_MS;
    map.refresh();
    expect(map.isVisible()).toBe(false);
    // A press that moves nothing does not bring the map up.
    now = 20_000;
    dom.fireWindow('pointerdown', { pointerId: 8 });
    map.refresh();
    expect(map.isVisible()).toBe(false);
    dom.fireWindow('pointercancel', { pointerId: 8 });
    map.destroy();
  });

  function phoneMap(now: { t: number }) {
    (globalThis as { window: { matchMedia: unknown } }).window.matchMedia = () => ({ matches: true }); // a phone
    vi.spyOn(performance, 'now').mockImplementation(() => now.t);
    const camera = createCamera();
    camera.setViewport(390, 844);
    const world = tower(30);
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => ({ top: 64, bottom: 0 }) });
    map.refresh();
    return { camera, map };
  }

  it('forgets a cancelled press: the next pan shows the map and it still goes 1.5 s after the lift', () => {
    const now = { t: 100 };
    const { camera, map } = phoneMap(now);
    // The browser takes a press for its own scroll: the pointer is cancelled, never lifted.
    dom.fireWindow('pointerdown', { pointerId: 3 });
    now.t = 120;
    dom.fireWindow('pointercancel', { pointerId: 3 });
    // Later, a pan of its own, pressed and lifted.
    now.t = 5000;
    dom.fireWindow('pointerdown', { pointerId: 4 });
    camera.panBy(0, -200);
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now.t = 5200;
    dom.fireWindow('pointerup', { pointerId: 4 });
    now.t = 5200 + MINIMAP_MOVE_MS - 1;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now.t = 5200 + MINIMAP_MOVE_MS;
    map.refresh();
    expect(map.isVisible()).toBe(false);
    map.destroy();
  });

  it('keeps the map through a pinch until the last finger lifts', () => {
    const now = { t: 100 };
    const { camera, map } = phoneMap(now);
    dom.fireWindow('pointerdown', { pointerId: 1 });
    dom.fireWindow('pointerdown', { pointerId: 2 });
    now.t = 150;
    camera.panBy(0, -200);
    map.refresh();
    // One finger lifts; the other still holds, still for a long while.
    now.t = 200;
    dom.fireWindow('pointerup', { pointerId: 1 });
    now.t = 200 + 2 * MINIMAP_MOVE_MS;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    // The last finger lifts: the count starts there.
    const lift = now.t;
    dom.fireWindow('pointerup', { pointerId: 2 });
    now.t = lift + MINIMAP_MOVE_MS - 1;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    now.t = lift + MINIMAP_MOVE_MS;
    map.refresh();
    expect(map.isVisible()).toBe(false);
    map.destroy();
  });

  it('keeps the phone alerts on one right edge whether the map shows or not', () => {
    const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
    const start = css.indexOf('/* On a phone the alerts sit under the status bar');
    const phone = css.slice(start, css.indexOf('.hs-toast {', start));
    const always = /\.hs-toasts \{[^}]*?\n\s*right: ([^;]+);/.exec(phone)?.[1];
    const withMap = /\.hs-minimap:not\(\.is-hidden\) ~ \.hs-toasts \{\s*right: ([^;]+);/.exec(phone)?.[1];
    expect(always).toBe('calc(64px + 2 * var(--edge) + var(--safe-right))');
    expect(withMap).toBe(always);
    // The edge leaves the phone map's 64 px column free.
    expect(/\.hs-minimap \{[^}]*width: (\d+)px;/.exec(css.slice(css.indexOf('@media (max-width: 720px) {\n  /* A phone\'s bottom belongs')))?.[1]).toBe('64');
  });

  it('keeps the desktop map up while the camera is still', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const camera = createCamera();
    camera.setViewport(1440, 900);
    const world = tower(30);
    const map = createMinimap({ camera, getWorld: () => world as never, getChrome: () => ({ top: 56, bottom: 28 }) });
    map.refresh();
    now = 60_000;
    map.refresh();
    expect(map.isVisible()).toBe(true);
    map.destroy();
  });

  it('hides the map behind an open card on a wide screen instead of stepping it left onto the tower', () => {
    const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
    const body = /@media \(min-width: 900px\) \{\s*\.hs-ui\.is-panel-open \.hs-minimap \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(body).toContain('display: none;');
    expect(body).not.toContain('right');
  });
});

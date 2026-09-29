// The first frame (design pass 2026-09-25, package P1): the opening framing (D-1, BB-1), the
// load fade on the wall clock from the chrome's steel (D-2), and a lobby run drawn as one hall
// (D-11). Drives the real createRenderer against a stub pixi Application and stub art, as
// reconcile.test.ts does: no GPU, no DOM, real pixi Containers and Graphics.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { FLOOR_PX, TILE_PX } from '../../src/render/art';
import { floorBaseY, floorTopY, MIN_ZOOM } from '../../src/render/camera';
import { createRenderer, lobbyRuns, OPENING_ZOOM, towerSpan, wholeTowerGroundLine, type Renderer, type RendererOptions } from '../../src/render/renderer';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

const apps = vi.hoisted(
  () => [] as { stage: import('pixi.js').Container; frames: (() => void)[]; ticker: { deltaMS: number }; screen: { width: number; height: number } }[],
);

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = {
      style: {} as Record<string, string>,
      addEventListener: (): void => {},
      removeEventListener: (): void => {},
    };
    renderer = { background: { color: 0 }, render: (): void => {} };
    frames: (() => void)[] = [];
    ticker = {
      add: (fn: () => void): void => {
        this.frames.push(fn);
      },
      remove: (): void => {},
      deltaMS: 16,
    };
    constructor() {
      apps.push(this);
    }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: FakeApplication, isWebGLSupported: () => true };
});

const textures = new Map<string, Texture>();
function tex(key: string): Texture {
  let t = textures.get(key);
  if (!t) textures.set(key, (t = new Texture({ label: key })));
  return t;
}
const stubArt: Art = {
  room: (kind, width, height, variant, state) => tex(`room|${kind}|${width}|${height}|${variant}|${state}`),
  slab: (width) => tex(`slab|${width}`),
  shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  car: (kind) => tex(`car|${kind}`),
  sim: (kind, band, frame) => tex(`sim|${kind}|${band}|${frame}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

let renderers: Renderer[] = [];
let clock = 0;
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(world: World, options: RendererOptions = {}, screen?: { width: number; height: number }) {
  const container = { appendChild: () => {} } as unknown as HTMLElement;
  const renderer = await createRenderer(container, world, options);
  renderers.push(renderer);
  const app = apps[apps.length - 1];
  if (!app) throw new Error('no application was created');
  const frame = (dtMs: number): void => {
    app.ticker.deltaMS = dtMs;
    for (const fn of app.frames) fn();
  };
  if (screen) {
    app.screen.width = screen.width;
    app.screen.height = screen.height;
    frame(16); // the frame loop picks the new size up
  }
  return { renderer, stage: app.stage, frame };
}

function room(world: World, kind: RoomKind, floor: number, x: number, width: number, height = 1): Room {
  const r: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width,
    height,
    eval: 0.7,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
  };
  addRoom(world, r);
  return r;
}

/** A lobby run on floor 1 and an office on every floor from 2 to `top`, 20 tiles wide at x 100. */
function tower(top: number): World {
  const world = createWorld(1);
  world.time.minute = 12 * 60;
  for (let x = 100; x < 120; x++) room(world, 'lobby', 1, x, 1);
  for (let f = 2; f <= top; f++) room(world, 'office', f, 100, 9);
  return world;
}

function labelled(root: Container, label: string): Graphics {
  let found: Graphics | null = null;
  const walk = (node: Container): void => {
    if (node instanceof Graphics && node.label === label) found = node;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  if (!found) throw new Error(`no Graphics labelled ${label}`);
  return found;
}

/** The fills a Graphics holds: each rect's box, colour and alpha. */
function fills(g: Graphics): { x: number; y: number; w: number; h: number; color: number; alpha: number }[] {
  const out: { x: number; y: number; w: number; h: number; color: number; alpha: number }[] = [];
  for (const instruction of g.context.instructions) {
    if (instruction.action !== 'fill') continue;
    const { style, path } = instruction.data as unknown as { style: { color: number; alpha: number }; path: { instructions: { action: string; data: number[] }[] } };
    for (const p of path.instructions) {
      if (p.action !== 'rect') continue;
      const [x, y, w, h] = p.data as [number, number, number, number];
      out.push({ x, y, w, h, color: style.color, alpha: style.alpha });
    }
  }
  return out;
}

describe('opening framing (D-1, BB-1)', () => {
  it('opens a tower that fits the free band whole, at zoom 0.5, centered in the band', async () => {
    const world = tower(4);
    const { renderer } = await mount(world);
    renderer.setChrome(80, 0);
    expect(renderer.camera.zoom).toBe(OPENING_ZOOM);
    const roof = renderer.camera.worldToScreen(0, floorTopY(4)).y;
    const street = renderer.camera.worldToScreen(0, floorBaseY(1)).y;
    // The tower's middle sits in the middle of the band under the 80 px bar.
    expect(Math.abs((roof + street) / 2 - (80 + (600 - 80) / 2))).toBeLessThanOrEqual(0.5);
    // Its middle column, 100 to 120 tiles, is in the middle of the screen.
    expect(Math.abs(renderer.camera.worldToScreen(110 * TILE_PX, 0).x - 400)).toBeLessThanOrEqual(0.5);
  });

  /** Screen y of the roof and of the lowest slab, and whether both sit inside the band. */
  function frameOf(renderer: Renderer, top: number, bottom: number) {
    const roof = renderer.camera.worldToScreen(0, floorTopY(top)).y;
    const base = renderer.camera.worldToScreen(0, floorBaseY(bottom)).y;
    return { roof, base, middle: (roof + base) / 2 };
  }

  it('zooms a tower too tall for the band below 0.5 until it shows whole, centered in the band', async () => {
    const { renderer } = await mount(tower(20));
    renderer.setChrome(80, 0);
    // 20 floors and one of sky, 1512 px, in a 520 px band.
    expect(renderer.camera.zoom).toBeCloseTo(520 / (21 * FLOOR_PX), 6);
    expect(renderer.camera.zoom).toBeLessThan(OPENING_ZOOM);
    const f = frameOf(renderer, 20, 1);
    expect(f.roof).toBeGreaterThanOrEqual(80);
    expect(f.base).toBeLessThanOrEqual(600);
    expect(Math.abs(f.middle - (80 + 520 / 2))).toBeLessThanOrEqual(0.5);
  });

  it('on a phone, a tall tower fits the band the palette leaves', async () => {
    const { renderer } = await mount(tower(30), {}, { width: 390, height: 844 });
    renderer.setChrome(120, 200);
    expect(renderer.camera.zoom).toBeCloseTo(524 / (31 * FLOOR_PX), 6);
    const f = frameOf(renderer, 30, 1);
    expect(f.roof).toBeGreaterThanOrEqual(120);
    expect(f.base).toBeLessThanOrEqual(644);
    expect(Math.abs(f.middle - (120 + 524 / 2))).toBeLessThanOrEqual(0.5);
  });

  it('zooms a tower too wide for the view out to its width, centered on it', async () => {
    const world = createWorld(1);
    world.time.minute = 12 * 60;
    for (let x = 20; x < 200; x++) room(world, 'lobby', 1, x, 1);
    room(world, 'office', 2, 20, 9);
    const { renderer } = await mount(world);
    renderer.setChrome(80, 0);
    // 180 tiles and a tile either side, 2912 px, in an 800 px view.
    expect(renderer.camera.zoom).toBeCloseTo(800 / (182 * TILE_PX), 6);
    expect(renderer.camera.worldToScreen(20 * TILE_PX, 0).x).toBeCloseTo(800 * (1 / 182), 3);
    expect(renderer.camera.worldToScreen(200 * TILE_PX, 0).x).toBeCloseTo(800 * (181 / 182), 3);
  });

  it('stops at MIN_ZOOM for a tower no zoom can show whole, still centered', async () => {
    const { renderer } = await mount(tower(100));
    renderer.setChrome(80, 0);
    expect(renderer.camera.zoom).toBe(MIN_ZOOM);
    expect(Math.abs(frameOf(renderer, 100, 1).middle - (80 + 520 / 2))).toBeLessThanOrEqual(0.5);
  });

  it('keeps the basement in the shot when the tower has one', async () => {
    const world = tower(20);
    room(world, 'parkingSpace', -3, 100, 4);
    const { renderer } = await mount(world);
    renderer.setChrome(80, 0);
    expect(renderer.camera.zoom).toBeCloseTo(520 / (24 * FLOOR_PX), 6);
    const f = frameOf(renderer, 20, -3);
    expect(f.roof).toBeGreaterThanOrEqual(80);
    expect(f.base).toBeLessThanOrEqual(600);
    expect(Math.abs(f.middle - (80 + 520 / 2))).toBeLessThanOrEqual(0.5);
  });

  it('frameTower reframes a swapped-in tower after the player moved, and hands the view back to the chrome', async () => {
    const { renderer } = await mount(tower(4));
    renderer.setChrome(80, 0);
    renderer.camera.panBy(900, 400); // through the player camera: the view is now the player's
    renderer.camera.zoomAt(2, 400, 300);
    renderer.setChrome(80, 0);
    expect(renderer.camera.zoom).not.toBe(OPENING_ZOOM); // a re-measure keeps the player's view

    const next = tower(20);
    renderer.frameTower(next);
    expect(renderer.camera.zoom).toBeCloseTo(520 / (21 * FLOOR_PX), 6);
    expect(Math.abs(frameOf(renderer, 20, 1).middle - (80 + 520 / 2))).toBeLessThanOrEqual(0.5);
    renderer.render(next, 1);
    renderer.setChrome(120, 0); // the game composes again until the player moves
    expect(renderer.camera.zoom).toBeCloseTo(480 / (21 * FLOOR_PX), 6);
  });

  it('frameTower on an empty lot is the zoom 1 opening', async () => {
    const { renderer } = await mount(tower(4));
    renderer.setChrome(80, 0);
    renderer.frameTower(createWorld(2));
    expect(renderer.camera.zoom).toBe(1);
    expect(Math.abs(renderer.camera.worldToScreen(0, 0).y - (80 + 0.68 * 520))).toBeLessThanOrEqual(0.5);
  });

  it('keeps an empty lot at zoom 1 with the street two thirds down', async () => {
    const world = createWorld(1);
    const { renderer } = await mount(world);
    renderer.setChrome(80, 0);
    expect(renderer.camera.zoom).toBe(1);
    expect(Math.abs(renderer.camera.worldToScreen(0, 0).y - (80 + 0.68 * 520))).toBeLessThanOrEqual(0.5);
  });

  it('waits for the chrome before opening whole: a view that never reports it stays at zoom 1', async () => {
    const { renderer } = await mount(tower(4));
    expect(renderer.camera.zoom).toBe(1);
  });

  it('counts the basement and a floor of sky in the fit', () => {
    const world = tower(8);
    room(world, 'parkingSpace', -3, 100, 4);
    expect(towerSpan(world)).toEqual({ top: 8, bottom: -3, built: true });
    // 8 floors up, 3 down, one of sky: 12 floors of 36 px at 0.5 is 432 px.
    expect(wholeTowerGroundLine(8, -3, 432)).not.toBeNull();
    expect(wholeTowerGroundLine(8, -3, 431)).toBeNull();
    expect(wholeTowerGroundLine(8, -3, 0)).toBeNull();
    expect(FLOOR_PX * OPENING_ZOOM * 12).toBe(432);
  });
});

describe('load fade (D-2)', () => {
  it('covers the view in the chrome steel until the first frame is drawn, however long that takes', async () => {
    const world = tower(3);
    const { stage, frame } = await mount(world);
    const cover = labelled(stage, 'load fade');
    for (let i = 0; i < 30; i++) {
      clock += 100;
      frame(100);
    }
    expect(cover.visible).toBe(true);
    expect(fills(cover)).toEqual([{ x: 0, y: 0, w: 800, h: 600, color: 0x1c232e, alpha: 1 }]);
  });

  it('lifts over 900 ms of wall clock after the first render, whatever the ticker says', async () => {
    const world = tower(3);
    const { renderer, stage, frame } = await mount(world);
    const cover = labelled(stage, 'load fade');
    renderer.render(world, 1);
    frame(100); // the fade starts here
    clock += 450;
    frame(100);
    expect(cover.visible).toBe(true);
    const half = fills(cover)[0];
    expect(half?.color).toBe(0x1c232e);
    expect(half?.alpha).toBeCloseTo(0.5, 5);
    clock += 440;
    frame(100);
    expect(cover.visible).toBe(true);
    clock += 10;
    frame(100);
    expect(cover.visible).toBe(false);
  });

  it('shows no cover at all with fadeIn false', async () => {
    const { stage, frame } = await mount(tower(3), { fadeIn: false });
    frame(16);
    expect(labelled(stage, 'load fade').visible).toBe(false);
  });

  it('under reduced motion drops the cover on the first frame after the first render, with no fade', async () => {
    const world = tower(3);
    const { renderer, stage, frame } = await mount(world);
    renderer.setReducedMotion(true);
    const cover = labelled(stage, 'load fade');
    frame(16);
    expect(cover.visible).toBe(true); // nothing drawn yet: the steel stays
    renderer.render(world, 1);
    frame(16);
    expect(cover.visible).toBe(false);
  });
});

describe('lobby runs (D-11)', () => {
  it('groups lobby tiles by floor and height into runs of touching tiles', () => {
    const world = createWorld(1);
    for (const x of [104, 100, 101, 103, 102]) room(world, 'lobby', 1, x, 1);
    room(world, 'lobby', 1, 107, 1); // a gap at 105 and 106
    room(world, 'office', 1, 108, 9);
    room(world, 'skyLobby', 15, 100, 1, 2);
    room(world, 'skyLobby', 15, 101, 1, 2);
    const runs = lobbyRuns(world.rooms.values()).sort((a, b) => a.floor - b.floor || a.x - b.x);
    expect(runs).toEqual([
      { floor: 1, height: 1, x: 100, end: 105 },
      { floor: 1, height: 1, x: 107, end: 108 },
      { floor: 15, height: 2, x: 100, end: 102 },
    ]);
  });

  it('draws each run once: a dark line at either end and one shadow face per floor', async () => {
    const world = createWorld(1);
    world.time.minute = 12 * 60;
    for (let x = 100; x < 104; x++) room(world, 'lobby', 1, x, 1);
    room(world, 'skyLobby', 15, 100, 1, 2);
    room(world, 'skyLobby', 15, 101, 1, 2);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const edges = fills(labelled(stage, 'lobby edges'));
    const y1 = floorTopY(1);
    const y15 = floorTopY(16);
    expect(edges).toEqual(
      expect.arrayContaining([
        { x: 1600, y: y1, w: 2, h: 72, color: 0x222222, alpha: 1 },
        { x: 1662, y: y1, w: 2, h: 72, color: 0x222222, alpha: 1 },
        { x: 1654, y: y1 + 22, w: 8, h: 44, color: 0xd7d7d4, alpha: 1 },
        { x: 1600, y: y15, w: 2, h: 144, color: 0x222222, alpha: 1 },
        { x: 1630, y: y15, w: 2, h: 144, color: 0x222222, alpha: 1 },
        { x: 1622, y: y15 + 22, w: 8, h: 44, color: 0xd7d7d4, alpha: 1 },
        { x: 1622, y: y15 + 72 + 22, w: 8, h: 44, color: 0xd7d7d4, alpha: 1 },
      ]),
    );
    expect(edges).toHaveLength(7);
  });
});

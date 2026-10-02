// R1 (2026-10-01): after a WebGL context loss and restore, the baked structural art (room
// shells, slabs, shafts, the ghost) drew blank until a reload. The renderer now listens for the
// canvas's webglcontextrestored, frees every bake (art.resetBaked) and rebuilds the static tower
// from the current world on the next render. This drives the real createRenderer against a stub
// pixi Application (as reconcile.test.ts does): it proves the wiring, the new textures on stage
// and no build feedback. That WebGL really draws them again is proven only in a browser, by the
// scratchpad gpu.mjs probe under software rendering; a real GPU and a phone are unverified.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld, markStructureChanged } from '../../src/sim/world';
import { REVEAL_COLOUR } from '../../src/render/buildfx';

type Listener = (event: unknown) => void;
const apps = vi.hoisted(
  () =>
    [] as {
      stage: import('pixi.js').Container;
      frames: (() => void)[];
      ticker: { deltaMS: number };
      canvas: { listeners: Map<string, Set<Listener>> };
    }[],
);

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = {
      style: {} as Record<string, string>,
      listeners: new Map<string, Set<Listener>>(),
      addEventListener(type: string, fn: Listener): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: Listener): void {
        this.listeners.get(type)?.delete(fn);
      },
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

// Stub art with a generation: resetBaked starts a new one, as a real reset makes every bake new.
// A texture's label is `${generation}#${key}`, so a test reads which bake a sprite shows.
const bakes = vi.hoisted(() => ({ generation: 0, resets: 0, fail: false }));
const textures = new Map<string, Texture>();
function tex(key: string, baked = true): Texture {
  const label = baked ? `${bakes.generation}#${key}` : key;
  let t = textures.get(label);
  if (!t) textures.set(label, (t = new Texture({ label })));
  return t;
}
const stubArt: Art = {
  room: (kind, width, height, variant, state) => tex(`room|${kind}|${width}|${height}|${variant}|${state}`),
  slab: (width) => tex(`slab|${width}`),
  shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  car: (kind, door) => tex(`car|${kind}|${doorFrameOf(door)}`, false),
  sim: (kind, band, frame, outfit) => tex(`sim|${kind}|${band}|${frame}|${outfit ?? -1}`, false),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
  resetBaked: () => {
    if (bakes.fail) throw new Error('reset failed');
    bakes.generation++;
    bakes.resets++;
    return 0;
  },
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

const NOON = 12 * 60;
let renderers: Renderer[] = [];
beforeEach(() => {
  bakes.generation = 0;
  bakes.resets = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
});

async function mount(world: World): Promise<{ renderer: Renderer; stage: Container; fire: (type: string) => void; listeners: Map<string, Set<Listener>> }> {
  const container = { appendChild: () => {} } as unknown as HTMLElement;
  const renderer = await createRenderer(container, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const fire = (type: string): void => {
    const event = { type, defaultPrevented: false, preventDefault(): void { this.defaultPrevented = true; } };
    for (const fn of app.canvas.listeners.get(type) ?? []) fn(event);
  };
  return { renderer, stage: app.stage, fire, listeners: app.canvas.listeners };
}

function sprites(root: Container, test: (label: string) => boolean): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite && !node.destroyed && test(node.texture?.label ?? '')) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}
const baked = (stage: Container): Sprite[] => sprites(stage, (l) => /^\d+#(room|slab|shaft|ghost)\|/.test(l));

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

function tower(): World {
  const world = createWorld(7);
  world.time.minute = NOON;
  makeRoom(world, 'office', 2, 100);
  makeRoom(world, 'office', 3, 100);
  const id = allocId(world);
  const car: Car = {
    id: allocId(world), shaftId: id, y: 1, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [],
    calls: new Set(), serves: 'any', range: null,
  };
  addShaft(world, { id, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 6, stops: new Set([1, 2, 3, 4, 5, 6]), homeFloor: 1, cars: [car], hallCalls: new Map() });
  return world;
}

describe('a restored WebGL context (R1)', () => {
  it('frees every bake and puts freshly baked rooms, slabs, shafts and the ghost on stage', async () => {
    const world = tower();
    const { renderer, stage, fire } = await mount(world);
    renderer.render(world, 1);
    renderer.setGhost({ widthTiles: 9, heightFloors: 1, floor: 4, x: 100, ok: true });
    renderer.render(world, 1);
    const before = baked(stage);
    expect(before.length).toBe(2 + 2 + 1 + 1); // two rooms, two slabs, a shaft piece, the ghost
    expect(before.every((s) => s.texture.label!.startsWith('0#'))).toBe(true);

    fire('webglcontextlost');
    fire('webglcontextrestored');
    expect(bakes.resets).toBe(1);
    renderer.render(world, 1);

    // The same structure, no version bump: every structural sprite now shows a new bake.
    const after = baked(stage);
    expect(after.length).toBe(before.length);
    expect(after.map((s) => s.texture.label!.slice(0, 2))).toEqual(after.map(() => '1#'));
    expect(sprites(stage, (l) => l.startsWith('0#'))).toEqual([]);
    // Nothing is announced as newly built: no reveal covers, no price.
    const reveals: Sprite[] = [];
    const walk = (n: Container): void => {
      if (n instanceof Sprite && n.texture === Texture.WHITE && n.tint === REVEAL_COLOUR) reveals.push(n);
      for (const c of n.children) walk(c as Container);
    };
    walk(stage);
    expect(reveals).toEqual([]);
  });

  it('a room built after the restore draws, and a second restore leaves one sprite per thing', async () => {
    const world = tower();
    const { renderer, stage, fire } = await mount(world);
    renderer.render(world, 1);
    fire('webglcontextrestored');
    renderer.render(world, 1);
    makeRoom(world, 'office', 4, 100);
    markStructureChanged(world);
    renderer.render(world, 1);
    fire('webglcontextrestored');
    fire('webglcontextrestored');
    renderer.render(world, 1);
    const rooms = baked(stage).filter((s) => s.texture.label!.includes('#room|'));
    const slabs = baked(stage).filter((s) => s.texture.label!.includes('#slab|'));
    const shafts = baked(stage).filter((s) => s.texture.label!.includes('#shaft|'));
    expect([rooms.length, slabs.length, shafts.length]).toEqual([3, 3, 1]);
    expect(baked(stage).every((s) => s.texture.label!.startsWith('3#'))).toBe(true);
  });

  // R1 review ADV-1: the tower is rebuilt inside the restore handler, so the first frame after it
  // (Pixi's ticker may draw before the game's render) has every shell, slab and shaft, each in the
  // window state it had, by day and at night.
  it.each([
    ['noon', NOON],
    ['22:00', 22 * 60],
  ])('the restore itself puts the whole tower back, in the same window states, at %s', async (_, minute) => {
    const world = tower();
    world.time.minute = minute;
    const { renderer, stage, fire } = await mount(world);
    renderer.render(world, 1);
    const keys = (gen: string): string[] =>
      baked(stage)
        .map((s) => s.texture.label!)
        .filter((l) => !l.includes('#ghost|'))
        .map((l) => {
          expect(l.startsWith(gen)).toBe(true);
          return l.slice(gen.length);
        })
        .sort();
    const before = keys('0#');
    expect(before.length).toBe(2 + 2 + 1);

    fire('webglcontextrestored');
    // No render yet: the stage as the very next frame would draw it.
    expect(keys('1#')).toEqual(before);
    // Pixi's ticker frame first, then the game's render: still one sprite per thing, all new.
    for (const frame of apps[apps.length - 1]!.frames) frame();
    renderer.render(world, 1);
    expect(keys('1#')).toEqual(before);
  });

  // R1 review ADV-2: a throw part way through the handler still leaves the next render to build
  // the tower from the world, not the window-only pass over an empty sprite table.
  it('a throw inside the restore handler still has the next render build every room', async () => {
    const world = tower();
    const { renderer, stage, fire } = await mount(world);
    renderer.render(world, 1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bakes.fail = true;
    fire('webglcontextrestored');
    bakes.fail = false;
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    renderer.render(world, 1);
    const rooms = baked(stage).filter((s) => s.texture.label!.includes('#room|'));
    const slabs = baked(stage).filter((s) => s.texture.label!.includes('#slab|'));
    const shafts = baked(stage).filter((s) => s.texture.label!.includes('#shaft|'));
    expect([rooms.length, slabs.length, shafts.length]).toEqual([2, 2, 1]);
  });

  // R1 review ADV-3: build feedback running over a room when the context comes back is landed,
  // not left playing its reveal over the rebuilt room.
  it('a restore during a build effect clears its reveal covers', async () => {
    const world = tower();
    const { renderer, stage, fire } = await mount(world);
    renderer.render(world, 1);
    makeRoom(world, 'office', 4, 100);
    markStructureChanged(world);
    renderer.render(world, 1);
    const reveals = (): Sprite[] => {
      const out: Sprite[] = [];
      const walk = (n: Container): void => {
        if (n instanceof Sprite && !n.destroyed && n.texture === Texture.WHITE && n.tint === REVEAL_COLOUR) out.push(n);
        for (const c of n.children) walk(c as Container);
      };
      walk(stage);
      return out;
    };
    expect(reveals().length).toBeGreaterThan(0);
    fire('webglcontextrestored');
    renderer.render(world, 1);
    expect(reveals()).toEqual([]);
  });

  it('takes its listener off in destroy', async () => {
    const world = tower();
    const { renderer, listeners } = await mount(world);
    expect(listeners.get('webglcontextrestored')?.size).toBe(1);
    renderer.destroy();
    renderers = [];
    expect(listeners.get('webglcontextrestored')?.size ?? 0).toBe(0);
  });
});

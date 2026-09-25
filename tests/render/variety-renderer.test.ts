// The renderer draws each room in the look interiorVariants gives it, neighbors considered: its
// fixture texture, its decor, its painted wall and its mirror, and remakes them when a new
// neighbor changes the look. Each shaft's cars wear the shaft's finish. Driven through the real
// createRenderer against a stub pixi Application and stub art, like reconcile.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { TILE_PX } from '../../src/render/grid';
import { carFinishes } from '../../src/render/illustrated';
import { interiorFlip, interiorVariant, interiorVariants, lookOf } from '../../src/render/interiors';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, Shaft, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld, markStructureChanged } from '../../src/sim/world';

const apps = vi.hoisted(() => [] as { stage: import('pixi.js').Container; frames: (() => void)[]; ticker: { deltaMS: number } }[]);

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = { style: {} as Record<string, string>, addEventListener: (): void => {}, removeEventListener: (): void => {} };
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
  car: (kind, door, finish) => tex(`car|${kind}|${doorFrameOf(door)}|${finish ?? 0}`),
  sim: (kind, band, frame, outfit) => tex(`sim|${kind}|${band}|${frame}|${outfit ?? -1}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
  interior: (kind, w, h, base) => tex(`interior|${kind}|${w}|${h}|${base}`),
  decor: (piece, fine) => tex(`decor|${piece}|${fine}`),
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
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
});

async function mount(world: World): Promise<{ renderer: Renderer; stage: Container }> {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world, {});
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  return { renderer, stage: app.stage };
}

function sprites(root: Container, prefix: string): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite && node.texture.label?.startsWith(prefix)) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}

/** The painted wall sprites: the shared white texture, tinted. */
function whites(root: Container): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite && node.texture === Texture.WHITE) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

function makeShaft(world: World, x: number, cars: number): Shaft {
  const id = allocId(world);
  const shaft: Shaft = { id, kind: 'standard', x, width: SHAFTS.standard.width, floorMin: 1, floorMax: 6, stops: new Set([1, 2, 3, 4, 5, 6]), homeFloor: 1, cars: [], hallCalls: new Map() };
  for (let i = 0; i < cars; i++) {
    const car: Car = { id: allocId(world), shaftId: id, y: 1 + i * 2, dir: 0, state: 'idle', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null };
    shaft.cars.push(car);
  }
  addShaft(world, shaft);
  return shaft;
}

/** A world whose first two offices, side by side, pick the same look on their own. */
function clashingOffices(): { world: World; a: Room; b: Room } {
  for (let seed = 1; seed < 500; seed++) {
    const world = createWorld(seed);
    world.time.minute = 12 * 60;
    const a = makeRoom(world, 'office', 3, 100);
    const b = makeRoom(world, 'office', 3, 109);
    if (interiorVariant(seed, a) === interiorVariant(seed, b)) return { world, a, b };
  }
  throw new Error('no clash found');
}

/** The fixture sprite over a room: an interior sprite whose span covers the room's left edge. */
function fixturesOf(stage: Container, room: Room): Sprite {
  const px = room.x * TILE_PX;
  const w = room.width * TILE_PX;
  const hit = sprites(stage, `interior|${room.kind}`).filter((s) => (s.scale.x < 0 ? s.x - w : s.x) === px);
  expect(hit).toHaveLength(1);
  return hit[0]!;
}

describe('the renderer draws each room in its look', () => {
  it('gives two side by side offices that would clash different looks, with each look\'s base, decor and mirror', async () => {
    const { world, a, b } = clashingOffices();
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const looks = interiorVariants(world.seed, world.rooms.values());
    expect(looks.get(a.id)).not.toBe(looks.get(b.id));
    for (const room of [a, b]) {
      const look = lookOf('office', looks.get(room.id)!);
      const fixtures = fixturesOf(stage, room);
      expect(fixtures.texture.label).toBe(`interior|office|9|1|${look.base}`);
      const flip = interiorFlip(world.seed, room);
      expect(fixtures.scale.x < 0).toBe(flip);
      // Its decor: one sprite per placement, over this room.
      const px = room.x * TILE_PX;
      const w = room.width * TILE_PX;
      const mine = sprites(stage, 'decor|').filter((s) => s.parent!.x === px);
      expect(mine.map((s) => s.texture.label).sort()).toEqual(look.decor.map((p) => `decor|${p.piece}|true`).sort());
      for (const s of mine) expect(s.scale.x < 0).toBe(flip);
      if (flip) expect(fixtures.x).toBe(px + w);
      // Its painted wall, when the look has one.
      const walls = whites(stage).filter((s) => s.parent!.x === px);
      if (look.wall !== null) expect(walls.map((s) => s.tint)).toContain(look.wall);
      else expect(walls).toHaveLength(0);
    }
  });

  it('never repaints a built room when a newer one goes up beside it: build A, then B to its left', async () => {
    // Two offices that pick the same look on their own. A (the lower id) is built first at x 109;
    // B (the higher id, as every later build is) goes up after, to its left at x 100.
    const clash = clashingOffices();
    const world = clash.world;
    const A = clash.a;
    const B = clash.b;
    A.x = 109;
    B.x = 100;
    world.rooms.delete(B.id);
    markStructureChanged(world);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const fixtures = fixturesOf(stage, A);
    const label = fixtures.texture.label;
    const decorOfA = (): (string | undefined)[] => sprites(stage, 'decor|').filter((s) => s.parent!.x === A.x * TILE_PX).map((s) => s.texture.label);
    const decor = decorOfA();
    expect(label).toBe(`interior|office|9|1|${lookOf('office', interiorVariant(world.seed, A)).base}`);
    addRoom(world, B);
    markStructureChanged(world);
    renderer.render(world, 1);
    // A's sprites are the same objects, untouched: nothing was remade for the old room.
    expect(fixturesOf(stage, A)).toBe(fixtures);
    expect(fixtures.texture.label).toBe(label);
    expect(decorOfA()).toEqual(decor);
    const now = interiorVariants(world.seed, world.rooms.values());
    expect(now.get(A.id)).toBe(interiorVariant(world.seed, A));
    // Only the newer room moved away from the clash.
    expect(now.get(B.id)).not.toBe(now.get(A.id));
  });
});

describe('the renderer dresses each shaft\'s cars in one finish', () => {
  it('shows every car of a shaft in its finish, and two neighboring shafts in different ones', async () => {
    const world = createWorld(12);
    world.time.minute = 12 * 60;
    const left = makeShaft(world, 100, 2);
    const right = makeShaft(world, 110, 2);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const finishes = carFinishes(world.seed, world.shafts.values());
    expect(finishes.get(left.id)).not.toBe(finishes.get(right.id));
    const cars = sprites(stage, 'car|');
    expect(cars).toHaveLength(4);
    const byShaft = (shaft: Shaft): string[] =>
      cars.filter((s) => Math.abs(s.x - (shaft.x + shaft.width / 2) * TILE_PX) < TILE_PX).map((s) => s.texture.label!.split('|')[3]!);
    expect(byShaft(left)).toEqual([String(finishes.get(left.id)), String(finishes.get(left.id))]);
    expect(byShaft(right)).toEqual([String(finishes.get(right.id)), String(finishes.get(right.id))]);
  });
});

// What a big crowd costs the renderer over one game day (package P3, the "sluggish over 750 people"
// report). A mixed tower of about 900 people (offices, condos, a hotel, food, shops, a cinema) is
// warmed up for two days, then its third day is ticked and rendered frame by frame through the
// real createRenderer against a stub pixi Application, in the reconcile.test.ts style: no GPU.
//
// F1: the full static tower pass (every room, slab, venue and shaft) runs only when the structure
// changes. People coming and going (a room's occupancy crossing zero) re-read window states only.
// F2: with the real art (on a fake canvas), every person on screen draws from one person atlas,
// baked at boot and kept: the live person textures stay at that one, whatever the crowd does.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Sprite, Texture, type Renderer as PixiRenderer, type TextureSource } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { applyCommand } from '../../src/sim/build';
import { ROOMS, SHAFTS } from '../../src/sim/rules';
import { tick } from '../../src/sim/tick';
import type { Command, RoomKind, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';

const apps = vi.hoisted(() => [] as { frames: (() => void)[]; ticker: { deltaMS: number } }[]);
const realArt = vi.hoisted(() => ({ create: null as null | ((r: unknown, o: unknown) => unknown) }));
// Every full static pass calls carFinishes once (reconcileShafts), and nothing else does.
const passes = vi.hoisted(() => ({ full: 0 }));

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

vi.mock('../../src/render/illustrated', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/render/illustrated')>();
  return {
    ...mod,
    carFinishes: (...args: Parameters<typeof mod.carFinishes>) => {
      passes.full++;
      return mod.carFinishes(...args);
    },
  };
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
  car: (kind, door) => tex(`car|${kind}|${doorFrameOf(door)}`),
  sim: (kind, band, frame, look) => tex(`sim|${kind}|${band}|${frame}|${look ?? -1}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
  interior: (kind, w, h, v) => tex(`interior|${kind}|${w}|${h}|${v}`),
  sign: (_kind, _w, name) => tex(`sign|${name}`),
  glow: () => tex('glow'),
  shut: (kind, w, h) => tex(`shut|${kind}|${w}|${h}`),
  mark: (mark) => tex(`mark|${mark}`),
};
const artHolder = vi.hoisted(() => ({ art: null as unknown }));
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  realArt.create = art.createArt as (r: unknown, o: unknown) => unknown;
  return { ...art, createArt: () => (artHolder.art as Art | null) ?? stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

let renderers: Renderer[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
  passes.full = 0;
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  artHolder.art = null;
  vi.unstubAllGlobals();
});

/** The diagnosis's mixed tower (scratch mixed.ts, six office floors): about 900 people. */
function mixedTower(): World {
  const W = 180;
  const world = createWorld(777);
  world.cash = 5_000_000_000;
  world.stars = 3;
  const ok = (c: Command): void => void applyCommand(world, c);
  for (let x = 0; x < W; x++) ok({ kind: 'build', room: 'lobby', floor: 1, x });
  const row = (floor: number, kind: RoomKind, from = 0, to = W): void => {
    const w = ROOMS[kind].width;
    for (let x = from; x + w <= to; x += w) ok({ kind: 'build', room: kind, floor, x });
  };
  let f = 2;
  row(f, 'fastFood', 0, 80);
  row(f, 'restaurant', 80, 152);
  row(f, 'fastFood', 152, 168);
  row(f, 'shop', 168, 180);
  f++;
  row(f, 'shop');
  f++;
  ok({ kind: 'build', room: 'cinema', floor: f, x: 0 });
  row(f, 'shop', 32, W);
  f++;
  row(f, 'shop', 32, W);
  f++;
  for (let i = 0; i < 6; i++, f++) row(f, 'office');
  for (let i = 0; i < 4; i++, f++) row(f, 'condo');
  ok({ kind: 'build', room: 'housekeeping', floor: f, x: 0 });
  row(f, 'hotelTwin', 16, W);
  f++;
  for (let i = 0; i < 2; i++, f++) row(f, 'hotelTwin');
  ok({ kind: 'build', room: 'security', floor: f, x: 0 });
  const top = f;
  for (const x of [20, 88, 156]) ok({ kind: 'shaft.build', shaft: 'standard', x, floorMin: 1, floorMax: top });
  for (const shaft of [...world.shafts.values()]) for (let c = 1; c < SHAFTS.standard.maxCars; c++) ok({ kind: 'shaft.addCar', shaftId: shaft.id });
  while (world.time.minute < 3 * 1440) tick(world);
  return world;
}

// Built and warmed once: the day under test starts from the same tower in every test.
let warmed: World | null = null;
function tower(): World {
  warmed ??= mixedTower();
  return warmed;
}

async function mount(world: World): Promise<{ renderer: Renderer; frame: () => void; stage: Container }> {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  // The whole tower in view, as the opening shot shows it: nobody is culled.
  renderer.camera.zoom = 0.5;
  renderer.camera.centerOn(12, 90);
  const frame = (): void => {
    app.ticker.deltaMS = 16;
    for (const fn of app.frames) fn();
  };
  return { renderer, frame, stage: (app as unknown as { stage: Container }).stage };
}

describe('one day at about 900 people', () => {
  it('runs the full static pass only when the structure changes, never for people coming and going', async () => {
    const world = tower();
    expect(world.population).toBeGreaterThan(750);
    const { renderer, frame } = await mount(world);
    renderer.render(world, 1);
    frame();
    // The structure, read from the world itself (not from structureVersion, whose meaning is what
    // is under test): rooms and their kinds, shafts and their spans, cars, and the rooms on fire.
    const structure = (w: World): string => {
      const rooms = [...w.rooms.values()].map((r) => `${r.id}:${r.kind}:${r.onFire ? 1 : 0}`).join(',');
      const shafts = [...w.shafts.values()].map((s) => `${s.id}:${s.floorMin}:${s.floorMax}:${s.cars.length}`).join(',');
      return `${rooms}|${shafts}`;
    };
    let structureChanges = 1; // the first pass
    let seen = structure(world);
    const start = world.time.minute;
    while (world.time.minute < start + 1440) {
      tick(world);
      const now = structure(world);
      if (now !== seen) {
        structureChanges++;
        seen = now;
      }
      renderer.render(world, 1);
      frame();
    }
    process.stderr.write(`full static passes over one day: ${passes.full}; structure changes: ${structureChanges}; population ${world.population}\n`);
    expect(passes.full).toBe(structureChanges);
  }, 120_000);
});

/** The real art on a fake canvas and a fake pixi renderer, as art-classes.test.ts: no GPU. */
function realArtOnAFakeCanvas(): Art {
  const noop = (): void => {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText' ? () => ({ width: 20 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop,
      set: () => true,
    },
  );
  const createCanvas = (width: number, height: number): HTMLCanvasElement => ({ width, height, getContext: () => ctx }) as unknown as HTMLCanvasElement;
  const renderer = { generateTexture: (): Texture => new Texture() } as unknown as PixiRenderer;
  return realArt.create!(renderer, { createCanvas, resolution: 1 }) as Art;
}

describe('one day at about 900 people, real art', () => {
  it('draws every person from one baked person atlas: the live person textures stay at that one all day', async () => {
    const world = tower();
    const art = realArtOnAFakeCanvas();
    artHolder.art = art;
    const { renderer, frame, stage } = await mount(world);
    const personTextures = (): number => Object.keys(art.stats!().byKey).filter((key) => key.startsWith('person:')).length;
    let peakTextures = 0;
    let peakDrawn = 0;
    const sources = new Set<TextureSource>();
    const start = world.time.minute;
    while (world.time.minute < start + 1440) {
      tick(world);
      renderer.render(world, 1);
      frame();
      peakTextures = Math.max(peakTextures, personTextures());
      if (world.time.minute % 30 !== 0) continue;
      // Every half hour: what the person sprites on the stage are drawn from.
      let drawn = 0;
      const walk = (node: Container): void => {
        if (node instanceof Sprite && node.texture.label?.startsWith('person:')) {
          drawn++;
          sources.add(node.texture.source);
        }
        for (const child of node.children) walk(child as Container);
      };
      walk(stage);
      peakDrawn = Math.max(peakDrawn, drawn);
    }
    process.stderr.write(`live person textures, peak over one day: ${peakTextures}; person sprites drawn, peak: ${peakDrawn}; texture sources: ${sources.size}\n`);
    expect(peakDrawn).toBeGreaterThan(100);
    expect(peakTextures).toBe(1);
    expect(sources.size).toBe(1);
  }, 180_000);
});

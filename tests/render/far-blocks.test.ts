// Design pass P3: with the flag that makes the category blocks the far zoom again (BB-2's way
// back, hierarchy.ts FAR_ZOOM_BLOCKS), the block pass draws the night of D-8: each block darkened
// toward the night sky, its occupancy a warm glow from the floor up on the emissive layer, and
// the day chart as before by day. The real createRenderer against a stub pixi Application.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Texture, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { floorTopY } from '../../src/render/camera';
import { lerpColor } from '../../src/render/light';
import { BLOCK, BLOCK_FILL_LIFT } from '../../src/render/palette';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

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
const tex = (key: string): Texture => new Texture({ label: key });
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
// The flag on: the far zoom is the block pass again.
vi.mock('../../src/render/hierarchy', async (importOriginal) => {
  const hierarchy = await importOriginal<typeof import('../../src/render/hierarchy')>();
  return { ...hierarchy, layerPlan: (tier: Parameters<typeof hierarchy.layerPlan>[0]) => hierarchy.layerPlan(tier, true) };
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

function find(root: Container, label: string): Container {
  let found: Container | null = null;
  const walk = (node: Container): void => {
    if (node.label === label) found = node;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  if (!found) throw new Error(`no node labelled ${label}`);
  return found;
}

function fills(g: Graphics): { x: number; y: number; w: number; h: number; color: number; alpha: number }[] {
  const out: { x: number; y: number; w: number; h: number; color: number; alpha: number }[] = [];
  for (const ins of g.context.instructions) {
    if (ins.action !== 'fill') continue;
    const data = ins.data as { style: { color: number; alpha: number }; path: GraphicsPath };
    for (const p of data.path.shapePath.shapePrimitives) {
      const r = p.shape as Rectangle;
      out.push({ x: r.x, y: r.y, w: r.width, h: r.height, color: data.style.color, alpha: data.style.alpha });
    }
  }
  return out;
}

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, occupancy: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

describe('D-8: the block pass at far zoom, with the flag', () => {
  it('darkens the blocks at night and glows their occupancy on the emissive layer; by day the chart as before', async () => {
    const world = createWorld(7);
    world.time.minute = 22 * 60;
    makeRoom(world, 'office', 3, 180, ROOMS.office.capacity / 2);
    makeRoom(world, 'condo', 4, 180, 0);
    const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
    renderers.push(renderer);
    const app = apps[apps.length - 1]!;
    const frame = (dtMs: number): void => {
      app.ticker.deltaMS = dtMs;
      for (const fn of app.frames) fn();
    };
    renderer.render(world, 1);
    renderer.camera.setReducedMotion(true);
    renderer.camera.zoomAt(0.4 / renderer.camera.zoom, 400, 300);
    frame(16);
    renderer.render(world, 1);

    const blocks = find(app.stage, 'blocks') as Graphics;
    const glow = find(app.stage, 'block glow') as Graphics;
    expect(blocks.visible).toBe(true);
    expect(find(app.stage, 'facade').visible).toBe(false);
    expect(glow.parent?.label).toBe('emissive');
    expect(glow.visible).toBe(true);
    expect(glow.blendMode).not.toBe('multiply');
    expect(fills(blocks).map((f) => f.color)).toEqual([lerpColor(BLOCK.office, 0x0d1b3d, 0.45), lerpColor(BLOCK.condo, 0x0d1b3d, 0.45)]);
    expect(fills(glow)).toEqual([{ x: 180 * 16, y: floorTopY(3) + 36, w: 9 * 16, h: 36, color: 0xffd678, alpha: 0.85 }]);

    world.time.minute = 24 * 60 + 13 * 60;
    renderer.render(world, 1);
    frame(500); // the blocks refresh on their own clock
    expect(glow.visible).toBe(false);
    expect(fills(blocks).map((f) => f.color)).toEqual([BLOCK.office, lerpColor(BLOCK.office, 0xffffff, BLOCK_FILL_LIFT), BLOCK.condo]);
  });
});

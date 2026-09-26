// The selection ring's box on screen (design pass 2026-09-25, D-23): the ui keeps the thing
// clicked clear of the card open beside it with this. Drives the real createRenderer against a
// stub pixi Application and stub art, as hierarchy.test.ts does: no GPU, no DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { FLOOR_PX, SIM_H, SIM_W, TILE_PX } from '../../src/render/art';
import { floorBaseY, floorTopY } from '../../src/render/camera';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

const apps = vi.hoisted(() => [] as { frames: (() => void)[] }[]);

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

let renderers: Renderer[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
});

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const room: Room = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

async function mount(): Promise<{ renderer: Renderer; world: World; office: Room; frame: () => void }> {
  const world = createWorld(7);
  world.time.minute = 12 * 60;
  const office = makeRoom(world, 'office', 3, 180);
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (): void => {
    for (const fn of app.frames) fn();
  };
  renderer.camera.setReducedMotion(true);
  frame();
  renderer.render(world, 1);
  return { renderer, world, office, frame };
}

describe('selectionScreenRect', () => {
  it('answers null with nothing selected', async () => {
    const { renderer } = await mount();
    expect(renderer.selectionScreenRect()).toBeNull();
  });

  it('answers the ring a frame drew, mapped through the camera the way the ghost is', async () => {
    const { renderer, world, office } = await mount();
    renderer.setSelection({ roomId: office.id });
    expect(renderer.selectionScreenRect()).toBeNull(); // not drawn yet
    renderer.render(world, 1);
    const cam = renderer.camera;
    const near = cam.worldToScreen(office.x * TILE_PX, floorTopY(office.floor));
    expect(renderer.selectionScreenRect()).toEqual({ x: near.x, y: near.y, w: office.width * TILE_PX * cam.zoom, h: FLOOR_PX * cam.zoom });
    // The camera moves the box with it, before the next frame is drawn.
    cam.panBy(-100, 0);
    expect(renderer.selectionScreenRect()!.x).toBeCloseTo(near.x + 100);
  });

  it('forgets the old ring the moment the selection changes, and answers null once nothing is drawn', async () => {
    const { renderer, world, office } = await mount();
    const other = makeRoom(world, 'office', 4, 180);
    renderer.setSelection({ roomId: office.id });
    renderer.render(world, 1);
    expect(renderer.selectionScreenRect()).not.toBeNull();
    renderer.setSelection({ roomId: other.id });
    expect(renderer.selectionScreenRect()).toBeNull();
    renderer.render(world, 1);
    expect(renderer.selectionScreenRect()!.y).toBeCloseTo(renderer.camera.worldToScreen(0, floorTopY(4)).y);
    renderer.setSelection(null);
    renderer.render(world, 1);
    expect(renderer.selectionScreenRect()).toBeNull();
  });

  it('boxes a person where the frame drew them, and not at all when the frame did not', async () => {
    const { renderer, world } = await mount();
    const sim = {
      id: 8, kind: 'worker' as const, homeRoomId: null, pos: { floor: 3, x: 182 }, inCarId: null, inRoomId: null, route: [], state: 'walking' as const,
      stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
    };
    world.sims.set(sim.id, sim);
    renderer.setSelection({ simId: sim.id });
    renderer.render(world, 1);
    const rect = renderer.selectionScreenRect()!;
    const feet = renderer.camera.worldToScreen(182 * TILE_PX, floorBaseY(3) - 6);
    expect(rect.x + rect.w / 2).toBeCloseTo(feet.x);
    expect(rect.w).toBeCloseTo((SIM_W + 8) * renderer.camera.zoom);
    expect(rect.h).toBeCloseTo((SIM_H + 8) * renderer.camera.zoom);
    // One in four is drawn: id 9 is outside the sample, so no ring and no box.
    world.sims.set(9, { ...sim, id: 9 });
    renderer.setSelection({ simId: 9 });
    renderer.render(world, 1);
    expect(renderer.selectionScreenRect()).toBeNull();
  });
});

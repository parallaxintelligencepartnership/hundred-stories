// Visual hierarchy by zoom (package 2): below 0.75 the window band and the connectors are muted
// by 20 percent; below 0.5 every room becomes a category block, only the selected person is
// drawn, and the selection and emergency overlays stay at full strength.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { BLOCKS_BELOW_ZOOM, layerPlan, MUTE_AMOUNT, MUTE_BELOW_ZOOM, occupancyLevel, zoomTier } from '../../src/render/hierarchy';
import { BLOCK } from '../../src/render/palette';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, setOnFire } from '../../src/sim/world';

describe('zoom tiers', () => {
  it('mutes below 0.75 and turns to blocks below 0.5', () => {
    expect([MUTE_BELOW_ZOOM, BLOCKS_BELOW_ZOOM, MUTE_AMOUNT]).toEqual([0.75, 0.5, 0.2]);
    expect(zoomTier(3)).toBe('full');
    expect(zoomTier(0.75)).toBe('full');
    expect(zoomTier(0.74)).toBe('muted');
    expect(zoomTier(0.5)).toBe('muted');
    expect(zoomTier(0.49)).toBe('blocks');
    expect(zoomTier(0.175)).toBe('blocks');
  });

  it('keeps selection and emergency overlays at full strength at every zoom', () => {
    for (const tier of ['full', 'muted', 'blocks'] as const) {
      expect(layerPlan(tier).selection).toBe(1);
      expect(layerPlan(tier).emergency).toBe(1);
    }
  });

  it('mutes the window band and the connectors by 20 percent when muted, and not at full zoom', () => {
    expect(layerPlan('full')).toMatchObject({ rooms: true, blocks: false, windowVeil: 0, connectors: 1, people: 'all' });
    expect(layerPlan('muted')).toMatchObject({ rooms: true, blocks: false, windowVeil: 0.2, connectors: 0.8, people: 'all' });
    expect(layerPlan('blocks')).toMatchObject({ rooms: false, blocks: true, people: 'selected', ambient: false });
  });

  it('fills a block by the share of its capacity inside', () => {
    expect(occupancyLevel({ kind: 'office', occupancy: 0 })).toBe(0);
    expect(occupancyLevel({ kind: 'office', occupancy: ROOMS.office.capacity / 2 })).toBeCloseTo(0.5);
    expect(occupancyLevel({ kind: 'office', occupancy: 99 })).toBe(1);
  });

  it('has a flat colour for every kind', () => {
    for (const kind of Object.keys(ROOMS) as RoomKind[]) expect(typeof BLOCK[kind]).toBe('number');
  });
});

// ---------------------------------------------------------------- the renderer at far zoom

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
  sim: (kind, band, frame, look) => tex(`sim|${kind}|${band}|${frame}|${look ?? -1}`),
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

function find(root: Container, label: string): Container {
  let found: Container | null = null;
  const walk = (node: Container): void => {
    if (node.label === label) found = node;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  if (!found) throw new Error(`no layer labelled ${label}`);
  return found;
}

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const room: Room = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 0.7, tenants: [], occupancy: 3,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

async function mountAt(zoom: number): Promise<{ stage: Container; renderer: Renderer; world: World; office: Room; frame: () => void }> {
  const world = createWorld(7);
  world.time.minute = 12 * 60;
  const office = makeRoom(world, 'office', 3, 180);
  makeRoom(world, 'stairs', 3, 200);
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (): void => {
    for (const fn of app.frames) fn();
  };
  renderer.render(world, 1);
  renderer.camera.setReducedMotion(true);
  renderer.camera.zoomAt(zoom / renderer.camera.zoom, 400, 300);
  frame();
  renderer.render(world, 1);
  return { stage: app.stage, renderer, world, office, frame };
}

describe('the renderer by zoom', () => {
  it('draws the tower as it is at zoom 1: rooms, no blocks, no veil', async () => {
    const { stage } = await mountAt(1);
    expect(find(stage, 'rooms').visible).toBe(true);
    expect(find(stage, 'blocks').visible).toBe(false);
    expect(find(stage, 'window veil').visible).toBe(false);
    expect(find(stage, 'connectors').alpha).toBe(1);
  });

  it('mutes the window band and the stairs by 20 percent below 0.75', async () => {
    const { stage } = await mountAt(0.6);
    expect(find(stage, 'rooms').visible).toBe(true);
    expect(find(stage, 'window veil').visible).toBe(true);
    expect(find(stage, 'window veil').alpha).toBeCloseTo(0.2);
    expect(find(stage, 'connectors').alpha).toBeCloseTo(0.8);
    expect(find(stage, 'blocks').visible).toBe(false);
  });

  it('turns to category blocks below 0.5, hides the people, and leaves the selection ring and fire at full strength', async () => {
    const { stage, renderer, world, office, frame } = await mountAt(0.4);
    expect(renderer.camera.zoom).toBeCloseTo(0.4);
    const blocks = find(stage, 'blocks') as Graphics;
    expect(blocks.visible).toBe(true);
    expect(blocks.context.instructions.length).toBeGreaterThan(0);
    expect(find(stage, 'rooms').visible).toBe(false);
    expect(find(stage, 'connectors').visible).toBe(false);
    expect(find(stage, 'people').visible).toBe(false);

    renderer.setSelection({ roomId: office.id });
    setOnFire(world, office, true);
    renderer.render(world, 1);
    frame();
    const ring = find(stage, 'selection') as Graphics;
    expect(ring.visible).toBe(true);
    expect(ring.alpha).toBe(1);
    expect(ring.context.instructions.length).toBeGreaterThan(0);
    // The ring sits on the overlay, above the light layer; the blocks never cover it.
    expect(stage.children.indexOf(ring.parent!.parent as Container)).toBeGreaterThan(stage.children.indexOf(blocks.parent!.parent as Container));
    // The fire's flames are in the effects layer, which the blocks do not hide.
    const effects = (stage.children[3] as Container).children[4] as Container;
    expect(effects.visible).toBe(true);
    expect(effects.children.some((c) => c instanceof Graphics && c.visible)).toBe(true);

    renderer.camera.zoomAt(1 / renderer.camera.zoom, 400, 300);
    frame();
    renderer.render(world, 1);
    expect(find(stage, 'blocks').visible).toBe(false);
    expect(find(stage, 'rooms').visible).toBe(true);
    expect(find(stage, 'people').visible).toBe(true);
  });

  it('draws only the selected person at far zoom', async () => {
    const { stage, renderer, world } = await mountAt(0.4);
    const sim = {
      id: 8, kind: 'worker' as const, homeRoomId: null, pos: { floor: 3, x: 182 }, inCarId: null, inRoomId: null, route: [], state: 'walking' as const,
      stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
    };
    world.sims.set(sim.id, sim);
    renderer.render(world, 1);
    const solo = find(stage, 'selected person').children[0] as Sprite;
    expect(solo.visible).toBe(false);
    renderer.setSelection({ simId: sim.id });
    renderer.render(world, 1);
    expect(solo.visible).toBe(true);
    expect(solo.texture.label?.startsWith('sim|worker')).toBe(true);
  });
});

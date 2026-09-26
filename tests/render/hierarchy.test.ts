// Visual hierarchy by zoom (package 2): below 0.75 the window band and the connectors are muted
// by 20 percent; below 0.5 the tower is a facade (design pass BB-2; the category blocks moved to
// the Districts view, and a flag makes them the far zoom again), only the selected person is
// drawn, and the selection and emergency overlays stay at full strength.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { FLOOR_PX, SLAB_PX, TILE_PX, WIN_PANE, WIN_PANE_TOP } from '../../src/render/grid';
import { BLOCKS_BELOW_ZOOM, CONNECTOR_ALPHA_FULL, FAR_ZOOM_BLOCKS, layerPlan, MUTE_AMOUNT, MUTE_BELOW_ZOOM, occupancyLevel, zoomTier } from '../../src/render/hierarchy';
import { floorTopY } from '../../src/render/camera';
import { BLOCK, PALETTE } from '../../src/render/palette';
import { createRenderer, FACADE_PANE_W, FACADE_SHAFT, FACADE_WALL, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, addShaft, allocId, createWorld, setOnFire } from '../../src/sim/world';

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
    // D-12: the stairs and escalators hold at 85 percent at full zoom, so the rooms beside them lead.
    expect(CONNECTOR_ALPHA_FULL).toBe(0.85);
    expect(layerPlan('full')).toMatchObject({ rooms: true, blocks: false, facade: false, windowVeil: 0, connectors: CONNECTOR_ALPHA_FULL, people: 'all' });
    expect(layerPlan('muted')).toMatchObject({ rooms: true, blocks: false, facade: false, windowVeil: 0.2, connectors: 0.8, people: 'all' });
    expect(layerPlan('blocks')).toMatchObject({ rooms: false, blocks: false, facade: true, people: 'selected', ambient: false });
  });

  it('BB-2: draws the far zoom as a facade, and a flag makes the category blocks the far zoom again', () => {
    expect(FAR_ZOOM_BLOCKS).toBe(false);
    expect(layerPlan('blocks', true)).toMatchObject({ rooms: false, blocks: true, facade: false, people: 'selected', ambient: false });
    expect(layerPlan('full', true)).toMatchObject({ blocks: false, facade: false });
    expect(layerPlan('muted', true)).toMatchObject({ blocks: false, facade: false });
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
    // The opening tier's alpha, set before any change of tier (D-12).
    expect(find(stage, 'connectors').alpha).toBeCloseTo(CONNECTOR_ALPHA_FULL);
  });

  it('mutes the window band and the stairs by 20 percent below 0.75', async () => {
    const { stage } = await mountAt(0.6);
    expect(find(stage, 'rooms').visible).toBe(true);
    expect(find(stage, 'window veil').visible).toBe(true);
    expect(find(stage, 'window veil').alpha).toBeCloseTo(0.2);
    expect(find(stage, 'connectors').alpha).toBeCloseTo(0.8);
    expect(find(stage, 'blocks').visible).toBe(false);
  });

  it('turns to the facade below 0.5 (BB-2), hides the people, and leaves the selection ring and fire at full strength', async () => {
    const { stage, renderer, world, office, frame } = await mountAt(0.4);
    expect(renderer.camera.zoom).toBeCloseTo(0.4);
    const facade = find(stage, 'facade') as Graphics;
    expect(facade.visible).toBe(true);
    expect(facade.context.instructions.length).toBeGreaterThan(0);
    // The category blocks moved to the Districts view: the block pass is hidden at far zoom.
    expect(find(stage, 'blocks').visible).toBe(false);
    expect(find(stage, 'rooms').visible).toBe(false);
    expect(find(stage, 'connectors').visible).toBe(false);
    expect(find(stage, 'people').visible).toBe(false);
    // The near view's lit windows and signs go with the rooms.
    for (const label of ['lit panes', 'lit halo', 'sign glows', 'lit signs']) expect(find(stage, label).visible, label).toBe(false);

    renderer.setSelection({ roomId: office.id });
    setOnFire(world, office, true);
    renderer.render(world, 1);
    frame();
    const ring = find(stage, 'selection') as Graphics;
    expect(ring.visible).toBe(true);
    expect(ring.alpha).toBe(1);
    expect(ring.context.instructions.length).toBeGreaterThan(0);
    // The ring sits on the overlay, above the light layer and the emissive layer; the facade never covers it.
    const ringRoot = stage.children.indexOf(ring.parent!.parent as Container);
    expect(ringRoot).toBeGreaterThan(stage.children.indexOf(facade.parent!.parent as Container));
    expect(ringRoot).toBeGreaterThan(stage.children.indexOf(find(stage, 'facade lit').parent as Container));
    // The fire's flames are in the effects layer, which the facade does not hide.
    const effects = (stage.children[3] as Container).children[4] as Container;
    expect(effects.visible).toBe(true);
    expect(effects.children.some((c) => c instanceof Graphics && c.visible)).toBe(true);

    renderer.camera.zoomAt(1 / renderer.camera.zoom, 400, 300);
    frame();
    renderer.render(world, 1);
    expect(find(stage, 'facade').visible).toBe(false);
    expect(find(stage, 'facade lit').visible).toBe(false);
    expect(find(stage, 'blocks').visible).toBe(false);
    expect(find(stage, 'rooms').visible).toBe(true);
    expect(find(stage, 'lit panes').visible).toBe(true);
    expect(find(stage, 'people').visible).toBe(true);
    expect(find(stage, 'connectors').alpha).toBeCloseTo(CONNECTOR_ALPHA_FULL);
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

// ---------------------------------------------------------------- BB-2: the facade

interface Drawn {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}

/** Every rectangle a Graphics filled, with its colour, in drawing order. */
function fills(g: Graphics): Drawn[] {
  const out: Drawn[] = [];
  for (const ins of g.context.instructions) {
    if (ins.action !== 'fill') continue;
    const data = ins.data as { style: { color: number }; path: GraphicsPath };
    for (const p of data.path.shapePath.shapePrimitives) {
      const r = p.shape as Rectangle;
      out.push({ x: r.x, y: r.y, w: r.width, h: r.height, color: data.style.color });
    }
  }
  return out;
}

/**
 * On floor 3 an occupied office (tiles 180 to 188) and a vacant one (190 to 198), a lobby run on
 * the ground from 180 to 203, and a standard shaft at 200 from floor 1 to 4.
 */
async function mountFar(minute: number): Promise<{ stage: Container; world: World }> {
  const world = createWorld(7);
  world.time.minute = minute;
  const occupied = makeRoom(world, 'office', 3, 180);
  const vacant = makeRoom(world, 'office', 3, 190);
  vacant.occupancy = 0;
  for (let x = 180; x < 204; x++) makeRoom(world, 'lobby', 1, x).occupancy = 0;
  expect(occupied.occupancy).toBe(3);
  addShaft(world, {
    id: allocId(world), kind: 'standard', x: 200, width: 4, floorMin: 1, floorMax: 4,
    stops: new Set([1, 2, 3, 4]), homeFloor: 1, cars: [], hallCalls: new Map(),
  });
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  renderer.render(world, 1);
  renderer.camera.setReducedMotion(true);
  renderer.camera.zoomAt(0.4 / renderer.camera.zoom, 400, 300);
  for (const fn of app.frames) fn();
  renderer.render(world, 1);
  return { stage: app.stage, world };
}

describe('BB-2: the far zoom facade', () => {
  it('draws each built floor as a band by day: the wall, a 2 px slab line, a pane per two tiles, the shaft a darker strip', async () => {
    const { stage } = await mountFar(13 * 60);
    const drawn = fills(find(stage, 'facade') as Graphics);
    const walls = drawn.filter((d) => d.color === FACADE_WALL);
    expect(walls.map((d) => d.y).sort((a, b) => a - b)).toEqual([4, 3, 2, 1].map((f) => floorTopY(f)));
    for (const d of walls) expect(d.h).toBe(FLOOR_PX);
    const slabs = drawn.filter((d) => d.color === 0x222222);
    expect(slabs).toHaveLength(4);
    for (const d of slabs) expect([d.h, (d.y - floorTopY(4)) % FLOOR_PX]).toEqual([2, FLOOR_PX - SLAB_PX]);
    // One pane per two tiles, two tiles' panes and their mullion wide, in the band's glass row.
    const panes = drawn.filter((d) => d.color === PALETTE.windowDay);
    expect(panes.every((d) => d.w === FACADE_PANE_W && d.h === WIN_PANE && (d.y - WIN_PANE_TOP - floorTopY(4)) % FLOOR_PX === 0)).toBe(true);
    // Floor 3: cells 180 to 198 (ten), none under the shaft; floor 1 the same; floors 2 and 4 are the shaft alone.
    const onFloor = (f: number): number[] => panes.filter((d) => d.y === floorTopY(f) + WIN_PANE_TOP).map((d) => (d.x - 2) / TILE_PX);
    expect(onFloor(3)).toEqual([180, 182, 184, 186, 188, 190, 192, 194, 196, 198]);
    expect(onFloor(1)).toEqual([180, 182, 184, 186, 188, 190, 192, 194, 196, 198]);
    expect(onFloor(2)).toEqual([]);
    const shaft = drawn.filter((d) => d.color === FACADE_SHAFT);
    expect(shaft).toEqual([{ x: 200 * TILE_PX, y: floorTopY(4), w: 4 * TILE_PX, h: 4 * FLOOR_PX, color: FACADE_SHAFT }]);
    // Darker than the wall, lighter than the ink.
    const lum = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(lum(FACADE_SHAFT)).toBeLessThan(lum(FACADE_WALL));
    expect(fills(find(stage, 'facade lit') as Graphics)).toEqual([]);
  });

  it('lights the panes of occupied rooms and darkens the empty ones on the emissive layer at night', async () => {
    const { stage } = await mountFar(22 * 60);
    const facadeLit = find(stage, 'facade lit') as Graphics;
    expect(facadeLit.parent?.label).toBe('emissive');
    expect(facadeLit.visible).toBe(true);
    const lit = fills(facadeLit);
    const cells = (color: number, f: number): number[] =>
      lit.filter((d) => d.color === color && d.y === floorTopY(f) + WIN_PANE_TOP).map((d) => (d.x - 2) / TILE_PX);
    expect(cells(PALETTE.windowLit, 3)).toEqual([180, 182, 184, 186, 188]);
    expect(cells(PALETTE.windowUnlit, 3)).toEqual([190, 192, 194, 196, 198]);
    expect(cells(PALETTE.windowUnlit, 1)).toHaveLength(10); // nobody in the lobby
    // No day panes left on the facade under the multiply.
    expect(fills(find(stage, 'facade') as Graphics).filter((d) => d.color === PALETTE.windowDay)).toEqual([]);
  });
});

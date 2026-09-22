// The static tower (rooms, slabs, shafts) is reconciled only when world.structureVersion,
// the world itself or the night lit bit moves; cars and sims every frame. And the screen
// draws one sim in four. Both live inside the createRenderer closure, so this drives the
// real createRenderer against a stub pixi Application and stub art, in the stub-renderer
// spirit of connectors.test.ts: no GPU, no DOM, real pixi Containers and Sprites.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, ParticleContainer, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { CROWD_ONE_IN, createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld, markStructureChanged, setOccupancy, setOnFire } from '../../src/sim/world';

// Every fake application, newest last, so a test can walk the stage createRenderer built.
const apps = vi.hoisted(() => [] as { stage: import('pixi.js').Container }[]);

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
    ticker = { add: (): void => {}, remove: (): void => {}, deltaMS: 16 };
    constructor() {
      apps.push(this);
    }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: FakeApplication, isWebGLSupported: () => true };
});

// Every texture carries its art key as its label, so a test can read which art a sprite shows.
const textures = new Map<string, Texture>();
function tex(key: string): Texture {
  let t = textures.get(key);
  if (!t) textures.set(key, (t = new Texture({ label: key })));
  return t;
}
const stubArt: Art = {
  room: (kind, width, height, variant, lit) => tex(`room|${kind}|${width}|${height}|${variant}|${lit}`),
  slab: (width) => tex(`slab|${width}`),
  shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  car: (kind, doorsOpen) => tex(`car|${kind}|${doorsOpen}`),
  sim: (kind, band, frame) => tex(`sim|${kind}|${band}|${frame}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});

const NOON = 12 * 60;
const MIDNIGHT = 24 * 60; // day 2, 00:00

let renderers: Renderer[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
});

async function mount(world: World, options: { crowd?: 'all' } = {}): Promise<{ renderer: Renderer; stage: Container }> {
  const container = { appendChild: () => {} } as unknown as HTMLElement;
  const renderer = await createRenderer(container, world, options);
  renderers.push(renderer);
  const app = apps[apps.length - 1];
  if (!app) throw new Error('no application was created');
  return { renderer, stage: app.stage };
}

function spritesWith(root: Container, prefix: string): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite && node.texture.label?.startsWith(prefix)) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return out;
}

function hasParticles(root: Container): boolean {
  let found = false;
  const walk = (node: Container): void => {
    if (node instanceof ParticleContainer) found = true;
    for (const child of node.children) walk(child as Container);
  };
  walk(root);
  return found;
}

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
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
  addRoom(world, room);
  return room;
}

function makeWalker(world: World, floor: number, x: number): Sim {
  const sim: Sim = {
    id: allocId(world),
    kind: 'worker',
    homeRoomId: null,
    pos: { floor, x },
    inCarId: null,
    inRoomId: null,
    route: [],
    state: 'walking',
    stress: 0,
    waitStart: null,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
  return sim;
}

function officeWorld(minute: number): { world: World; room: Room } {
  const world = createWorld(7);
  world.time.minute = minute;
  const room = makeRoom(world, 'office', 3, 180);
  return { world, room };
}

function roomSprite(stage: Container): Sprite {
  const sprites = spritesWith(stage, 'room|office');
  expect(sprites).toHaveLength(1);
  return sprites[0]!;
}

describe('static tower reconcile on the structure version', () => {
  it('leaves a room sprite alone until the structure version moves', async () => {
    const { world, room } = officeWorld(NOON);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xffffff);

    room.onFire = true; // written behind the version's back
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xffffff);

    markStructureChanged(world);
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xff8a72);
  });

  it('shows a fire set and cleared through setOnFire', async () => {
    const { world, room } = officeWorld(NOON);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    setOnFire(world, room, true);
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xff8a72);
    setOnFire(world, room, false);
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xffffff);
  });

  it('lights a room at night when its occupancy crosses zero, and only then bumps', async () => {
    const { world, room } = officeWorld(MIDNIGHT);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|false$/);

    const before = world.structureVersion;
    setOccupancy(world, room, 1);
    expect(world.structureVersion).toBe(before + 1);
    setOccupancy(world, room, 2); // still occupied: nothing on screen changes
    expect(world.structureVersion).toBe(before + 1);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|true$/);

    setOccupancy(world, room, 0);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|false$/);
  });

  it('runs a full pass when night falls, with no version bump', async () => {
    const { world, room } = officeWorld(NOON);
    setOccupancy(world, room, 1);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|false$/);
    const version = world.structureVersion;
    world.time.minute = MIDNIGHT;
    renderer.render(world, 1);
    expect(world.structureVersion).toBe(version);
    expect(roomSprite(stage).texture.label).toMatch(/\|true$/);
  });

  it('reconciles in full after resetMotion and on a replaced world', async () => {
    const { world, room } = officeWorld(NOON);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    room.onFire = true; // no bump
    renderer.resetMotion();
    renderer.render(world, 1);
    expect(roomSprite(stage).tint).toBe(0xff8a72);

    // A different world at the same version number still reconciles.
    const other = officeWorld(NOON);
    other.world.structureVersion = world.structureVersion;
    renderer.render(other.world, 1);
    expect(roomSprite(stage).tint).toBe(0xffffff);
  });

  it('adds and removes room sprites on build and demolish', async () => {
    const { world } = officeWorld(NOON);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const shop = makeRoom(world, 'shop', 2, 150);
    renderer.render(world, 1);
    expect(spritesWith(stage, 'room|shop')).toHaveLength(1);
    world.rooms.delete(shop.id);
    markStructureChanged(world);
    renderer.render(world, 1);
    expect(spritesWith(stage, 'room|shop')).toHaveLength(0);
  });
});

describe('crowd sample in the sim draw loop', () => {
  function crowdWorld(count: number): World {
    const world = createWorld(11);
    world.time.minute = NOON;
    makeRoom(world, 'lobby', 1, 186);
    for (let i = 0; i < count; i++) makeWalker(world, 1, 186 + (i % 8));
    return world;
  }
  function drawnCount(world: World): number {
    let n = 0;
    for (const sim of world.sims.values()) if (sim.id % CROWD_ONE_IN === 0) n++;
    return n;
  }

  it('draws one visible sim in four', async () => {
    const world = crowdWorld(40);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(spritesWith(stage, 'sim|')).toHaveLength(drawnCount(world));
    expect(drawnCount(world)).toBe(10);
  });

  it('draws every sim with crowd all', async () => {
    const world = crowdWorld(40);
    const { renderer, stage } = await mount(world, { crowd: 'all' });
    renderer.render(world, 1);
    expect(spritesWith(stage, 'sim|')).toHaveLength(40);
  });

  it('counts only the sample toward particle mode', async () => {
    // 1,600 visible, 400 drawn: under the particle threshold of 500, so sprites stay.
    const world = crowdWorld(1600);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(hasParticles(stage)).toBe(false);
    expect(spritesWith(stage, 'sim|')).toHaveLength(400);
  });
});

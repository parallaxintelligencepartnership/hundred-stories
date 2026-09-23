// The static tower (rooms, slabs, shafts) is reconciled only when world.structureVersion,
// the world itself or the light band (day, or the hour at night) moves; cars and sims every frame. And the screen
// draws one sim in four. Both live inside the createRenderer closure, so this drives the
// real createRenderer against a stub pixi Application and stub art, in the stub-renderer
// spirit of connectors.test.ts: no GPU, no DOM, real pixi Containers and Sprites.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, ParticleContainer, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { CROWD_ONE_IN, createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld, markStructureChanged, setOccupancy, setOnFire } from '../../src/sim/world';
import { floorTopY } from '../../src/render/camera';

// Every fake application, newest last, so a test can walk the stage createRenderer built.
const apps = vi.hoisted(
  () => [] as { stage: import('pixi.js').Container; frames: (() => void)[]; ticker: { deltaMS: number } }[],
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

// Every texture carries its art key as its label, so a test can read which art a sprite shows.
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
  sim: (kind, band, frame, outfit) => tex(`sim|${kind}|${band}|${frame}|${outfit ?? -1}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});

// The sky's gradient needs a DOM canvas; the frame loop tests only need the sky to exist.
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
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

async function mount(
  world: World,
  options: { crowd?: 'all' } = {},
): Promise<{ renderer: Renderer; stage: Container; frame: (dtMs: number) => void }> {
  const container = { appendChild: () => {} } as unknown as HTMLElement;
  const renderer = await createRenderer(container, world, options);
  renderers.push(renderer);
  const app = apps[apps.length - 1];
  if (!app) throw new Error('no application was created');
  // One tick of the pixi frame loop, dtMs of real time after the last.
  const frame = (dtMs: number): void => {
    app.ticker.deltaMS = dtMs;
    for (const fn of app.frames) fn();
  };
  return { renderer, stage: app.stage, frame };
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
    expect(roomSprite(stage).texture.label).toMatch(/\|vacant$/);

    const before = world.structureVersion;
    setOccupancy(world, room, 1);
    expect(world.structureVersion).toBe(before + 1);
    setOccupancy(world, room, 2); // still occupied: nothing on screen changes
    expect(world.structureVersion).toBe(before + 1);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|lit$/);

    setOccupancy(world, room, 0);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|vacant$/);
  });

  it('runs a full pass when night falls, with no version bump', async () => {
    const { world, room } = officeWorld(NOON);
    setOccupancy(world, room, 1);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(roomSprite(stage).texture.label).toMatch(/\|day$/);
    const version = world.structureVersion;
    world.time.minute = MIDNIGHT;
    renderer.render(world, 1);
    expect(world.structureVersion).toBe(version);
    expect(roomSprite(stage).texture.label).toMatch(/\|lit$/);
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

describe('light and time (look round L2)', () => {
  it('bakes the window states for every kind in the tower at boot, before any render', async () => {
    const world = createWorld(5);
    world.time.minute = NOON;
    makeRoom(world, 'office', 3, 180);
    makeRoom(world, 'hotelSingle', 4, 180);
    textures.clear();
    await mount(world);
    const keys = [...textures.keys()].filter((k) => k.startsWith('room|'));
    for (const kind of ['office', 'hotelSingle']) {
      for (const state of ['day', 'lit', 'vacant']) {
        expect(keys.some((k) => k.startsWith(`room|${kind}|`) && k.endsWith(`|${state}`))).toBe(true);
      }
    }
    expect(keys.some((k) => k.startsWith('room|hotelSingle|') && k.endsWith('|housekeeping'))).toBe(true);
    expect(keys.some((k) => k.startsWith('room|office|') && k.endsWith('|housekeeping'))).toBe(false);
  });

  it('picks up a hotel room going dirty at night on the next game hour, with no version bump', async () => {
    const world = createWorld(5);
    world.time.minute = MIDNIGHT + 60; // 01:00
    const hotel = makeRoom(world, 'hotelSingle', 4, 180);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const sprite = (): Sprite => spritesWith(stage, 'room|hotelSingle')[0]!;
    expect(sprite().texture.label).toMatch(/\|vacant$/);
    hotel.dirty = true; // the sim does not version the dirty flag
    world.time.minute += 30;
    renderer.render(world, 1);
    expect(sprite().texture.label).toMatch(/\|vacant$/); // same hour: the gate holds
    world.time.minute += 30; // 02:00
    renderer.render(world, 1);
    expect(sprite().texture.label).toMatch(/\|housekeeping$/);
  });

  it('lights a lobby at night while someone stands on its floor', async () => {
    const world = createWorld(5);
    world.time.minute = MIDNIGHT + 60;
    makeRoom(world, 'lobby', 1, 186);
    const walker = makeWalker(world, 1, 186);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(spritesWith(stage, 'room|lobby')[0]!.texture.label).toMatch(/\|lit$/);
    walker.state = 'gone';
    world.time.minute += 60;
    renderer.render(world, 1);
    expect(spritesWith(stage, 'room|lobby')[0]!.texture.label).toMatch(/\|vacant$/);
  });

  it('puts one multiply light sprite between the world and the overlay, tinted by the hour', async () => {
    const { world } = officeWorld(MIDNIGHT - 60); // 23:00
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const isLight = (c: Container): boolean => c.children.some((s) => s instanceof Sprite && s.blendMode === 'multiply');
    const layers = stage.children.filter((c) => isLight(c as Container));
    expect(layers).toHaveLength(1);
    const layer = layers[0] as Container;
    const light = layer.children[0] as Sprite;
    expect(light.alpha).toBeCloseTo(0.4);
    expect(light.tint).toBe(0x6078b0);
    const index = stage.children.indexOf(layer);
    // Behind it: the world root holding the tower.
    const behind = stage.children.slice(0, index) as Container[];
    expect(behind.some((c) => spritesWith(c, 'room|').length > 0)).toBe(true);
    // In front of it: the ghost's layer, so placement colours are never graded by the hour.
    renderer.setGhost({ widthTiles: 9, heightFloors: 1, floor: 3, x: 180, ok: true });
    renderer.render(world, 1);
    const front = stage.children.slice(index + 1) as Container[];
    expect(front.some((c) => spritesWith(c, 'ghost|').length > 0)).toBe(true);
  });

  it('moves the overlay root with the world root when the camera pans and zooms', async () => {
    const { world } = officeWorld(NOON);
    const { renderer, stage, frame } = await mount(world);
    renderer.setGhost({ widthTiles: 9, heightFloors: 1, floor: 3, x: 180, ok: true });
    renderer.render(world, 1);
    const roots = stage.children as Container[];
    const worldRoot = roots.find((c) => spritesWith(c, 'room|').length > 0) as Container;
    const overlayRoot = roots.find((c) => spritesWith(c, 'ghost|').length > 0) as Container;
    expect(worldRoot).toBeDefined();
    expect(overlayRoot).toBeDefined();
    expect(overlayRoot).not.toBe(worldRoot);

    renderer.camera.setReducedMotion(true); // no inertia or zoom easing: the move lands this frame
    renderer.camera.centerOn(6, 40);
    renderer.camera.zoomAt(2, 400, 300);
    for (let i = 0; i < 30; i++) frame(16);

    expect(worldRoot.scale.x).not.toBe(1);
    expect(overlayRoot.scale.x).toBe(worldRoot.scale.x);
    expect(overlayRoot.scale.y).toBe(worldRoot.scale.y);
    expect(overlayRoot.position.x).toBe(worldRoot.position.x);
    expect(overlayRoot.position.y).toBe(worldRoot.position.y);
    expect(worldRoot.position.x).not.toBe(0);
  });

  it('hangs a cable from each car to the top of its shaft, under the car', async () => {
    const world = createWorld(5);
    world.time.minute = NOON;
    const id = allocId(world);
    const car: Car = {
      id: allocId(world),
      shaftId: id,
      y: 2,
      dir: 0,
      state: 'idle',
      doorTimer: 0,
      idleSince: null,
      passengers: [],
      calls: new Set(),
      serves: 'any',
      range: null,
    };
    const stops = new Set<number>([1, 2, 3, 4, 5, 6]);
    addShaft(world, { id, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 6, stops, homeFloor: 1, cars: [car], hallCalls: new Map() });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const carSprite = spritesWith(stage, 'car|')[0]!;
    const carsLayer = carSprite.parent!.parent!;
    const [cables, sprites] = carsLayer.children as Container[];
    expect(sprites!.children).toContain(carSprite);
    expect(cables!.children).toHaveLength(1);
    const cable = cables!.children[0]!;
    expect(cable.y).toBe(floorTopY(6));
    expect(cable.visible).toBe(true);
    const before = cable.scale.y;
    expect(before).toBeGreaterThan(0);
    car.y = 5; // the car climbs, the cable shortens
    renderer.render(world, 1);
    expect(cable.scale.y).toBeLessThan(before);
    expect(cable.scale.y).toBeGreaterThan(0);
  });
});

function shaftWorld(): { world: World; car: Car } {
  const world = createWorld(5);
  world.time.minute = NOON;
  const id = allocId(world);
  const car: Car = {
    id: allocId(world),
    shaftId: id,
    y: 2,
    dir: 0,
    state: 'idle',
    doorTimer: 0,
    idleSince: null,
    passengers: [],
    calls: new Set(),
    serves: 'any',
    range: null,
  };
  const stops = new Set<number>([1, 2, 3, 4, 5, 6]);
  addShaft(world, { id, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 6, stops, homeFloor: 1, cars: [car], hallCalls: new Map() });
  return { world, car };
}

function effectsSprites(stage: Container): Sprite[] {
  // the effects layer is the last child of the world root, which holds the room layers
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite && node.texture === Texture.WHITE) out.push(node);
    for (const child of node.children) walk(child as Container);
  };
  const worldRoot = stage.children.find((c) => (c as Container).children.length === 5) as Container;
  walk(worldRoot.children[4] as Container);
  return out;
}

describe('motion (look round L3)', () => {
  it('slides the doors open over 240 ms from the car state, on the frame loop', async () => {
    const { world, car } = shaftWorld();
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    const sprite = spritesWith(stage, 'car|')[0]!;
    expect(sprite.texture.label).toBe('car|standard|0');
    car.state = 'doorsOpen';
    renderer.render(world, 1);
    expect(sprite.texture.label).toBe('car|standard|0'); // no time has passed
    frame(60);
    expect(sprite.texture.label).toBe('car|standard|1');
    frame(60);
    expect(sprite.texture.label).toBe('car|standard|2');
    frame(120);
    expect(sprite.texture.label).toBe('car|standard|4');
    car.state = 'moving';
    renderer.render(world, 1);
    frame(120);
    expect(sprite.texture.label).toBe('car|standard|2');
    frame(120);
    expect(sprite.texture.label).toBe('car|standard|0');
  });

  it('opens the doors all the way for a one tick stop', async () => {
    const { world, car } = shaftWorld();
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    const sprite = spritesWith(stage, 'car|')[0]!;
    car.state = 'doorsOpen';
    renderer.render(world, 1);
    car.state = 'moving'; // the next tick closes them before a frame has passed
    renderer.render(world, 1);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      frame(16);
      seen.add(sprite.texture.label!);
    }
    expect(seen.has('car|standard|4')).toBe(true);
    expect(sprite.texture.label).toBe('car|standard|0');
  });

  it('snaps the doors under reduced motion, holding a one tick stop open for the tween time', async () => {
    const { world, car } = shaftWorld();
    const { renderer, stage, frame } = await mount(world);
    renderer.setReducedMotion(true);
    renderer.render(world, 1);
    const sprite = spritesWith(stage, 'car|')[0]!;
    car.state = 'doorsOpen';
    renderer.render(world, 1);
    expect(sprite.texture.label).toBe('car|standard|4'); // open at once, no frame in between
    car.state = 'moving';
    renderer.render(world, 1);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      frame(16);
      seen.add(sprite.texture.label!);
    }
    expect([...seen].sort()).toEqual(['car|standard|0', 'car|standard|4']);
    expect(sprite.texture.label).toBe('car|standard|0');
  });

  it('walks a walker through the three frames on real time, in its own outfit', async () => {
    const world = createWorld(9);
    world.time.minute = NOON;
    makeRoom(world, 'lobby', 1, 180);
    const walker = makeWalker(world, 1, 180);
    walker.id = 4; // one the crowd sample draws
    world.sims.clear();
    addSim(world, walker);
    const { renderer, stage } = await mount(world);
    const labels = new Set<string>();
    const now = vi.spyOn(performance, 'now');
    for (let t = 0; t < 720; t += 40) {
      now.mockReturnValue(10_000 + t);
      walker.pos.x = 180 + t / 400; // on the move
      renderer.render(world, 1);
      labels.add(spritesWith(stage, 'sim|')[0]!.texture.label!);
    }
    // stopped (a paused game), the walker stands instead of walking on the spot
    for (let t = 720; t < 1440; t += 40) {
      now.mockReturnValue(10_000 + t);
      renderer.render(world, 1);
    }
    expect(spritesWith(stage, 'sim|')[0]!.texture.label!.split('|')[3]).toBe('0');
    now.mockRestore();
    const frames = new Set([...labels].map((l) => l.split('|')[3]));
    expect([...frames].sort()).toEqual(['0', '1', '2']);
    const outfits = new Set([...labels].map((l) => l.split('|')[4]));
    expect(outfits.size).toBe(1);
    expect(Number([...outfits][0])).toBeGreaterThanOrEqual(0);
  });

  it('plays the build feedback on a room placed after the first pass, not on the rooms loaded with the world', async () => {
    const { world } = officeWorld(NOON);
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    expect(effectsSprites(stage)).toHaveLength(0);
    const added = makeRoom(world, 'office', 4, 180);
    markStructureChanged(world);
    renderer.render(world, 1);
    const sprite = spritesWith(stage, 'room|office').find((s) => s.y < floorTopY(4))!;
    expect(sprite.y).toBe(floorTopY(added.floor) - 4); // four pixels up, settling
    expect(effectsSprites(stage).length).toBe(1 + 6); // the flash and six specks
    frame(400);
    expect(sprite.y).toBe(floorTopY(added.floor));
    expect(effectsSprites(stage)).toHaveLength(0);
  });

  it('skips the build feedback and the ambient emitters under reduced motion', async () => {
    const { world } = officeWorld(NOON);
    makeRoom(world, 'shop', 6, 180);
    makeRoom(world, 'restaurant', 7, 180);
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    expect(effectsSprites(stage).length).toBe(1 + 3); // a sign strip and three steam puffs
    renderer.setReducedMotion(true);
    frame(16);
    expect(effectsSprites(stage)).toHaveLength(0);
    makeRoom(world, 'office', 5, 180);
    markStructureChanged(world);
    renderer.render(world, 1);
    expect(effectsSprites(stage)).toHaveLength(0);
  });
});

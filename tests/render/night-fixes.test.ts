// The P3 fix wave (design pass 2026-09-25, review of 9280b9c): the behaviors the first pass
// claimed without a failing test (the sign cut on lit panes, the lobbies in the dusk window, the
// shafts under the far facade), the facade below the street and at night, no lit panes over a
// fire, and the stress marks on the emissive layer at every crowd size. The real createRenderer
// against a stub pixi Application and stub art, as night.test.ts: no GPU.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, ParticleContainer, Sprite, Texture, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { floorTopY } from '../../src/render/camera';
import { TILE_PX } from '../../src/render/grid';
import { signBoard } from '../../src/render/illustrated';
import { NIGHT_GRADE, roomNight } from '../../src/render/light';
import { createRenderer, FACADE_WALL, STRIP_BELOW, type Renderer } from '../../src/render/renderer';
import { ROOMS, STRESS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld, setOnFire } from '../../src/sim/world';

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
const atlas = tex('atlas');
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
  // One atlas for crowd mode: people, props and marks all from the same source.
  crowd: () => ({ frameOf: () => atlas, propOf: () => atlas, markOf: () => atlas }),
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

const at = (h: number, m = 0): number => h * 60 + m;
let renderers: Renderer[] = [];
beforeEach(() => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
});

async function mount(world: World, options: { crowd?: 'all' } = {}): Promise<{ renderer: Renderer; stage: Container; frame: () => void }> {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world, options);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (): void => {
    for (const fn of app.frames) fn();
  };
  return { renderer, stage: app.stage, frame };
}

/** Zoom the camera to `zoom` at once and run a frame, then render. */
function zoomTo(renderer: Renderer, world: World, frame: () => void, zoom: number): void {
  renderer.camera.setReducedMotion(true);
  renderer.camera.zoomAt(zoom / renderer.camera.zoom, 400, 300);
  frame();
  renderer.render(world, 1);
}

function walk(root: Container, pred: (n: Container) => boolean): Container[] {
  const out: Container[] = [];
  const go = (n: Container): void => {
    if (pred(n)) out.push(n);
    for (const c of n.children) go(c as Container);
  };
  go(root);
  return out;
}
const find = (root: Container, label: string): Container => {
  const found = walk(root, (n) => n.label === label)[0];
  if (!found) throw new Error(`no node labelled ${label}`);
  return found;
};
const spritesWith = (root: Container, prefix: string): Sprite[] =>
  walk(root, (n) => n instanceof Sprite && !!n.texture.label?.startsWith(prefix)) as Sprite[];

interface Drawn {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
}
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

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, patch: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100, ...patch,
  };
  addRoom(world, room);
  return room;
}

function makeWalker(world: World, floor: number, x: number, stress = 0): Sim {
  const sim: Sim = {
    id: allocId(world), kind: 'worker', homeRoomId: null, pos: { floor, x }, inCarId: null, inRoomId: null, route: [], state: 'walking',
    stress, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
  };
  addSim(world, sim);
  return sim;
}

describe('D-4: the sign stands in front of the lit panes', () => {
  it('cuts a lit shop pane where its sign board covers it, and keeps the rest', async () => {
    const world = createWorld(5);
    world.time.minute = at(20); // open until 21:00, and night
    const shop = makeRoom(world, 'shop', 3, 100, { occupancy: 2 });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const panes = fills(find(stage, 'lit panes') as Graphics).filter((d) => d.y === floorTopY(3) + 6);
    const board = signBoard('shop', shop.width * TILE_PX);
    const left = shop.x * TILE_PX + board.x;
    const right = left + board.w;
    expect(panes.length).toBeGreaterThan(0);
    for (const d of panes) expect(d.x >= right || d.x + d.w <= left, `pane at ${d.x}`).toBe(true);
    // The pane the board's left edge cuts keeps its part outside the board.
    expect(panes.some((d) => d.x + d.w === left)).toBe(true);
  });
});

describe('D-15: a lobby in the dusk window', () => {
  it('lights while people stand on its floor once its own night has come, before the tower is night', async () => {
    const minute = at(18, 20); // nightness 0.44: not the tower's night yet
    let checked = false;
    for (let seed = 1; seed < 400 && !checked; seed++) {
      const world = createWorld(seed);
      world.time.minute = minute;
      const lobby = makeRoom(world, 'lobby', 1, 186);
      if (!roomNight(seed, lobby.id, minute)) continue;
      makeWalker(world, 1, 186);
      const { renderer, stage } = await mount(world);
      renderer.render(world, 1);
      expect(spritesWith(stage, 'room|lobby')[0]!.texture.label).toMatch(/\|lit$/);
      checked = true;
    }
    expect(checked).toBe(true);
  });
});

describe('BB-2: the far facade', () => {
  async function farWorld(minute: number): Promise<{ stage: Container; world: World; renderer: Renderer; frame: () => void }> {
    const world = createWorld(7);
    world.time.minute = minute;
    makeRoom(world, 'office', 1, 180, { occupancy: 2 });
    makeRoom(world, 'office', -1, 180, { occupancy: 2 });
    const shaftId = allocId(world);
    addShaft(world, { id: shaftId, kind: 'standard', x: 192, width: 4, floorMin: -1, floorMax: 3, stops: new Set([-1, 1, 2, 3]), homeFloor: 1, cars: [], hallCalls: new Map() });
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    zoomTo(renderer, world, frame, 0.4);
    return { stage, world, renderer, frame };
  }

  it('hides the shaft sprites under the facade, and shows them again closer in', async () => {
    const { stage, world, renderer, frame } = await farWorld(at(12));
    const shaft = spritesWith(stage, 'shaft|')[0]!;
    expect(shaft.parent!.visible).toBe(false);
    zoomTo(renderer, world, frame, 1);
    expect(shaft.parent!.visible).toBe(true);
  });

  it('stops at the street: a basement floor draws in the basement tone with no panes, lit or not', async () => {
    const { stage } = await farWorld(at(23));
    const below = floorTopY(-1);
    const drawn = fills(find(stage, 'facade') as Graphics).filter((d) => d.y >= below && d.y < below + 72);
    expect(drawn.some((d) => d.color === STRIP_BELOW && d.h === 72)).toBe(true);
    expect(drawn.some((d) => d.color === FACADE_WALL)).toBe(false);
    expect(fills(find(stage, 'facade lit') as Graphics).filter((d) => d.y >= below && d.y < below + 72)).toEqual([]);
    // Above the street the lit office still shows its panes.
    expect(fills(find(stage, 'facade lit') as Graphics).some((d) => d.y === floorTopY(1) + 6)).toBe(true);
  });

  it('grades the wall at night like an empty room, and never the lit panes on the emissive layer', async () => {
    const night = await farWorld(at(23));
    const facade = find(night.stage, 'facade') as Graphics;
    const lit = find(night.stage, 'facade lit') as Graphics;
    expect(facade.tint).toBe(NIGHT_GRADE.vacant);
    expect(lit.tint).toBe(0xffffff);
    expect(lit.parent?.label).toBe('emissive');
    const day = await farWorld(at(12));
    expect((find(day.stage, 'facade') as Graphics).tint).toBe(0xffffff);
  });
});

describe('a room on fire', () => {
  it('draws no lit panes or halo while it burns, and gets them back once the fire is out', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    const office = makeRoom(world, 'office', 3, 100, { occupancy: 2 });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(fills(find(stage, 'lit panes') as Graphics).length).toBeGreaterThan(0);
    setOnFire(world, office, true);
    renderer.render(world, 1);
    expect(fills(find(stage, 'lit panes') as Graphics)).toEqual([]);
    expect(fills(find(stage, 'lit halo') as Graphics)).toEqual([]);
    setOnFire(world, office, false);
    renderer.render(world, 1);
    expect(fills(find(stage, 'lit panes') as Graphics).length).toBeGreaterThan(0);
  });

  it('puts out a burning shop\'s pools and lit sign, and gives it no lit pane on the far facade', async () => {
    const world = createWorld(5);
    world.time.minute = at(20); // open and night
    const shop = makeRoom(world, 'shop', 3, 100, { occupancy: 2 });
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    const pool = spritesWith(find(stage, 'pools'), 'glow')[0]!.parent!;
    const glow = spritesWith(find(stage, 'sign glows'), 'glow')[0]!;
    const litFace = spritesWith(find(stage, 'lit signs'), 'sign|')[0]!;
    expect([pool.visible, glow.visible, litFace.visible]).toEqual([true, true, true]);
    setOnFire(world, shop, true);
    renderer.render(world, 1);
    expect([pool.visible, glow.visible, litFace.visible]).toEqual([false, false, false]);
    // Far zoom: the burning shop's facade panes are dark, not lit.
    zoomTo(renderer, world, frame, 0.4);
    const panes = fills(find(stage, 'facade lit') as Graphics).filter((d) => d.y === floorTopY(3) + 6);
    expect(panes.length).toBeGreaterThan(0);
    expect(panes.every((d) => d.color === 0x2a3550)).toBe(true);
    setOnFire(world, shop, false);
    zoomTo(renderer, world, frame, 1);
    zoomTo(renderer, world, frame, 0.4);
    expect(fills(find(stage, 'facade lit') as Graphics).some((d) => d.y === floorTopY(3) + 6 && d.color === 0xffd866)).toBe(true);
    zoomTo(renderer, world, frame, 1);
    expect([pool.visible, glow.visible, litFace.visible]).toEqual([true, true, true]);
  });
});

describe('the muted tier', () => {
  it('dims the emissive layer with the window veil, and not at full zoom', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    makeRoom(world, 'office', 3, 100, { occupancy: 2 });
    const { renderer, stage, frame } = await mount(world);
    renderer.render(world, 1);
    const emissive = find(stage, 'emissive');
    expect(emissive.alpha).toBe(1);
    zoomTo(renderer, world, frame, 0.6);
    expect(find(stage, 'window veil').visible).toBe(true);
    expect(emissive.alpha).toBeCloseTo(1 - find(stage, 'window veil').alpha);
    expect(emissive.alpha).toBeCloseTo(0.8);
    zoomTo(renderer, world, frame, 1);
    expect(emissive.alpha).toBe(1);
  });
});

describe('stress marks at any crowd size', () => {
  /** A lobby floor with `count` people drawn, one of them red with stress. */
  async function crowd(count: number): Promise<Container> {
    const world = createWorld(11);
    world.time.minute = at(23);
    for (let x = 180; x < 200; x++) makeRoom(world, 'lobby', 1, x);
    makeWalker(world, 1, 186, STRESS.red + 0.05);
    for (let i = 1; i < count; i++) makeWalker(world, 1, 180 + (i % 16));
    const { renderer, stage } = await mount(world, { crowd: 'all' });
    renderer.camera.centerOn(1, 188);
    renderer.render(world, 1);
    return stage;
  }

  it('puts the mark on the emissive layer at 499 people as sprites and at 501 as particles', async () => {
    const few = await crowd(499);
    const emissiveFew = find(few, 'emissive');
    expect(walk(few, (n) => n instanceof ParticleContainer)).toHaveLength(0);
    expect(spritesWith(emissiveFew, 'mark|')).toHaveLength(1);

    const many = await crowd(501);
    const emissiveMany = find(many, 'emissive');
    const people = walk(find(many, 'selected person').parent as Container, (n) => n instanceof ParticleContainer) as ParticleContainer[];
    expect(people.length).toBe(1); // crowd mode is on
    const marks = walk(emissiveMany, (n) => n instanceof ParticleContainer) as ParticleContainer[];
    expect(marks).toHaveLength(1);
    expect(marks[0]!.particleChildren).toHaveLength(1);
    // The people (and what they carry) stay in the world under the night tint; the mark does not.
    expect(people[0]!.particleChildren.length).toBeGreaterThanOrEqual(501);
    expect(people[0]!.particleChildren).not.toContain(marks[0]!.particleChildren[0]);
  });
});

// The night (design pass 2026-09-25, package P3). D-4: what gives light (lit window panes over a
// soft halo, pools, signs, car indicators, stress marks) draws on an emissive layer above the
// light layer's multiply, and empty rooms fall back under a night grade. D-15: each room lights
// on its own minute across the dusk hour and goes out the same way at dawn. The real
// createRenderer against a stub pixi Application and stub art, as reconcile.test.ts: no GPU.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { floorTopY } from '../../src/render/camera';
import { TILE_PX } from '../../src/render/grid';
import { POOL_ALPHA } from '../../src/render/illustrated';
import { NIGHT_GRADE } from '../../src/render/light';
import { createRenderer, type Renderer } from '../../src/render/renderer';
import { ROOMS, STRESS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

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
// Rich enough for the venue layers: fixtures, signs, the shared glow, the closed overlays, marks.
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

async function mount(world: World): Promise<{ renderer: Renderer; stage: Container; frame: (dtMs: number) => void }> {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (dtMs: number): void => {
    app.ticker.deltaMS = dtMs;
    for (const fn of app.frames) fn();
  };
  return { renderer, stage: app.stage, frame };
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
  alpha: number;
}
function fills(g: Graphics): Drawn[] {
  const out: Drawn[] = [];
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

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, patch: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100, ...patch,
  };
  addRoom(world, room);
  return room;
}

function makeShaft(world: World, x: number, floorMin: number, floorMax: number, cars: Car[] = []): number {
  const id = allocId(world);
  const stops = new Set<number>();
  for (let f = floorMin; f <= floorMax; f++) if (f !== 0) stops.add(f);
  addShaft(world, { id, kind: 'standard', x, width: 4, floorMin, floorMax, stops, homeFloor: floorMin, cars, hallCalls: new Map() });
  return id;
}

describe('D-4: the emissive layer', () => {
  it('stacks the world, the light, the emissive layer and the overlay in that order, the emissive one in the world transform', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    makeRoom(world, 'office', 3, 180, { occupancy: 2 });
    const { renderer, stage, frame } = await mount(world);
    renderer.setGhost({ widthTiles: 9, heightFloors: 1, floor: 4, x: 180, ok: true });
    renderer.render(world, 1);
    const roots = stage.children as Container[];
    expect(spritesWith(roots[3]!, 'room|').length).toBeGreaterThan(0); // the world root
    expect(roots[4]!.children.some((s) => s instanceof Sprite && s.blendMode === 'multiply')).toBe(true); // the light
    expect(roots[5]!.label).toBe('emissive');
    expect(spritesWith(roots[6]!, 'ghost|')).toHaveLength(1); // the overlay root: never graded, never lit over

    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(6, 40);
    renderer.camera.zoomAt(2, 400, 300);
    for (let i = 0; i < 30; i++) frame(16);
    expect(roots[3]!.scale.x).not.toBe(1);
    expect(roots[5]!.scale.x).toBe(roots[3]!.scale.x);
    expect(roots[5]!.position.x).toBe(roots[3]!.position.x);
    expect(roots[5]!.position.y).toBe(roots[3]!.position.y);
  });

  it('holds the pools, the indicators and the marks in that order, with the panes under them and the signs under the marks', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    const { stage } = await mount(world);
    const emissive = find(stage, 'emissive');
    const order = emissive.children.map((c) => c.label);
    const i = (label: string): number => order.indexOf(label);
    for (const label of ['lit halo', 'lit panes', 'pools', 'sign glows', 'lit signs', 'indicators', 'marks']) expect(i(label), label).toBeGreaterThanOrEqual(0);
    expect(i('pools')).toBeLessThan(i('indicators'));
    expect(i('indicators')).toBeLessThan(i('marks'));
    expect(i('lit halo')).toBeLessThan(i('lit panes'));
    expect(i('sign glows')).toBeLessThan(i('lit signs'));
    // What stood in front of the windows before still does: the signs and the marks over the panes.
    expect(i('lit panes')).toBeLessThan(i('lit signs'));
    expect(i('lit panes')).toBeLessThan(i('marks'));
    expect((find(stage, 'lit halo') as Graphics).blendMode).toBe('add');
  });

  it('draws a lit room its panes above the multiply, one per tile, skipping shafts and stairs, with a halo per lit floor', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    const a = makeRoom(world, 'office', 3, 100, { occupancy: 2 }); // a shaft crosses it at tiles 104 to 107
    makeShaft(world, 104, 1, 6);
    const b = makeRoom(world, 'office', 5, 200, { occupancy: 1 }); // stairs from floor 4 cover its tiles 206 to 208
    makeRoom(world, 'stairs', 4, 206);
    makeRoom(world, 'office', 7, 100); // vacant: no panes
    const hotel = makeRoom(world, 'hotelSingle', 9, 100, { dirty: true }); // empty and dirty: the lamp only
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);

    const panes = fills(find(stage, 'lit panes') as Graphics);
    const lit = panes.filter((d) => d.color === 0xffd866 && d.w === 12 && d.h === 12);
    const tiles = (room: Room): number[] =>
      lit.filter((d) => d.y === floorTopY(room.floor) + 6).map((d) => (d.x - room.x * TILE_PX - 2) / 16);
    expect(tiles(a)).toEqual([0, 1, 2, 3, 8]);
    expect(tiles(b)).toEqual([0, 1, 2, 3, 4, 5]);
    // Every lit pane carries its 2 px pale header, over it.
    const headers = panes.filter((d) => d.color === 0xfff3b0);
    expect(headers.map((d) => [d.x, d.y, d.w, d.h])).toEqual(lit.map((d) => [d.x, d.y, 12, 2]));
    // The housekeeping lamp: a low warm strip at 55 percent in each of the hotel room's four panes.
    const lamp = panes.filter((d) => d.alpha === 0.55);
    expect(lamp.map((d) => [d.x - hotel.x * TILE_PX, d.y - floorTopY(9), d.w, d.h, d.color])).toEqual(
      [2, 18, 34, 50].map((x) => [x, 14, 12, 4, 0xffd866]),
    );
    expect(lit.length + headers.length + lamp.length).toBe(panes.length);

    const halo = fills(find(stage, 'lit halo') as Graphics);
    expect(halo).toEqual([
      { x: a.x * TILE_PX, y: floorTopY(3) + 4, w: 9 * TILE_PX, h: 16, color: 0xffd866, alpha: 0.12 },
      { x: b.x * TILE_PX, y: floorTopY(5) + 4, w: 9 * TILE_PX, h: 16, color: 0xffd866, alpha: 0.12 },
    ]);

    // By day both are cleared.
    world.time.minute = at(24 + 12);
    renderer.render(world, 1);
    expect(fills(find(stage, 'lit panes') as Graphics)).toEqual([]);
    expect(fills(find(stage, 'lit halo') as Graphics)).toEqual([]);
  });

  it('grades the empty rooms at night, their fixtures, shutters and staff with them, and leaves lit rooms and the day alone', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    const lit = makeRoom(world, 'office', 3, 100, { occupancy: 2 });
    const vacant = makeRoom(world, 'office', 4, 100);
    const hotel = makeRoom(world, 'hotelSingle', 5, 100, { dirty: true });
    const medical = makeRoom(world, 'medical', 6, 100); // a nurse at the desk whenever it is open, which is always
    const burning = makeRoom(world, 'office', 7, 100, { onFire: true });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const shell = (room: Room): Sprite => spritesWith(stage, `room|${room.kind}`).find((s) => s.y === floorTopY(room.floor))!;
    const fixtures = (room: Room): Sprite => spritesWith(stage, `interior|${room.kind}`).find((s) => Math.round(s.y) >= floorTopY(room.floor) && s.y < floorTopY(room.floor) + 72)!;
    expect(shell(lit).tint).toBe(NIGHT_GRADE.lit);
    expect(shell(vacant).tint).toBe(0x9aa5c6);
    expect(shell(hotel).tint).toBe(0xb4bcd6);
    expect(shell(medical).tint).toBe(0x9aa5c6);
    expect(shell(burning).tint).toBe(0xff8a72);
    expect(fixtures(lit).tint).toBe(0xffffff);
    expect(fixtures(vacant).tint).toBe(0x9aa5c6);
    expect(fixtures(hotel).tint).toBe(0xb4bcd6);
    expect(fixtures(burning).tint).toBe(0xff8a72);
    // The offices are shut at 23:00: their blinds take the room's grade too.
    const blinds = spritesWith(stage, 'shut|office').find((s) => Math.round(s.y) >= floorTopY(vacant.floor) && s.y < floorTopY(vacant.floor) + 72)!;
    expect(blinds.visible).toBe(true);
    expect(blinds.tint).toBe(0x9aa5c6);
    const nurse = spritesWith(stage, 'sim|staff').find((s) => s.y > floorTopY(medical.floor) && s.y <= floorTopY(medical.floor) + 72)!;
    expect(nurse.visible).toBe(true);
    expect(nurse.tint).toBe(0x9aa5c6);
    // Every painted wall a look hangs (two white sprites at the room's corner) takes the grade of its room.
    const walls = walk(stage, (n) => n.children.length === 2 && n.children.every((c) => c instanceof Sprite && c.texture === Texture.WHITE));
    for (const wall of walls) {
      const room = [lit, vacant, hotel, medical, burning].find((r) => r.x * TILE_PX === wall.x && floorTopY(r.floor) === wall.y)!;
      expect(room, 'a wall belongs to one of the rooms').toBeDefined();
      expect(wall.tint).toBe(shell(room).tint);
    }

    world.time.minute = at(24 + 12);
    renderer.render(world, 1);
    expect(shell(vacant).tint).toBe(0xffffff);
    expect(fixtures(vacant).tint).toBe(0xffffff);
    expect(nurse.tint).toBe(0xffffff);
    expect(shell(burning).tint).toBe(0xff8a72);
  });

  it('adds the pools of light over the multiply at 35 percent', async () => {
    expect(POOL_ALPHA).toBe(0.35);
    const world = createWorld(5);
    world.time.minute = at(23);
    makeRoom(world, 'condo', 3, 100, { occupancy: 2 });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const pools = find(stage, 'pools');
    expect(pools.parent?.label).toBe('emissive');
    const glows = spritesWith(pools, 'glow');
    expect(glows.length).toBeGreaterThan(0);
    expect(glows.every((g) => g.blendMode === 'add' && g.alpha === 0.35)).toBe(true);
    expect(glows[0]!.parent!.visible).toBe(true);
  });

  it('lights an open sign at night with an added glow at 80 percent and a second face above the multiply, and only then', async () => {
    const world = createWorld(5);
    world.time.minute = at(20); // shops are open until 21:00
    makeRoom(world, 'shop', 3, 100);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const glow = spritesWith(find(stage, 'sign glows'), 'glow')[0]!;
    expect(glow.blendMode).toBe('add');
    expect(glow.alpha).toBeCloseTo(0.8);
    const faces = spritesWith(stage, 'sign|');
    expect(faces).toHaveLength(2);
    const litFace = spritesWith(find(stage, 'lit signs'), 'sign|')[0]!;
    const dayFace = faces.find((s) => s !== litFace)!;
    expect(litFace.texture).toBe(dayFace.texture);
    expect([litFace.x, litFace.y, litFace.width, litFace.height]).toEqual([dayFace.x, dayFace.y, dayFace.width, dayFace.height]);
    expect([glow.visible, litFace.visible]).toEqual([true, true]);

    world.time.minute = at(23); // shut: the sign dims and nothing is lit
    renderer.render(world, 1);
    expect([glow.visible, litFace.visible]).toEqual([false, false]);
    expect(dayFace.tint).not.toBe(0xffffff);

    world.time.minute = at(24 + 12); // open by day: the plain sign
    renderer.render(world, 1);
    expect([glow.visible, litFace.visible, dayFace.tint]).toEqual([false, false, 0xffffff]);
  });

  it('draws the car indicators and the stress marks on the emissive layer', async () => {
    const world = createWorld(5);
    world.time.minute = at(23);
    const shaftId = allocId(world);
    const car: Car = { id: allocId(world), shaftId, y: 2, dir: 1, state: 'moving', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null };
    addShaft(world, { id: shaftId, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 6, stops: new Set([1, 2, 3, 4, 5, 6]), homeFloor: 1, cars: [car], hallCalls: new Map() });
    for (let x = 170; x < 200; x++) makeRoom(world, 'lobby', 1, x);
    const sim: Sim = {
      id: 8, kind: 'worker', homeRoomId: null, pos: { floor: 1, x: 175 }, inCarId: null, inRoomId: null, route: [], state: 'walking',
      stress: STRESS.red + 0.05, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
    };
    addSim(world, sim);
    const { renderer, stage } = await mount(world);
    renderer.camera.centerOn(1, 180);
    renderer.render(world, 1);
    const indicators = find(stage, 'indicators');
    expect(indicators.parent?.label).toBe('emissive');
    expect(indicators.children.length).toBe(1);
    const marks = find(stage, 'marks');
    expect(marks.parent?.label).toBe('emissive');
    expect(spritesWith(marks, 'mark|')).toHaveLength(1);
  });
});

describe('D-15: the tower lights window by window', () => {
  /** Sixty occupied offices over three floors. */
  function officeBlock(minute: number): World {
    const world = createWorld(11);
    world.time.minute = minute;
    for (let i = 0; i < 60; i++) makeRoom(world, 'office', 2 + Math.floor(i / 20), 10 + (i % 20) * 9, { occupancy: 1 });
    return world;
  }
  const states = (stage: Container): string[] => spritesWith(stage, 'room|office').map((s) => s.texture.label!.split('|').at(-1)!);

  it('keeps every room in day until 18:15, lights some by 18:37 and all by 19:00, a reconcile every five game minutes', async () => {
    const world = officeBlock(at(18, 10));
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(new Set(states(stage))).toEqual(new Set(['day']));
    expect(fills(find(stage, 'lit panes') as Graphics)).toEqual([]);

    const version = world.structureVersion;
    world.time.minute = at(18, 37);
    renderer.render(world, 1);
    const dusk = states(stage);
    expect(world.structureVersion).toBe(version); // no bump: the light band moved
    expect(dusk.filter((s) => s === 'lit').length).toBeGreaterThan(5);
    expect(dusk.filter((s) => s === 'day').length).toBeGreaterThan(5);
    // The emissive panes follow the rooms that are on, nine panes each.
    const panes = fills(find(stage, 'lit panes') as Graphics).filter((d) => d.h === 12);
    expect(panes.length).toBe(9 * dusk.filter((s) => s === 'lit').length);
    // Five minutes later more are on, never fewer.
    world.time.minute = at(18, 42);
    renderer.render(world, 1);
    expect(states(stage).filter((s) => s === 'lit').length).toBeGreaterThanOrEqual(dusk.filter((s) => s === 'lit').length);

    world.time.minute = at(19);
    renderer.render(world, 1);
    expect(new Set(states(stage))).toEqual(new Set(['lit']));
  });

  it('puts them out the same way at dawn', async () => {
    const world = officeBlock(at(24 + 5, 20));
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    expect(new Set(states(stage))).toEqual(new Set(['lit']));
    world.time.minute = at(24 + 5, 52);
    renderer.render(world, 1);
    const dawn = states(stage);
    expect(dawn.filter((s) => s === 'lit').length).toBeGreaterThan(5);
    expect(dawn.filter((s) => s === 'day').length).toBeGreaterThan(5);
    world.time.minute = at(24 + 6, 15);
    renderer.render(world, 1);
    expect(new Set(states(stage))).toEqual(new Set(['day']));
  });
});

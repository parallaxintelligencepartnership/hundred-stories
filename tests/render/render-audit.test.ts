// Audit 2026-09-25, lanes F1 to F3 (renderer half): the verifyF harness. The real createRenderer
// against a stub pixi Application and stub art, as reconcile.test.ts, with the canvas and window
// listeners captured so taps and keys go through the renderer's real handlers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import {
  builtFloorExtents,
  createRenderer,
  inCrowd,
  PICK_RADIUS_TILES,
  pickRoomAt,
  type Ghost,
  type PickHit,
  type Renderer,
} from '../../src/render/renderer';
import { floorBaseY, floorTopY } from '../../src/render/camera';
import { shownWeatherKind } from '../../src/render/weather';
import { weatherAt } from '../../src/game/weather';
import { createGame } from '../../src/game/game';
import { ROOMS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

type Listener = (e: unknown) => void;
const apps = vi.hoisted(
  () =>
    [] as {
      stage: import('pixi.js').Container;
      frames: (() => void)[];
      ticker: { deltaMS: number };
      canvasListeners: Map<string, Listener[]>;
    }[],
);
vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvasListeners = new Map<string, Listener[]>();
    canvas = {
      style: {} as Record<string, string>,
      addEventListener: (type: string, fn: Listener): void => {
        const list = this.canvasListeners.get(type) ?? [];
        list.push(fn);
        this.canvasListeners.set(type, list);
      },
      removeEventListener: (): void => {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: (): void => {},
      releasePointerCapture: (): void => {},
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
  umbrella: (c) => tex(`umbrella|${c}`),
  vehicle: (k) => tex(`vehicle|${k}`),
};
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

const NOON = 12 * 60;
const windowListeners = new Map<string, Listener[]>();
let renderers: Renderer[] = [];
beforeEach(() => {
  windowListeners.clear();
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    addEventListener: (type: string, fn: Listener) => {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
    removeEventListener: () => {},
  });
  // The key handler asks whether the target is a text field.
  vi.stubGlobal('HTMLElement', class {});
});
afterEach(() => {
  for (const r of renderers) r.destroy();
  renderers = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(world: World): Promise<{
  renderer: Renderer;
  stage: Container;
  frame: (dtMs: number) => void;
  tap: (sx: number, sy: number) => void;
  picks: PickHit[];
}> {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (dtMs: number): void => {
    app.ticker.deltaMS = dtMs;
    for (const fn of app.frames) fn();
  };
  const fire = (type: string, e: unknown): void => {
    for (const fn of app.canvasListeners.get(type) ?? []) fn(e);
  };
  const tap = (sx: number, sy: number): void => {
    const e = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: sx, clientY: sy, timeStamp: 1000, preventDefault() {} };
    fire('pointerdown', e);
    fire('pointerup', { ...e, timeStamp: 1050 });
  };
  const picks: PickHit[] = [];
  renderer.onPick((hit) => picks.push(hit));
  return { renderer, stage: app.stage, frame, tap, picks };
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
const spritesWith = (root: Container, prefix: string): Sprite[] =>
  walk(root, (n) => n instanceof Sprite && !!n.texture.label?.startsWith(prefix)) as Sprite[];
const shown = (root: Container, prefix: string): Sprite[] =>
  spritesWith(root, prefix).filter((s) => s.visible && s.parent?.visible !== false);
const byLabel = (root: Container, label: string): Container => walk(root, (n) => n.label === label)[0]!;
/** worldRoot's first child: the street (curb scene, wet pavement). */
const groundOf = (stage: Container): Container => (stage.children[3] as Container).children[0] as Container;

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}
function makeSim(world: World, id: number, over: Partial<Sim>): Sim {
  const sim: Sim = {
    id, kind: 'worker', homeRoomId: null, pos: { floor: 1, x: 100 }, inCarId: null, inRoomId: null, route: [], state: 'walking',
    stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null, ...over,
  };
  addSim(world, sim);
  return sim;
}

/** An office on floor 2 at x 100 over a lobby, with one person in it standing at the room's middle. */
function officeWith(simId: number): { world: World; office: Room; center: number; sim: Sim } {
  const world = createWorld(3);
  world.time.minute = NOON;
  for (let x = 96; x < 112; x++) makeRoom(world, 'lobby', 1, x);
  const office = makeRoom(world, 'office', 2, 100);
  const center = office.x + Math.floor(office.width / 2);
  const sim = makeSim(world, simId, { homeRoomId: office.id, inRoomId: office.id, state: 'inRoom', pos: { floor: 2, x: center } });
  return { world, office, center, sim };
}

describe('people are picked and ringed where they are drawn (F1 S2, new S5, F1 S6)', () => {
  it('F1 S2: a tap on the person at the desk picks them, a tap on the empty middle picks the room, and far zoom picks the room', async () => {
    const { world, office, center, sim } = officeWith(400);
    expect(inCrowd(sim)).toBe(true);
    const { renderer, stage, frame, tap, picks } = await mount(world);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(2, 104);
    frame(16);
    renderer.render(world, 1);
    const sprite = spritesWith(byLabel(stage, 'people'), 'sim|')[0]!;
    // The person sits at a desk, well away from the room's middle (sim.pos.x).
    expect(Math.abs(sprite.x / 16 - center)).toBeGreaterThan(PICK_RADIUS_TILES);

    const onPerson = renderer.camera.worldToScreen(sprite.x, sprite.y - 20);
    tap(onPerson.x, onPerson.y);
    expect(picks.at(-1)).toMatchObject({ simId: sim.id });

    const onEmpty = renderer.camera.worldToScreen((center + 0.5) * 16, sprite.y - 20);
    tap(onEmpty.x, onEmpty.y);
    expect(picks.at(-1)?.simId).toBeUndefined();
    expect(picks.at(-1)).toMatchObject({ roomId: office.id });

    // The ring goes round the drawn person.
    renderer.setSelection({ simId: sim.id });
    renderer.render(world, 1);
    const ring = byLabel(stage, 'selection') as Graphics;
    expect(ring.visible).toBe(true);
    const b = ring.getLocalBounds();
    expect(b.x).toBeLessThanOrEqual(sprite.x - 8);
    expect(b.x + b.width).toBeGreaterThanOrEqual(sprite.x + 8);
    expect(b.x).toBeGreaterThan(sprite.x - 24);

    // Far zoom draws no people: a tap on the office block is the office.
    renderer.setSelection(null);
    renderer.camera.zoomAt(0.3, 400, 300);
    frame(16);
    renderer.render(world, 1);
    expect(byLabel(stage, 'people').visible).toBe(false);
    const far = renderer.camera.worldToScreen((center + 0.5) * 16, floorTopY(2) + 30);
    tap(far.x, far.y);
    expect(picks.at(-1)?.simId).toBeUndefined();
    expect(picks.at(-1)).toMatchObject({ roomId: office.id });
  });

  it('new S5: a person picked from the occupant list who is not drawn gets no ring on the empty floor', async () => {
    const { world, sim } = officeWith(401);
    expect(inCrowd(sim)).toBe(false);
    const { renderer, stage } = await mount(world);
    renderer.setSelection({ simId: sim.id }); // what the room panel's occupant row does
    renderer.render(world, 1);
    expect(spritesWith(byLabel(stage, 'people'), 'sim|')).toHaveLength(0);
    expect((byLabel(stage, 'selection') as Graphics).visible).toBe(false);
  });

  it('keeps the ring on a sampled person in a room', async () => {
    const { world, sim } = officeWith(400);
    const { renderer, stage } = await mount(world);
    renderer.setSelection({ simId: sim.id });
    renderer.render(world, 1);
    expect((byLabel(stage, 'selection') as Graphics).visible).toBe(true);
  });

  it('F1 S6: a selected person riding a car is not ringed at the hall floor', async () => {
    const world = createWorld(5);
    world.time.minute = NOON;
    const shaftId = allocId(world);
    const car: Car = { id: allocId(world), shaftId, y: 9, dir: 1, state: 'moving', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null };
    addShaft(world, {
      id: shaftId, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 12,
      stops: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), homeFloor: 1, cars: [car], hallCalls: new Map(),
    });
    const sim = makeSim(world, 400, { state: 'riding', inCarId: car.id, pos: { floor: 1, x: 179 } });
    car.passengers.push(sim.id);
    const { renderer, stage } = await mount(world);
    renderer.setSelection({ simId: sim.id });
    renderer.render(world, 1);
    // The car draws the rider; nobody is ringed on floor 1 while the car is at floor 9.
    expect(spritesWith(stage, 'car|')).toHaveLength(1);
    expect((byLabel(stage, 'selection') as Graphics).visible).toBe(false);
  });
});

describe('keys with a modifier (F1 S5)', () => {
  it('Cmd+A does not pan the camera, and a plain A still does', async () => {
    const world = createWorld(3);
    world.time.minute = NOON;
    const { renderer, frame } = await mount(world);
    renderer.camera.setReducedMotion(true);
    frame(16);
    const x0 = renderer.camera.x;
    const key = (type: string, e: Record<string, unknown>): void => {
      for (const fn of windowListeners.get(type) ?? []) fn({ key: 'a', code: 'KeyA', metaKey: false, ctrlKey: false, altKey: false, target: null, ...e });
    };
    key('keydown', { metaKey: true }); // Cmd+A, and the browser never sends the keyup
    for (let i = 0; i < 60; i++) frame(16);
    expect(renderer.camera.x).toBe(x0);

    key('keydown', {});
    for (let i = 0; i < 30; i++) frame(16);
    key('keyup', {});
    expect(renderer.camera.x).not.toBe(x0);
  });
});

describe('connectors and floor strips (F1 S7, S8)', () => {
  it('F1 S7: where two flights overlap, the tap picks the one drawn on top', async () => {
    const world = createWorld(5);
    world.time.minute = NOON;
    const lower = makeRoom(world, 'stairs', 2, 104); // floors 2 and 3
    const upper = makeRoom(world, 'stairs', 3, 100); // floors 3 and 4, made later: drawn over the first
    expect(pickRoomAt(world, 3, 106)?.id).toBe(upper.id);
    expect(pickRoomAt(world, 2, 106)?.id).toBe(lower.id);
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const connectors = byLabel(stage, 'connectors').children as Sprite[];
    expect(connectors.at(-1)!.x).toBe(upper.x * 16);
  });

  it('F1 S8: a flight from B1 to the ground paints the ground floor strip too', () => {
    const world = createWorld(6);
    makeRoom(world, 'stairs', -1, 130);
    expect([...builtFloorExtents(world).keys()].sort((a, b) => a - b)).toEqual([-1, 1]);
  });
});

describe('elevators (F2 S1, F2 S2)', () => {
  it('F2 S2: an elevator ghost across the ground floor covers exactly the floors of its span', async () => {
    // The game's ghost feed: a new drag from B1 to 1.
    const ghosts: (Ghost | null)[] = [];
    const fake = {
      render: () => {},
      camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
      screenToTile: (sx: number, sy: number) => ({ floor: sy, x: Math.floor(sx) }), // screen y is the floor
      setGhost: (g: Ghost | null) => ghosts.push(g),
      ghostScreenRect: () => null,
      setSelection: () => {},
      onPick: () => {},
      setPanEnabled: () => {},
      setToolOwnsDrag: () => {},
      setReducedMotion: () => {},
      setChrome: () => {},
      resetMotion: () => {},
      destroy: () => {},
    } as unknown as Renderer;
    const handlers = new Map<string, Listener[]>();
    const host = {
      addEventListener: (type: string, fn: Listener) => {
        const list = handlers.get(type) ?? [];
        list.push(fn);
        handlers.set(type, list);
      },
    } as unknown as HTMLElement;
    const fire = (type: string, e: unknown): void => {
      for (const fn of handlers.get(type) ?? []) fn(e);
    };
    const game = createGame(1);
    game.attach(fake, host);
    game.world.cash = 1e9;
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    const at = (x: number, floor: number): Record<string, number | string> => ({
      button: 0, pointerId: 1, pointerType: 'mouse', offsetX: x, offsetY: floor, clientX: x, clientY: floor, timeStamp: 0,
    });
    fire('pointerdown', at(200, -1));
    fire('pointermove', at(200, 1));
    const fed = ghosts.filter((g): g is Ghost => g !== null).at(-1)!;
    fire('pointerup', at(200, 1));
    expect(fed).toMatchObject({ floor: -1, heightFloors: 2 });

    // The renderer draws each span over exactly its floors.
    const world = createWorld(3);
    world.time.minute = NOON;
    const { renderer, stage } = await mount(world);
    const drawn = (g: Ghost): [number, number] => {
      renderer.setGhost(g);
      renderer.render(world, 1);
      const sprite = spritesWith(stage, 'ghost|')[0]!;
      return [sprite.y, sprite.y + sprite.height];
    };
    expect(drawn(fed)).toEqual([floorTopY(1), floorBaseY(-1)]); // -72..72
    // An existing shaft B3..1 dragged up to 2: five floors, B3 to 2.
    expect(drawn({ widthTiles: 4, heightFloors: 5, floor: -3, x: 300, ok: true, shaft: 'standard' })).toEqual([floorTopY(2), floorBaseY(-3)]); // -144..216
    // Room ghosts are unchanged: stairs based at B1 cover B1 and 1.
    expect(drawn({ widthTiles: 8, heightFloors: 2, floor: -1, x: 130, ok: true })).toEqual([floorTopY(1), floorBaseY(-1)]);
    expect(drawn({ widthTiles: 9, heightFloors: 1, floor: 4, x: 130, ok: true })).toEqual([floorTopY(4), floorBaseY(4)]);
  });

  it('F2 S1 and new S4: a built express from 1 to 100 is a stack of pieces no taller than 32 floors, covering its span', async () => {
    const world = createWorld(5);
    world.time.minute = NOON;
    const shaftId = allocId(world);
    addShaft(world, {
      id: shaftId, kind: 'express', x: 180, width: 6, floorMin: 1, floorMax: 100,
      stops: new Set([1, 100]), homeFloor: 1, cars: [], hallCalls: new Map(),
    });
    const { renderer, stage } = await mount(world);
    renderer.render(world, 1);
    const parts = spritesWith(stage, 'shaft|express|').sort((a, b) => a.y - b.y);
    const floorsOf = (s: Sprite): number => Number(s.texture.label!.split('|')[2]);
    expect(parts.map(floorsOf)).toEqual([32, 32, 32, 4]);
    expect(parts[0]!.y).toBe(floorTopY(100));
    for (let i = 1; i < parts.length; i++) expect(parts[i]!.y).toBe(parts[i - 1]!.y + parts[i - 1]!.height);
    const last = parts.at(-1)!;
    expect(last.y + last.height).toBe(floorBaseY(1));
  });
});

describe('a tower switch and the street (F3 S2, F3 S4)', () => {
  it('F3 S2: after a switch from a rainy tower to a clear one, the first frame has no commuters, no umbrellas and a dry street', async () => {
    const minute = NOON;
    let rainy = -1;
    let clear = -1;
    for (let s = 1; s < 400 && (rainy < 0 || clear < 0); s++) {
      const w = weatherAt(s, minute);
      if (rainy < 0 && w.kind === 'rain' && w.intensity > 0.5) rainy = s;
      if (clear < 0 && w.kind === 'clear') clear = s;
    }
    expect(rainy).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(0);
    const a = createWorld(rainy);
    a.time.minute = minute;
    const b = createWorld(clear);
    b.time.minute = minute;
    for (const w of [a, b]) for (let x = 100; x < 140; x++) makeRoom(w, 'lobby', 1, x);
    for (let i = 1; i <= 40; i++) makeSim(a, 1000 + i, { state: 'outside' });
    // Tower B has people with the same ids, every one of them inside.
    for (let i = 1; i <= 40; i++) makeSim(b, 1000 + i, { state: 'inRoom', inRoomId: 1, pos: { floor: 1, x: 101 } });

    const now = vi.spyOn(performance, 'now');
    let t = 50_000;
    now.mockReturnValue(t);
    const { renderer, stage, frame } = await mount(a);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(1, 120);
    renderer.camera.zoomAt(0.6, 400, 300);
    renderer.render(a, 1);
    for (let i = 0; i < 10; i++) {
      t += 16;
      now.mockReturnValue(t);
      frame(16);
    }
    const ground = groundOf(stage);
    // The rainy tower really is showing commuters under umbrellas on a wet street.
    expect(shown(ground, 'sim|').length).toBeGreaterThan(0);
    expect(shown(ground, 'umbrella|').length).toBeGreaterThan(0);
    expect(byLabel(ground, 'wet street').visible).toBe(true);

    renderer.resetMotion();
    renderer.render(b, 1);
    t += 16;
    now.mockReturnValue(t);
    frame(16);
    expect(shown(ground, 'sim|')).toHaveLength(0);
    expect(shown(ground, 'umbrella|')).toHaveLength(0);
    expect(byLabel(ground, 'wet street').visible).toBe(false);
    // And the status bar names the new tower's weather, not the old tower's rain.
    expect(shownWeatherKind(b.seed, minute)).toBe('clear');
  });

  it('F3 S4: a person leaving from floor 10 is never drawn in the tower and on the street at once', async () => {
    const world = createWorld(3);
    world.time.minute = NOON;
    for (let x = 100; x < 140; x++) makeRoom(world, 'lobby', 1, x);
    const sim = makeSim(world, 1004, { state: 'leaving', pos: { floor: 10, x: 120 } });
    expect(inCrowd(sim)).toBe(true);
    const now = vi.spyOn(performance, 'now');
    let t = 50_000;
    now.mockReturnValue(t);
    const { renderer, stage, frame } = await mount(world);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(5, 120);
    renderer.camera.zoomAt(0.55, 400, 300);
    renderer.render(world, 1);
    let inTower = 0;
    let both = 0;
    for (let i = 0; i < 60; i++) {
      t += 100;
      now.mockReturnValue(t);
      frame(100);
      renderer.render(world, 1);
      const onStreet = shown(groundOf(stage), 'sim|').length;
      const inside = spritesWith(byLabel(stage, 'people'), 'sim|').length;
      if (inside > 0) inTower++;
      if (onStreet > 0 && inside > 0) both++;
    }
    expect(inTower).toBeGreaterThan(0);
    expect(both).toBe(0);
  });
});

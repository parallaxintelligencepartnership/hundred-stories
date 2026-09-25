// Verifier probes for lanes F1, F2, F3. Stub pixi Application and stub art, as tests/render/reconcile.test.ts,
// plus captured canvas and window listeners so taps and keys go through the renderer's real handlers.
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Art } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art';
import { doorFrameOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/anim';
import { builtFloorExtents, createRenderer, pickRoomAt, type Ghost, type PickHit, type Renderer } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/renderer';
import { floorTopY, floorBaseY, yToFloor } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/camera';
import { ROOMS } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/rules';
import type { Car, Room, RoomKind, Sim, World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
import { addShaft, addSim, allocId, createWorld, addRoom } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';
import { applyCommand } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/build';
import { weatherAt } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/game/weather';
import { createGame } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/game/game';

vi.mock('/Users/matthew/parallax-private/Projects/hundred-stories/src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

type L = (e: unknown) => void;
const apps = vi.hoisted(() => [] as { stage: import('pixi.js').Container; frames: (() => void)[]; ticker: { deltaMS: number }; canvasL: Map<string, L[]> }[]);
vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvasL = new Map<string, L[]>();
    canvas = {
      style: {} as Record<string, string>,
      addEventListener: (t: string, fn: L): void => { const l = this.canvasL.get(t) ?? []; l.push(fn); this.canvasL.set(t, l); },
      removeEventListener: (): void => {},
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: (): void => {},
      releasePointerCapture: (): void => {},
    };
    renderer = { background: { color: 0 }, render: (): void => {} };
    frames: (() => void)[] = [];
    ticker = { add: (fn: () => void): void => { this.frames.push(fn); }, remove: (): void => {}, deltaMS: 16 };
    constructor() { apps.push(this); }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: FakeApplication, isWebGLSupported: () => true };
});
const textures = new Map<string, Texture>();
function tex(key: string): Texture { let t = textures.get(key); if (!t) textures.set(key, (t = new Texture({ label: key }))); return t; }
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
vi.mock('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art')>();
  return { ...art, createArt: () => stubArt };
});
vi.mock('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

const winL = new Map<string, L[]>();
let renderers: Renderer[] = [];
beforeEach(() => {
  winL.clear();
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: (t: string, fn: L) => { const l = winL.get(t) ?? []; l.push(fn); winL.set(t, l); }, removeEventListener: () => {} });
});
afterEach(() => { for (const r of renderers) r.destroy(); renderers = []; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount(world: World) {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (dt: number): void => { app.ticker.deltaMS = dt; for (const fn of app.frames) fn(); };
  const fire = (t: string, e: unknown): void => { for (const fn of app.canvasL.get(t) ?? []) fn(e); };
  const tap = (sx: number, sy: number): void => {
    const e = { button: 0, pointerId: 1, pointerType: 'mouse', clientX: sx, clientY: sy, timeStamp: 1000, preventDefault() {} };
    fire('pointerdown', e);
    fire('pointerup', { ...e, timeStamp: 1050 });
  };
  const picks: PickHit[] = [];
  renderer.onPick((h) => picks.push(h));
  return { renderer, stage: app.stage, frame, tap, picks };
}
function walk(root: Container, pred: (n: Container) => boolean): Container[] {
  const out: Container[] = [];
  const go = (n: Container): void => { if (pred(n)) out.push(n); for (const c of n.children) go(c as Container); };
  go(root);
  return out;
}
const spritesWith = (root: Container, p: string): Sprite[] => walk(root, (n) => n instanceof Sprite && !!n.texture.label?.startsWith(p)) as Sprite[];
const byLabel = (root: Container, label: string): Container => walk(root, (n) => n.label === label)[0]!;

function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = { id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100 };
  addRoom(world, room);
  return room;
}
function makeSim(world: World, id: number, over: Partial<Sim>): Sim {
  const sim: Sim = { id, kind: 'worker', homeRoomId: null, pos: { floor: 1, x: 100 }, inCarId: null, inRoomId: null, route: [], state: 'walking', stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null, ...over };
  addSim(world, sim);
  return sim;
}
function build(world: World, cmd: Parameters<typeof applyCommand>[1]): void {
  const r = applyCommand(world, cmd);
  console.log('   build', JSON.stringify(cmd), '->', JSON.stringify(r));
}

describe('verify F', () => {
  it('F1 S1: ids built by real commands collide across towers; layer after swap', async () => {
    const a = createWorld(1); a.time.minute = 720; a.cash = 1e9;
    const b = createWorld(2); b.time.minute = 720; b.cash = 1e9;
    for (let x = 96; x < 120; x++) { build(a, { kind: 'build', room: 'lobby', floor: 1, x }); build(b, { kind: 'build', room: 'lobby', floor: 1, x }); }
    build(a, { kind: 'build', room: 'stairs', floor: 1, x: 100 });
    build(b, { kind: 'build', room: 'office', floor: 2, x: 100 });
    const stairs = [...a.rooms.values()].find((r) => r.kind === 'stairs')!;
    const office = [...b.rooms.values()].find((r) => r.kind === 'office')!;
    console.log('F1S1 stairs id in A', stairs.id, 'office id in B', office.id);
    const { renderer, stage, tap } = await mount(a);
    renderer.render(a, 1);
    renderer.resetMotion(); renderer.setSelection(null); renderer.setGhost(null); renderer.camera.reset();
    renderer.render(b, 1);
    const s = spritesWith(stage, 'room|office')[0]!;
    console.log('F1S1 A->B office sprite parent =', s.parent?.label, '| connector layer children', byLabel(stage, 'connectors').children.length);
    // reverse
    const r2 = await mount(b);
    r2.renderer.render(b, 1); r2.renderer.resetMotion(); r2.renderer.render(a, 1);
    const st = walk(r2.stage, (n) => n instanceof Sprite && n.parent?.label === 'rooms' && n.texture.label?.startsWith('room|office') === true);
    const rooms = byLabel(r2.stage, 'rooms');
    console.log('F1S1 B->A: rooms layer children', rooms.children.length, 'connectors children', byLabel(r2.stage, 'connectors').children.length, '(stairs sprite stays in rooms, under shafts/venues)');
    void st; void tap;
  });

  it('F1 S2: in-room pick and ring, and far-zoom pick', async () => {
    const w = createWorld(3); w.time.minute = 720;
    for (let x = 96; x < 112; x++) makeRoom(w, 'lobby', 1, x);
    const office = makeRoom(w, 'office', 2, 100);
    const center = office.x + Math.floor(office.width / 2);
    const sim = makeSim(w, 400, { kind: 'worker', homeRoomId: office.id, inRoomId: office.id, state: 'inRoom', pos: { floor: 2, x: center } });
    const { renderer, stage, frame, tap, picks } = await mount(w);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(2, 104);
    frame(16);
    renderer.render(w, 1);
    const sprite = spritesWith(stage, 'sim|')[0]!;
    console.log('F1S2 sim pos.x', sim.pos.x, 'sprite world x', sprite.x, '= tile', sprite.x / 16);
    const onSprite = renderer.camera.worldToScreen(sprite.x, sprite.y - 20);
    tap(onSprite.x, onSprite.y);
    console.log('F1S2 tap on the drawn person ->', JSON.stringify(picks.at(-1)));
    const onEmpty = renderer.camera.worldToScreen((center + 0.5) * 16, sprite.y - 20);
    tap(onEmpty.x, onEmpty.y);
    console.log('F1S2 tap on empty floor at tile', center, '->', JSON.stringify(picks.at(-1)));
    renderer.setSelection({ simId: sim.id });
    renderer.render(w, 1);
    const ring = byLabel(stage, 'selection') as Graphics;
    const b = ring.getLocalBounds();
    console.log('F1S2 ring x range', b.x, '..', b.x + b.width, 'vs sprite x', sprite.x - 8, '..', sprite.x + 8);
    // far zoom
    renderer.setSelection(null);
    renderer.camera.zoomAt(0.3, 400, 300);
    frame(16);
    renderer.render(w, 1);
    console.log('F1S2 zoom', renderer.camera.zoom.toFixed(3), 'people layer visible', byLabel(stage, 'people').visible, 'solo visible', (byLabel(stage, 'selected person').children[0] as Sprite).visible);
    const far = renderer.camera.worldToScreen((center + 0.5) * 16, floorTopY(2) + 30);
    tap(far.x, far.y);
    console.log('F1S2 far-zoom tap on the office block ->', JSON.stringify(picks.at(-1)));
  });

  it('F1 S5: Cmd+A pans with no keyup', async () => {
    const w = createWorld(3); w.time.minute = 720;
    vi.stubGlobal('HTMLElement', class {});
    const { renderer, frame } = await mount(w);
    renderer.camera.setReducedMotion(true);
    frame(16);
    const x0 = renderer.camera.x;
    for (const fn of winL.get('keydown') ?? []) fn({ code: 'KeyA', key: 'a', metaKey: true, ctrlKey: false, target: null });
    for (let i = 0; i < 60; i++) frame(16);
    console.log('F1S5 camera.x before', x0, 'after 1 s with Cmd+A down and no keyup', renderer.camera.x.toFixed(1));
  });

  it('F1 S6: ring on a riding person', async () => {
    const w = createWorld(5); w.time.minute = 720;
    const id = allocId(w);
    const car: Car = { id: allocId(w), shaftId: id, y: 9, dir: 1, state: 'moving', doorTimer: 0, idleSince: null, passengers: [], calls: new Set(), serves: 'any', range: null };
    addShaft(w, { id, kind: 'standard', x: 180, width: 4, floorMin: 1, floorMax: 12, stops: new Set([1,2,3,4,5,6,7,8,9,10,11,12]), homeFloor: 1, cars: [car], hallCalls: new Map() });
    const sim = makeSim(w, 400, { state: 'riding', inCarId: car.id, pos: { floor: 1, x: 179 } });
    car.passengers.push(sim.id);
    const { renderer, stage } = await mount(w);
    renderer.setSelection({ simId: sim.id });
    renderer.render(w, 1);
    const ring = byLabel(stage, 'selection') as Graphics;
    const b = ring.getLocalBounds();
    const carSprite = spritesWith(stage, 'car|')[0]!;
    console.log('F1S6 ring visible', ring.visible, 'ring y', b.y, '..', b.y + b.height, '(floor', yToFloor(b.y + b.height - 10), ') car sprite y', carSprite.y, '(floor', yToFloor(carSprite.y - 10), ')');
  });

  it('F1 S7: overlapping flights, pick vs draw order', async () => {
    const w = createWorld(5); w.time.minute = 720; w.cash = 1e9;
    for (let x = 90; x < 130; x++) build(w, { kind: 'build', room: 'lobby', floor: 1, x });
    build(w, { kind: 'build', room: 'office', floor: 2, x: 95 });
    build(w, { kind: 'build', room: 'office', floor: 2, x: 104 });
    // reviewer's input: A x108 base 2, B x100 base 3
    build(w, { kind: 'build', room: 'stairs', floor: 2, x: 104 });
    build(w, { kind: 'build', room: 'stairs', floor: 3, x: 100 });
    const flights = [...w.rooms.values()].filter((r) => r.kind === 'stairs');
    console.log('F1S7 flights', flights.map((r) => `id${r.id}@f${r.floor}x${r.x}`).join(' '));
    const { renderer, stage } = await mount(w);
    renderer.render(w, 1);
    const order = byLabel(stage, 'connectors').children.map((c) => (c as Sprite).x / 16);
    const picked = pickRoomAt(w, 3, 106);
    console.log('F1S7 connector draw order (x tiles, last on top)', order, '| pickRoomAt(floor 3, tile 106) -> x', picked?.x, 'id', picked?.id);
    console.log('F1S7 reviewer input tile 110: A covers 108..115, B covers 100..107, overlap at tile 110?', 110 >= 100 && 110 < 108);
  });

  it('F1 S8: B1-to-ground flight strip', () => {
    const w = createWorld(5); w.cash = 1e9;
    for (let x = 96; x < 120; x++) build(w, { kind: 'build', room: 'lobby', floor: 1, x });
    build(w, { kind: 'build', room: 'parkingSpace', floor: -1, x: 96 });
    build(w, { kind: 'build', room: 'stairs', floor: -1, x: 130 });
    const only = createWorld(6);
    makeRoom(only, 'stairs', -1, 130);
    console.log('F1S8 extents keys for a world holding only stairs@-1 h2:', [...builtFloorExtents(only).keys()]);
  });

  it('F2 S2: elevator ghost position from the real game ghost feed', async () => {
    const ghosts: (Ghost | null)[] = [];
    const floorOfY = (sy: number): number => sy; // screen y encodes the floor directly
    const fake = {
      render: () => {}, commitMotion: () => {}, resetMotion: () => {},
      camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
      screenToTile: (sx: number, sy: number) => ({ floor: floorOfY(sy), x: Math.floor(sx) }),
      setGhost: (g: Ghost | null) => ghosts.push(g), ghostScreenRect: () => null, setSelection: () => {}, onPick: () => {},
      setPanEnabled: () => {}, setToolOwnsDrag: () => {}, setReducedMotion: () => {}, setChrome: () => {}, destroy: () => {}, setGuideBand: () => {}, setOverlay: () => {},
    } as unknown as Renderer;
    const handlers = new Map<string, L[]>();
    const host = { addEventListener: (t: string, fn: L) => { const l = handlers.get(t) ?? []; l.push(fn); handlers.set(t, l); } } as unknown as HTMLElement;
    const fire = (t: string, e: unknown): void => { for (const fn of handlers.get(t) ?? []) fn(e); };
    const game = createGame(1);
    game.attach(fake, host);
    game.world.cash = 1e9;
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    const ev = (x: number, floor: number) => ({ button: 0, pointerId: 1, pointerType: 'mouse', offsetX: x, offsetY: floor, clientX: x, clientY: floor, timeStamp: 0 });
    // new drag B1 -> 1 at x 200
    fire('pointerdown', ev(200, -1)); fire('pointermove', ev(200, 1));
    const g1 = ghosts.filter(Boolean).at(-1)!;
    fire('pointerup', ev(200, 1));
    console.log('F2S2 new drag B1..1 ghost', JSON.stringify(g1));
    // an existing shaft B3..1 at x 300, extended to floor 2
    console.log('   shaft.build', JSON.stringify(game.apply({ kind: 'shaft.build', shaft: 'standard', x: 300, floorMin: -3, floorMax: 1 })));
    fire('pointerdown', ev(301, 1)); fire('pointermove', ev(301, 2));
    const g2 = ghosts.filter(Boolean).at(-1)!;
    fire('pointerup', ev(301, 2));
    console.log('F2S2 extend B3..1 -> B3..2 ghost', JSON.stringify(g2));
    const w = createWorld(3); w.time.minute = 720;
    const { renderer, stage } = await mount(w);
    for (const [name, g, lo, hi] of [['B1..1', g1, -1, 1], ['B3..2', g2, -3, 2]] as const) {
      renderer.setGhost(g); renderer.render(w, 1);
      const sp = spritesWith(stage, 'ghost|')[0]!;
      const top = sp.y, bottom = sp.y + sp.height;
      console.log(`F2S2 ${name}: drawn y ${top}..${bottom} = floors ${yToFloor(top + 1)} down to ${yToFloor(bottom - 1)}; should be y ${floorTopY(hi)}..${floorBaseY(lo)} (floors ${hi} down to ${lo})`);
    }
  });

  it('F3 S1: curb scene during a burning fire, real renderer', async () => {
    const w = createWorld(3); w.time.minute = 720;
    for (let x = 100; x < 140; x++) makeRoom(w, 'lobby', 1, x);
    const room = makeRoom(w, 'office', 2, 110);
    room.onFire = true;
    w.events.push({ kind: 'fire', roomIds: [room.id], startedAt: 700, spreadAt: 760 } as never);
    for (let i = 1; i <= 40; i++) makeSim(w, 1000 + i, { state: 'outside', pos: { floor: 1, x: 0 } });
    const now = vi.spyOn(performance, 'now');
    let t = 50_000;
    now.mockReturnValue(t);
    const { renderer, stage, frame } = await mount(w);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(1, 120);
    renderer.camera.zoomAt(0.6, 400, 300);
    renderer.render(w, 1);
    const ground = (stage.children[3] as Container).children[0] as Container;
    const tracks = new Map<Sprite, number[]>();
    const doors = { left: 100 * 16, right: 140 * 16 };
    for (let i = 0; i < 400; i++) {
      t += 100; now.mockReturnValue(t);
      frame(100);
      for (const s of spritesWith(ground, 'sim|')) {
        const d = s.x < doors.left + 1 ? doors.left - s.x : s.x - doors.right;
        const list = tracks.get(s) ?? []; list.push(d); tracks.set(s, list);
      }
    }
    const vehicle = spritesWith(ground, 'vehicle|')[0];
    let inward = 0, reachedDoor = 0, outward = 0;
    for (const list of tracks.values()) {
      if (list.length < 3) continue;
      if (list[list.length - 1]! < list[0]!) inward++; else outward++;
      if (Math.min(...list) < 3) reachedDoor++;
    }
    console.log('F3S1 fire event active; vehicle', vehicle?.texture.label, 'visible', vehicle?.visible, '| street figures tracked', tracks.size, 'moving toward the door', inward, 'away', outward, 'reached within 3 px of a door', reachedDoor);
  });

  it('F3 S2: rain and a stale curb sample carried over a tower switch', async () => {
    let rainy = -1, clear = -1, minute = 720;
    for (let s = 1; s < 400 && (rainy < 0 || clear < 0); s++) {
      const k = weatherAt(s, minute).kind;
      if (k === 'rain' && rainy < 0 && weatherAt(s, minute).intensity > 0.5) rainy = s;
      if (k === 'clear' && clear < 0) clear = s;
    }
    const a = createWorld(rainy); a.time.minute = minute;
    const b = createWorld(clear); b.time.minute = minute;
    for (const w of [a, b]) for (let x = 100; x < 140; x++) makeRoom(w, 'lobby', 1, x);
    for (let i = 1; i <= 40; i++) makeSim(a, 1000 + i, { state: 'outside' });
    // tower B: the same ids, every one inside a lobby tile (not outside, not leaving)
    for (let i = 1; i <= 40; i++) makeSim(b, 1000 + i, { state: 'inRoom', inRoomId: 1, pos: { floor: 1, x: 101 } });
    const now = vi.spyOn(performance, 'now');
    let t = 50_000; now.mockReturnValue(t);
    const { renderer, stage, frame } = await mount(a);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(1, 120);
    renderer.camera.zoomAt(0.6, 400, 300);
    renderer.render(a, 1);
    for (let i = 0; i < 10; i++) { t += 16; now.mockReturnValue(t); frame(16); }
    const ground = (stage.children[3] as Container).children[0] as Container;
    const umb = (): number => spritesWith(ground, 'umbrella|').filter((s) => s.visible && s.parent?.visible !== false).length;
    console.log(`F3S2 seeds rainy ${rainy} clear ${clear}; before swap: street figures`, spritesWith(ground, 'sim|').length, 'umbrellas up', umb());
    renderer.resetMotion(); renderer.render(b, 1);
    for (const ms of [16, 500, 900, 1500, 2100]) {
      while (t < 50_160 + ms) { t += 16; now.mockReturnValue(t); frame(16); renderer.render(b, 1); }
      console.log(`F3S2 ${ms} ms after swap to the clear tower: street figures`, spritesWith(ground, 'sim|').length, '(tower B has 0 outside or leaving) umbrellas up', umb());
    }
  });
});

describe('verify F3 S4', () => {
  it('a leaving person on floor 10 is drawn in the tower and on the street', async () => {
    const w = createWorld(3); w.time.minute = 720;
    for (let x = 100; x < 140; x++) makeRoom(w, 'lobby', 1, x);
    const sim = makeSim(w, 1004, { state: 'leaving', pos: { floor: 10, x: 120 } });
    const now = vi.spyOn(performance, 'now');
    let t = 50_000; now.mockReturnValue(t);
    const { renderer, stage, frame } = await mount(w);
    renderer.camera.setReducedMotion(true);
    renderer.camera.centerOn(5, 120);
    renderer.camera.zoomAt(0.55, 400, 300);
    renderer.render(w, 1);
    let both = 0;
    for (let i = 0; i < 60; i++) {
      t += 100; now.mockReturnValue(t); frame(100); renderer.render(w, 1);
      const ground = (stage.children[3] as Container).children[0] as Container;
      const onStreet = spritesWith(ground, 'sim|').length;
      const inTower = spritesWith(byLabel(stage, 'people'), 'sim|').length;
      if (onStreet > 0 && inTower > 0) both++;
    }
    console.log('F3S4 sim', sim.id, 'leaving on floor', sim.pos.floor, '| frames of 60 where it is drawn both in the tower and on the street:', both);
  });
});

import { appendFileSync } from 'node:fs';
import { inCrowd, pickSimAt } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/renderer';
const out5 = (s: string) => appendFileSync('/private/tmp/claude-501/-Users-matthew-parallax-private-Projects-hundred-stories/59100aac-82b1-4a98-947c-f0845463d155/scratchpad/audit/verifyNew/n5.out', s + '\n');
describe('new N2', () => {
  for (const id of [401, 400]) it(`ring on in-room person ${id}`, async () => {
    const w = createWorld(3); w.time.minute = 720;
    for (let x = 96; x < 112; x++) makeRoom(w, 'lobby', 1, x);
    const office = makeRoom(w, 'office', 2, 100);
    const sim = makeSim(w, id, { homeRoomId: office.id, inRoomId: office.id, state: 'inRoom', pos: { floor: 2, x: 104 } });
    const { renderer, stage } = await mount(w);
    renderer.setSelection({ simId: id }); // what panels.ts:405 occupant row does via ctx.select -> game.select
    renderer.render(w, 1);
    const ring = byLabel(stage, 'selection') as Graphics;
    const people = spritesWith(byLabel(stage, 'people'), 'sim|');
    out5(`sim ${id}: inCrowd=${inCrowd(sim)} pickSimAt(tap on it)=${pickSimAt(w.sims.values(), 2, 104)?.id ?? null} | ring visible=${ring.visible} ring x=${ring.getLocalBounds().x} | people sprites drawn=${people.length}${people.length ? ' at x ' + people.map((p: any) => p.x).join(',') : ''}`);
  });
});

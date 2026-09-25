// Lane F1 probes. Harness copied from tests/render/reconcile.test.ts (stub pixi Application, stub art).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
const R = '/Users/matthew/parallax-private/Projects/hundred-stories/src';
import type { Art } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art';
import { doorFrameOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/anim';
import { createRenderer, inRoomSlot, pickSimAt, type Renderer } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/renderer';
import { venueOf } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/venue';
import { interiorVariants } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/render/interiors';
import { ROOMS } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/rules';
import type { Room, RoomKind, Sim, World } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/types';
import { addRoom, addSim, allocId, createWorld } from '/Users/matthew/parallax-private/Projects/hundred-stories/src/sim/world';

const apps = vi.hoisted(() => [] as { stage: import('pixi.js').Container }[]);
vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = { style: {} as Record<string, string>, addEventListener: (): void => {}, removeEventListener: (): void => {} };
    renderer = { background: { color: 0 }, render: (): void => {} };
    ticker = { add: (): void => {}, remove: (): void => {}, deltaMS: 16 };
    constructor() { apps.push(this); }
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
const baseArt: Art = {
  room: (kind, width, height, variant, state) => tex(`room|${kind}|${width}|${height}|${variant}|${state}`),
  slab: (width) => tex(`slab|${width}`),
  shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  car: (kind, door) => tex(`car|${kind}|${doorFrameOf(door)}`),
  sim: (kind, band, frame, outfit) => tex(`sim|${kind}|${band}|${frame}|${outfit ?? -1}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
};
const richArt: Art = {
  ...baseArt,
  interior: (kind, w, h, v) => tex(`interior|${kind}|${w}|${h}|${v}`),
  sign: (kind, w, name) => tex(`sign|${name}`),
  glow: () => tex('glow'),
};
const holder = vi.hoisted(() => ({ art: null as unknown }));
vi.mock('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/art')>();
  return { ...art, createArt: () => holder.art };
});
vi.mock('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('/Users/matthew/parallax-private/Projects/hundred-stories/src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

let renderers: Renderer[] = [];
beforeEach(() => vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} }));
afterEach(() => { for (const r of renderers) r.destroy(); renderers = []; vi.unstubAllGlobals(); });
async function mount(world: World) {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
  renderers.push(renderer);
  return { renderer, stage: apps[apps.length - 1]!.stage };
}
function sprites(root: Container, prefix: string): Sprite[] {
  const out: Sprite[] = [];
  const walk = (n: Container): void => { if (n instanceof Sprite && n.texture.label?.startsWith(prefix)) out.push(n); for (const c of n.children) walk(c as Container); };
  walk(root);
  return out;
}
function makeRoom(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = { id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100 };
  addRoom(world, room);
  return room;
}

describe('F1 probes', () => {
  it('P1 world swap: an office that takes over a stairs id stays in the connector layer', async () => {
    holder.art = baseArt;
    const a = createWorld(1); a.time.minute = 720;
    const stairs = makeRoom(a, 'stairs', 2, 100);
    const b = createWorld(2); b.time.minute = 720;
    const office = makeRoom(b, 'office', 2, 100);
    expect(office.id).toBe(stairs.id);
    const { renderer, stage } = await mount(a);
    renderer.render(a, 1);
    renderer.resetMotion();
    renderer.render(b, 1);
    const s = sprites(stage, 'room|office');
    console.log('P1 office sprite parent label =', s[0]?.parent?.label);
    // A fresh renderer on world b puts it in 'rooms'.
    const fresh = await mount(b);
    fresh.renderer.render(b, 1);
    console.log('P1 fresh renderer parent label =', sprites(fresh.stage, 'room|office')[0]?.parent?.label);
  });

  it('P2 world swap: a shop sign keeps the previous tower brand', async () => {
    holder.art = richArt;
    let reported = 0;
    for (let seed = 2; seed < 60 && reported < 2; seed++) {
      const a = createWorld(1); a.time.minute = 720;
      makeRoom(a, 'shop', 2, 100);
      const b = createWorld(seed); b.time.minute = 720;
      const shopB = makeRoom(b, 'shop', 2, 100);
      const va = interiorVariants(1, a.rooms.values()).get(shopB.id);
      const vb = interiorVariants(seed, b.rooms.values()).get(shopB.id);
      const nameA = venueOf(1, shopB.id, 'shop').name;
      const nameB = venueOf(seed, shopB.id, 'shop').name;
      if (va !== vb || nameA === nameB) continue;
      const { renderer, stage } = await mount(a);
      renderer.render(a, 1);
      renderer.resetMotion();
      renderer.render(b, 1);
      const labels = sprites(stage, 'sign|').map((s) => s.texture.label);
      console.log(`P2 seed ${seed}: panel name for world b = "${nameB}", sign drawn = ${JSON.stringify(labels)}`);
      reported++;
    }
  });

  it('P3 world swap: floor strips keep the old tower when the signature collides', async () => {
    holder.art = baseArt;
    const a = createWorld(1); a.time.minute = 720;
    makeRoom(a, 'office', 5, 100);
    const b = createWorld(2); b.time.minute = 720;
    makeRoom(b, 'office', 2, 300);
    const { renderer, stage } = await mount(a);
    renderer.render(a, 1);
    const tower = (stage.children[3] as Container).children[1] as Container;
    const strips = tower.children[0] as Graphics;
    const before = strips.getLocalBounds();
    renderer.resetMotion();
    renderer.render(b, 1);
    const after = strips.getLocalBounds();
    console.log('P3 strips before', before.x, before.y, before.width, 'after', after.x, after.y, after.width, '(world b office at x px', 300 * 16, ')');
  });

  it('P4 in-room pick and ring use pos.x, sprite uses the slot', () => {
    const w = createWorld(3);
    const office = makeRoom(w, 'office', 2, 100);
    const sim: Sim = { id: 4, kind: 'worker', homeRoomId: office.id, pos: { floor: 2, x: office.x + Math.floor(office.width / 2) }, inCarId: null, inRoomId: office.id, route: [], state: 'inRoom', stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null };
    addSim(w, sim);
    const [px] = inRoomSlot(w, sim, new Map());
    const drawnTile = px / 16;
    console.log('P4 sprite drawn at tile', drawnTile, 'pos.x (pick and ring) at', sim.pos.x);
    console.log('P4 tap on the sprite ->', pickSimAt(w.sims.values(), 2, drawnTile)?.id ?? null);
    console.log('P4 tap on empty desk at pos.x ->', pickSimAt(w.sims.values(), 2, sim.pos.x + 0.5)?.id ?? null);
  });
});

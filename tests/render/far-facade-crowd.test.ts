// The P3 review's render advisories, closed 2026-09-29: the far facade takes its day grade when
// night ends even if no window changes after it (advisory 1), lit windows are drawn in bands of
// floors (advisory 2), a window change reaches the far facade on the next frame rather than on a
// 400 ms clock (advisory 3), and the crowd has a quarter viewport margin and a ceiling of drawn
// people (advisory 5). Driven through the real createRenderer on a stub pixi Application with
// stub art, as reconcile.test.ts does: no GPU, no DOM, real pixi Containers, Graphics and Sprites.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite, Texture, type GraphicsPath, type Rectangle } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { doorFrameOf } from '../../src/render/anim';
import { roomNight, NIGHT_GRADE } from '../../src/render/light';
import { TILE_PX } from '../../src/render/grid';
import { PALETTE } from '../../src/render/palette';
import { createRenderer, CROWD_CEILING, CROWD_MARGIN_VIEWPORTS, LIT_BAND_FLOORS, type Renderer, type RendererOptions } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, Sim, World } from '../../src/sim/types';
import { addRoom, addSim, allocId, createWorld, setOccupancy } from '../../src/sim/world';

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
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

function walker(world: World, floor: number, x: number): Sim {
  const sim = {
    id: allocId(world), kind: 'worker', homeRoomId: null, pos: { floor, x }, inCarId: null, inRoomId: null, route: [], state: 'walking',
    stress: 0, waitStart: null, schedule: [], nextScheduleIndex: 0, stayUntil: null, wallet: 0, leaveReason: null,
  } as Sim;
  addSim(world, sim);
  return sim;
}

function find(root: Container, label: string): Container | null {
  if (root.label === label) return root;
  for (const c of root.children) {
    const f = find(c as Container, label);
    if (f) return f;
  }
  return null;
}

function colors(node: Container): number[] {
  const out: number[] = [];
  for (const child of node.children) out.push(...colors(child as Container));
  if (!(node instanceof Graphics)) return out;
  for (const ins of node.context.instructions) {
    if (ins.action !== 'fill') continue;
    const data = ins.data as { style: { color: number }; path: GraphicsPath };
    for (const p of data.path.shapePath.shapePrimitives) {
      void (p.shape as Rectangle);
      out.push(data.style.color);
    }
  }
  return out;
}

function personSprites(root: Container): Sprite[] {
  const out: Sprite[] = [];
  const walk = (n: Container): void => {
    if (n instanceof Sprite && (n.texture.label ?? '').startsWith('sim|')) out.push(n);
    for (const c of n.children) walk(c as Container);
  };
  walk(root);
  return out;
}

async function mount(world: World, options: RendererOptions = {}) {
  const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world, options);
  renderers.push(renderer);
  const app = apps[apps.length - 1]!;
  const frame = (dt = 16): void => {
    app.ticker.deltaMS = dt;
    for (const fn of app.frames) fn();
  };
  return { renderer, stage: app.stage, frame };
}

describe('the far facade (P3 advisories 1 and 3)', () => {
  it('takes its day grade when night ends, though no window changes after 06:08', async () => {
    // A small tower whose every room is out before 06:08: base eb71c55 rebuilt on the 06:30 band,
    // 8151e86 only on a window change, so it stayed in the night grade all day.
    let world: World | null = null;
    for (let seed = 1; seed < 5000 && !world; seed++) {
      const w = createWorld(seed);
      const rooms = [makeRoom(w, 'office', 2, 100), makeRoom(w, 'office', 3, 100), makeRoom(w, 'condo', 4, 100)];
      if (!rooms.some((r) => roomNight(seed, r.id, 368))) world = w;
    }
    const w = world!;
    w.time.minute = 1440 + 4 * 60; // day 2, 04:00
    const { renderer, stage, frame } = await mount(w);
    renderer.camera.zoom = 0.3; // the facade tier
    renderer.render(w, 1);
    frame(500);
    const facade = find(stage, 'facade') as Graphics;
    expect(facade.tint).toBe(NIGHT_GRADE.vacant);
    while (w.time.minute < 1440 + 12 * 60) {
      w.time.minute += 1;
      renderer.render(w, 1);
      frame(500);
    }
    expect(facade.tint).toBe(0xffffff);
  });

  it('a room lit at night shows on the facade on the next frame, not after 400 ms', async () => {
    const w = createWorld(3);
    const office = makeRoom(w, 'office', 2, 100);
    makeRoom(w, 'office', 3, 100);
    w.time.minute = 1440 + 23 * 60; // 23:00, every room's night has come
    const { renderer, stage, frame } = await mount(w);
    renderer.camera.zoom = 0.3;
    renderer.render(w, 1);
    frame(500); // the facade's first full draw
    const lit = find(stage, 'facade lit') as Container;
    expect(colors(lit).filter((c) => c === PALETTE.windowLit)).toEqual([]);
    setOccupancy(w, office, 3);
    renderer.render(w, 1);
    frame(16);
    expect(colors(lit).filter((c) => c === PALETTE.windowLit).length).toBeGreaterThan(0);
    setOccupancy(w, office, 0);
    renderer.render(w, 1);
    frame(16);
    expect(colors(lit).filter((c) => c === PALETTE.windowLit)).toEqual([]);
  });
});

describe('lit windows in bands of floors (P3 advisory 2)', () => {
  it(`draws a night tower's lit panes as one Graphics per ${LIT_BAND_FLOORS} floors, not one per lit floor`, async () => {
    const w = createWorld(4);
    for (let f = 2; f <= 12; f++) setOccupancy(w, makeRoom(w, 'office', f, 100), 2);
    w.time.minute = 1440 + 23 * 60;
    const { renderer, stage, frame } = await mount(w);
    renderer.render(w, 1);
    frame(16);
    const panes = find(stage, 'lit panes') as Container;
    // Floors 2 to 7 in one band, 8 to 12 in the next.
    expect(panes.children).toHaveLength(2);
    expect(colors(panes).length).toBeGreaterThan(0);
  });
});

describe('the crowd: a quarter viewport margin and a ceiling (P3 advisory 5)', () => {
  it('draws a person inside the margin and skips one a viewport out', async () => {
    const w = createWorld(5);
    makeRoom(w, 'lobby', 1, 100);
    w.time.minute = 12 * 60;
    const { renderer, stage, frame } = await mount(w, { crowd: 'all' });
    renderer.camera.zoom = 1;
    renderer.camera.centerOn(1, 150);
    // The view is 800 px wide at zoom 1: its edge is 400 px out, the margin 200 px past that. The
    // old margin was a whole viewport (800 px out), where the second walker still got a sprite.
    const cx = renderer.camera.x;
    walker(w, 1, (cx + 400 + 150) / TILE_PX);
    walker(w, 1, (cx + 800 * (0.5 + CROWD_MARGIN_VIEWPORTS) + 60) / TILE_PX);
    renderer.render(w, 1);
    frame(16);
    const drawn = personSprites(stage);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.x - cx).toBeLessThan(800 * (0.5 + CROWD_MARGIN_VIEWPORTS));
    expect(CROWD_MARGIN_VIEWPORTS).toBe(0.25);
  });

  it(`draws at most ${CROWD_CEILING} people, the ones nearest the middle, and always the selected one`, async () => {
    expect(CROWD_CEILING).toBe(1000);
    const w = createWorld(6);
    makeRoom(w, 'lobby', 1, 100);
    w.time.minute = 12 * 60;
    const { renderer, stage, frame } = await mount(w, { crowd: 'all' });
    renderer.camera.zoom = 1;
    renderer.camera.centerOn(3, 150);
    const cx = renderer.camera.x / TILE_PX;
    const sims: Sim[] = [];
    // 1,200 walkers across the view, 35 tiles each way of the middle, all inside the margin.
    for (let i = 0; i < 1200; i++) sims.push(walker(w, 1 + (i % 5), cx - 35 + (i % 71)));
    const far = walker(w, 5, cx + 36); // the one farthest from the middle
    renderer.setSelection({ simId: far.id });
    renderer.render(w, 1);
    frame(16);
    const drawn = personSprites(stage);
    expect(drawn.length).toBe(CROWD_CEILING + 1); // the ceiling, and the selected person over it
    // The far ends of the crowd are the ones left out: nobody but the selected person is drawn
    // more than 33 tiles from the middle, though the crowd runs 35 tiles each way.
    const out = drawn.map((sprite) => Math.abs(sprite.x - renderer.camera.x) / TILE_PX).sort((a, b) => b - a);
    expect(out[0]).toBeGreaterThan(35); // the selected one, 36 tiles out
    expect(out[1]).toBeLessThan(33);
    expect(sims.length).toBe(1200);
    renderer.setSelection(null);
    renderer.render(w, 1);
    frame(16);
    expect(personSprites(stage).length).toBe(CROWD_CEILING);
  });
});

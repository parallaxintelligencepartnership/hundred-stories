// The daytime read (design pass 2026-09-25, package P2): the day window band opens to the rail and
// the sill (BB-3), every room shows a floor line in its far zoom colour (D-7), even under a painted
// look, and stacked stairs recede (D-12). The shells are baked through a stub renderer with every
// rectangle and its fill recorded, the flight is drawn on a recording canvas context, and the
// painted look goes through the real createRenderer against a stub pixi Application and stub art,
// so this needs no GPU. The hotel rows (D-13) are in interiors.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Renderer as PixiRenderer } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { createArt, VENUE_SHELL } from '../../src/render/art';
import { FLOOR_PX, LINE_PX, SLAB_PX, TILE_PX, WIN_PANE, WIN_PANE_TOP, WIN_SILL, WIN_TOP } from '../../src/render/grid';
import { CONNECTOR_ALPHA_FULL, layerPlan, MUTE_AMOUNT } from '../../src/render/hierarchy';
import { INTERIORS, interiorVariant, lookOf } from '../../src/render/interiors';
import type { WindowState } from '../../src/render/light';
import { BLOCK, INK, PALETTE, shade } from '../../src/render/palette';
import { createRenderer } from '../../src/render/renderer';
import { ROOMS } from '../../src/sim/rules';
import type { Room, RoomKind, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';

// The renderer case swaps in stub art; every other case bakes through the real createArt.
const harness = vi.hoisted(() => ({ stubArt: false, apps: [] as { stage: import('pixi.js').Container }[] }));

vi.mock('pixi.js', async (importOriginal) => {
  const pixi = await importOriginal<typeof import('pixi.js')>();
  class FakeApplication {
    stage = new pixi.Container();
    screen = { width: 800, height: 600 };
    canvas = { style: {} as Record<string, string>, addEventListener: (): void => {}, removeEventListener: (): void => {} };
    renderer = { background: { color: 0 }, render: (): void => {} };
    ticker = { add: (): void => {}, remove: (): void => {}, deltaMS: 16 };
    constructor() {
      harness.apps.push(this);
    }
    async init(): Promise<void> {}
    destroy(): void {}
  }
  return { ...pixi, Application: FakeApplication, isWebGLSupported: () => true };
});
vi.mock('../../src/render/art', async (importOriginal) => {
  const art = await importOriginal<typeof import('../../src/render/art')>();
  return { ...art, createArt: (...args: Parameters<typeof art.createArt>) => (harness.stubArt ? stubArt : art.createArt(...args)) };
});
vi.mock('../../src/render/sky', async (importOriginal) => {
  const sky = await importOriginal<typeof import('../../src/render/sky')>();
  return { ...sky, createSky: () => ({ update: (): void => {}, destroy: (): void => {} }) };
});

const tex = (key: string): Texture => new Texture({ label: key });
const stubArt: Art = {
  room: (kind, width, height, variant, state) => tex(`room|${kind}|${width}|${height}|${variant}|${state}`),
  slab: (width) => tex(`slab|${width}`),
  shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  car: (kind) => tex(`car|${kind}`),
  sim: (kind, band, frame) => tex(`sim|${kind}|${band}|${frame}`),
  ghost: (w, h, ok) => tex(`ghost|${w}|${h}|${ok}`),
  interior: (kind, w, h, base) => tex(`interior|${kind}|${w}|${h}|${base}`),
};

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  alpha: number;
}

const originalRect = Graphics.prototype.rect;
const originalFill = Graphics.prototype.fill;
afterEach(() => {
  Graphics.prototype.rect = originalRect;
  Graphics.prototype.fill = originalFill;
});

/** Bakes one room shell and returns every rectangle drawn into it, with the colour it was filled in. */
function bakeShell(kind: RoomKind, state: WindowState, variant = VENUE_SHELL): Rect[] {
  const rects: Rect[] = [];
  Graphics.prototype.rect = function patched(this: Graphics, x: number, y: number, w: number, h: number) {
    rects.push({ x, y, w, h, color: -1, alpha: 1 });
    return originalRect.call(this, x, y, w, h);
  };
  Graphics.prototype.fill = function patched(this: Graphics, style?: unknown) {
    const last = rects[rects.length - 1];
    if (last && last.color === -1 && style && typeof style === 'object' && 'color' in style) {
      last.color = (style as { color: number }).color;
      last.alpha = (style as { alpha?: number }).alpha ?? 1;
    }
    return originalFill.call(this, style as never);
  };
  const renderer = {
    generateTexture(_options: { frame: Rectangle }): Texture {
      return {} as Texture;
    },
  } as unknown as PixiRenderer;
  const rule = ROOMS[kind];
  createArt(renderer, { resolution: 1 }).room(kind, rule.width, rule.height, variant, state);
  Graphics.prototype.rect = originalRect;
  Graphics.prototype.fill = originalFill;
  return rects;
}

/** A pane: a WIN_PANE square in the glass row. */
const panes = (rects: readonly Rect[]): Rect[] => rects.filter((r) => r.w === WIN_PANE && r.h === WIN_PANE && r.y === WIN_PANE_TOP);

describe('BB-3: the day band is the rail and the sill with the wall between', () => {
  it('draws no panes, no mullions and no glint by day, only the head rail and the sill in ink', () => {
    for (const kind of ['office', 'hotelSingle', 'condo', 'lobby'] as RoomKind[]) {
      const w = ROOMS[kind].width * TILE_PX;
      const rects = bakeShell(kind, 'day');
      expect(panes(rects), kind).toHaveLength(0);
      expect(rects.some((r) => r.color === PALETTE.windowDay), kind).toBe(false);
      expect(rects.some((r) => r.color === 0xffffff), kind).toBe(false); // the glints
      // Nothing inked in the glass rows but the cell outline's side edges.
      const glass = rects.filter((r) => r.color === INK && r.y >= WIN_PANE_TOP && r.y < WIN_SILL && r.h < FLOOR_PX);
      expect(glass, kind).toHaveLength(0);
      expect(rects.some((r) => r.x === 0 && r.y === WIN_TOP && r.w === w && r.h === LINE_PX && r.color === INK), kind).toBe(true);
      expect(rects.some((r) => r.x === 0 && r.y === WIN_SILL && r.w === w && r.h === LINE_PX && r.color === INK), kind).toBe(true);
    }
  });

  it('keeps the panes at dusk and at night: lit, vacant and housekeeping', () => {
    const w = ROOMS.office.width * TILE_PX;
    const count = Math.floor((w - WIN_PANE - LINE_PX - 2) / TILE_PX) + 1; // pane n at 2 + 16n, clear of the right outline
    expect(panes(bakeShell('office', 'lit')).filter((r) => r.color === PALETTE.windowLit)).toHaveLength(count);
    expect(panes(bakeShell('office', 'vacant')).filter((r) => r.color === PALETTE.windowUnlit)).toHaveLength(count);
    const dirty = bakeShell('hotelSingle', 'housekeeping');
    expect(panes(dirty).filter((r) => r.color === PALETTE.windowUnlit).length).toBeGreaterThan(0);
  });
});

describe('D-7: a floor line in the district colour', () => {
  it('draws a 2 px line in the block colour just above the slab edge, inside the outline', () => {
    for (const kind of ['office', 'condo', 'hotelSingle', 'hotelTwin', 'hotelSuite', 'fastFood', 'restaurant', 'shop', 'medical'] as RoomKind[]) {
      const w = ROOMS[kind].width * TILE_PX;
      const line = bakeShell(kind, 'day').filter((r) => r.color === BLOCK[kind] && r.h === 2);
      expect(line, kind).toEqual([{ x: LINE_PX, y: 64, w: w - 2 * LINE_PX, h: 2, color: BLOCK[kind], alpha: 1 }]);
    }
  });

  it('draws one per floor slab: every floor of a per floor room, the bottom of a full height one', () => {
    const party = ROOMS.partyHall;
    const lines = bakeShell('partyHall', 'day').filter((r) => r.color === BLOCK.partyHall && r.h === 2);
    expect(lines.map((r) => r.y)).toEqual([(party.height - 1) * FLOOR_PX + 64]);
  });

  it('draws none in a lobby, a sky lobby, or the stairs and escalators', () => {
    for (const kind of ['lobby', 'skyLobby', 'stairs', 'escalator'] as RoomKind[]) {
      const rects = bakeShell(kind, 'day', 0);
      expect(rects.some((r) => r.color === BLOCK[kind] && r.h === 2 && r.w > TILE_PX), kind).toBe(false);
    }
  });
});

describe('D-7: the floor line under a painted look', () => {
  afterEach(() => {
    harness.stubArt = false;
    vi.unstubAllGlobals();
  });

  function hotelRoom(world: World, x: number): Room {
    const rule = ROOMS.hotelSingle;
    const room: Room = {
      id: allocId(world), kind: 'hotelSingle', floor: 3, x, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
      builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    };
    addRoom(world, room);
    return room;
  }

  /** Every sprite on the shared white texture: the painted walls (and the light layer's quad). */
  function whites(root: Container): Sprite[] {
    const out: Sprite[] = [];
    const walk = (node: Container): void => {
      if (node instanceof Sprite && node.texture === Texture.WHITE) out.push(node);
      for (const child of node.children) walk(child as Container);
    };
    walk(root);
    return out;
  }

  it('stops every painted wall at y 64, above the line, so a painted hotel room keeps its district colour', async () => {
    harness.stubArt = true;
    vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: () => {}, removeEventListener: () => {} });
    const world = createWorld(7);
    world.time.minute = 12 * 60;
    const rooms = [0, 1, 2, 3].map((i) => hotelRoom(world, 100 + i * ROOMS.hotelSingle.width));
    // Four neighbors by id: the kind's own wall and all three paints.
    const paints = new Set(rooms.map((r) => lookOf('hotelSingle', interiorVariant(world.seed, r)).wall).filter((w): w is number => w !== null));
    expect(paints.size).toBe(3);
    const renderer = await createRenderer({ appendChild: () => {} } as unknown as HTMLElement, world);
    try {
      renderer.render(world, 1);
      const tints = new Set([...paints].flatMap((w) => [w, shade(w)]));
      const painted = whites(harness.apps[harness.apps.length - 1]!.stage).filter((s) => tints.has(s.tint));
      expect(painted).toHaveLength(6); // the lit face and the shadow face of three rooms
      // Room coordinates: the line is rows 64 and 65 (art.ts drawShell), the paint ends where it starts.
      for (const s of painted) expect(s.y + s.height).toBe(FLOOR_PX - SLAB_PX - 2);
    } finally {
      renderer.destroy();
    }
  });
});

// ---------------------------------------------------------------- the stairs

interface Stroke {
  color: string;
  width: number;
  pts: [number, number][];
}

/** A canvas context that records every stroke: its colour, its width and its path. */
function recordingContext(): { ctx: CanvasRenderingContext2D; strokes: Stroke[] } {
  const strokes: Stroke[] = [];
  let path: [number, number][] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (target, key) => {
      if (key === 'beginPath') return () => (path = []);
      if (key === 'moveTo' || key === 'lineTo') return (x: number, y: number) => path.push([x, y]);
      if (key === 'stroke') return () => strokes.push({ color: String(target['strokeStyle']), width: Number(target['lineWidth']), pts: [...path] });
      if (key in target) return target[key as string];
      return () => ({ addColorStop: () => {} });
    },
    set: (target, key, value) => {
      target[key as string] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe('D-12: stacked stairs recede at zoom 1', () => {
  it('holds the connectors at 85 percent in the full tier and still mutes them below 0.75', () => {
    expect(CONNECTOR_ALPHA_FULL).toBe(0.85);
    expect(layerPlan('full').connectors).toBe(CONNECTOR_ALPHA_FULL);
    expect(layerPlan('muted').connectors).toBe(1 - MUTE_AMOUNT);
    expect(layerPlan('blocks').connectors).toBe(0);
  });

  it('draws a lighter 2 px handrail on two posts, one at the foot and one at the head', () => {
    const { ctx, strokes } = recordingContext();
    const w = ROOMS.stairs.width * TILE_PX;
    INTERIORS.stairs.draw(ctx, w, ROOMS.stairs.height, 0);
    const rail = strokes.filter((s) => s.pts.length === 4);
    expect(rail).toHaveLength(1);
    expect(rail[0]).toMatchObject({ color: '#8a97a8', width: 2 });
    const posts = strokes.filter((s) => s.pts.length === 2 && s.color === '#5a6472');
    expect(posts).toHaveLength(2);
    const [foot, head] = posts.map((s) => s.pts[0]![0]);
    expect(foot).toBeLessThan(head!);
    // The flight keeps its concrete fill and its 2 px ink outline.
    expect(strokes.some((s) => s.color === '#222222' && s.width === 2 && s.pts.length > 10)).toBe(true);
  });
});

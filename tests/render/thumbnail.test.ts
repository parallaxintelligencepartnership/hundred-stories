// Palette thumbnails (package 8b): the room as the world draws it, the plain shell with the
// illustrated interior over it, composited once per kind and kept.
import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import { VENUE_SHELL, type Art } from '../../src/render/art';
import { FLOOR_PX, TILE_PX } from '../../src/render/grid';
import { INTERIORS } from '../../src/render/interiors';
import { createThumbnails, THUMBNAIL_MIN_TILES, thumbnailPlan } from '../../src/render/thumbnail';
import { ROOMS } from '../../src/sim/rules';

interface Drawn {
  source: string;
  smooth: boolean;
  box: [number, number, number, number];
}

function stub(withInterior = true): {
  art: Art;
  extracted: string[];
  composites: { width: number; height: number; drawn: Drawn[] }[];
  reset(): void;
  extract: (t: Texture) => HTMLCanvasElement;
  createCanvas: (w: number, h: number) => HTMLCanvasElement;
} {
  let textures = new Map<string, Texture>();
  const extracted: string[] = [];
  const composites: { width: number; height: number; drawn: Drawn[] }[] = [];
  const tex = (key: string): Texture => {
    let t = textures.get(key);
    if (!t) textures.set(key, (t = new Texture({ label: key })));
    return t;
  };
  const art = {
    room: (kind, w, h, v, state) => tex(`room|${kind}|${w}|${h}|${v}|${state}`),
    shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
    ...(withInterior ? { interior: (kind: string, w: number, h: number, v: number) => tex(`interior|${kind}|${w}|${h}|${v}`) } : {}),
  } as Art;
  return {
    art,
    extracted,
    composites,
    reset: () => {
      textures = new Map();
    },
    // An extracted canvas is the texture at twice its logical size for an interior (the
    // illustrated class), once for a shell: the composite takes the sharper scale.
    extract: (t) => {
      const label = t.label ?? '';
      extracted.push(label);
      const [family, , w, h] = label.split('|');
      const scale = family === 'interior' ? 2 : 1;
      const floors = Number(h);
      return { label, width: Number(w) * TILE_PX * scale, height: floors * FLOOR_PX * scale } as unknown as HTMLCanvasElement;
    },
    createCanvas: (width, height) => {
      const entry = { width, height, drawn: [] as Drawn[] };
      composites.push(entry);
      let smooth = false;
      const ctx = {
        set imageSmoothingEnabled(v: boolean) {
          smooth = v;
        },
        drawImage: (src: { label: string }, x: number, y: number, w: number, h: number) => entry.drawn.push({ source: src.label, smooth, box: [x, y, w, h] }),
      };
      return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    },
  };
}

describe('renderer thumbnails', () => {
  it('composites the shell and the illustrated interior at the rule size', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract, createCanvas: s.createCanvas });
    thumbnail('office');
    const w = ROOMS.office.width;
    expect(s.extracted).toEqual([`room|office|${w}|1|${VENUE_SHELL}|day`, `interior|office|${w}|1|0`]);
    const [composite] = s.composites;
    expect(composite).toMatchObject({ width: w * TILE_PX * 2, height: FLOOR_PX * 2 });
    const band = INTERIORS.office.band(1);
    expect(composite!.drawn).toEqual([
      { source: `room|office|${w}|1|${VENUE_SHELL}|day`, smooth: false, box: [0, 0, w * TILE_PX * 2, FLOOR_PX * 2] },
      { source: `interior|office|${w}|1|0`, smooth: true, box: [0, band.top * 2, w * TILE_PX * 2, band.height * 2] },
    ]);
  });

  it('shows a one tile room as a run of tiles in its rhythm', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract, createCanvas: s.createCanvas });
    thumbnail('lobby');
    expect(s.extracted[0]).toBe(`room|lobby|${THUMBNAIL_MIN_TILES}|1|${VENUE_SHELL}|day`);
    expect(s.extracted.slice(1)).toEqual(Array.from({ length: THUMBNAIL_MIN_TILES }, (_, i) => `interior|lobby|1|1|${i}`));
  });

  it('draws stairs and escalators as their flight alone, with no shell behind', () => {
    const s = stub();
    const plan = thumbnailPlan(s.art, 'stairs');
    expect(plan.layers.map((l) => l.texture.label)).toEqual([`interior|stairs|${ROOMS.stairs.width}|${ROOMS.stairs.height}|0`]);
  });

  it('draws a shaft from one floor of its texture', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract, createCanvas: s.createCanvas });
    const shaft = thumbnail('standard');
    expect(s.extracted).toEqual(['shaft|standard|1']);
    expect((shaft as unknown as { label: string }).label).toBe('shaft|standard|1');
  });

  it('falls back to the whole structural room for an art without interiors', () => {
    const s = stub(false);
    const plan = thumbnailPlan(s.art, 'condo');
    expect(plan.layers.map((l) => l.texture.label)).toEqual([`room|condo|${ROOMS.condo.width}|1|0|day`]);
  });

  it('composites each kind once and hands back the same canvas after', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract, createCanvas: s.createCanvas });
    const first = thumbnail('cinema');
    for (let i = 0; i < 5; i += 1) expect(thumbnail('cinema')).toBe(first);
    expect(s.composites.length).toBe(1);
  });

  it('composites again only when the art hands back different textures', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract, createCanvas: s.createCanvas });
    const first = thumbnail('condo');
    s.reset(); // the art cache was rebuilt: new texture identities
    const second = thumbnail('condo');
    expect(second).not.toBe(first);
    expect(s.composites.length).toBe(2);
  });
});

describe('illustrated layers', () => {
  it('draws a canvas backed texture from its own canvas, and reads only the shell back from the GPU', () => {
    const g = globalThis as { HTMLCanvasElement?: unknown };
    const had = 'HTMLCanvasElement' in g;
    const previous = g.HTMLCanvasElement;
    class FakeCanvas {
      width = 32;
      height = 94;
      label = 'painted';
    }
    g.HTMLCanvasElement = FakeCanvas;
    try {
      const s = stub();
      const painted = new FakeCanvas();
      const art = {
        ...s.art,
        interior: () => ({ label: 'interior', source: { resource: painted } }) as unknown as Texture,
      } as Art;
      const thumbnail = createThumbnails({ art: () => art, extract: s.extract, createCanvas: s.createCanvas });
      thumbnail('hotelSingle');
      expect(s.extracted).toEqual([`room|hotelSingle|${ROOMS.hotelSingle.width}|1|${VENUE_SHELL}|day`]);
      expect(s.composites[0]!.drawn.map((d) => d.source)).toEqual([`room|hotelSingle|${ROOMS.hotelSingle.width}|1|${VENUE_SHELL}|day`, 'painted']);
    } finally {
      if (had) g.HTMLCanvasElement = previous;
      else delete g.HTMLCanvasElement;
    }
  });
});

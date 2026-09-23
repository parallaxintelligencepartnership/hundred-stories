// Palette thumbnails: one canvas per kind, cut from the day art, extracted once and kept.
import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';
import type { Art } from '../../src/render/art';
import { createThumbnails, THUMBNAIL_MIN_TILES } from '../../src/render/thumbnail';
import { ROOMS } from '../../src/sim/rules';

function stub(): { art: Art; asked: string[]; extracted: string[]; reset(): void; extract: (t: Texture) => HTMLCanvasElement } {
  let textures = new Map<string, Texture>();
  const asked: string[] = [];
  const extracted: string[] = [];
  const tex = (key: string): Texture => {
    asked.push(key);
    let t = textures.get(key);
    if (!t) textures.set(key, (t = new Texture({ label: key })));
    return t;
  };
  const art = {
    room: (kind, w, h, v, state) => tex(`room|${kind}|${w}|${h}|${v}|${state}`),
    shaft: (kind, floors) => tex(`shaft|${kind}|${floors}`),
  } as Art;
  return {
    art,
    asked,
    extracted,
    reset: () => {
      textures = new Map();
    },
    extract: (t) => {
      extracted.push(t.label ?? '');
      return { label: t.label } as unknown as HTMLCanvasElement;
    },
  };
}

describe('renderer thumbnails', () => {
  it('returns a canvas per kind, cut from the day art at the rule size', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract });
    const office = thumbnail('office');
    const shaft = thumbnail('standard');
    expect(office).not.toBe(shaft);
    thumbnail('lobby'); // a one tile segment is shown as a short run of lobby
    expect(s.extracted).toEqual([
      `room|office|${ROOMS.office.width}|${ROOMS.office.height}|0|day`,
      'shaft|standard|1',
      `room|lobby|${THUMBNAIL_MIN_TILES}|1|0|day`,
    ]);
  });

  it('extracts each kind once and hands back the same canvas after', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract });
    const first = thumbnail('cinema');
    for (let i = 0; i < 5; i += 1) expect(thumbnail('cinema')).toBe(first);
    expect(s.extracted.length).toBe(1);
  });

  it('extracts again only when the art hands back a different texture', () => {
    const s = stub();
    const thumbnail = createThumbnails({ art: () => s.art, extract: s.extract });
    const first = thumbnail('condo');
    s.reset(); // the art cache was rebuilt: new texture identities
    const second = thumbnail('condo');
    expect(second).not.toBe(first);
    expect(s.extracted.length).toBe(2);
  });
});

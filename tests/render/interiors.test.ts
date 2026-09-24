// Package 8b: every room kind is drawn in the illustrated style over a plain structural shell.
// The registry (interiors.ts INTERIORS) must hold every RoomKind, each must bake through art.ts
// in the illustrated class, covering only its band, and the closed-hours overlays, the posts and
// the variants must follow the rules the renderer reads.

import { describe, expect, it } from 'vitest';
import { Texture, type Rectangle, type Renderer as PixiRenderer } from 'pixi.js';
import { createArt } from '../../src/render/art';
import { FLOOR_PX, TILE_PX } from '../../src/render/grid';
import {
  bakesAtStructuralScale,
  INTERIOR_2X_MAX_PX,
  INTERIORS,
  interiorOpen,
  interiorVariant,
  LOBBY_RHYTHM,
  postX,
} from '../../src/render/interiors';
import { venueOf } from '../../src/render/venue';
import { ROOMS, SCHEDULES, SECURITY, WASTE } from '../../src/sim/rules';
import type { RoomKind } from '../../src/sim/types';

const KINDS = Object.keys(ROOMS) as RoomKind[];

/** A minute on day 0 (a weekday) at hh:mm. */
const at = (hh: number, mm = 0): number => hh * 60 + mm;

function harness(resolution: 1 | 2 = 1): { art: ReturnType<typeof createArt>; canvases: { width: number; height: number }[]; structural: number } {
  const canvases: { width: number; height: number }[] = [];
  let structural = 0;
  const renderer = {
    generateTexture(_options: { frame: Rectangle }): Texture {
      structural += 1;
      return new Texture();
    },
  } as unknown as PixiRenderer;
  const noop = (): void => {};
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText' ? () => ({ width: 20 }) : key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop,
      set: () => true,
    },
  );
  const createCanvas = (width: number, height: number): HTMLCanvasElement => {
    canvases.push({ width, height });
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
  return {
    art: createArt(renderer, { createCanvas, resolution }),
    canvases,
    get structural() {
      return structural;
    },
  };
}

describe('the illustrated interiors registry', () => {
  it('registers an illustrated bake for every room kind', () => {
    expect(KINDS).toHaveLength(22);
    for (const kind of KINDS) {
      const spec = INTERIORS[kind];
      expect(spec, kind).toBeDefined();
      expect(spec.variants, kind).toBeGreaterThanOrEqual(1);
      expect(typeof spec.draw, kind).toBe('function');
    }
    expect(Object.keys(INTERIORS).sort()).toEqual([...KINDS].sort());
  });

  it('bakes every kind at its rule size, in the illustrated class, covering only its band', () => {
    for (const kind of KINDS) {
      const h = harness(1);
      const rule = ROOMS[kind];
      const texture = h.art.interior!(kind, rule.width, rule.height, 0);
      const band = INTERIORS[kind].band(rule.height);
      expect(h.structural, kind).toBe(0); // never through the structural bake
      expect(texture.source.scaleMode, kind).toBe('linear');
      expect([texture.width, texture.height], kind).toEqual([rule.width * TILE_PX, band.height]);
      // The band lies inside the room.
      expect(band.top, kind).toBeGreaterThanOrEqual(0);
      expect(band.top + band.height, kind).toBeLessThanOrEqual(rule.height * FLOOR_PX);
      const scale = bakesAtStructuralScale(kind, rule.width) ? 1 : 2;
      expect(h.canvases[0], kind).toEqual({ width: rule.width * TILE_PX * scale, height: Math.ceil(band.height * scale) });
    }
  });

  it('bakes each kind and size once, and a venue shares the texture its treatment already has', () => {
    const { art } = harness(1);
    expect(art.interior!('condo', 16, 1, 0)).toBe(art.interior!('condo', 16, 1, 0));
    expect(art.interior!('office', 9, 1, 2)).toBe(art.venue!('office', 9, 2));
    expect(art.interior!('restaurant', 24, 1, 1)).toBe(art.venue!('restaurant', 24, 1));
  });

  it('keeps the doubled resolution for rooms up to twelve tiles and bakes wider ones at the structural resolution', () => {
    expect(INTERIOR_2X_MAX_PX).toBe(12 * TILE_PX);
    expect(bakesAtStructuralScale('hotelSuite', 10)).toBe(false);
    expect(bakesAtStructuralScale('lobby', 1)).toBe(false);
    expect(bakesAtStructuralScale('condo', 16)).toBe(true);
    expect(bakesAtStructuralScale('cathedral', 28)).toBe(true);
    // Stairs and escalators recede at every size; venues keep package 2's doubled textures.
    expect(bakesAtStructuralScale('stairs', 8)).toBe(true);
    expect(bakesAtStructuralScale('restaurant', 24)).toBe(false);
  });

  it('draws stairs and escalators as overlays, and nothing else', () => {
    const overlays = KINDS.filter((k) => INTERIORS[k].overlay);
    expect(overlays.sort()).toEqual(['escalator', 'stairs']);
  });
});

describe('closed hours', () => {
  it('bakes a closed overlay inside the room for every kind that keeps hours', () => {
    for (const kind of KINDS) {
      const spec = INTERIORS[kind];
      const rule = ROOMS[kind];
      const h = harness(1);
      const shut = h.art.shut!(kind, rule.width, rule.height);
      if (!spec.closed) {
        expect(shut, kind).toBe(Texture.EMPTY);
        continue;
      }
      const r = spec.closed.rect(rule.width * TILE_PX, rule.height);
      expect(r.x, kind).toBeGreaterThanOrEqual(0);
      expect(r.y, kind).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w, kind).toBeLessThanOrEqual(rule.width * TILE_PX);
      expect(r.y + r.h, kind).toBeLessThanOrEqual(rule.height * FLOOR_PX);
      expect([shut.width, shut.height], kind).toEqual([r.w, r.h]);
    }
  });

  it('opens the cinema for its shows, the party hall for the weekend party, the metro by day', () => {
    const show = SCHEDULES.cinema.showTimes[0] as number;
    expect(interiorOpen('cinema', show)).toBe(true);
    expect(interiorOpen('cinema', show + SCHEDULES.cinema.showMinutes)).toBe(show + SCHEDULES.cinema.showMinutes === SCHEDULES.cinema.showTimes[1]);
    expect(interiorOpen('cinema', at(9))).toBe(false);
    expect(interiorOpen('partyHall', at(13))).toBe(false); // day 0 is a weekday
    expect(interiorOpen('metro', at(8))).toBe(true);
    expect(interiorOpen('metro', at(2))).toBe(false);
  });

  it('shuts the loading bay outside the collectors shift and the fast food outside meal hours', () => {
    expect(interiorOpen('recycling', WASTE.shiftStart)).toBe(true);
    expect(interiorOpen('recycling', WASTE.shiftEnd)).toBe(false);
    expect(interiorOpen('fastFood', at(12))).toBe(true);
    expect(interiorOpen('fastFood', at(22))).toBe(false);
    expect(interiorOpen('housekeeping', at(11))).toBe(true);
    expect(interiorOpen('housekeeping', at(23))).toBe(false);
  });

  it('keeps the rooms with no hours open around the clock', () => {
    for (const kind of ['security', 'medical', 'condo', 'hotelSuite', 'lobby', 'cathedral'] as RoomKind[]) {
      for (const hour of [0, 6, 12, 18, 23]) expect(interiorOpen(kind, at(hour)), `${kind} ${hour}`).toBe(true);
    }
  });
});

describe('posts', () => {
  it('puts a guard at the security desk and a collector at the loading bay, all hours they are open', () => {
    expect(INTERIORS.security.post).toMatchObject({ kind: 'guard', when: 'open' });
    expect(INTERIORS.recycling.post).toMatchObject({ kind: 'collector', when: 'open' });
    expect(INTERIORS.medical.post).toMatchObject({ kind: 'staff', when: 'open' });
    expect(SECURITY.guardsPerOffice).toBeGreaterThan(0);
  });

  it('stands every post inside its room', () => {
    for (const kind of KINDS) {
      const x = postX(kind, ROOMS[kind].width);
      if (x === null) continue;
      expect(x, kind).toBeGreaterThan(0);
      expect(x, kind).toBeLessThan(ROOMS[kind].width * TILE_PX);
    }
  });
});

describe('variants', () => {
  it('gives a venue its treatment, so the fixtures match the room panel', () => {
    for (const id of [3, 17, 40, 99]) {
      expect(interiorVariant(777, { id, kind: 'shop', x: 100 })).toBe(venueOf(777, id, 'shop').treatment);
    }
  });

  it('lays lobby tiles in a rhythm by x, so a run reads as one lobby', () => {
    const run = Array.from({ length: LOBBY_RHYTHM * 2 }, (_, i) => interiorVariant(1, { id: 500 - i, kind: 'lobby', x: 120 + i }));
    expect(run.slice(0, LOBBY_RHYTHM)).toEqual(run.slice(LOBBY_RHYTHM));
    expect(new Set(run).size).toBe(LOBBY_RHYTHM);
  });

  it('picks every other kind by id, within its variants', () => {
    for (const kind of KINDS) {
      const n = INTERIORS[kind].variants;
      for (const id of [1, 2, 3, 10]) {
        const v = interiorVariant(1, { id, kind, x: 0 });
        expect(v, kind).toBeGreaterThanOrEqual(0);
        expect(v, kind).toBeLessThan(n);
      }
    }
  });
});

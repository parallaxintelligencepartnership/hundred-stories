// More looks for offices, restaurants, fast food, condos and elevator cars (2026-09-24): how many
// each kind has, that every look is its own, that a room's look is a pure function of the seed
// and the room's id, kind, floor and x, that rooms of one kind side by side on a floor do not
// share a look when another is open to them, and that a shaft's cars all share one finish.

import { describe, expect, it } from 'vitest';
import { Texture, type Rectangle, type Renderer as PixiRenderer } from 'pixi.js';
import { createArt } from '../../src/render/art';
import { TILE_PX } from '../../src/render/grid';
import { CAR_FINISHES, carFinishes, VENUE_BAND } from '../../src/render/illustrated';
import {
  DECOR,
  INTERIORS,
  interiorFlip,
  interiorVariant,
  interiorVariants,
  lookOf,
  NEIGHBOR_KINDS,
  type DecorName,
} from '../../src/render/interiors';
import { TREATMENTS, venueOf } from '../../src/render/venue';
import { ROOMS } from '../../src/sim/rules';
import { hashWorld } from '../../src/sim/save';
import type { RoomKind } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';

const FOUR: readonly RoomKind[] = ['office', 'restaurant', 'fastFood', 'condo'];
const MIN_LOOKS: Record<string, number> = { office: 6, restaurant: 5, fastFood: 5, condo: 6 };

/** A floor of `count` rooms of one kind, side by side from x 100, ids from `firstId`. */
function row(kind: RoomKind, count: number, firstId: number, floor = 3): { id: number; kind: RoomKind; floor: number; x: number }[] {
  return Array.from({ length: count }, (_, i) => ({ id: firstId + i * 7, kind, floor, x: 100 + i * ROOMS[kind].width }));
}

function harness(): { art: ReturnType<typeof createArt>; canvases: { width: number; height: number }[] } {
  const canvases: { width: number; height: number }[] = [];
  const renderer = { generateTexture: (_o: { frame: Rectangle }): Texture => new Texture() } as unknown as PixiRenderer;
  const noop = (): void => {};
  const ctx = new Proxy({}, { get: (_t, key) => (key === 'createLinearGradient' || key === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop), set: () => true });
  const createCanvas = (width: number, height: number): HTMLCanvasElement => {
    canvases.push({ width, height });
    return { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  };
  return { art: createArt(renderer, { createCanvas, resolution: 1 }), canvases };
}

describe('how many looks each kind has', () => {
  it('gives offices and condos six or more looks, restaurants and fast food five or more', () => {
    for (const kind of FOUR) expect(INTERIORS[kind].variants, kind).toBeGreaterThanOrEqual(MIN_LOOKS[kind] as number);
    expect(INTERIORS.office.variants).toBe(6);
    expect(INTERIORS.restaurant.variants).toBe(6);
    expect(INTERIORS.fastFood.variants).toBe(5);
    expect(INTERIORS.condo.variants).toBe(6);
  });

  it('mirrors offices and condos on top of their looks, and never a kind with somebody at a post', () => {
    expect(INTERIORS.office.flips).toBe(true);
    expect(INTERIORS.condo.flips).toBe(true);
    for (const kind of Object.keys(INTERIORS) as RoomKind[]) {
      if (INTERIORS[kind].post) expect(INTERIORS[kind].flips, kind).toBeFalsy();
    }
  });

  it('draws every look differently: no two looks of a kind share their base, wall and decor', () => {
    for (const kind of FOUR) {
      const seen = new Set<string>();
      for (let v = 0; v < INTERIORS[kind].variants; v++) seen.add(JSON.stringify(lookOf(kind, v)));
      expect(seen.size, kind).toBe(INTERIORS[kind].variants);
    }
  });

  it('has an open plan office and a meeting room office, each more than once across the treatments', () => {
    const bases = Array.from({ length: INTERIORS.office.variants }, (_, v) => lookOf('office', v).base);
    expect(bases.filter((b) => b === 0)).toHaveLength(2); // the open plan bench
    expect(bases.filter((b) => b === 3)).toHaveLength(2); // the meeting room
  });

  it('bakes three condo layouts, four office layouts and five fast food schemes, and no more', () => {
    for (const kind of FOUR) {
      const n = INTERIORS[kind].bases ?? INTERIORS[kind].variants;
      for (let v = 0; v < INTERIORS[kind].variants; v++) {
        const base = lookOf(kind, v).base;
        expect(base, kind).toBeGreaterThanOrEqual(0);
        expect(base, kind).toBeLessThan(n);
      }
    }
    expect(INTERIORS.condo.bases).toBe(3);
    expect(INTERIORS.office.bases).toBe(4);
    expect(INTERIORS.restaurant.bases).toBe(3); // the restaurant's new looks are decor and paint only
  });

  it('places every piece of decor inside its room and its band', () => {
    for (const kind of FOUR) {
      const w = ROOMS[kind].width * TILE_PX;
      for (let v = 0; v < INTERIORS[kind].variants; v++) {
        for (const p of lookOf(kind, v).decor) {
          const piece = DECOR[p.piece];
          expect(p.x, `${kind} ${v} ${p.piece}`).toBeGreaterThanOrEqual(0);
          expect(p.x + piece.w, `${kind} ${v} ${p.piece}`).toBeLessThanOrEqual(w);
          expect(p.y, `${kind} ${v} ${p.piece}`).toBeGreaterThanOrEqual(VENUE_BAND.top - 6);
          expect(p.y + piece.h, `${kind} ${v} ${p.piece}`).toBeLessThanOrEqual(VENUE_BAND.top + VENUE_BAND.height + 1);
        }
      }
    }
  });

  it('has four elevator car finishes', () => {
    expect(CAR_FINISHES.length).toBeGreaterThanOrEqual(4);
  });
});

describe('choosing a look', () => {
  it('keeps a venue inside its treatment, so the room panel still names what is drawn', () => {
    for (const kind of ['office', 'restaurant', 'shop'] as const) {
      const per = INTERIORS[kind].variants / TREATMENTS;
      for (let id = 1; id < 200; id += 3) {
        const v = interiorVariant(4242, { id, kind, x: 0 });
        expect(Math.floor(v / per), `${kind} ${id}`).toBe(venueOf(4242, id, kind).treatment);
      }
    }
  });

  it('is the same for the same seed and rooms, whatever order the rooms come in', () => {
    const rooms = [...row('office', 8, 11), ...row('condo', 5, 400, 4), ...row('fastFood', 4, 900, 5), ...row('restaurant', 3, 1200, 6)];
    const a = interiorVariants(20260918, rooms);
    const b = interiorVariants(20260918, [...rooms].reverse());
    expect([...b.entries()].sort((x, y) => x[0] - y[0])).toEqual([...a.entries()].sort((x, y) => x[0] - y[0]));
    for (const room of rooms) expect(interiorFlip(20260918, room)).toBe(interiorFlip(20260918, { ...room }));
  });

  it('uses every look over enough rooms, and a different seed deals them differently', () => {
    for (const kind of FOUR) {
      const rooms = row(kind, 60, 5);
      const looks = interiorVariants(1, rooms);
      expect(new Set(looks.values()).size, kind).toBe(INTERIORS[kind].variants);
      const other = interiorVariants(2, rooms);
      expect([...other.values()], kind).not.toEqual([...looks.values()]);
    }
    const flips = row('office', 60, 5).map((r) => interiorFlip(1, r));
    expect(flips).toContain(true);
    expect(flips).toContain(false);
  });

  it('never reads or moves the world: its rng state and its hash stay the same', () => {
    const world = createWorld(99);
    const rng = world.rng.state();
    const hash = hashWorld(world);
    interiorVariants(world.seed, row('office', 10, 3));
    carFinishes(world.seed, [{ id: 1, x: 10, floorMin: 1, floorMax: 9 }]);
    expect(world.rng.state()).toBe(rng);
    expect(hashWorld(world)).toBe(hash);
  });
});

describe('the neighbor rule', () => {
  it('never draws two side by side rooms of the four kinds in the same look when another is open to them', () => {
    let clashes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const kind of FOUR) {
        const rooms = row(kind, 12, seed * 13);
        const looks = interiorVariants(seed, rooms);
        for (let i = 1; i < rooms.length; i++) {
          const a = rooms[i - 1]!;
          const b = rooms[i]!;
          const va = looks.get(a.id)!;
          const vb = looks.get(b.id)!;
          // A venue may only move within its treatment: two looks each, so a match is avoidable
          // whenever the two share a treatment.
          if (va === vb) clashes++;
        }
      }
    }
    expect(clashes).toBe(0);
  });

  it('sees past a gap or a shaft to the nearest room on the floor, and not across floors', () => {
    const seed = 3;
    // Find two office ids that pick the same look on their own.
    let pair: [number, number] | null = null;
    for (let a = 1; a < 400 && !pair; a++) {
      for (let b = a + 1; b < 400; b++) {
        if (interiorVariant(seed, { id: a, kind: 'office', x: 0 }) === interiorVariant(seed, { id: b, kind: 'office', x: 0 })) {
          pair = [a, b];
          break;
        }
      }
    }
    const [a, b] = pair!;
    const gap = interiorVariants(seed, [
      { id: a, kind: 'office', floor: 2, x: 100 },
      { id: b, kind: 'office', floor: 2, x: 113 }, // a shaft's width apart
    ]);
    expect(gap.get(a)).not.toBe(gap.get(b));
    const stacked = interiorVariants(seed, [
      { id: a, kind: 'office', floor: 2, x: 100 },
      { id: b, kind: 'office', floor: 3, x: 100 },
    ]);
    expect(stacked.get(a)).toBe(stacked.get(b));
    // A different kind between them breaks the run.
    const between = interiorVariants(seed, [
      { id: a, kind: 'office', floor: 2, x: 100 },
      { id: 999, kind: 'condo', floor: 2, x: 109 },
      { id: b, kind: 'office', floor: 2, x: 125 },
    ]);
    expect(between.get(a)).toBe(between.get(b));
  });

  it('only applies to the four kinds', () => {
    expect([...NEIGHBOR_KINDS].sort()).toEqual([...FOUR].sort());
  });
});

describe('elevator car finishes', () => {
  it('gives each shaft one finish, the same on every call, and overlapping neighbors different ones', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const shafts = Array.from({ length: 6 }, (_, i) => ({ id: 50 + i * 11, x: 20 + i * 12, floorMin: 1, floorMax: 20 }));
      const finishes = carFinishes(seed, shafts);
      expect(carFinishes(seed, [...shafts].reverse())).toEqual(finishes);
      for (let i = 1; i < shafts.length; i++) expect(finishes.get(shafts[i]!.id)).not.toBe(finishes.get(shafts[i - 1]!.id));
      for (const f of finishes.values()) expect(f).toBeLessThan(CAR_FINISHES.length);
    }
  });

  it('bakes a car per kind, door frame and finish, and shares it between cars of one finish', () => {
    const { art } = harness();
    expect(art.car('standard', 0, 1)).not.toBe(art.car('standard', 0, 0));
    expect(art.car('standard', 0, 2)).toBe(art.car('standard', 0, 2));
    expect(art.car('standard', 1)).toBe(art.car('standard', 1, 0));
  });
});

describe('decor textures', () => {
  it('bakes each piece once at its own size, at twice the structural resolution when fine', () => {
    const { art, canvases } = harness();
    for (const name of Object.keys(DECOR) as DecorName[]) {
      const before = canvases.length;
      const t = art.decor!(name, true);
      expect(art.decor!(name, true), name).toBe(t);
      expect(canvases.length, name).toBe(before + 1);
      expect(canvases[canvases.length - 1], name).toEqual({ width: DECOR[name].w * 2, height: DECOR[name].h * 2 });
      art.decor!(name, false);
      expect(canvases[canvases.length - 1], name).toEqual({ width: DECOR[name].w, height: DECOR[name].h });
    }
  });

  it('shares one fixture texture between every look on the same base', () => {
    const { art } = harness();
    const office = (v: number): Texture => art.interior!('office', 9, 1, lookOf('office', v).base);
    expect(office(0)).toBe(office(5)); // both on the open plan bench
    expect(office(1)).toBe(office(3)); // both in the meeting room
    expect(office(0)).not.toBe(office(1));
    const restaurant = (v: number): Texture => art.interior!('restaurant', 24, 1, lookOf('restaurant', v).base);
    expect(restaurant(0)).toBe(restaurant(1));
  });
});

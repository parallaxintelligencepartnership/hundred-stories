// The landing hero (design pass D-34, D-35): a day sky under the canvas while the renderer boots,
// no load fade, a clock held between 10:00 and 20:00, and the tower beside the copy on a desk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import heroSource from '../../src/site/hero.ts?raw';
import {
  CENTER_TILE,
  HERO_PANEL_GAP,
  HERO_SIDE_BY_SIDE,
  heroCenterTile,
  heroMinute,
  towerSpanOf,
  tri,
} from '../../src/site/hero';
import { animateDemo, buildHeroWorld, walkRange } from '../../src/render/smoke';

// Read off disk: vitest hands a .css?raw import over empty.
const css = readFileSync(join(__dirname, '..', '..', 'src', 'site', 'site.css'), 'utf8');
const flat = (text: string): string => text.replace(/\s+/g, ' ');

describe('the hero opens on a daytime sky', () => {
  it('hides the still image as soon as the canvas is booting, so it never squeezes the copy', () => {
    expect(flat(css)).toContain('.hero.has-canvas #hero-shot { display: none; }');
  });

  it('paints the day sky behind the canvas, not a black box', () => {
    const rule = flat(css).match(/\.hero\.has-canvas #hero-view \{[^}]*\}/)![0];
    expect(rule).toContain('background: linear-gradient(180deg, #9fd3f5 0%, #dcefff 100%);');
    expect(rule).not.toContain('#070b1a');
  });

  it('asks the renderer for no load fade', () => {
    expect(heroSource).toContain("createRenderer(view, world, { crowd: 'all', fadeIn: false })");
  });
});

describe('the hero clock', () => {
  it('is the 0 to 1 to 0 triangle', () => {
    expect(tri(0)).toBe(0);
    expect(tri(0.5)).toBe(0.5);
    expect(tri(1)).toBe(1);
    expect(tri(1.5)).toBe(0.5);
    expect(tri(2)).toBe(0);
    expect(tri(2.25)).toBe(0.25);
  });

  it('runs 10:00 to 20:00 over 45 s and back, never leaving the band', () => {
    expect(heroMinute(0)).toBe(600);
    expect(heroMinute(22_500)).toBe(900);
    expect(heroMinute(45_000)).toBe(1200);
    expect(heroMinute(90_000)).toBe(600);
    expect(heroMinute(10_000)).toBeLessThan(18 * 60);
    for (let ms = 0; ms <= 180_000; ms += 250) {
      expect(heroMinute(ms)).toBeGreaterThanOrEqual(600);
      expect(heroMinute(ms)).toBeLessThanOrEqual(1200);
    }
  });

  it('sets the clock each frame instead of running it', () => {
    expect(heroSource).toContain('world.time.minute = heroMinute(elapsed);');
    expect(heroSource).toContain('animateDemo(world, dt, { minutesPerMs: 0, fire: false });');
  });
});

describe('the hero camera', () => {
  const TOWER = { left: 110, right: 150 };
  /** The tower's left edge in page px with the camera on `tile`: camera.ts centerOn puts the middle of the tile at the view's middle, zoom 1. */
  const towerLeftOnScreen = (tile: number, hero: { left: number; right: number }): number =>
    (hero.left + hero.right) / 2 + (TOWER.left - (tile + 0.5)) * 16;

  it('side by side from 720 css px', () => {
    expect(HERO_SIDE_BY_SIDE).toBe('(min-width: 720px)');
  });

  it('measures the hero tower at 640 css px, x 110 to 149', () => {
    expect(towerSpanOf(buildHeroWorld())).toEqual(TOWER);
  });

  it('anchors a tower wider than the space 24 px right of the panel and crops its right side (1440 px)', () => {
    // The reviewer's 1440: the panel ends at 855, leaving 585 px, less than the tower's 640.
    const hero = { left: 0, right: 1440 };
    const tile = heroCenterTile(hero, { left: 215, right: 855 }, true, TOWER);
    expect(HERO_PANEL_GAP).toBe(24);
    expect(towerLeftOnScreen(tile, hero)).toBe(855 + 24);
    expect(towerLeftOnScreen(tile, hero) + 640).toBeGreaterThan(1440);
  });

  it('anchors a tower that fits but would sit within 24 px of the panel when centered (1568 px)', () => {
    // Panel ends at 920, leaving 648 px: room for the 640 px tower, but centered its left edge lands at 916, under the panel.
    const hero = { left: 0, right: 1568 };
    const tile = heroCenterTile(hero, { left: 280, right: 920 }, true, TOWER);
    expect(towerLeftOnScreen(tile, hero)).toBe(920 + 24);
  });

  it('centers a tower that fits the space as the spec says (1920 px)', () => {
    // Panel ends at 1095: the space is 1095 to 1920 (825 px), its middle 1507.5, 547.5 px right of 960.
    const hero = { left: 0, right: 1920 };
    const tile = heroCenterTile(hero, { left: 455, right: 1095 }, true, TOWER);
    expect(tile).toBe(CENTER_TILE - 547.5 / 16);
    expect(CENTER_TILE).toBe(130);
    expect(towerLeftOnScreen(tile, hero)).toBeGreaterThan(1095 + 24);
  });

  it('keeps CENTER_TILE in the middle when stacked or with no panel', () => {
    expect(heroCenterTile({ left: 0, right: 390 }, { left: 16, right: 374 }, false, TOWER)).toBe(CENTER_TILE);
    expect(heroCenterTile({ left: 0, right: 1280 }, null, true, TOWER)).toBe(CENTER_TILE);
  });
});

describe('the hero tower (buildHeroWorld)', () => {
  const world = buildHeroWorld();
  const at = (floor: number): string[] =>
    [...world.rooms.values()]
      .filter((r) => r.floor === floor)
      .sort((a, b) => a.x - b.x)
      .map((r) => `${r.kind} ${r.x}`);

  it('puts the listed rooms on the listed floors', () => {
    expect(at(1)).toEqual(Array.from({ length: 40 }, (_, i) => `lobby ${110 + i}`));
    // The fast food ends at x 145, clear of the shaft; shop 122 made way for it.
    expect(at(2)).toEqual(['shop 110', 'fastFood 130']);
    expect(at(3)).toEqual(['restaurant 110', 'shop 134']);
    for (const floor of [4, 5]) expect(at(floor)).toEqual(['office 110', 'office 119', 'office 128', 'office 137']);
    expect(at(6)).toEqual(['hotelSuite 110', 'hotelTwin 120', 'hotelTwin 126', 'hotelSingle 132', 'hotelSingle 136', 'hotelSingle 140']);
    for (const floor of [7, 8]) expect(at(floor)).toEqual(['condo 110', 'condo 126']);
    expect(world.rooms.size).toBe(40 + 2 + 2 + 8 + 6 + 4);
  });

  it('overlaps no two rooms on a floor, and no room but the lobby under it meets the shaft', () => {
    const rooms = [...world.rooms.values()];
    const overlap = (a: { x: number; width: number }, b: { x: number; width: number }): boolean =>
      a.x < b.x + b.width && b.x < a.x + a.width;
    const clashes: string[] = [];
    rooms.forEach((a, i) => {
      for (const b of rooms.slice(i + 1)) {
        if (a.floor === b.floor && overlap(a, b)) clashes.push(`${a.kind} ${a.x} and ${b.kind} ${b.x} on floor ${a.floor}`);
      }
    });
    expect(clashes).toEqual([]);
    const shaft = [...world.shafts.values()][0]!;
    const inShaft = rooms
      .filter((r) => r.kind !== 'lobby' && r.floor >= shaft.floorMin && r.floor <= shaft.floorMax && overlap(r, shaft))
      .map((r) => `${r.kind} ${r.x} on floor ${r.floor}`);
    expect(inShaft).toEqual([]);
  });

  it('keeps the shops, the fast food and the restaurant open', () => {
    for (const room of world.rooms.values()) {
      if (['shop', 'fastFood', 'restaurant'].includes(room.kind)) expect(room.occupancy, `${room.kind} ${room.x}`).toBeGreaterThan(0);
    }
  });

  it('runs one standard shaft with two cars over floors 1 to 8 at x 146', () => {
    const shafts = [...world.shafts.values()];
    expect(shafts).toHaveLength(1);
    expect(shafts[0]).toMatchObject({ kind: 'standard', x: 146, floorMin: 1, floorMax: 8 });
    expect(shafts[0]!.cars).toHaveLength(2);
  });

  it('fills it with 24 people cycling the everyday kinds', () => {
    const kinds = [...world.sims.values()].map((s) => s.kind);
    expect(kinds).toHaveLength(24);
    expect(kinds.slice(0, 7)).toEqual(['worker', 'resident', 'guest', 'shopper', 'staff', 'guard', 'visitor']);
  });

  it("keeps every walker's whole 16 px figure inside its floor, even at the 100 ms frame cap", () => {
    const hero = buildHeroWorld();
    // A floor's extent in tiles, right edge exclusive: its rooms, and the shaft where it reaches.
    const extent = (floor: number): { left: number; right: number } => {
      const parts = [
        ...[...hero.rooms.values()].filter((r) => r.floor === floor),
        ...[...hero.shafts.values()].filter((s) => floor >= s.floorMin && floor <= s.floorMax),
      ];
      return { left: Math.min(...parts.map((p) => p.x)), right: Math.max(...parts.map((p) => p.x + p.width)) };
    };
    const outside = new Set<string>();
    for (let t = 0; t < 60_000; t += 100) {
      animateDemo(hero, 100, { minutesPerMs: 0, fire: false });
      for (const sim of hero.sims.values()) {
        // The figure is one tile wide, centered on pos.x (renderer.ts anchors people at 0.5).
        const { left, right } = extent(sim.pos.floor);
        if (sim.pos.x - 0.5 < left || sim.pos.x + 0.5 > right) outside.add(`person ${sim.id} on floor ${sim.pos.floor}`);
      }
    }
    expect([...outside]).toEqual([]);
    expect(walkRange(hero, 1)).toEqual({ min: 111.5, max: 147 });
  });

  it('is the world the hero draws', () => {
    expect(heroSource).toContain('const world = buildHeroWorld();');
  });
});

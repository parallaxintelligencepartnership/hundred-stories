// The landing hero (design pass D-34, D-35): a day sky under the canvas while the renderer boots,
// no load fade, a clock held between 10:00 and 20:00, and the tower beside the copy on a desk.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../../src/render/renderer';

// Node has no WebGL, so the renderer refuses here exactly as it does on a machine without it.
vi.mock('../../src/render/renderer', () => ({
  createRenderer: vi.fn(() => Promise.reject(new Error('no WebGL context'))),
}));

import heroSource from '../../src/site/hero.ts?raw';
import {
  CENTER_TILE,
  HERO_PANEL_GAP,
  HERO_SIDE_BY_SIDE,
  LOAD_WAIT_NOTE_MS,
  afterPageLoad,
  heroCenterTile,
  heroMinute,
  towerSpanOf,
  tri,
} from '../../src/site/hero';
import { animateDemo, buildHeroWorld, walkRange } from '../../src/render/smoke';

// Read off disk: vitest hands a .css?raw import over empty.
const css = readFileSync(join(__dirname, '..', '..', 'src', 'site', 'site.css'), 'utf8');
const flat = (text: string): string => text.replace(/\s+/g, ' ');

/** A WebP's pixel size, read off its RIFF header by hand (lossy VP8, lossless VP8L, extended VP8X). */
function webpSize(b: Uint8Array): { width: number; height: number } {
  const tag = (at: number): string => String.fromCharCode(...b.subarray(at, at + 4));
  expect(tag(0)).toBe('RIFF');
  expect(tag(8)).toBe('WEBP');
  const chunk = tag(12);
  const le16 = (at: number): number => b[at]! | (b[at + 1]! << 8);
  const le24 = (at: number): number => le16(at) | (b[at + 2]! << 16);
  if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1 };
  if (chunk === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  throw new Error(`not a WebP image chunk: ${chunk}`);
}

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

describe('the hero without WebGL', () => {
  it('drops has-canvas when the renderer refuses, so the panel keeps its width and the still image returns', async () => {
    // No jsdom in this repo: the three elements start() reads, as stubs (as tests/site/challenge.test.ts does).
    const classes = new Set<string>();
    const added: string[] = [];
    const hero = {
      classList: {
        add: (name: string) => {
          added.push(name);
          classes.add(name);
        },
        remove: (name: string) => classes.delete(name),
        contains: (name: string) => classes.has(name),
      },
      querySelector: () => null,
    };
    const elements: Record<string, unknown> = { hero, 'hero-view': {}, 'hero-shot': { style: { display: '' } } };
    const g = globalThis as Record<string, unknown>;
    g.document = { getElementById: (id: string) => elements[id] ?? null, visibilityState: 'visible', readyState: 'complete' };
    g.window = { matchMedia: () => ({ matches: false }) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // A fresh evaluation, so the module level start() runs now that there is a document.
      vi.resetModules();
      await import('../../src/site/hero');
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      // The class went on while the renderer booted, and came off when it refused.
      expect(added).toEqual(['has-canvas']);
      expect(hero.classList.contains('has-canvas')).toBe(false);
      expect(warn).toHaveBeenCalledWith('hero: no tower today', expect.any(Error));
    } finally {
      delete g.document;
      delete g.window;
      warn.mockRestore();
    }
  });
});

describe('the hero leaves the network to the still image', () => {
  it('imports the renderer only inside start(), so Vite never modulepreloads its chunks in the head', () => {
    expect(heroSource).not.toMatch(/^import (?!type )[^;]*from '\.\.\/render\/(renderer|smoke)';/m);
    expect(heroSource).toContain("import('../render/renderer')");
    expect(heroSource).toContain("import('../render/smoke')");
  });

  it("waits for the page's load event before it boots the renderer or hides the still image", async () => {
    const added: string[] = [];
    const hero = { classList: { add: (n: string) => added.push(n), remove: () => undefined, contains: () => false }, querySelector: () => null };
    const elements: Record<string, unknown> = { hero, 'hero-view': {}, 'hero-shot': { style: { display: '' } } };
    const loads: (() => void)[] = [];
    const g = globalThis as Record<string, unknown>;
    g.document = { getElementById: (id: string) => elements[id] ?? null, visibilityState: 'visible', readyState: 'interactive' };
    g.window = {
      matchMedia: () => ({ matches: false }),
      addEventListener: (type: string, l: () => void) => void (type === 'load' && loads.push(l)),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(createRenderer).mockClear();
    try {
      vi.resetModules();
      await import('../../src/site/hero');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(createRenderer).not.toHaveBeenCalled();
      expect(added).toEqual([]);
      // Two: hero-trailer.ts's own boot (imported by hero.ts, harmless here: the stub document has
      // no #hero-trailer) registers first, then hero.ts's own afterPageLoad listener.
      expect(loads).toHaveLength(2);
      loads[1]!();
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('hero: no tower today', expect.any(Error)));
      expect(added).toEqual(['has-canvas']);
    } finally {
      delete g.document;
      delete g.window;
      warn.mockRestore();
    }
  });
});

describe('the still image and the canvas share one box (no layout shift when has-canvas flips)', () => {
  const flatCss = flat(css);
  const wide = flatCss.slice(flatCss.indexOf('@media (min-width: 720px)'));
  const ruleIn = (text: string, selector: string): string => {
    const at = text.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return text.slice(at, text.indexOf('}', at) + 1);
  };

  it('on a phone the still image is the canvas host\'s 320 px block, cropped to fit', () => {
    const shot = ruleIn(flatCss, '#hero-shot');
    expect(shot).toContain('display: block;');
    expect(shot).toContain('height: 320px;');
    expect(shot).toContain('object-fit: cover;');
    expect(ruleIn(flatCss, '.hero.has-canvas #hero-view')).toContain('height: 320px;');
  });

  it('on a wider screen the hero keeps its desk layout in both states, the image under the copy like the canvas', () => {
    const hero = ruleIn(wide, '.hero');
    for (const decl of ['min-height: 480px;', 'display: flex;', 'align-items: flex-end;', 'padding-bottom: 40px;']) expect(hero).toContain(decl);
    expect(ruleIn(wide, '.hero .wrap')).toContain('width: 100%;');
    const shot = ruleIn(wide, '#hero-shot');
    for (const decl of ['position: absolute;', 'inset: 0;', 'height: 100%;']) expect(shot).toContain(decl);
    expect(wide).not.toContain('.hero.has-canvas {');
    expect(wide).not.toContain('.hero:not(.has-canvas)');
  });

  it('crops toward the tower and the ground, so a crop only trims sky', () => {
    expect(ruleIn(flatCss, '#hero-shot')).toContain('object-position: right bottom;');
  });

  it('ships a WebP still whose pixel size is the size the markup reserves', () => {
    const webp = readFileSync(join(__dirname, '..', '..', 'public', 'hero-still.webp'));
    const size = webpSize(webp);
    const shot = flat(readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8')).match(/<img id="hero-shot"[^>]*>/)![0];
    expect(size).toEqual({ width: Number(shot.match(/width="(\d+)"/)![1]), height: Number(shot.match(/height="(\d+)"/)![1]) });
    expect(size).toEqual({ width: 1600, height: 479 });
  });
});

describe('a load event that never comes', () => {
  it('leaves one console note, and none when the page loads in time', () => {
    vi.useFakeTimers();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const loads: (() => void)[] = [];
      const win = { addEventListener: (_t: string, l: () => void) => void loads.push(l) } as unknown as Window;
      void afterPageLoad({ readyState: 'interactive' }, win);
      vi.advanceTimersByTime(LOAD_WAIT_NOTE_MS * 3);
      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]![0]).toContain('no load event');

      info.mockClear();
      void afterPageLoad({ readyState: 'interactive' }, win);
      loads[1]!();
      vi.advanceTimersByTime(LOAD_WAIT_NOTE_MS * 3);
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      vi.useRealTimers();
    }
  });
});

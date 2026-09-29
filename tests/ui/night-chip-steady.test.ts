// The night speed chip ("Night: 8 times as fast") sits left of the speed pill in the top bar's
// controls. It used to leave the flow by day (display none), so at nightfall the controls grew,
// the bar could wrap to a second row, Views moved, and Watch and Sound (placed from Views by
// placeWatchButton) jumped, then jumped back at dawn. Now the chip keeps one fixed box on a wide
// screen whether it shows or not, and its words wrap inside it: the bar's contents never change
// size with it. A phone hangs it over the speed pill, out of the row, as before. The fake DOM
// lays nothing out, so the box is read from ui.css and the DOM is checked for staying put.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const phoneAt = css.indexOf('@media (max-width: 720px) {');

/** Every rule whose selector list names `selector` exactly, with its declarations. */
function rulesFor(block: string, selector: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(block); m; m = re.exec(block)) {
    const selectors = (m[1] ?? '').split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const decls: Record<string, string> = {};
    for (const decl of (m[2] ?? '').split(';')) {
      const [k, ...v] = decl.split(':');
      if (k?.trim() && v.length) decls[k.trim()] = v.join(':').trim();
    }
    out.push(decls);
  }
  return out;
}

/** The wide screen's css: all of it but the phone block. */
const wide = css.slice(0, phoneAt);
/** What the wide screen's (min-width: 721px) block says. */
function wideOnly(): string {
  const start = wide.lastIndexOf('@media (min-width: 721px) {', wide.indexOf('.hs-speed-mode {', wide.indexOf('.hs-speed-mode.is-hidden')));
  let depth = 0;
  for (let i = wide.indexOf('{', start); i < wide.length; i += 1) {
    if (wide[i] === '{') depth += 1;
    if (wide[i] === '}' && --depth === 0) return wide.slice(wide.indexOf('{', start) + 1, i);
  }
  throw new Error('no wide block');
}

describe('the night speed chip keeps the top bar still', () => {
  it('hidden by day it keeps its box: only its visibility changes, nothing that sizes it', () => {
    const hidden = rulesFor(css, '.hs-speed-mode.is-hidden');
    expect(hidden.length).toBeGreaterThan(0);
    for (const decls of hidden) expect(Object.keys(decls)).toEqual(['visibility']);
    expect(hidden.map((d) => d.visibility)).toContain('hidden');
  });

  it('on a wide screen its box is one fixed size, whatever its words: they wrap inside it', () => {
    const [box] = rulesFor(wideOnly(), '.hs-speed-mode');
    expect(box).toBeDefined();
    expect(box!.flex).toBe('none');
    expect(box!.width).toMatch(/^\d+(\.\d+)?em$/);
    expect(box!['white-space']).toBe('normal');
    // Nothing else on a wide screen lets its words size it.
    for (const decls of rulesFor(wide, '.hs-speed-mode')) {
      expect(decls['min-width']).toBeUndefined();
      expect(decls['max-width']).toBeUndefined();
    }
    // A phone still hangs it over the speed pill, out of the row.
    expect(rulesFor(css.slice(phoneAt), '.hs-speed-mode').some((d) => d.position === 'absolute')).toBe(true);
  });

  describe('in the ui', () => {
    let dom: FakeDom;
    let uninstall: () => void;
    beforeEach(() => {
      dom = new FakeDom();
      uninstall = dom.install();
    });
    afterEach(() => uninstall());

    it('day, night, paused at night and day again: the same nodes in the same places, and the same measures under the bar', () => {
      const world = {
        cash: 2_000_000, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0,
        rooms: new Map(), shafts: new Map(), sims: new Map(), events: [],
      };
      let speed = 1;
      const api = {
        world, subscribe: () => () => {}, getHover: () => null, getSpeed: () => speed, getTool: () => ({ kind: 'none' }),
        setTool: () => {}, getPlacement: () => null, getPlacementRect: () => null, getSelection: () => null,
        setChrome: () => {}, setReducedMotion: () => {},
      } as never;
      const root = dom.createElement('div');
      const ui = createUi(root as never, api, {} as never);
      const has = (n: FakeElement, c: string): boolean => n.className.split(' ').includes(c);
      const top = root.descendants().find((n) => has(n, 'hs-top'))!;
      const actions = top.children.find((n) => has(n, 'hs-top-actions'))!;
      const chip = actions.children.find((n) => has(n, 'hs-speed-mode'))!;
      const snapshot = (): unknown => ({
        top: [...top.children],
        actions: [...actions.children],
        placed: top.children.map((n) => [n.className, n.style['--watch-x'], n.style['--sound-x'], n.style['--save-x']]),
      });
      const before = snapshot();
      const seen: [string, boolean][] = [];
      for (const [minute, s] of [[23 * 60 + 30, 1], [23 * 60 + 40, 0], [12 * 60 + 2 * 1440, 1]] as const) {
        world.time.minute = minute;
        speed = s;
        ui.update();
        seen.push([chip.textContent, chip.classList.contains('is-hidden')]);
        expect(snapshot()).toEqual(before);
      }
      // Its words are as they were: shown at night, the paused line when paused, gone by day.
      expect(seen).toEqual([
        ['Night: 8 times as fast', false],
        ['Paused. Nights run 8 times as fast', false],
        ['', true],
      ]);
      ui.destroy();
    });
  });
});

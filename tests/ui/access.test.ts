// Accessibility built in: the Skip to tower link first in the tab order, the focus ring on every
// control, Larger text scaling the ui by 1.25 through the tokens, and the color-blind switch
// reaching the renderer and the chip. Read from the fake DOM and from ui.css.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LARGE_TEXT_SCALE, applyDisplayPrefs, readDisplayPrefs, watchDisplayPrefs } from '../../src/ui/display';
import { PREF_KEYS, setFlag } from '../../src/ui/prefs';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
const has = (n: FakeElement, c: string): boolean => n.className.split(' ').includes(c);

/** The first `:root {` block's body. */
function rootBlock(): string {
  const start = css.indexOf(':root {');
  return css.slice(start + 7, css.indexOf('\n}', start));
}

function fakeGame(): never {
  return {
    world: { cash: 1_000_000, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(), sims: new Map(), events: [] },
    subscribe: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
  } as never;
}

describe('skip to tower', () => {
  it('is the first thing Tab reaches, and moves focus to the tower view', () => {
    const view = dom.createElement('div');
    view.id = 'view';
    (globalThis as { document: { getElementById: (id: string) => unknown } }).document.getElementById = (id: string) =>
      id === 'view' ? view : null;
    const root = dom.createElement('div');
    createUi(root as never, fakeGame(), {} as never);
    const shell = root.children[0]!;
    const focusable = shell.descendants().filter((n) => n.tagName === 'A' || n.tagName === 'BUTTON' || n.tagName === 'INPUT');
    const skip = focusable[0]!;
    expect(skip.tagName).toBe('A');
    expect(skip.textContent).toBe('Skip to tower');
    expect(skip.getAttribute('href') ?? (skip as unknown as { href: string }).href).toBe('#view');
    let prevented = false;
    for (const fn of skip.listeners.get('click') ?? []) fn({ preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(view.getAttribute('tabindex')).toBe('-1');
    expect(dom.activeElement).toBe(view);
  });

  it('is out of sight until it has focus, then shows in the focus ring', () => {
    expect(css).toMatch(/\.hs-skip \{[^}]*transform: translateY\(calc\(-100% - 16px\)\);/);
    expect(css).toMatch(/\.hs-skip:focus,\s*\.hs-skip:focus-visible \{\s*transform: none;\s*outline: var\(--focus-ring\);/);
  });
});

describe('focus ring', () => {
  it('rings every control in the chrome with the token, and nothing takes it away but the sheet itself', () => {
    expect(css).toMatch(/\.hs-ui :focus-visible \{\s*outline: var\(--focus-ring\);/);
    const removed = [...css.matchAll(/([^{}]+)\{[^}]*outline: none/g)].map((m) => m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').trim());
    expect(removed).toEqual(['.hs-ui .hs-sheet:focus-visible']);
  });

  it('keeps the new controls as buttons, so Tab reaches each one', () => {
    const root = dom.createElement('div');
    createUi(root as never, fakeGame(), {} as never);
    const shell = root.children[0]!;
    for (const c of ['hs-views-btn', 'hs-build-fab', 'hs-build-tab', 'hs-views-item', 'hs-view-chip-close', 'hs-build-placing-cancel', 'hs-build-handle']) {
      const nodes = shell.descendants().filter((n) => has(n, c));
      expect(nodes.length, c).toBeGreaterThan(0);
      for (const n of nodes) {
        expect(n.tagName, c).toBe('BUTTON');
        expect(n.getAttribute('tabindex'), c).not.toBe('-1');
      }
    }
  });
});

describe('larger text', () => {
  it('scales every size token and the touch target by --ui-scale, 1 by default and 1.25 when on', () => {
    const block = rootBlock();
    expect(block).toMatch(/--ui-scale: 1;/);
    for (const token of ['--size-12', '--size-14', '--size-16', '--size-20', '--size-28', '--touch', '--status-h', '--panel-w', '--palette-w', '--fab']) {
      expect(block, token).toMatch(new RegExp(`${token}: calc\\(\\d+px \\* var\\(--ui-scale\\)\\);`));
    }
    expect(LARGE_TEXT_SCALE).toBe(1.25);
    expect(css).toMatch(/:root\.hs-large-text \{\s*--ui-scale: 1\.25;\s*\}/);
  });

  it('puts hs-large-text on the page root from the stored switch, and follows it when Settings writes it', () => {
    const rootEl = dom.createElement('html');
    const colorBlind: boolean[] = [];
    const stop = watchDisplayPrefs({ root: rootEl as never, colorBlind: (on) => colorBlind.push(on) });
    expect(has(rootEl, 'hs-large-text')).toBe(false);
    setFlag(PREF_KEYS.largeText, true);
    expect(has(rootEl, 'hs-large-text')).toBe(true);
    expect(readDisplayPrefs()).toEqual({ largeText: true, colorBlind: false });
    setFlag(PREF_KEYS.largeText, false);
    expect(has(rootEl, 'hs-large-text')).toBe(false);
    stop();
    setFlag(PREF_KEYS.largeText, true);
    expect(has(rootEl, 'hs-large-text')).toBe(false); // stopped listening
    expect(colorBlind).toEqual([false]);
  });

  it('applies both switches in one call', () => {
    const rootEl = dom.createElement('html');
    const seen: boolean[] = [];
    applyDisplayPrefs({ largeText: true, colorBlind: true }, { root: rootEl as never, colorBlind: (on) => seen.push(on) });
    expect(has(rootEl, 'hs-large-text')).toBe(true);
    expect(seen).toEqual([true]);
  });
});

describe('color-blind friendly views in the shell', () => {
  it('reaches the renderer and the legend when the switch is written', () => {
    const calls: boolean[] = [];
    const root = dom.createElement('div');
    createUi(root as never, fakeGame(), { setOverlayColorBlind: (on: boolean) => calls.push(on) } as never);
    expect(calls).toEqual([false]);
    setFlag(PREF_KEYS.colorBlind, true);
    expect(calls).toEqual([false, true]);
    const shell = root.children[0]!;
    const first = shell.descendants().find((n) => has(n, 'hs-views-item'))!;
    for (const fn of first.listeners.get('click') ?? []) fn({});
    const striped = shell.descendants().filter((n) => has(n, 'is-striped'));
    expect(striped).toHaveLength(1);
  });
});

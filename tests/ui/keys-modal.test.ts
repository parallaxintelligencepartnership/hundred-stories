// Keys and the controller around buttons and open sheets (audit 2026-09-25, E1 S5 and S6):
// Space on a focused button is that button's, not the pause key; tool, group and pause keys do
// nothing behind an open modal sheet; the controller's A never clicks the tower behind an open
// menu, it moves focus into the menu instead.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { PAD_BUTTONS, type PadLike } from '../../src/ui/gamepad';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

function pad(held: (keyof typeof PAD_BUTTONS)[] = []): PadLike {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const name of held) buttons[PAD_BUTTONS[name]] = { pressed: true, value: 1 };
  return { connected: true, axes: [0, 0, 0, 0], buttons };
}

let dom: FakeDom;
let uninstall: () => void;
let savedNav: PropertyDescriptor | undefined;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  savedNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
});
afterEach(() => {
  uninstall();
  if (savedNav) Object.defineProperty(globalThis, 'navigator', savedNav);
});

function mkGame(calls: string[]): never {
  return {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 0 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null }, story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    togglePause: () => calls.push('togglePause'),
    getTool: () => ({ kind: 'room', room: 'office' }),
    setTool: (t: unknown) => calls.push(`setTool ${JSON.stringify(t)}`),
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    select() {},
  } as never;
}

function key(target: unknown, k: string, code: string): { prevented: boolean } {
  const out = { prevented: false };
  dom.fireWindow('keydown', {
    key: k, code, target, defaultPrevented: false,
    preventDefault() { out.prevented = true; },
    stopImmediatePropagation() {},
  });
  return out;
}

const menuButton = (root: FakeElement): FakeElement =>
  root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;

it('S5: Space on a focused button does not pause, and is left to the button', () => {
  const calls: string[] = [];
  const root = dom.createElement('div');
  createUi(root as never, mkGame(calls), {} as never);
  const pressed = key(menuButton(root), ' ', 'Space');
  expect(calls).toEqual([]);
  expect(pressed.prevented).toBe(false);
  // Space with nothing focused still pauses.
  key(dom.body, ' ', 'Space');
  expect(calls).toEqual(['togglePause']);
});

it('S5: with the Settings sheet open, a tool key picks nothing and Space does not pause', () => {
  const calls: string[] = [];
  const root = dom.createElement('div');
  createUi(root as never, mkGame(calls), {} as never);
  (menuButton(root).listeners.get('click') ?? []).forEach((f) => f({} as never));
  const dialog = root.descendants().find((n) => n.getAttribute('role') === 'dialog');
  expect(dialog?.getAttribute('aria-modal')).toBe('true');
  key(dom.activeElement ?? dom.body, '1', 'Digit1');
  key(dom.body, ' ', 'Space');
  expect(calls).toEqual([]);
});

it('S6: A with the menu open and focus on the page moves focus into the menu, never clicks the tower', () => {
  const pads: PadLike[] = [];
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => pads }, configurable: true });
  const hits: string[] = [];
  const canvas = { dispatchEvent: (e: { type: string }) => (hits.push(e.type), true) };
  const doc = (globalThis as unknown as { document: { querySelector: (s: string) => unknown } }).document;
  doc.querySelector = (s: string) => (s === '#view canvas' ? canvas : null);
  const g = globalThis as unknown as Record<string, unknown>;
  g.PointerEvent = class { type: string; constructor(t: string, i: object) { this.type = t; Object.assign(this, i); } };
  g.MouseEvent = class { type: string; constructor(t: string, i: object) { this.type = t; Object.assign(this, i); } };
  const root = dom.createElement('div');
  createUi(root as never, mkGame([]), {} as never);
  const shell = root.children[0]!;
  pads.push(pad(['start']));
  dom.fireWindow('gamepadconnected');
  dom.runFrame();
  const dialog = shell.descendants().find((n) => n.getAttribute('role') === 'dialog');
  expect(dialog).toBeDefined();
  pads[0] = pad([]);
  dom.runFrame();
  dom.activeElement = dom.body; // the focused row was replaced, focus fell to the page
  hits.length = 0;
  pads[0] = pad(['a']);
  dom.runFrame();
  // The fake frame passes no timestamp, so the pad loop's pan step is NaN and moves the cursor
  // (a pointermove) every frame; that is the fake, not A. A must press nothing on the tower.
  expect(hits.filter((type) => type !== 'pointermove')).toEqual([]);
  expect(dialog!.contains(dom.activeElement)).toBe(true);
  expect(shell.descendants().some((n) => n.getAttribute('role') === 'dialog')).toBe(true);
});

// Warnings counted in one tower are not folded into the first warning toast of the next one
// (the reset in ui.ts onWorld; audit 2026-09-28 review F6: removing it passed every ui test).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorld, log } from '../../src/sim/world';
import { createUi, GIVE_UP_TOAST_GAP_MS } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
let now = 100_000;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
  now = 100_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

function mount() {
  const subscribers = new Set<() => void>();
  const game = {
    world: createWorld(3),
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select: () => {},
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
  };
  const root = dom.createElement('div');
  createUi(root as never, game as never, {} as never);
  return { game, root, notify: () => subscribers.forEach((cb) => cb()) };
}

const toasts = (root: FakeElement): string[] =>
  root
    .descendants()
    .filter((n) => n.className.split(/\s+/).includes('hs-news-toast') && !n.classList.contains('is-leaving'))
    .map((n) => n.textContent);

it("a tower switch drops the old tower's counted warnings from the new tower's first toast", () => {
  const { game, root, notify } = mount();
  notify();
  // One toast now; the next two warnings land inside the gap, so they are only counted.
  log(game.world, 'Gave up waiting for an elevator on floor 4.', 'warn');
  notify();
  now += 1000;
  log(game.world, 'Gave up waiting for an elevator on floor 6.', 'warn');
  notify();
  log(game.world, 'A tenant moved out of the office on floor 2.', 'warn');
  notify();
  expect(toasts(root)).toEqual(['Gave up waiting for an elevator on floor 4.']);

  // Another tower loads (a new game, a friend's tower, the daily).
  game.world = createWorld(9);
  notify();
  now += GIVE_UP_TOAST_GAP_MS;
  log(game.world, 'Gave up waiting for an elevator on floor 3.', 'warn');
  notify();
  expect(toasts(root)).toContain('Gave up waiting for an elevator on floor 3.');
  expect(toasts(root).some((t) => /problems in the tower|people gave up/.test(t))).toBe(false);
});

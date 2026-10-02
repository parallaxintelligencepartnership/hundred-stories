// A refused Add car or Build says why once (audit 2026-09-25, E1 S3): the notice card where the
// player acted, never a news toast of the same words as well. The real game logs the refusal and
// notifies before apply returns, which is the order that used to put up both.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGame } from '../../src/game/game';
import { resetEventTestHooks } from '../../src/sim/events';
import { log } from '../../src/sim/world';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const store = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage;
  store.setItem('hs.intro.seen', 'true');
  store.setItem('hs.guide.done', 'true');
  resetEventTestHooks();
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (n: FakeElement): void => (n.listeners.get('click') ?? []).forEach((fn) => fn({} as never));

it('the first refused Add car shows exactly one notice card and no news toast', () => {
  const game = createGame(5);
  game.world.cash = 10_000_000;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  expect(game.apply({ kind: 'shaft.build', shaft: 'standard', x: 100, floorMin: 1, floorMax: 3 }).ok).toBe(true);
  const root = dom.createElement('div');
  createUi(root as never, game, {} as never);
  game.world.cash = 0;
  game.select({ shaftId: [...game.world.shafts.keys()][0]! });

  const add = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('Add car'));
  expect(add).toBeDefined();
  click(add!);
  const saying = (n: FakeElement): boolean => n.textContent.includes('Not enough cash');
  const notices = root.descendants().filter((n) => has(n, 'is-notice') && saying(n));
  const news = root.descendants().filter((n) => has(n, 'hs-news-toast') && saying(n));
  expect(notices).toHaveLength(1);
  expect(news).toHaveLength(0);
  // The refusal is still in the world log for the News panel.
  expect(game.world.log.at(-1)?.text).toContain('Not enough cash');
});

it('an accepted Add car reaches the News panel only, not a toast (routine info never toasts)', () => {
  const game = createGame(5);
  game.world.cash = 10_000_000;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  game.apply({ kind: 'shaft.build', shaft: 'standard', x: 100, floorMin: 1, floorMax: 3 });
  const root = dom.createElement('div');
  createUi(root as never, game, {} as never);
  game.select({ shaftId: [...game.world.shafts.keys()][0]! });
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('Add car'))!);
  expect(game.world.log.at(-1)?.text).toContain('Added a car');
  expect(root.descendants().some((n) => has(n, 'hs-news-toast') && n.textContent.includes('Added a car'))).toBe(false);
});

it('a refusal does not swell the next warning toast into a count (audit 2026-09-28, E1 S6)', () => {
  const game = createGame(5);
  game.world.cash = 10_000_000;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  game.apply({ kind: 'shaft.build', shaft: 'standard', x: 100, floorMin: 1, floorMax: 3 });
  const root = dom.createElement('div');
  createUi(root as never, game, {} as never);
  game.world.cash = 0;
  game.select({ shaftId: [...game.world.shafts.keys()][0]! });
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('Add car'))!);
  game.select({});
  const sentence = 'Gave up waiting for an elevator on floor 2 and went home.';
  log(game.world, sentence, 'warn');
  game.setSpeed(game.getSpeed());
  const toasts = root.descendants().filter((n) => has(n, 'hs-news-toast')).map((n) => n.textContent);
  // Since P3b the toast speaks for the problems true now: the one give-up, not a count with the refusal.
  expect(toasts).toEqual(['1 person gave up waiting for an elevator in the last hour, on floor 2. More cars or another elevator would help.']);
});

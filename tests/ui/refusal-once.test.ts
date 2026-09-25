// A refused Add car or Build says why once (audit 2026-09-25, E1 S3): the notice card where the
// player acted, never a news toast of the same words as well. The real game logs the refusal and
// notifies before apply returns, which is the order that used to put up both.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGame } from '../../src/game/game';
import { resetEventTestHooks } from '../../src/sim/events';
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

it('an accepted Add car still reaches the news', () => {
  const game = createGame(5);
  game.world.cash = 10_000_000;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  game.apply({ kind: 'shaft.build', shaft: 'standard', x: 100, floorMin: 1, floorMax: 3 });
  const root = dom.createElement('div');
  createUi(root as never, game, {} as never);
  game.select({ shaftId: [...game.world.shafts.keys()][0]! });
  click(root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent.startsWith('Add car'))!);
  expect(root.descendants().some((n) => has(n, 'hs-news-toast') && n.textContent.includes('Added a car'))).toBe(true);
});

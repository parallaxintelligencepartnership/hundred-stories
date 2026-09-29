// A refused demolish from a tap on the tower says why where the player acted (Matt's playtest,
// 2026-09-28): a notice card with the sim's reason and one plain sentence on what to do, never
// only a news toast that the warning throttle can drop, fold into a count or hide.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../../src/game/game';
import type { PickHit, Renderer } from '../../src/render/renderer';
import { resetEventTestHooks } from '../../src/sim/events';
import { demolishNotice } from '../../src/ui/explain';
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

function tower(): { game: ReturnType<typeof createGame>; root: FakeElement; pick(hit: PickHit): void; roomAt: { id: number; x: number; occupancy: number } } {
  let onPick: ((hit: PickHit) => void) | null = null;
  const renderer = {
    render: () => {},
    camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
    screenToTile: () => ({ floor: 2, x: 0 }),
    setGhost: () => {},
    ghostScreenRect: () => null,
    setSelection: () => {},
    onPick: (cb: (hit: PickHit) => void) => {
      onPick = cb;
    },
    setPanEnabled: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
    resetMotion: () => {},
    commitMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
  const game = createGame(5);
  game.world.cash = 10_000_000;
  game.world.stars = 3;
  for (let x = 90; x < 130; x += 1) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
  expect(game.apply({ kind: 'build', room: 'hotelSingle', floor: 2, x: 110 }).ok).toBe(true);
  const room = [...game.world.rooms.values()].find((r) => r.kind === 'hotelSingle')!;
  const root = dom.createElement('div');
  createUi(root as never, game, {} as never);
  const host = dom.createElement('div');
  game.attach(renderer, host as unknown as HTMLElement);
  return { game, root, pick: (hit) => onPick!(hit), roomAt: room };
}

describe('a refused demolish', () => {
  it('explains the common reasons in one plain sentence, and leaves other lines alone', () => {
    expect(demolishNotice('People are inside.')).toBe('People are inside. Wait until the room is empty.');
    expect(demolishNotice('Wait until the cars are empty.')).toBe('Wait until the cars are empty.');
    expect(demolishNotice('Something above rests on this. Remove that first.')).toBe(
      'Something above rests on this. Remove that first. Demolish from the top down.',
    );
    expect(demolishNotice('Not enough cash. You need $20,000.')).toBe(null);
    expect(demolishNotice('Sam gave up waiting for an elevator.')).toBe(null);
  });

  it('from a tower tap: a notice card says why, every time, and no news toast repeats it', () => {
    const { game, root, pick, roomAt } = tower();
    roomAt.occupancy = 1;
    game.setTool({ kind: 'demolish' });
    const words = 'People are inside. Wait until the room is empty.';
    const notices = (): FakeElement[] => root.descendants().filter((n) => has(n, 'is-notice') && n.textContent.includes(words));
    const toasts = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-news-toast') && n.textContent.includes('People are inside.'));
    pick({ roomId: roomAt.id, floor: 2, x: roomAt.x + 3 });
    expect(notices()).toHaveLength(1);
    // A second tap straight after: the warning toast's 20 s gap does not swallow it.
    pick({ simId: 36, floor: 2, x: roomAt.x + 1 });
    expect(notices()).toHaveLength(2);
    expect(toasts()).toHaveLength(0);
    // The News panel still keeps the sim's words.
    expect(game.world.log.at(-1)?.text).toBe('People are inside.');
  });
});

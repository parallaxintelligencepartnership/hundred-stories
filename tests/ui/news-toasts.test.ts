// Info lines stop toasting (Matt, 2026-09-26): hotel check-outs and housekeeping are 'info' and
// used to rise as one toast each, flooding the screen. Now only an info line marked notable (a
// VIP arriving or checking in, a wedding starting or ending) toasts; every other info line goes
// to the News panel only. Warn lines still fold into one toast per 20 s; alerts are cards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWedding } from '../../src/sim/events';
import { ROOMS } from '../../src/sim/rules';
import type { LogEntry } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
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

function mountWorld(): { world: ReturnType<typeof createWorld>; notify(): void; root: FakeElement } {
  const world = createWorld(3);
  const subscribers = new Set<() => void>();
  const game = {
    world,
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
  return { world, notify: () => subscribers.forEach((cb) => cb()), root };
}

const toasts = (root: FakeElement): string[] =>
  root
    .descendants()
    .filter((n) => n.className.split(/\s+/).includes('hs-news-toast') && !n.classList.contains('is-leaving'))
    .map((n) => n.textContent);

describe('news toasts', () => {
  it('a plain info line (check-out, housekeeping, built) makes no toast; the News log keeps it', () => {
    const { world, notify, root } = mountWorld();
    log(world, 'A guest checked out of the hotel room on floor 3.', 'info');
    notify();
    log(world, 'Housekeeping cleaned a hotel room on floor 3.');
    log(world, 'Built an office on floor 2.', 'info', { roomId: 1 });
    notify();
    expect(toasts(root)).toEqual([]);
    expect(world.log.map((l: LogEntry) => l.text)).toContain('Housekeeping cleaned a hotel room on floor 3.');
    expect(world.log.some((l: LogEntry) => l.notable)).toBe(false);
  });

  it('a notable info line makes one toast, even with a routine line after it in the same batch', () => {
    const { world, notify, root } = mountWorld();
    log(world, 'The VIP checked into the suite on floor 9.', 'info', { notable: true });
    log(world, 'Housekeeping cleaned a hotel room on floor 3.', 'info');
    notify();
    expect(toasts(root)).toEqual(['The VIP checked into the suite on floor 9.']);
  });

  it('the wedding start is logged notable by the sim, and toasts', () => {
    const { world, notify, root } = mountWorld();
    world.stars = 5;
    const kind = 'cathedral' as const;
    addRoom(world, {
      id: allocId(world), kind, floor: 20, x: 100, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 0.7, tenants: [],
      occupancy: 0, builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 0,
    } as never);
    startWedding(world);
    expect(world.log.at(-1)).toMatchObject({ level: 'info', notable: true });
    notify();
    expect(toasts(root)).toEqual([world.log.at(-1)?.text]);
  });

  it('warn lines still fold into one toast per 20 s', () => {
    const { world, notify, root } = mountWorld();
    log(world, 'Gave up waiting for an elevator on floor 4.', 'warn');
    log(world, 'Gave up waiting for an elevator on floor 6.', 'warn');
    notify();
    expect(toasts(root)).toEqual(['2 people gave up waiting for an elevator.']);
    now += 1000;
    log(world, 'A tenant moved out of the office on floor 2.', 'warn');
    notify();
    expect(toasts(root)).toEqual(['2 people gave up waiting for an elevator.']);
    now += GIVE_UP_TOAST_GAP_MS;
    log(world, 'Gave up waiting for an elevator on floor 5.', 'warn');
    notify();
    expect(toasts(root)).toEqual(['2 problems in the tower. Tap for the news.']);
  });
});

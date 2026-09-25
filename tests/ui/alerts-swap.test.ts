// A tower switch or an import (audit 2026-09-25, E1 S1 / E2 S1): the old lines of the tower that
// arrives are history. They never become live fire, bomb or VIP cards, and a live fire card of
// the tower left behind never flips to "Fire out". A tower that arrives mid fire still shows its
// fire card with the button.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { EVENT_TEST_HOOKS, handleEventCommand, resetEventTestHooks, startBomb, startFire } from '../../src/sim/events';
import { ROOMS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import type { Command, CommandResult, Room, RoomKind, Star, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
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
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0 };
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
});

function place(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world), kind, floor, x, width: rule.width, height: rule.height, eval: 1, tenants: [], occupancy: 0,
    builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const cards = (root: FakeElement): string[] =>
  root
    .descendants()
    .filter((n) => has(n, 'hs-toast') && !has(n, 'is-tip') && !has(n, 'is-star'))
    .map((n) => n.textContent);

/** An older tower with a long log: a fire put out, a ransom paid and a VIP checkout, all over. Reloaded like a slot. */
function oldTower(): World {
  const w = createWorld(4242);
  w.stars = 3 as Star;
  w.cash = 5_000_000;
  place(w, 'lobby', 1, 100);
  const office = place(w, 'office', 2, 100);
  for (let i = 0; i < 40; i += 1) log(w, 'Built something.', 'info');
  EVENT_TEST_HOOKS.target.fire = office.id;
  startFire(w);
  handleEventCommand(w, { kind: 'fire.callHelicopter' });
  EVENT_TEST_HOOKS.target.bomb = place(w, 'office', 3, 100).id;
  startBomb(w);
  handleEventCommand(w, { kind: 'bomb.pay' });
  log(w, 'The VIP checked out and rated the tower good.', 'alert');
  const back = deserialize(serialize(w));
  if (!back.ok) throw new Error('the old tower did not load');
  return back.world;
}

function youngTower(withFire: boolean): World {
  const w = createWorld(7);
  w.stars = 3 as Star;
  w.cash = 5_000_000;
  place(w, 'lobby', 1, 100);
  const office = place(w, 'office', 2, 100);
  log(w, 'Welcome.', 'info');
  if (withFire) {
    EVENT_TEST_HOOKS.target.fire = office.id;
    startFire(w);
  }
  return w;
}

function mount(first: World): { root: FakeElement; swap(w: World): void; notify(): void } {
  let current = first;
  const subs = new Set<() => void>();
  const api = {
    get world() {
      return current;
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    subscribeEvents: () => () => {},
    apply: (_c: Command): CommandResult => ({ ok: true }),
    getHover: () => null,
    getSpeed: () => 1,
    setSpeed: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    togglePause: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select: () => {},
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
  } as never;
  const root = dom.createElement('div');
  createUi(root as never, api, {} as never);
  return {
    root,
    swap(w: World) {
      current = w;
      subs.forEach((cb) => cb());
    },
    notify() {
      subs.forEach((cb) => cb());
    },
  };
}

it('A: switching from a short log to a long log replays none of the old alerts', () => {
  const h = mount(youngTower(false));
  h.notify();
  h.swap(oldTower());
  expect(cards(h.root)).toEqual([]);
});

it('B: a live fire card of the tower left behind never flips to "Fire out"', () => {
  const h = mount(youngTower(true));
  h.notify();
  expect(cards(h.root)).toHaveLength(1);
  expect(cards(h.root)[0]).toContain('Fire on floor 2');
  h.swap(oldTower());
  expect(cards(h.root).some((c) => c.includes('Fire out'))).toBe(false);
  expect(cards(h.root)).toEqual([]);
});

it('C: a long log to a short log with a live fire shows only the new fire', () => {
  const old = oldTower();
  const h = mount(old);
  h.notify();
  log(old, 'The bank took the tower because your cash stayed too low for too long.', 'alert');
  h.notify();
  expect(cards(h.root).some((c) => c.includes('The bank took the tower'))).toBe(true);
  h.swap(youngTower(true));
  const after = cards(h.root);
  expect(after).toHaveLength(1);
  expect(after[0]).toContain('Fire on floor 2');
});

it('D: a live bomb card is not turned into "threat over" by a longer tower', () => {
  const a = oldTower();
  EVENT_TEST_HOOKS.target.bomb = [...a.rooms.values()].find((r) => r.kind === 'office')!.id;
  startBomb(a);
  const b = oldTower();
  for (let i = 0; i < 20; i += 1) log(b, 'x', 'info');
  const h = mount(a);
  h.notify();
  expect(cards(h.root).some((c) => c.includes('Pay ransom'))).toBe(true);
  h.swap(b);
  expect(cards(h.root)).toEqual([]);
});

it('a tower that arrives mid fire, by load or by switch, shows "Fire on floor N" with its button', () => {
  const loaded = deserialize(serialize(youngTower(true)));
  if (!loaded.ok) throw new Error('load');
  const h = mount(loaded.world);
  h.notify();
  expect(cards(h.root)).toHaveLength(1);
  expect(cards(h.root)[0]).toContain('Fire on floor 2');
  expect(cards(h.root)[0]).toContain('Call a helicopter');

  const h2 = mount(youngTower(false));
  h2.notify();
  const long = oldTower();
  const office = place(long, 'office', 4, 100);
  EVENT_TEST_HOOKS.target.fire = office.id;
  startFire(long);
  h2.swap(long);
  const after = cards(h2.root);
  expect(after).toHaveLength(1);
  expect(after[0]).toContain('Fire on floor 4');
  expect(after[0]).toContain('Call a helicopter');
});

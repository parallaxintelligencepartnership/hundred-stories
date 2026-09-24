// The alert stack on a fake DOM with a real world: a fire that spreads across five rooms is one
// card that counts them, carries the player's response and closes; Escape closes the newest
// card; the stack shows three cards and folds the rest; the log keeps one line per room.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_TEST_HOOKS, handleEventCommand, resetEventTestHooks, tickEvents } from '../../src/sim/events';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import type { Command, CommandResult, LogEntry, Room, RoomKind, Star, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import { SECURITY_LESSON, SECURITY_RESPONDING, fireHeadline, fireOutText } from '../../src/ui/alerts';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage.setItem('hs.intro.seen', 'true');
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0 };
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
  vi.useRealTimers();
});

const ROLL_MINUTE = 6 * 60;

function place(world: World, kind: RoomKind, floor: number, x: number): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 1,
    tenants: [],
    occupancy: 0,
    builtAtMinute: world.time.minute,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
  };
  addRoom(world, room);
  return room;
}

interface Harness {
  world: World;
  root: FakeElement;
  applied: Command[];
  /** Run the event tick at a minute and let the ui hear it, as a tick batch would. */
  at(minute: number): void;
  notify(): void;
}

/** A real world behind just enough GameApi; apply runs the sim's own event command. */
function mount(world: World): Harness {
  const subscribers = new Set<() => void>();
  const applied: Command[] = [];
  const notify = (): void => subscribers.forEach((cb) => cb());
  const api = {
    world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    apply(cmd: Command): CommandResult {
      applied.push(cmd);
      if (cmd.kind === 'fire.callHelicopter' || cmd.kind === 'bomb.pay') return handleEventCommand(world, cmd);
      return { ok: false, reason: 'Not in this test.' };
    },
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
  } as never;
  const root = dom.createElement('div');
  createUi(root as never, api, {} as never);
  return {
    world,
    root,
    applied,
    notify,
    at(minute: number) {
      world.time.minute = minute;
      tickEvents(world);
      notify();
    },
  };
}

const has = (node: FakeElement, cls: string): boolean => node.className.split(/\s+/).includes(cls);
const toastsOf = (root: FakeElement): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-toast') && !has(n, 'is-tip'));
const shown = (root: FakeElement): FakeElement[] => toastsOf(root).filter((n) => !has(n, 'is-collapsed'));
const fireCards = (root: FakeElement): FakeElement[] => toastsOf(root).filter((n) => has(n, 'is-fire'));
const closeOf = (card: FakeElement): FakeElement => {
  const node = card.descendants().find((n) => has(n, 'hs-toast-close'));
  if (!node) throw new Error('no close control');
  return node;
};
const helicopterOf = (card: FakeElement): FakeElement | undefined =>
  card.descendants().find((n) => n.tagName === 'BUTTON' && n.dataset['command'] === 'fire.callHelicopter');
const click = (node: FakeElement): void => {
  for (const fn of node.listeners.get('click') ?? []) fn({});
};
const press = (key: string): void => {
  dom.fireWindow('keydown', {
    key,
    code: '',
    target: { tagName: 'BODY' },
    defaultPrevented: false,
    preventDefault() {},
    stopImmediatePropagation() {},
  });
};

/** Five offices side by side on floor 2; the fire starts in the first and walks the row. */
function fiveRoomRow(withSecurity: boolean): { world: World; rooms: Room[] } {
  const world = createWorld(4242);
  world.stars = EVENTS.fire.minStar as Star;
  place(world, 'lobby', 1, 100);
  const width = ROOMS.office.width;
  const rooms = [0, 1, 2, 3, 4].map((i) => place(world, 'office', 2, 100 + i * width));
  if (withSecurity) place(world, 'security', 1, 200);
  EVENT_TEST_HOOKS.chance.fire = 1;
  EVENT_TEST_HOOKS.target.fire = rooms[0]!.id;
  return { world, rooms };
}

const roomLines = (world: World): LogEntry[] =>
  world.log.filter((e) => e.text.startsWith('Fire broke out in the ') || e.text.startsWith('The fire spread to the '));

describe('the fire incident card', () => {
  it('is one card for a fire that spreads across five rooms, and its count follows the fire', () => {
    const { world } = fiveRoomRow(false);
    const h = mount(world);
    h.at(ROLL_MINUTE);
    expect(fireCards(h.root)).toHaveLength(1);
    expect(fireCards(h.root)[0]!.textContent).toContain('Fire on floor 2');
    for (let step = 1; step <= 4; step += 1) h.at(ROLL_MINUTE + step * EVENTS.fire.spreadMinutes);
    expect(world.events.find((e) => e.kind === 'fire')?.roomIds).toHaveLength(5);
    expect(toastsOf(h.root)).toHaveLength(1);
    expect(fireCards(h.root)[0]!.textContent).toContain('Fire on floor 2, 5 rooms burning');
    // The log is the sim's, untouched: one line per room.
    expect(roomLines(world)).toHaveLength(5);
  });

  it('without a security office offers the helicopter at its price, teaches the fix, and the button calls it', () => {
    vi.useFakeTimers();
    const { world } = fiveRoomRow(false);
    const h = mount(world);
    h.at(ROLL_MINUTE);
    h.at(ROLL_MINUTE + EVENTS.fire.spreadMinutes);
    const card = fireCards(h.root)[0]!;
    expect(card.textContent).toContain(SECURITY_LESSON);
    expect(card.textContent).not.toContain(SECURITY_RESPONDING);
    const call = helicopterOf(card);
    expect(call?.textContent).toBe('Call a helicopter ($250,000)');
    expect(call?.disabled).toBe(false);
    click(call!);
    expect(h.applied).toEqual([{ kind: 'fire.callHelicopter' }]);
    expect(world.events.some((e) => e.kind === 'fire')).toBe(false);
    // The same card closes the incident, then goes by itself after eight seconds.
    expect(fireCards(h.root)).toHaveLength(1);
    expect(card.textContent).toContain(fireOutText(2));
    expect(helicopterOf(card)).toBeUndefined();
    vi.advanceTimersByTime(7999);
    expect(fireCards(h.root)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fireCards(h.root)).toHaveLength(0);
  });

  it('with a security office says security is responding, and still offers the helicopter', () => {
    const { world } = fiveRoomRow(true);
    const h = mount(world);
    h.at(ROLL_MINUTE);
    const card = fireCards(h.root)[0]!;
    expect(card.textContent).toContain(SECURITY_RESPONDING);
    expect(card.textContent).not.toContain(SECURITY_LESSON);
    expect(helicopterOf(card)).toBeDefined();
    h.at(ROLL_MINUTE + EVENTS.fire.securityPutOutMinutes);
    expect(card.textContent).toContain(fireOutText(1));
  });

  it('greys the helicopter out with the reason when cash is short', () => {
    const { world } = fiveRoomRow(false);
    world.cash = EVENTS.fire.helicopterCost - 1;
    const h = mount(world);
    h.at(ROLL_MINUTE);
    const card = fireCards(h.root)[0]!;
    expect(helicopterOf(card)?.disabled).toBe(true);
    expect(card.textContent).toContain('Not enough cash. A firefighting helicopter costs $250,000.');
  });

  it('closes on its close control, and the fire and the log go on without it', () => {
    const { world } = fiveRoomRow(false);
    const h = mount(world);
    h.at(ROLL_MINUTE);
    click(closeOf(fireCards(h.root)[0]!));
    expect(fireCards(h.root)).toHaveLength(0);
    for (let step = 1; step <= 4; step += 1) h.at(ROLL_MINUTE + step * EVENTS.fire.spreadMinutes);
    expect(fireCards(h.root)).toHaveLength(0);
    expect(world.events.find((e) => e.kind === 'fire')?.roomIds).toHaveLength(5);
    expect(roomLines(world)).toHaveLength(5);
  });

  it('closes on Escape, the newest card first', () => {
    const { world } = fiveRoomRow(false);
    const h = mount(world);
    h.at(ROLL_MINUTE);
    log(world, 'The VIP checked out and rated the tower good.', 'alert');
    h.notify();
    expect(shown(h.root)).toHaveLength(2);
    press('Escape');
    expect(toastsOf(h.root).map((n) => n.textContent)).toEqual([expect.stringContaining('Fire on floor 2')]);
    press('Escape');
    expect(toastsOf(h.root)).toHaveLength(0);
  });

  it('names a fire that spans floors', () => {
    expect(fireHeadline([12], 1)).toBe('Fire on floor 12');
    expect(fireHeadline([12, 13, 14], 3)).toBe('Fire on floors 12 to 14, 3 rooms burning');
    expect(fireOutText(3)).toBe('Fire out, 3 rooms damaged');
  });
});

describe('the alert stack', () => {
  it('shows three cards and folds the rest into one line', () => {
    const world = createWorld(7);
    const h = mount(world);
    for (let i = 1; i <= 5; i += 1) log(world, `Alert number ${i}.`, 'alert');
    h.notify();
    expect(toastsOf(h.root)).toHaveLength(5);
    expect(shown(h.root).map((n) => n.textContent)).toEqual(['×Alert number 3.', '×Alert number 4.', '×Alert number 5.']);
    const more = h.root.descendants().filter((n) => has(n, 'hs-toast-more'));
    expect(more).toHaveLength(1);
    expect(more[0]!.textContent).toBe('and 2 more');
    press('Escape');
    expect(h.root.descendants().find((n) => has(n, 'hs-toast-more'))?.textContent).toBe('and 1 more');
    press('Escape');
    expect(h.root.descendants().some((n) => has(n, 'hs-toast-more'))).toBe(false);
    expect(shown(h.root)).toHaveLength(3);
  });

  it('keeps alerts to the top quarter of a phone screen', () => {
    const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');
    const phone = css.slice(css.lastIndexOf('@media (max-width: 720px) {'));
    const rule = /\n {2}\.hs-toasts \{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(rule).toContain('bottom: auto;');
    expect(rule).toContain('max-height: 25vh;');
    expect(rule).toContain('overflow-y: auto;');
  });
});

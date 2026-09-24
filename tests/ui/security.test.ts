// The theft card and the security office panel, on a fake DOM with a real world. The card says
// whether a guard is on the way, then how it ended, and goes; the office panel lists its guards
// with where each one is and the floors their patrol covers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_TEST_HOOKS, resetEventTestHooks, startTheft } from '../../src/sim/events';
import { personName } from '../../src/sim/identity';
import { tick } from '../../src/sim/tick';
import type { ActiveEvent, Command, CommandResult, Room, World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';
import { ALERT_LINGER_MS, theftHeadline, theftLineOf } from '../../src/ui/alerts';
import { createQueryPanel, type PanelContext } from '../../src/ui/panels';
import { createUi } from '../../src/ui/ui';
import { atOnDay, buildRow, buildTower, lobbyRun, onlyShaft, roomsMatching } from '../scenarios/helpers';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage.setItem('hs.intro.seen', 'true');
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 0, theft: 0 };
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
  vi.useRealTimers();
});

type Theft = Extract<ActiveEvent, { kind: 'theft' }>;
const theftOf = (world: World): Theft | undefined => world.events.find((e): e is Theft => e.kind === 'theft');

/** A lobby, one shaft to floor 6, an office per floor for support, a shop on 5, security on 3 (or none). */
function tower(withSecurity: boolean): World {
  const world = createWorld(11);
  world.stars = 3;
  world.cash = 500_000_000;
  const script: Command[] = [...lobbyRun(90, 200), { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 6 }];
  for (let f = 2; f <= 6; f++) script.push(...buildRow('office', f, [100]));
  script.push({ kind: 'build', room: 'shop', floor: 5, x: 160 });
  if (withSecurity) script.push({ kind: 'build', room: 'security', floor: 3, x: 160 });
  buildTower(world, script);
  buildTower(world, [{ kind: 'shaft.addCar', shaftId: onlyShaft(world).id }]);
  return world;
}

function mount(world: World): { root: FakeElement; notify(): void } {
  const subscribers = new Set<() => void>();
  const notify = (): void => subscribers.forEach((cb) => cb());
  const api = {
    world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    apply: (): CommandResult => ({ ok: false, reason: 'Not in this test.' }),
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
  return { root, notify };
}

const has = (node: FakeElement, cls: string): boolean => node.className.split(/\s+/).includes(cls);
const theftCards = (root: FakeElement): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-toast') && has(n, 'is-theft'));
const cardText = (card: FakeElement): string =>
  card.descendants().filter((n) => has(n, 'hs-toast-text')).map((n) => n.textContent).join(' ');

/** Tick one minute at a time, letting the ui hear each, until `done` holds. */
function runUntil(world: World, notify: () => void, done: () => boolean): void {
  for (let i = 0; i < 1440 && !done(); i++) {
    tick(world);
    notify();
  }
  if (!done()) throw new Error('never got there');
}

describe('the theft card', () => {
  it('shows nothing while the thief is only a visitor, then a guard on the way, then the catch, then goes', () => {
    vi.useFakeTimers();
    const world = tower(true);
    const h = mount(world);
    atOnDay(world, 1, 6, 1);
    startTheft(world, 11 * 60);
    runUntil(world, h.notify, () => theftOf(world)?.phase === 'approach');
    expect(theftCards(h.root)).toHaveLength(0);
    runUntil(world, h.notify, () => theftOf(world)?.phase === 'acting');
    expect(theftCards(h.root)).toHaveLength(1);
    const card = theftCards(h.root)[0]!;
    expect(cardText(card)).toBe('Theft on floor 5, a guard is on the way');
    runUntil(world, h.notify, () => theftOf(world) === undefined);
    expect(cardText(card)).toBe('Thief caught on floor 5');
    vi.advanceTimersByTime(ALERT_LINGER_MS);
    expect(theftCards(h.root)).toHaveLength(0);
  });

  it('says when no guard can reach it, then the loss', () => {
    const world = tower(false);
    const h = mount(world);
    atOnDay(world, 1, 6, 1);
    startTheft(world, 11 * 60);
    runUntil(world, h.notify, () => theftOf(world)?.phase === 'acting');
    const card = theftCards(h.root)[0]!;
    expect(cardText(card)).toBe('Theft on floor 5, no guard can reach it');
    runUntil(world, h.notify, () => theftOf(world) === undefined);
    expect(cardText(card)).toBe('Thief escaped, $2,000 lost');
  });

  it('reads only theft lines, and heads a card for a theft under way in a loaded save', () => {
    const line = (text: string) => ({ minute: 0, text, level: 'alert' as const });
    expect(theftLineOf(line('Theft on floor 7, a guard is on the way. Leah Novak is heading to the shop.'))).toEqual({
      kind: 'start',
      headline: 'Theft on floor 7, a guard is on the way',
    });
    expect(theftLineOf(line('Thief escaped, $2,000 lost. The thief got away from the shop on floor 7.'))?.headline).toBe('Thief escaped, $2,000 lost');
    expect(theftLineOf(line('Fire broke out in the shop on floor 7. Call a helicopter or wait for security.'))).toBeNull();
    expect(theftLineOf(line('A caller planted a bomb in the shop on floor 7.'))).toBeNull();
    expect(theftLineOf({ ...line('Theft on floor 7, a guard is on the way.'), level: 'info' })).toBeNull();
    expect(theftHeadline(7, true)).toBe('Theft on floor 7, a guard is on the way');
    expect(theftHeadline(-2, false)).toBe('Theft on floor B2, no guard can reach it');
  });
});

describe('the security office panel', () => {
  function context(): PanelContext {
    return { apply: () => ({ ok: true }), notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} };
  }

  it('lists its guards by name with where each one is, and the floors the patrol covers', () => {
    const world = tower(true);
    const office = roomsMatching(world, 'security')[0] as Room;
    atOnDay(world, 1, 7, 0);
    const panel = createQueryPanel({ world } as never, { roomId: office.id }, context()) as unknown as FakeElement;
    const titles = panel.descendants().filter((n) => n.className === 'hs-section-title').map((n) => n.textContent);
    expect(titles).toContain('Guards');
    expect(panel.textContent).toContain('Patrol covers');
    expect(panel.textContent).toContain('Floors 1 to 5');
    const items = panel.descendants().filter((n) => n.className === 'hs-occupant');
    expect(items).toHaveLength(6);
    const lines = items.map((n) => n.textContent);
    for (const id of office.tenants) expect(lines.some((l) => l.startsWith(personName(world.seed, id)))).toBe(true);
    // Morning: the day shift is out on the floors, the night shift is off.
    expect(lines.filter((l) => l.endsWith('Off shift'))).toHaveLength(3);
    expect(lines.filter((l) => /Patrolling floor \d$/.test(l))).toHaveLength(3);
  });
});

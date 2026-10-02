// Stories as the one way in (Matt, 2026-10-01): on the real ui with a real world, a closed or
// folded fire or bomb card leaves a reminder chip that opens Stories at it; Stories carries the
// helicopter and the ransom, so a closed card no longer takes the player's only response; every
// toast, the "and N more" line and the chip open the pause menu on the Stories page with the game
// paused; first focus is never a button that spends; Show on the tower leaves the menu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_TEST_HOOKS, handleEventCommand, resetEventTestHooks, startBomb, tickEvents } from '../../src/sim/events';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import type { Command, CommandResult, Room, RoomKind, Star, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 800;
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
  const room: Room = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [], occupancy: 0,
    builtAtMinute: world.time.minute, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (node: FakeElement | undefined): void => {
  if (!node) throw new Error('nothing to click');
  (node.listeners.get('click') ?? []).forEach((f) => f({ target: node, preventDefault() {}, stopPropagation() {} }));
};

/** A real world behind just enough GameApi, with a speed the menu can hold; apply runs the sim's event commands. */
function mount(world: World, speed = 2) {
  const state = { speed };
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
    getSpeed: () => state.speed,
    setSpeed(next: number) {
      state.speed = next;
      notify();
    },
    togglePause: () => {},
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select: () => {},
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    getDaily: () => null,
    getDailyChoice: () => null,
    save: async (): Promise<CommandResult> => ({ ok: true }),
  } as never;
  const root = dom.createElement('div');
  createUi(root as never, api, {} as never);
  const find = (pick: (n: FakeElement) => boolean): FakeElement | undefined => root.descendants().find(pick);
  const card = (): FakeElement | undefined => find((n) => has(n, 'hs-pause-card'));
  const page = (): string | null => card()?.getAttribute('data-page') ?? null;
  const toasts = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-toast'));
  return {
    world,
    root,
    state,
    applied,
    notify,
    at(minute: number) {
      world.time.minute = minute;
      tickEvents(world);
      notify();
    },
    card,
    page,
    paused: () => card()?.descendants().find((n) => has(n, 'hs-pause-state'))?.textContent === 'Paused',
    back: () => card()?.descendants().find((n) => n.getAttribute('aria-label') === 'Back'),
    menu: () => find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu'),
    fireCards: () => toasts().filter((n) => has(n, 'is-fire')),
    bombCards: () => toasts().filter((n) => has(n, 'is-bomb')),
    chip: (kind: string) => find((n) => has(n, 'hs-toast-chip') && n.dataset['incident'] === kind),
    more: () => find((n) => has(n, 'hs-toast-more')),
    inPage: (pick: (n: FakeElement) => boolean) => card()?.descendants().find((n) => n.tagName === 'BUTTON' && pick(n)),
    closeOf: (node: FakeElement) => node.descendants().find((n) => has(n, 'hs-toast-close')),
  };
}

const helicopter = (b: FakeElement): boolean => b.dataset['command'] === 'fire.callHelicopter';
const ransom = (b: FakeElement): boolean => b.dataset['command'] === 'bomb.pay';
const focused = (): FakeElement | null => dom.activeElement;

function fireTower(): World {
  const world = createWorld(4242);
  world.stars = EVENTS.fire.minStar as Star;
  place(world, 'lobby', 1, 100);
  const office = place(world, 'office', 2, 100);
  EVENT_TEST_HOOKS.chance.fire = 1;
  EVENT_TEST_HOOKS.target.fire = office.id;
  return world;
}

function bombTower(): World {
  const world = createWorld(4242);
  world.stars = EVENTS.bomb.minStar as Star;
  place(world, 'lobby', 1, 100);
  const office = place(world, 'office', 3, 100);
  EVENT_TEST_HOOKS.target.bomb = office.id;
  world.time.minute = ROLL_MINUTE;
  return world;
}

describe('a closed fire or bomb card', () => {
  it('fire: the card closes for good, a chip stays, and Stories from the menu calls the helicopter and the fire ends', () => {
    const h = mount(fireTower());
    h.at(ROLL_MINUTE);
    click(h.closeOf(h.fireCards()[0]!));
    h.notify();
    expect(h.fireCards()).toHaveLength(0);
    expect(h.chip('fire')?.textContent).toBe('Fire on floor 2');
    // A quiet screen: the menu, then its Stories entry.
    click(h.menu());
    choosePauseEntry(h.root, 'stories');
    expect(h.page()).toBe('stories');
    expect(h.paused()).toBe(true);
    // Opened with no target, focus waits on Back, never on the button that spends.
    expect(focused()).toBe(h.back());
    const call = h.inPage(helicopter)!;
    expect(call.textContent).toBe('Call a helicopter ($270,000)');
    click(call);
    expect(h.applied).toEqual([{ kind: 'fire.callHelicopter' }]);
    expect(h.world.events.some((e) => e.kind === 'fire')).toBe(false);
    h.notify();
    // The fire is over: the chip goes, and the card it stood for never comes back.
    expect(h.chip('fire')).toBeUndefined();
    expect(h.fireCards()).toHaveLength(0);
    expect(h.card()!.textContent).toContain('Nothing needs you right now.');
  });

  it('bomb: the card closes for good, a chip stays, and Stories pays the ransom and the threat ends', () => {
    const h = mount(bombTower());
    startBomb(h.world);
    h.notify();
    click(h.closeOf(h.bombCards()[0]!));
    h.notify();
    expect(h.bombCards()).toHaveLength(0);
    expect(h.chip('bomb')?.textContent).toBe('Bomb threat on floor 3');
    click(h.menu());
    choosePauseEntry(h.root, 'stories');
    expect(focused()).toBe(h.back());
    const pay = h.inPage(ransom)!;
    expect(pay.textContent).toBe(`Pay ransom ($${EVENTS.bomb.ransom.toLocaleString('en-US')})`);
    click(pay);
    expect(h.world.events.some((e) => e.kind === 'bomb')).toBe(false);
    h.notify();
    expect(h.chip('bomb')).toBeUndefined();
    expect(h.bombCards()).toHaveLength(0);
  });

  it('with too little cash both buttons in Stories are off and say why', () => {
    const world = bombTower();
    world.cash = 1000;
    EVENT_TEST_HOOKS.chance.fire = 1;
    EVENT_TEST_HOOKS.target.fire = [...world.rooms.values()].find((r) => r.kind === 'office')!.id;
    const h = mount(world);
    h.at(ROLL_MINUTE);
    startBomb(world);
    h.notify();
    click(h.menu());
    choosePauseEntry(h.root, 'stories');
    expect(h.inPage(helicopter)?.disabled).toBe(true);
    expect(h.inPage(ransom)?.disabled).toBe(true);
    const text = h.card()!.textContent;
    expect(text).toContain('Not enough cash. A firefighting helicopter costs $270,000.');
    expect(text).toContain(`Not enough cash. The ransom is $${EVENTS.bomb.ransom.toLocaleString('en-US')}.`);
    // The cash comes in while Stories is open: the buttons come on there and then.
    world.cash = 10_000_000;
    h.notify();
    expect(h.inPage(helicopter)?.disabled).toBe(false);
    expect(h.inPage(ransom)?.disabled).toBe(false);
  });
});

describe('the fold and the chip', () => {
  it('three newer alerts fold the fire card; the chip appears and opens Stories at the fire, paused, focus on Show on the tower', () => {
    const h = mount(fireTower());
    h.at(ROLL_MINUTE);
    expect(h.chip('fire')).toBeUndefined();
    for (let i = 1; i <= 3; i += 1) log(h.world, `Alert number ${i}.`, 'alert');
    h.notify();
    expect(has(h.fireCards()[0]!, 'is-collapsed')).toBe(true);
    const chip = h.chip('fire')!;
    expect(chip.tagName).toBe('BUTTON');
    // The fire icon in the alert red, no stripe.
    const glyph = chip.descendants().find((n) => (n.getAttribute('class') ?? '').includes('hs-toast-icon'));
    expect(glyph?.getAttribute('class')).toContain('is-alert');
    expect(glyph?.children[0]?.getAttribute('href')).toBe('#hs-icon-fire');
    click(chip);
    expect(h.page()).toBe('stories');
    expect(h.state.speed).toBe(0);
    expect(h.paused()).toBe(true);
    expect(focused()?.textContent).toBe('Show on the tower');
    expect(focused()?.dataset['spend']).not.toBe('true');
    // Show on the tower leaves the menu, the speed given back.
    click(focused()!);
    expect(h.card()).toBeUndefined();
    expect(h.state.speed).toBe(2);
  });

  it('"and N more" is a button that opens Stories', () => {
    const h = mount(createWorld(7));
    for (let i = 1; i <= 5; i += 1) log(h.world, `Alert number ${i}.`, 'alert');
    h.notify();
    const more = h.more()!;
    expect(more.tagName).toBe('BUTTON');
    expect(more.textContent).toBe('and 2 more');
    click(more);
    expect(h.page()).toBe('stories');
    expect(h.paused()).toBe(true);
    // Back goes to the menu's root, Stories selected, and Resume gives the speed back.
    click(h.back());
    expect(h.page()).toBeNull();
    const selected = h.root.descendants().find((n) => has(n, 'hs-pause-item') && has(n, 'is-selected'));
    expect(selected?.dataset['entry']).toBe('stories');
    choosePauseEntry(h.root, 'resume');
    expect(h.card()).toBeUndefined();
    expect(h.state.speed).toBe(2);
  });
});

describe('a news toast opens Stories', () => {
  const wedding = (world: World): void => log(world, 'A wedding has started in the cathedral on floor 1.', 'info', { notable: true });
  const newsToast = (root: FakeElement): FakeElement | undefined => root.descendants().find((n) => has(n, 'hs-news-toast'));

  it('with the menu closed: the menu opens on Stories and the game pauses', () => {
    const h = mount(createWorld(7));
    wedding(h.world);
    h.notify();
    const toast = newsToast(h.root)!;
    expect(toast.title).toBe('Open Stories');
    click(toast);
    expect(h.page()).toBe('stories');
    expect(h.state.speed).toBe(0);
    expect(h.paused()).toBe(true);
    expect(focused()?.dataset['spend']).not.toBe('true');
  });

  it('with the menu open on Settings: Stories goes over it, still paused, and Back goes to Settings', () => {
    const h = mount(createWorld(7));
    click(h.menu());
    choosePauseEntry(h.root, 'settings');
    expect(h.page()).toBe('settings');
    wedding(h.world);
    h.notify();
    click(newsToast(h.root));
    expect(h.page()).toBe('stories');
    expect(h.state.speed).toBe(0);
    click(h.back());
    expect(h.page()).toBe('settings');
  });

  it('no element or string on the way says News', () => {
    const h = mount(createWorld(7));
    wedding(h.world);
    h.notify();
    click(newsToast(h.root));
    const words = (n: FakeElement): string[] => [n.children.length === 0 ? n.textContent : '', n.title, n.getAttribute('aria-label') ?? ''];
    const said = [h.root, ...h.root.descendants()].flatMap(words).filter((w) => /\bnews\b/i.test(w));
    expect(said).toEqual([]);
  });
});

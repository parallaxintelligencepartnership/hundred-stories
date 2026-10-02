// The VIP visit's own cards (P3c), on a fake DOM with real worlds ticked through a real visit:
// the booking card in the news look (amber, polite, not the assertive alert role) with the guest,
// when they arrive in plain words, the suite and a way to the checklist; the arrival card with See
// the guest and See the suite; the result card with the rating as its headline, the reasons, what
// it means for the fourth star and the next chance, red only when the visit went badly; the result
// kept in Stories after the card is closed and after a save round trip. Also the reminder chip
// fixes from the Stories review: made once (A4), no blink when notices fold the card (A12), and
// gone with the spend buttons off in a finished Today's tower (A5).
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DAILY_OVER_REASON } from '../../src/game/game';
import { EVENT_TEST_HOOKS, handleEventCommand, resetEventTestHooks, tickEvents } from '../../src/sim/events';
import { personName } from '../../src/sim/identity';
import { EVENTS, ROOMS } from '../../src/sim/rules';
import { deserialize, serialize } from '../../src/sim/save';
import type { ActiveEvent, Command, CommandResult, LogEntry, Room, RoomKind, Star, VipVisitRecord, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld, log } from '../../src/sim/world';
import { createAlertStack, type AlertStack } from '../../src/ui/alerts';
import type { PanelContext } from '../../src/ui/panels';
import { storiesBody } from '../../src/ui/stories';
import { createUi } from '../../src/ui/ui';
import { vipBreakdown } from '../../src/ui/vip';
import { VIP_BOOKED_HEADLINE, VIP_HERE_HEADLINE, VIP_OPEN_STORIES, VIP_SEE_CHECKLIST, VIP_SEE_GUEST, VIP_SEE_SUITE } from '../../src/ui/vip-cards';
import { buildTower, lobbyRun, runMinutes } from '../scenarios/helpers';
import { FakeDom, type FakeElement } from './fake-dom';

type Visit = Extract<ActiveEvent, { kind: 'vip' }>;

let dom: FakeDom;
let uninstall: () => void;
/** Every element made since the test began, to count chips made and gone. */
let made: FakeElement[];
beforeEach(() => {
  dom = new FakeDom();
  made = [];
  const create = dom.createElement.bind(dom);
  dom.createElement = (tag: string): FakeElement => {
    const node = create(tag);
    made.push(node);
    return node;
  };
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 800;
  resetEventTestHooks();
  EVENT_TEST_HOOKS.chance = { fire: 0, bomb: 0, vip: 1 };
});
afterEach(() => {
  uninstall();
  resetEventTestHooks();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (node: FakeElement | undefined): void => {
  if (!node) throw new Error('nothing to click');
  (node.listeners.get('click') ?? []).forEach((f) => f({ target: node, preventDefault() {}, stopPropagation() {} }));
};
const buttonIn = (node: FakeElement | undefined, label: string): FakeElement | undefined =>
  node?.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === label);
const textsIn = (node: FakeElement, cls: string): string[] => node.descendants().filter((n) => has(n, cls)).map((n) => n.textContent);
const iconOf = (card: FakeElement): string => card.children[0]?.getAttribute('class') ?? '';
const reasonsOf = (node: FakeElement): { label: string; value: string }[] =>
  node.descendants().filter((n) => has(n, 'hs-vip-reason')).map((n) => ({ label: n.children[0]!.textContent, value: n.children[1]!.textContent }));

/** A tower with a suite on floor 3 the lobby reaches, booked at the 6 AM roll: the VIP comes tomorrow at 3 PM. */
function bookedTower(): World {
  const world = createWorld(11);
  world.stars = EVENTS.vip.minStar;
  world.cash = 100_000_000;
  buildTower(world, [
    ...lobbyRun(90, 170),
    { kind: 'shaft.build', shaft: 'standard', x: 150, floorMin: 1, floorMax: 4 },
    { kind: 'build', room: 'office', floor: 2, x: 100 },
    { kind: 'build', room: 'hotelSuite', floor: 3, x: 152 },
  ]);
  // 6:00 AM on the first day: the next minute's roll books the visit.
  expect(world.time.minute).toBe(6 * 60);
  return world;
}

const visitOf = (world: World): Visit | undefined => world.events.find((e): e is Visit => e.kind === 'vip');

/** The real ui over a real world, with the GameApi parts it reads. */
function mount(world: World, extra: Record<string, unknown> = {}) {
  const subscribers = new Set<() => void>();
  const selected: unknown[] = [];
  const applied: Command[] = [];
  const state = { speed: 1 };
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
    select: (sel: unknown) => selected.push(sel),
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => 'mine',
    getDaily: () => null,
    getDailyChoice: () => null,
    save: async (): Promise<CommandResult> => ({ ok: true }),
    ...extra,
  } as never;
  const root = dom.createElement('div');
  createUi(root as never, api, {} as never);
  const find = (pick: (n: FakeElement) => boolean): FakeElement | undefined => root.descendants().find(pick);
  const cards = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-toast') && !has(n, 'is-tip'));
  return {
    world,
    root,
    selected,
    applied,
    notify,
    /** Tick the sim a minute at a time, letting the ui hear each, until `done`. */
    runUntil(done: () => boolean, limit = 3 * 1440): void {
      for (let i = 0; i < limit && !done(); i++) {
        runMinutes(world, 1);
        notify();
      }
      if (!done()) throw new Error('never happened');
    },
    vipCards: () => cards().filter((n) => has(n, 'is-vip')),
    fireCards: () => cards().filter((n) => has(n, 'is-fire')),
    page: () => find((n) => has(n, 'hs-pause-card'))?.getAttribute('data-page') ?? null,
    pageCard: () => find((n) => has(n, 'hs-pause-card')),
    newsToasts: () => root.descendants().filter((n) => has(n, 'hs-news-toast')).map((n) => n.textContent),
    chip: (kind: string) => find((n) => has(n, 'hs-toast-chip') && n.dataset['incident'] === kind),
    closeOf: (node: FakeElement) => node.descendants().find((n) => has(n, 'hs-toast-close')),
  };
}

/** The cards say no day numbers and never call the preference what the rating comes from. */
function plainWords(text: string): void {
  expect(text).not.toMatch(/weekday|weekend|quarter \d|year \d|day \d/i);
  expect(text).not.toMatch(/cares? most about/i);
  expect(text).not.toMatch(/[–—]/);
}

describe('the booking card', () => {
  it('names the guest with a portrait, says when they arrive in plain words and the suite floor, in the news look, polite, until closed', () => {
    const h = mount(bookedTower());
    h.runUntil(() => visitOf(h.world) !== undefined);
    const visit = visitOf(h.world)!;
    const [card, ...others] = h.vipCards();
    expect(others).toHaveLength(0);
    expect(has(card!, 'is-vip-booked')).toBe(true);
    // Amber, not the red trouble icon, and no stripe class.
    expect(iconOf(card!)).toContain('is-amber');
    expect(iconOf(card!)).not.toContain('is-alert');
    // Not an emergency: a polite status of its own, not the assertive alert role.
    expect(card!.getAttribute('role')).toBe('status');
    expect(card!.getAttribute('aria-live')).toBe('polite');
    const name = personName(h.world.seed, visit.simId);
    expect(card!.descendants().find((n) => n.tagName === 'CANVAS')?.getAttribute('aria-label')).toBe(`Portrait of ${name}`);
    expect(textsIn(card!, 'hs-toast-text')).toEqual([VIP_BOOKED_HEADLINE]);
    expect(textsIn(card!, 'hs-vip-name')).toEqual([`${name}, VIP guest`]);
    expect(textsIn(card!, 'hs-vip-line')).toEqual(['Arrives tomorrow afternoon at 3:00 PM.', 'Suite on floor 3.']);
    plainWords(card!.textContent);
    // It stays: a day on, the words still true, and the same card.
    h.runUntil(() => h.world.time.minute >= 1440 + 60);
    expect(h.vipCards()).toEqual([card]);
    expect(textsIn(card!, 'hs-vip-line')[0]).toBe('Arrives this afternoon at 3:00 PM.');
    // One action: Stories at the VIP section, where the live checklist is.
    click(buttonIn(card, VIP_SEE_CHECKLIST));
    expect(h.page()).toBe('stories');
    const section = h.pageCard()!.descendants().find((n) => has(n, 'hs-vip'))!;
    expect(section.textContent).toContain('A suite is ready for them');
    expect(section.textContent).toContain(`Likes: ${visit.preference}`);
    expect(section.textContent).toContain('Every VIP rates the same three things: the longest elevator wait, the suite and safety.');
  });

  it('closes on its close control and does not come back', () => {
    const h = mount(bookedTower());
    h.runUntil(() => visitOf(h.world) !== undefined);
    click(h.closeOf(h.vipCards()[0]!));
    expect(h.vipCards()).toHaveLength(0);
    h.runUntil(() => h.world.time.minute >= 1440);
    expect(h.vipCards()).toHaveLength(0);
  });
});

describe('the arrival card', () => {
  it('names the guest when they walk into the lobby, in place of the booking card and of a toast; check in stays a toast', () => {
    const h = mount(bookedTower());
    h.runUntil(() => visitOf(h.world)?.phase === 'route');
    const visit = visitOf(h.world)!;
    const [card, ...others] = h.vipCards();
    expect(others).toHaveLength(0);
    expect(has(card!, 'is-vip-arrived')).toBe(true);
    expect(iconOf(card!)).toContain('is-amber');
    expect(card!.getAttribute('role')).toBe('status');
    expect(textsIn(card!, 'hs-toast-text')).toEqual([VIP_HERE_HEADLINE]);
    expect(textsIn(card!, 'hs-vip-name')).toEqual([`${personName(h.world.seed, visit.simId)}, VIP guest`]);
    expect(textsIn(card!, 'hs-vip-line')).toEqual(['Heading up to the suite on floor 3.']);
    expect(h.newsToasts().some((t) => t.includes('walked into the lobby'))).toBe(false);
    // See the guest selects the VIP, so the person card opens.
    click(buttonIn(card, VIP_SEE_GUEST));
    expect(h.selected).toEqual([{ simId: visit.simId }]);
    h.runUntil(() => visitOf(h.world)?.phase === 'stay');
    expect(h.newsToasts().some((t) => t.startsWith('The VIP checked into the'))).toBe(true);
  });

  it('See the suite centers the view on the suite', () => {
    const world = bookedTower();
    const centered: [number, number][] = [];
    const selected: number[] = [];
    const stack = directStack(world, { centerOn: (f, x) => centered.push([f, x]), selectGuest: (id) => selected.push(id) });
    runMinutes(world, 1);
    stack.drain();
    while (visitOf(world)?.phase !== 'route') {
      runMinutes(world, 1);
      stack.drain();
    }
    const card = stack.host.children.find((n) => has(n, 'is-vip-arrived'))!;
    click(buttonIn(card, VIP_SEE_SUITE));
    const suite = [...world.rooms.values()].find((r) => r.kind === 'hotelSuite')!;
    expect(centered).toEqual([[3, suite.x + Math.floor(suite.width / 2)]]);
    click(buttonIn(card, VIP_SEE_GUEST));
    expect(selected).toEqual([visitOf(world)!.simId]);
  });
});

describe('the result card', () => {
  it('after a real visit: the rating as headline, the reasons, the progress line and the next chance; Stories keeps it after a close and a reload', () => {
    const h = mount(bookedTower());
    h.runUntil(() => h.world.stats.lastVip !== undefined);
    const record = h.world.stats.lastVip!;
    expect(record.suiteFloor).toBe(3);
    const [card, ...others] = h.vipCards();
    expect(others).toHaveLength(0);
    expect(has(card!, 'is-vip-result')).toBe(true);
    const word = record.rating.charAt(0).toUpperCase() + record.rating.slice(1);
    expect(textsIn(card!, 'hs-vip-headline')).toEqual([word]);
    expect(record.rating).not.toBe('poor');
    expect(iconOf(card!)).toContain('is-amber');
    expect(card!.getAttribute('role')).toBe('status');
    expect(textsIn(card!, 'hs-vip-name')).toEqual([`${personName(h.world.seed, record.simId)}, VIP guest`]);
    expect(textsIn(card!, 'hs-vip-line')).toEqual(['Checked out.']);
    // The reasons, straight from the breakdown, without its Rating row.
    expect(reasonsOf(card!)).toEqual(vipBreakdown(record).filter((r) => r.label !== 'Rating'));
    expect(reasonsOf(card!).map((r) => r.label)).toEqual(['Longest wait', 'Suite', 'Safety']);
    expect(reasonsOf(card!)[1]!.value).toMatch(/^Floor 3, clean/);
    expect(textsIn(card!, 'hs-vip-progress')).toEqual([`A fair or better visit is needed for 4 stars. Your best so far is ${record.rating}, so that part is done.`]);
    expect(textsIn(card!, 'hs-vip-next')[0]).toMatch(/^A new VIP may book (today|tomorrow|in 2 days) at 6:00 AM\.$/);
    plainWords(card!.textContent);
    // Its one action opens Stories at the VIP section, which shows the same result.
    click(buttonIn(card, VIP_OPEN_STORIES));
    expect(h.page()).toBe('stories');
    // Closing it loses nothing: Stories still has it, and so does a reloaded tower.
    click(h.closeOf(card!));
    expect(h.vipCards()).toHaveLength(0);
    const ctx = { apply: () => ({ ok: true }), notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} } as unknown as PanelContext;
    const before = storiesBody({ world: h.world } as never, ctx).node as unknown as FakeElement;
    const result = before.descendants().find((n) => has(n, 'hs-vip-result'))!;
    expect(textsIn(result, 'hs-vip-headline')).toEqual([word]);
    expect(reasonsOf(result)).toEqual(reasonsOf(card!));
    const loaded = deserialize(serialize(h.world));
    if (!loaded.ok) throw new Error(loaded.reason);
    const after = storiesBody({ world: loaded.world } as never, ctx).node as unknown as FakeElement;
    const kept = after.descendants().find((n) => has(n, 'hs-vip-result'))!;
    expect(textsIn(kept, 'hs-vip-headline')).toEqual([word]);
    expect(reasonsOf(kept)).toEqual(reasonsOf(card!));
    expect(textsIn(kept, 'hs-vip-progress')).toEqual(textsIn(result, 'hs-vip-progress'));
  });

  it('when the guest leaves early: red, Poor, the reason as a row', () => {
    const h = mount(bookedTower());
    h.runUntil(() => visitOf(h.world) !== undefined);
    const suite = [...h.world.rooms.values()].find((r) => r.kind === 'hotelSuite')!;
    h.world.rooms.delete(suite.id);
    h.runUntil(() => h.world.stats.lastVip !== undefined);
    const [card] = h.vipCards();
    expect(has(card!, 'is-vip-result')).toBe(true);
    expect(iconOf(card!)).toContain('is-alert');
    expect(textsIn(card!, 'hs-vip-headline')).toEqual(['Poor']);
    expect(textsIn(card!, 'hs-vip-line')).toEqual(['Left early.']);
    expect(reasonsOf(card!)[0]).toEqual({ label: 'Left early', value: 'No suite was ready' });
    expect(reasonsOf(card!).find((r) => r.label === 'Suite')?.value).toBe('Never reached');
    expect(textsIn(card!, 'hs-vip-progress')).toEqual(['A fair or better visit is needed for 4 stars. Your best so far is poor.']);
    // Still a polite card: a visit is never the assertive alert.
    expect(card!.getAttribute('role')).toBe('status');
  });

  /** A finished visit as the sim saves it, its line logged, heard by the ui. */
  function rated(h: ReturnType<typeof mount>, record: Partial<VipVisitRecord>, best: World['stats']['vipRating'], stars: Star): FakeElement {
    h.world.stars = stars;
    h.world.stats.vipRating = best;
    const full: VipVisitRecord = {
      simId: 4242, minute: h.world.time.minute, rating: 'fair', preference: 'a quiet floor', longestWait: 5, waitBand: 'fair',
      suiteClean: true, suiteBand: 'good', incident: false, reason: null, suiteFloor: 9, suiteId: 1, ...record,
    };
    h.world.stats.lastVip = full;
    log(h.world, `The VIP checked out and rated the tower ${full.rating}.`, 'alert', { simId: full.simId });
    h.notify();
    return h.vipCards().at(-1)!;
  }

  it('a fair visit: amber, Fair, and the progress line says the part is done', () => {
    const h = mount(createWorld(5));
    const card = rated(h, { rating: 'fair' }, 'fair', 3);
    expect(iconOf(card)).toContain('is-amber');
    expect(textsIn(card, 'hs-vip-headline')).toEqual(['Fair']);
    expect(reasonsOf(card)).toEqual([
      { label: 'Longest wait', value: '5 minutes (fair)' },
      { label: 'Suite', value: 'Floor 9, clean (good)' },
      { label: 'Safety', value: 'No fire or bomb (good)' },
    ]);
    expect(textsIn(card, 'hs-vip-progress')).toEqual(['A fair or better visit is needed for 4 stars. Your best so far is fair, so that part is done.']);
  });

  it('a poor visit whose best so far is below fair: red, Poor, the reasons, and what is still needed', () => {
    const h = mount(createWorld(5));
    const card = rated(h, { rating: 'poor', longestWait: 12, waitBand: 'poor', incident: true }, 'poor', 3);
    expect(iconOf(card)).toContain('is-alert');
    expect(textsIn(card, 'hs-vip-headline')).toEqual(['Poor']);
    expect(reasonsOf(card)).toEqual([
      { label: 'Longest wait', value: '12 minutes (poor)' },
      { label: 'Suite', value: 'Floor 9, clean (good)' },
      { label: 'Safety', value: 'A fire or bomb (poor)' },
    ]);
    expect(textsIn(card, 'hs-vip-progress')).toEqual(['A fair or better visit is needed for 4 stars. Your best so far is poor.']);
  });

  it('a poor visit after a good one: the best so far still counts', () => {
    const h = mount(createWorld(5));
    const card = rated(h, { rating: 'poor', longestWait: 12, waitBand: 'poor' }, 'good', 3);
    expect(textsIn(card, 'hs-vip-progress')).toEqual(['A fair or better visit is needed for 4 stars. Your best so far is good, so that part is done.']);
  });

  it('in a tower that already has 4 stars: says the rating already counted', () => {
    const h = mount(createWorld(5));
    const card = rated(h, { rating: 'good', longestWait: 1, waitBand: 'good' }, 'good', 4);
    expect(textsIn(card, 'hs-vip-headline')).toEqual(['Good']);
    expect(textsIn(card, 'hs-vip-progress')).toEqual(['Your tower already has 4 stars, so the VIP rating already counted.']);
  });

  it('an old record without the suite fields renders, the suite simply not named', () => {
    const world = createWorld(5);
    world.stars = 3;
    world.stats.vipRating = 'good';
    world.stats.lastVip = {
      simId: 4242, minute: 0, rating: 'good', preference: 'quick elevators', longestWait: 2, waitBand: 'good',
      suiteClean: true, suiteBand: 'good', incident: false, reason: null,
    };
    const ctx = { apply: () => ({ ok: true }), notice: () => {}, close: () => {}, reducedMotion: false, setReducedMotion: () => {} } as unknown as PanelContext;
    const node = storiesBody({ world } as never, ctx).node as unknown as FakeElement;
    const result = node.descendants().find((n) => has(n, 'hs-vip-result'))!;
    expect(textsIn(result, 'hs-vip-headline')).toEqual(['Good']);
    expect(reasonsOf(result).find((r) => r.label === 'Suite')?.value).toBe('Clean (good)');
    expect(result.textContent).not.toMatch(/floor/i);
  });
});

describe('the words', () => {
  it('no player string says "cares most about"', () => {
    for (const file of ['../../src/ui/vip.ts', '../../src/ui/vip-cards.ts', '../../src/ui/stories-vip.ts', '../../src/sim/events.ts', '../../how-to-play/index.html']) {
      expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/cares? most about/i);
    }
    const world = bookedTower();
    runMinutes(world, 1);
    expect(world.log.at(-1)?.text).toMatch(/They like (quick elevators|a clean suite|a quiet floor)\. Every VIP rates the wait, the suite and safety\.$/);
  });
});

// ------------------------------------------------------------------ the chips

function place(world: World, kind: RoomKind, floor: number, x: number): Room {
  const room: Room = {
    id: allocId(world), kind, floor, x, width: ROOMS[kind].width, height: ROOMS[kind].height, eval: 1, tenants: [], occupancy: 0,
    builtAtMinute: world.time.minute, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
  };
  addRoom(world, room);
  return room;
}

function fireTower(): World {
  const world = createWorld(4242);
  world.stars = EVENTS.fire.minStar as Star;
  place(world, 'lobby', 1, 100);
  const width = ROOMS.office.width;
  const offices = [0, 1, 2].map((i) => place(world, 'office', 2, 100 + i * width));
  EVENT_TEST_HOOKS.chance.fire = 1;
  EVENT_TEST_HOOKS.target.fire = offices[0]!.id;
  return world;
}

/** The alert stack alone on a host, fed the log as the ui's drain feeds it. */
function directStack(
  world: World,
  extra: { refusal?: () => string | null; centerOn?: (floor: number, x: number) => void; selectGuest?: (id: number) => void } = {},
): AlertStack & { host: FakeElement; drain(): void; later: (() => void)[] } {
  const host = dom.createElement('div');
  const later: (() => void)[] = [];
  const stack = createAlertStack({
    host: host as never,
    getWorld: () => world,
    apply: (cmd) => (cmd.kind === 'fire.callHelicopter' || cmd.kind === 'bomb.pay' ? handleEventCommand(world, cmd) : { ok: false, reason: 'Not in this test.' }),
    later: (fn) => later.push(fn),
    openStories: () => {},
    ...extra,
  });
  let seen = world.logTotal;
  const drain = (): void => {
    const fresh = Math.min(world.logTotal - seen, world.log.length);
    for (const entry of world.log.slice(world.log.length - fresh) as LogEntry[]) {
      if (entry.level === 'alert') stack.onAlert(entry);
      else if (entry.text.startsWith('The VIP, ') && entry.text.includes(' walked into the lobby')) stack.onVipArrival(entry);
    }
    seen = world.logTotal;
    stack.sync();
  };
  return Object.assign(stack, { host, drain, later });
}

const chipsMade = (): FakeElement[] => made.filter((n) => has(n, 'hs-toast-chip'));
const shownChip = (host: FakeElement): FakeElement | undefined => host.children.find((n) => has(n, 'hs-toast-chip') && !n.hidden);

describe('the reminder chip', () => {
  it('a new fire with its card in sight makes no chip at all (A4)', () => {
    const world = fireTower();
    const stack = directStack(world);
    world.time.minute = 6 * 60;
    tickEvents(world);
    stack.drain();
    expect(chipsMade()).toHaveLength(0);
  });

  it('is made once and updated in place across refreshes as the fire spreads, and is polite (A4)', () => {
    const world = fireTower();
    const stack = directStack(world);
    world.time.minute = 6 * 60;
    tickEvents(world);
    stack.drain();
    const fire = stack.host.children.find((n) => has(n, 'is-fire'))!;
    click(fire.descendants().find((n) => has(n, 'hs-toast-close')));
    stack.drain();
    const chip = shownChip(stack.host)!;
    expect(chip.getAttribute('aria-live')).toBe('polite');
    for (let i = 1; i <= 3; i++) {
      world.time.minute = 6 * 60 + i * EVENTS.fire.spreadMinutes;
      tickEvents(world);
      stack.drain();
    }
    expect(shownChip(stack.host)).toBe(chip);
    expect(chip.textContent).toContain('Fire on floor 2');
    expect(chipsMade()).toHaveLength(1);
  });

  it('does not blink when ordinary notices fold the fire card (A12)', () => {
    const world = fireTower();
    const stack = directStack(world);
    world.time.minute = 6 * 60;
    tickEvents(world);
    stack.drain();
    log(world, 'Alert number 1.', 'alert');
    log(world, 'Alert number 2.', 'alert');
    stack.drain();
    stack.notice('Game saved.');
    stack.drain();
    const fire = stack.host.children.find((n) => has(n, 'is-fire'))!;
    expect(has(fire, 'is-collapsed')).toBe(true);
    expect(shownChip(stack.host)).toBeUndefined();
    // A lasting card that folds it still raises the chip.
    log(world, 'Alert number 3.', 'alert');
    stack.drain();
    expect(shownChip(stack.host)?.textContent).toContain('Fire on floor 2');
  });

  it("in a finished Today's tower: no chip, and the helicopter is off with the reason, on the card and in Stories (A5)", () => {
    const world = fireTower();
    const h = mount(world, { getSlot: () => 'daily', getDaily: () => ({ date: '2026-10-01', twist: { name: '', line: '' }, endMinute: 0, finished: true }) });
    world.time.minute = 6 * 60;
    tickEvents(world);
    h.notify();
    const card = h.fireCards()[0]!;
    const call = card.descendants().find((n) => n.tagName === 'BUTTON' && n.dataset['command'] === 'fire.callHelicopter')!;
    expect(call.disabled).toBe(true);
    expect(card.textContent).toContain(DAILY_OVER_REASON);
    click(h.closeOf(card));
    h.notify();
    expect(h.chip('fire')).toBeUndefined();
    // Stories, from the menu: the same button, off, with the same words.
    const menu = h.root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu');
    click(menu);
    const entry = h.root.descendants().find((n) => has(n, 'hs-pause-item') && n.dataset['entry'] === 'stories');
    click(entry);
    const inPage = h.pageCard()!.descendants().find((n) => n.tagName === 'BUTTON' && n.dataset['command'] === 'fire.callHelicopter')!;
    expect(inPage.disabled).toBe(true);
    expect(h.pageCard()!.textContent).toContain(DAILY_OVER_REASON);
    expect(h.applied).toEqual([]);
  });
});

// The first run on a fake DOM, a stub game and the fake store: the intro shows once, the guide
// follows the world and not the clock, the card lights the tile and bands the tower, the tips
// fire once each and wait for the guide, and Help brings the intro back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

type Band = { floorMin: number; floorMax: number; xMin: number; xMax: number } | null;

interface Stub {
  api: never;
  world: {
    cash: number;
    population: number;
    stars: number;
    time: { minute: number };
    log: never[];
    logTotal: number;
    rooms: Map<number, Record<string, unknown>>;
    shafts: Map<number, Record<string, unknown>>;
    sims: Map<number, unknown>;
    events: unknown[];
    stats: { tenantsLeftReasons: Record<string, number>; lastQuarter: { income: number; upkeep: number; net: number }; vipRating: string; weddingsHeld: number };
    longWaits: { hour: number[]; count: number[] };
  };
  notify(): void;
  speed: number;
  bands: Band[];
}

function stubGame(): Stub {
  const subscribers = new Set<() => void>();
  const world: Stub['world'] = {
    cash: 2_000_000,
    population: 0,
    stars: 1,
    time: { minute: 6 * 60 },
    log: [],
    logTotal: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    events: [],
    stats: { tenantsLeftReasons: {}, lastQuarter: { income: 0, upkeep: 0, net: 0 }, vipRating: 'none', weddingsHeld: 0 },
    longWaits: { hour: new Array(24).fill(-1), count: new Array(24).fill(0) },
  };
  const stub: Stub = { api: null as never, world, notify: () => subscribers.forEach((cb) => cb()), speed: 1, bands: [] };
  stub.api = {
    world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    getHover: () => null,
    getSpeed: () => stub.speed,
    getTool: () => ({ kind: 'none' }),
    setTool: () => {},
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select: () => {},
    setChrome: () => {},
    setReducedMotion: () => {},
  } as never;
  return stub;
}

function mount(game: Stub): { ui: ReturnType<typeof createUi>; root: FakeElement } {
  const root = dom.createElement('div');
  const renderer = { setGuideBand: (band: Band) => game.bands.push(band) };
  return { ui: createUi(root as never, game.api, renderer as never), root };
}

const byClass = (root: FakeElement, name: string): FakeElement[] =>
  root.descendants().filter((n) => n.className.split(/\s+/).includes(name));
const one = (root: FakeElement, name: string): FakeElement | undefined => byClass(root, name)[0];
const buttonNamed = (root: FakeElement, text: string): FakeElement => {
  const found = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text);
  if (!found) throw new Error(`no button ${text}`);
  return found;
};
const click = (node: FakeElement): void => {
  for (const fn of node.listeners.get('click') ?? []) fn({});
};
const store = (): { getItem(k: string): string | null; setItem(k: string, v: string): void } =>
  (globalThis as unknown as { window: { localStorage: { getItem(k: string): string | null; setItem(k: string, v: string): void } } }).window.localStorage;
const introOf = (root: FakeElement): FakeElement | undefined => one(root, 'hs-intro');
const cardOf = (root: FakeElement): FakeElement => one(root, 'hs-card') as FakeElement;
const tipsOf = (root: FakeElement): FakeElement[] => byClass(root, 'is-tip');

let nextId = 1;
function addRoom(game: Stub, room: Record<string, unknown>): Record<string, unknown> {
  const full = { id: nextId++, height: 1, occupancy: 0, vacant: room['kind'] === 'office', ...room };
  game.world.rooms.set(full.id as number, full);
  return full;
}

describe('intro', () => {
  it('shows on the first empty tower, walks three screens, and never shows again', () => {
    const game = stubGame();
    const first = mount(game);
    const intro = introOf(first.root);
    expect(intro).toBeDefined();
    expect(intro?.textContent).toContain('1 of 3');
    expect(intro?.textContent).toContain('Your tower');
    click(buttonNamed(first.root, 'Next'));
    expect(introOf(first.root)?.textContent).toContain('Stars');
    click(buttonNamed(first.root, 'Next'));
    expect(introOf(first.root)?.textContent).toContain('What empties a tower');
    click(buttonNamed(first.root, 'Start building'));
    expect(introOf(first.root)).toBeUndefined();
    expect(store().getItem('hs.intro.seen')).toBe('true');
    first.ui.destroy();

    const second = mount(game);
    expect(introOf(second.root)).toBeUndefined();
  });

  it('one tap on Skip dismisses it for good', () => {
    const game = stubGame();
    const { root, ui } = mount(game);
    click(buttonNamed(introOf(root) as FakeElement, 'Skip'));
    expect(introOf(root)).toBeUndefined();
    expect(store().getItem('hs.intro.seen')).toBe('true');
    ui.destroy();
    expect(introOf(mount(game).root)).toBeUndefined();
  });

  it('does not show over a tower that is already standing', () => {
    const game = stubGame();
    addRoom(game, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    expect(introOf(mount(game).root)).toBeUndefined();
  });

  it('comes back from Help in the settings panel', () => {
    const game = stubGame();
    store().setItem('hs.intro.seen', 'true');
    const { root } = mount(game);
    expect(introOf(root)).toBeUndefined();
    click(buttonNamed(root, 'Menu'));
    const help = root.descendants().find((n) => n.className === 'hs-section' && n.textContent.startsWith('Help'));
    expect(help).toBeDefined();
    const link = help?.descendants().find((n) => n.tagName === 'A');
    expect(link?.textContent).toBe('How to play');
    expect((link as unknown as { href: string }).href).toBe('/how-to-play/');
    click(buttonNamed(root, 'Intro'));
    expect(introOf(root)?.textContent).toContain('1 of 3');
  });
});

describe('guided first tower', () => {
  it('advances on world changes after a notify, not on the clock, then hands over to the goals', () => {
    const game = stubGame();
    const { root } = mount(game);
    click(buttonNamed(introOf(root) as FakeElement, 'Skip')); // the intro
    const card = cardOf(root);
    expect(card.textContent).toContain('Step 1 of 5');
    expect(card.textContent).toContain('Build a lobby');

    for (let i = 0; i < 5; i++) {
      game.world.time.minute += 1440; // days pass: nothing was built
      game.notify();
    }
    expect(card.textContent).toContain('Step 1 of 5');

    addRoom(game, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    expect(card.textContent).toContain('Step 1 of 5'); // read after the notify, not before
    game.notify();
    expect(card.textContent).toContain('Step 2 of 5');

    const office = addRoom(game, { kind: 'office', floor: 2, x: 185, width: 9 });
    game.notify();
    expect(card.textContent).toContain('Step 3 of 5');
    expect(card.textContent).toContain('floor 2');

    game.world.shafts.set(99, { id: 99, floorMin: 1, floorMax: 2 });
    game.notify();
    expect(card.textContent).toContain('Step 4 of 5');

    office['vacant'] = false;
    game.notify();
    expect(card.textContent).toContain('Step 5 of 5');

    game.world.stars = 2;
    game.world.population = 306;
    game.notify();
    expect(card.textContent).toContain('Next: 3 stars');
    expect(card.textContent).toContain('306 of 1,000');
    expect(card.textContent).toContain('Security office');
    expect(store().getItem('hs.guide.done')).toBe('true');
    expect(game.bands[game.bands.length - 1]).toBe(null);
  });

  it('lights the target tile and bands the tower for each step', () => {
    const game = stubGame();
    const { root } = mount(game);
    click(buttonNamed(introOf(root) as FakeElement, 'Skip'));
    const lit = (): string[] => byClass(root, 'hs-tool-hint').map((n) => n.textContent);
    expect(lit()).toHaveLength(1);
    expect(lit()[0]).toContain('Lobby');
    expect(game.bands[game.bands.length - 1]).toEqual({ floorMin: 1, floorMax: 1, xMin: 0, xMax: 374 });

    addRoom(game, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    addRoom(game, { kind: 'office', floor: 2, x: 185, width: 9 });
    game.notify();
    expect(lit()[0]).toContain('Elevator');
    expect(game.bands[game.bands.length - 1]).toEqual({ floorMin: 1, floorMax: 2, xMin: 185, xMax: 193 });
    const calls = game.bands.length;
    game.notify();
    expect(game.bands.length).toBe(calls); // an unchanged band is not sent again
  });

  it('skipping ends it for good and shows the goals', () => {
    const game = stubGame();
    const { root, ui } = mount(game);
    click(buttonNamed(introOf(root) as FakeElement, 'Skip')); // the intro
    click(buttonNamed(cardOf(root), 'Skip')); // the guide, from its card header
    expect(store().getItem('hs.guide.done')).toBe('true');
    expect(cardOf(root).textContent).toContain('Next: 2 stars');
    expect(byClass(root, 'hs-tool-hint')).toHaveLength(0);
    ui.destroy();
    expect(cardOf(mount(game).root).textContent).toContain('Next: 2 stars');
  });

  it('is not offered on a standing tower when the intro was not shown this session', () => {
    const game = stubGame();
    store().setItem('hs.intro.seen', 'true');
    addRoom(game, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    const { root } = mount(game);
    expect(cardOf(root).textContent).toContain('Next: 2 stars');
    expect(game.bands).toHaveLength(0);
  });
});

describe('goals card nudges', () => {
  it('says so when more than a dozen people waited over five minutes this hour', () => {
    const game = stubGame();
    store().setItem('hs.intro.seen', 'true');
    store().setItem('hs.guide.done', 'true');
    store().setItem('hs.tips', JSON.stringify(['longWait', 'firstPanel']));
    const { root } = mount(game);
    const hour = Math.floor(game.world.time.minute / 60);
    game.world.longWaits.hour[hour % 24] = hour;
    game.world.longWaits.count[hour % 24] = 14;
    game.notify();
    expect(cardOf(root).textContent).toContain('14 people waited over 5 minutes for a car in the last hour.');
  });

  it('says tenants need an elevator after two still days with rooms vacant', () => {
    const game = stubGame();
    store().setItem('hs.intro.seen', 'true');
    store().setItem('hs.guide.done', 'true');
    addRoom(game, { kind: 'office', floor: 2, x: 185, width: 9 });
    const { root } = mount(game);
    game.world.time.minute += 2 * 1440 - 1;
    game.notify();
    expect(cardOf(root).textContent).not.toContain('Tenants need an elevator within reach.');
    game.world.time.minute += 1;
    game.notify();
    expect(cardOf(root).textContent).toContain('Tenants need an elevator within reach.');
  });
});

describe('tips', () => {
  function readyGame(): Stub {
    const game = stubGame();
    store().setItem('hs.intro.seen', 'true');
    store().setItem('hs.guide.done', 'true');
    addRoom(game, { kind: 'lobby', floor: 1, x: 180, width: 20 });
    return game;
  }

  it('the night speed tip fires once, names the mode, and never again after Got it', () => {
    const game = readyGame();
    const first = mount(game);
    expect(tipsOf(first.root)).toHaveLength(0);
    game.world.time.minute = 23 * 60 + 10;
    game.speed = 2;
    game.notify();
    game.notify();
    expect(tipsOf(first.root)).toHaveLength(1);
    expect(tipsOf(first.root)[0]?.textContent).toContain('Night x8, effective x16: from 11 PM to 6 AM');
    click(buttonNamed(first.root, 'Got it'));
    expect(tipsOf(first.root)).toHaveLength(0);
    expect(JSON.parse(store().getItem('hs.tips') ?? '[]')).toContain('nightSpeed');
    game.notify();
    expect(tipsOf(first.root)).toHaveLength(0);
    first.ui.destroy();

    const second = mount(game);
    game.notify();
    expect(tipsOf(second.root)).toHaveLength(0);
  });

  it('shows one at a time: a tenant leaving, rent day, an event, a long wait', () => {
    const game = readyGame();
    const { root } = mount(game);
    game.world.stats.tenantsLeftReasons['Too long waiting for an elevator on floor 4.'] = 1;
    game.world.stats.lastQuarter = { income: 10_000, upkeep: 0, net: 10_000 };
    game.world.events.push({ kind: 'santa' });
    const hour = Math.floor(game.world.time.minute / 60);
    game.world.longWaits.hour[hour % 24] = hour;
    game.world.longWaits.count[hour % 24] = 1;
    game.notify();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(tipsOf(root)).toHaveLength(1);
      seen.push(tipsOf(root)[0]?.textContent ?? '');
      click(buttonNamed(root, 'Got it'));
    }
    expect(tipsOf(root)).toHaveLength(0);
    expect(seen).toContain('Someone waited over 5 minutes for a car, and another car from the elevator panel shortens the wait.Got it');
    expect(seen).toContain('A tenant moved out: too long waiting for an elevator on floor 4.Got it');
    expect(seen).toContain('Rent day: the tower took in $10,000 last quarter, and the finances panel has the details.Got it');
    expect(seen).toContain('Events arrive as alerts, and the ones that need a decision carry the button that answers them.Got it');
  });

  it('the first panel tip comes with the first panel', () => {
    const game = readyGame();
    const { root } = mount(game);
    click(buttonNamed(root, 'Menu'));
    expect(tipsOf(root)[0]?.textContent).toContain('Panels show the details');
  });

  it('wait while the intro or a guide step is open, then show', () => {
    const game = stubGame();
    const { root } = mount(game); // the intro is up and the guide will follow
    game.world.time.minute = 23 * 60 + 10;
    game.notify();
    expect(tipsOf(root)).toHaveLength(0);
    click(buttonNamed(introOf(root) as FakeElement, 'Skip')); // the intro
    expect(tipsOf(root)).toHaveLength(0); // the guide's step card is open
    click(buttonNamed(cardOf(root), 'Skip')); // the guide, from its card header
    expect(tipsOf(root)).toHaveLength(1);
  });
});

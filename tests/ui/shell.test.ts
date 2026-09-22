// The ui shell on a fake DOM and a fake game: how often it subscribes, and how often it
// measures the page while a tool is in hand.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Placement } from '../../src/game/api';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

interface FakeGame {
  api: never;
  subscribers: Set<() => void>;
  notify(): void;
  placement: Placement | null;
  rect: { x: number; y: number; w: number; h: number } | null;
  minute: number;
}

function fakeGame(): FakeGame {
  const subscribers = new Set<() => void>();
  const state: FakeGame = {
    api: null as never,
    subscribers,
    notify: () => subscribers.forEach((cb) => cb()),
    placement: null,
    rect: null,
    minute: 0,
  };
  const world = {
    cash: 1_000_000,
    population: 0,
    stars: 1,
    time: {
      get minute() {
        return state.minute;
      },
    },
    log: [],
    logTotal: 0,
    rooms: new Map(),
    shafts: new Map(),
    sims: new Map(),
    events: [],
  };
  state.api = {
    world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getHover: () => null,
    getSpeed: () => 1,
    getTool: () => (state.placement ? { kind: 'room', room: 'office' } : { kind: 'none' }),
    setTool: () => {},
    getPlacement: () => state.placement,
    getPlacementRect: () => state.rect,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
  } as never;
  return state;
}

const office: Placement = { floor: 2, x: 10, floorMin: 2, floorMax: 2, ok: true, label: 'Office', cost: 40_000, pending: false };

function mount(game: FakeGame): { ui: ReturnType<typeof createUi>; root: FakeElement } {
  const root = dom.createElement('div');
  return { ui: createUi(root as never, game.api, {} as never), root };
}

const chipOf = (root: FakeElement): FakeElement => {
  const chip = root.descendants().find((n) => n.className.split(' ').includes('hs-place-chip'));
  if (!chip) throw new Error('no chip');
  return chip;
};

describe('ui subscription', () => {
  it('subscribes once to the game and lets go on destroy', () => {
    const game = fakeGame();
    const { ui } = mount(game);
    expect(game.subscribers.size).toBe(1);
    ui.destroy();
    expect(game.subscribers.size).toBe(0);
  });
});

describe('placement chip measurement', () => {
  it.each([
    ['a hover ghost', false],
    ['a parked ghost with its bar', true],
  ])('does not measure on every step or every frame with %s', (_name, pending) => {
    const game = fakeGame();
    game.placement = { ...office, pending };
    game.rect = { x: 100, y: 200, w: 60, h: 40 };
    const { root } = mount(game);
    game.notify();
    dom.runFrame();
    dom.measures = 0;
    for (let i = 0; i < 20; i += 1) {
      game.minute += 1; // the clock moves: update() rewrites the HUD text every step
      game.notify();
      dom.runFrame();
    }
    expect(dom.measures).toBe(0);
    expect(chipOf(root).style['left']).toBe(`${100 + 30 - 60}px`); // centred on the ghost, 120 wide
  });

  it('follows a pan without measuring, from the ghost rect alone', () => {
    const game = fakeGame();
    game.placement = office;
    game.rect = { x: 100, y: 200, w: 60, h: 40 };
    const { root } = mount(game);
    dom.runFrame();
    dom.measures = 0;
    game.rect = { x: 300, y: 200, w: 60, h: 40 };
    dom.runFrame();
    expect(dom.measures).toBe(0);
    expect(chipOf(root).style['left']).toBe(`${300 + 30 - 60}px`);
  });

  it('measures again when the chip text changes and when the window resizes', () => {
    const game = fakeGame();
    game.placement = office;
    game.rect = { x: 100, y: 200, w: 60, h: 40 };
    mount(game);
    dom.measures = 0;
    game.placement = { ...office, ok: false, reason: 'Build a floor below this one first.' };
    game.notify();
    expect(dom.measures).toBe(1); // the chip only: the view has not changed
    dom.measures = 0;
    dom.fireWindow('resize');
    expect(dom.measures).toBeGreaterThan(0);
    const afterResize = dom.measures;
    game.notify();
    dom.runFrame();
    expect(dom.measures).toBe(afterResize);
  });
});

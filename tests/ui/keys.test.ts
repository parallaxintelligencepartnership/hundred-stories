// The keyboard map: number keys pick palette groups, letters pick tools inside the active group,
// Escape drops the tool, Space pauses; the tiles show their letters and name their keys; and
// nothing fires while the player is typing or a card with a text field is open.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Tool } from '../../src/game/api';
import { RESERVED_LETTERS, assignLetters, hasTextField, isFormField, keyAction, keyHelpLines, stepSpeed } from '../../src/ui/keys';
import { GROUPS } from '../../src/ui/palette';
import { createUi } from '../../src/ui/ui';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window.localStorage.setItem('hs.intro.seen', 'true');
});
afterEach(() => uninstall());

describe('letters', () => {
  it('never hands out a camera key and never repeats a letter inside a group', () => {
    const letters = assignLetters(['Stairs', 'Sky lobby', 'Security office', 'Demolish', 'Wall', 'Aa']);
    for (const letter of letters) expect(RESERVED_LETTERS.has(letter)).toBe(false);
    expect(new Set(letters).size).toBe(letters.length);
    expect(letters.slice(0, 4)).toEqual(['T', 'K', 'E', 'M']);
  });
});

describe('keyAction', () => {
  const groups = [['L', 'K', 'T', 'E'], ['E', 'R', 'X'], ['C']];

  it('maps number keys to groups in palette order and ignores numbers past the last group', () => {
    expect(keyAction({ key: '1' }, groups, null)).toEqual({ kind: 'group', group: 0 });
    expect(keyAction({ key: '3' }, groups, 1)).toEqual({ kind: 'group', group: 2 });
    expect(keyAction({ key: '4' }, groups, null)).toBeNull();
    expect(keyAction({ key: '0' }, groups, null)).toBeNull();
  });

  it('maps a letter to a tool inside the active group only', () => {
    expect(keyAction({ key: 'x' }, groups, 1)).toEqual({ kind: 'tool', group: 1, index: 2 });
    expect(keyAction({ key: 'E' }, groups, 0)).toEqual({ kind: 'tool', group: 0, index: 3 });
    expect(keyAction({ key: 'x' }, groups, 0)).toBeNull();
    expect(keyAction({ key: 'l' }, groups, null)).toBeNull();
  });

  it('maps Escape, Space, and leaves modified keys to the browser', () => {
    expect(keyAction({ key: 'Escape' }, groups, null)).toEqual({ kind: 'clear' });
    expect(keyAction({ key: ' ', code: 'Space' }, groups, null)).toEqual({ kind: 'pause' });
    expect(keyAction({ key: '1', ctrlKey: true }, groups, null)).toBeNull();
    expect(keyAction({ key: 'r', metaKey: true }, groups, 1)).toBeNull();
  });
});

describe('text fields', () => {
  it('knows a form field and a card that holds a text field', () => {
    expect(isFormField({ tagName: 'INPUT', type: 'checkbox' })).toBe(true);
    expect(isFormField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isFormField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isFormField({ tagName: 'BUTTON' })).toBe(false);
    const card = { tagName: 'DIV', children: [{ tagName: 'P', children: [] }, { tagName: 'DIV', children: [{ tagName: 'INPUT', type: 'number' }] }] };
    expect(hasTextField(card)).toBe(true);
    expect(hasTextField({ tagName: 'DIV', children: [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'file' }] })).toBe(false);
  });
});

interface Stub {
  api: never;
  world: { stars: number } & Record<string, unknown>;
  tool: Tool;
  pauses: number;
  speed: number;
}

function stubGame(stars = 1): Stub {
  const subscribers = new Set<() => void>();
  const stub: Stub = {
    api: null as never,
    world: {
      cash: 2_000_000,
      population: 0,
      stars,
      seed: 1,
      time: { minute: 6 * 60 },
      log: [],
      logTotal: 0,
      rooms: new Map(),
      shafts: new Map(),
      sims: new Map(),
      events: [],
    },
    tool: { kind: 'none' },
    pauses: 0,
    speed: 1,
  };
  stub.api = {
    world: stub.world,
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    subscribeEvents: () => () => {},
    getHover: () => null,
    getSpeed: () => stub.speed,
    setSpeed: (speed: number) => {
      stub.speed = speed;
    },
    getTool: () => stub.tool,
    setTool: (tool: Tool) => {
      stub.tool = tool;
    },
    togglePause: () => {
      stub.pauses += 1;
    },
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    select: () => {},
    setChrome: () => {},
    setReducedMotion: () => {},
  } as never;
  return stub;
}

function mount(game: Stub): FakeElement {
  const root = dom.createElement('div');
  createUi(root as never, game.api, {} as never);
  return root;
}

const press = (key: string, target: unknown = { tagName: 'BODY' }): { stopped: boolean } => {
  const seen = { stopped: false };
  dom.fireWindow('keydown', {
    key,
    code: key === ' ' ? 'Space' : '',
    target,
    defaultPrevented: false,
    preventDefault() {},
    stopImmediatePropagation() {
      seen.stopped = true;
    },
  });
  return seen;
};

describe('keys in the shell', () => {
  it('picks a group and its first tool, then a tool by its letter, and Escape drops it', () => {
    const game = stubGame(3);
    mount(game);
    press('2');
    expect(game.tool).toEqual({ kind: 'shaft', shaft: 'standard' });
    press('x');
    expect(game.tool).toEqual({ kind: 'shaft', shaft: 'express' });
    press('5');
    expect(game.tool).toEqual({ kind: 'room', room: 'office' });
    press('h');
    expect(game.tool).toEqual({ kind: 'room', room: 'shop' });
    press('Escape');
    expect(game.tool).toEqual({ kind: 'none' });
    // With nothing in hand the last group picked stays active for letters.
    press('r');
    expect(game.tool).toEqual({ kind: 'room', room: 'restaurant' });
    press(' ');
    expect(game.pauses).toBe(1);
  });

  it('puts the first tool the player can have in hand, and a locked letter picks nothing', () => {
    const game = stubGame(2);
    mount(game);
    press('6'); // Services: the medical center needs 3 stars, the security office 2
    expect(game.tool).toEqual({ kind: 'room', room: 'security' });
    press('m');
    expect(game.tool).toEqual({ kind: 'room', room: 'security' });
  });

  it('ignores every key while focus is in a field', () => {
    const game = stubGame(3);
    mount(game);
    for (const target of [
      { tagName: 'INPUT', type: 'text' },
      { tagName: 'INPUT', type: 'checkbox' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
    ]) {
      press('2', target);
      press(' ', target);
      press('Escape', target);
    }
    expect(game.tool).toEqual({ kind: 'none' });
    expect(game.pauses).toBe(0);
  });

  it('ignores every key, and holds the camera keys back, while a card with a text field is open', () => {
    const game = stubGame(3);
    const root = mount(game);
    const menu = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Menu') as FakeElement;
    for (const fn of menu.listeners.get('click') ?? []) fn({});
    const seen = press('2');
    press(' ');
    expect(game.tool).toEqual({ kind: 'none' });
    expect(game.pauses).toBe(0);
    expect(seen.stopped).toBe(true);
  });
});

describe('tiles and help', () => {
  it('shows each tile its letter and names its keys in the tooltip', () => {
    const game = stubGame(1);
    const root = mount(game);
    const tiles = root.descendants().filter((n) => n.tagName === 'BUTTON' && n.className.split(' ').includes('hs-tool'));
    const lobby = tiles.find((n) => n.textContent.startsWith('Lobby')) as FakeElement;
    expect(lobby.descendants().find((n) => n.className === 'hs-tool-key')?.textContent).toBe('L');
    expect(lobby.title).toBe('Lobby (keys 1 then L)');
    const suite = tiles.find((n) => n.textContent.startsWith('Suite')) as FakeElement;
    expect(suite.title).toBe('Suite: needs 2 stars (keys 4 then U)');
    for (const tile of tiles) {
      const letter = tile.descendants().find((n) => n.className === 'hs-tool-key')?.textContent ?? '';
      expect(RESERVED_LETTERS.has(letter)).toBe(false);
    }
  });

  it('lists the keys in the Help controls', () => {
    const lines = keyHelpLines(GROUPS.length);
    expect(lines.join(' ')).toContain(`1 to ${GROUPS.length}`);
    const root = mount(stubGame());
    const menu = root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Menu') as FakeElement;
    for (const fn of menu.listeners.get('click') ?? []) fn({});
    const controls = root.descendants().find((n) => n.className === 'hs-help-controls');
    for (const line of lines) expect(controls?.textContent).toContain(line);
    expect(controls?.textContent).not.toContain('1, 2, 3 set the clock speed');
  });
});

describe('speed keys', () => {
  it('steps the speed with stepSpeed, held at pause and at 4x', () => {
    expect([0, 1, 2, 4].map((s) => stepSpeed(s, 1))).toEqual([1, 2, 4, 4]);
    expect([0, 1, 2, 4].map((s) => stepSpeed(s, -1))).toEqual([0, 0, 1, 2]);
    expect(keyAction({ key: ',' }, [], null)).toEqual({ kind: 'speed', step: -1 });
    expect(keyAction({ key: '.' }, [], null)).toEqual({ kind: 'speed', step: 1 });
  });

  it('period speeds up one step to 4x and stops there', () => {
    const game = stubGame();
    game.speed = 0;
    mount(game);
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      press('.');
      seen.push(game.speed);
    }
    expect(seen).toEqual([1, 2, 4, 4]);
  });

  it('comma slows down one step to pause and stops there', () => {
    const game = stubGame();
    game.speed = 4;
    mount(game);
    const seen: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      press(',');
      seen.push(game.speed);
    }
    expect(seen).toEqual([2, 1, 0, 0]);
  });

  it('ignores comma and period while focus is in a form field', () => {
    const game = stubGame();
    game.speed = 2;
    mount(game);
    for (const target of [{ tagName: 'INPUT', type: 'number' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
      press('.', target);
      press(',', target);
    }
    expect(game.speed).toBe(2);
  });

  it('names both keys in the Help controls', () => {
    expect(keyHelpLines(GROUPS.length).join(' ')).toContain('comma slows down one step and period speeds up one step');
  });
});

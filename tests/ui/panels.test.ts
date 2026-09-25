// The log and room panels on a fake DOM: what a refresh builds, and what it leaves alone.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFinancesPanel, createLogPanel, createQueryPanel, createSettingsPanel, type PanelContext } from '../../src/ui/panels';
import type { Sound } from '../../src/audio/audio';
import { RENT } from '../../src/sim/rules';
import type { LogEntry } from '../../src/sim/types';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

const ctx: PanelContext = {
  apply: () => ({ ok: true }) as never,
  notice: () => {},
  close: () => {},
  reducedMotion: false,
  setReducedMotion: () => {},
};

function logGame(): {
  game: never;
  world: { log: LogEntry[]; logTotal: number; time: { minute: number } };
  push(n: number, minute?: number, level?: LogEntry['level']): void;
} {
  const world = { log: [] as LogEntry[], logTotal: 0, time: { minute: 0 } };
  return {
    game: { world } as never,
    world,
    push(n: number, minute = world.time.minute, level: LogEntry['level'] = 'info') {
      for (let i = 0; i < n; i += 1) {
        world.log.push({ minute, text: `line ${world.logTotal}`, level });
        world.logTotal += 1;
      }
    },
  };
}

const node = (panel: unknown): FakeElement => panel as FakeElement;

function listOf(panel: unknown): FakeElement {
  const list = node(panel).descendants().find((n) => n.className === 'hs-log-list');
  if (!list) throw new Error('no log list');
  return list;
}

/** Each line's sentence (the text span, or the whole li for the empty line). */
const texts = (list: FakeElement): string[] =>
  list.children.map((li) => li.children.find((c) => c.className === 'hs-log-text')?.textContent ?? li.textContent);
/** Each line's time words. */
const times = (list: FakeElement): string[] =>
  list.children.map((li) => li.children.find((c) => c.className === 'hs-log-time')?.textContent ?? '');
const showOlder = (panel: unknown): FakeElement | undefined =>
  node(panel).descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === 'Show older');
const tap = (target: FakeElement): void => {
  for (const fn of target.listeners.get('click') ?? []) fn({});
};

describe('News panel', () => {
  it('is called News', () => {
    const { game } = logGame();
    const panel = node(createLogPanel(game, ctx));
    const title = panel.descendants().find((n) => n.className === 'hs-panel-title-text');
    expect(title?.textContent).toBe('News');
    expect(panel.textContent).not.toMatch(/event log/i);
  });

  it('shows the newest ten lines, newest first', () => {
    const { game, push } = logGame();
    push(25);
    const list = listOf(createLogPanel(game, ctx));
    expect(texts(list)).toEqual(['line 24', 'line 23', 'line 22', 'line 21', 'line 20', 'line 19', 'line 18', 'line 17', 'line 16', 'line 15']);
  });

  it('puts a new line on top and keeps ten', () => {
    const { game, push } = logGame();
    push(12);
    const panel = createLogPanel(game, ctx);
    push(2);
    panel.refresh?.();
    const list = listOf(panel);
    expect(list.children.length).toBe(10);
    expect(texts(list).slice(0, 3)).toEqual(['line 13', 'line 12', 'line 11']);
  });

  it('says when each line happened in words, from the game clock', () => {
    const { game, world, push } = logGame();
    world.time.minute = 3 * 1440 + 12 * 60; // noon on the fourth day
    push(1, 1 * 1440 + 9 * 60); // two days ago
    push(1, 2 * 1440 + 18 * 60); // yesterday evening
    push(1, 3 * 1440 + 7 * 60); // five hours ago
    push(1, 3 * 1440 + 11 * 60); // an hour ago
    push(1, 3 * 1440 + 11 * 60 + 50); // ten minutes ago
    const panel = createLogPanel(game, ctx);
    expect(times(listOf(panel))).toEqual(['just now', 'an hour ago', '5 hours ago', 'yesterday', '2 days ago']);
    // The words move on as the clock does, with no new line.
    world.time.minute += 60;
    panel.refresh?.();
    expect(times(listOf(panel))[0]).toBe('an hour ago');
  });

  it('has no clock stamp, level tag or id in any line', () => {
    const { game, world, push } = logGame();
    world.time.minute = 2000;
    push(3, 1990, 'warn');
    push(3, 1995, 'alert');
    world.log.push({ minute: 1999, text: 'A tenant moved in.', level: 'info', roomId: 42, simId: 77 });
    world.logTotal += 1;
    const list = listOf(createLogPanel(game, ctx));
    for (const li of list.children) {
      expect(li.textContent).not.toMatch(/\b(info|warn|alert)\b|\d{1,2}:\d{2}|weekday|weekend|42|77|#/i);
    }
    expect(list.children[0]?.textContent).toContain('A tenant moved in.');
  });

  it('Show older reveals the next fifty, and goes away when there is no more', () => {
    const { game, push } = logGame();
    push(70);
    const panel = createLogPanel(game, ctx);
    const older = showOlder(panel);
    expect(older).toBeDefined();
    tap(older as FakeElement);
    const list = listOf(panel);
    expect(list.children.length).toBe(60);
    expect(texts(list)[59]).toBe('line 10');
    expect(showOlder(panel)?.hidden).toBe(false);
    tap(showOlder(panel) as FakeElement);
    expect(list.children.length).toBe(70);
    expect(showOlder(panel)?.hidden ?? true).toBe(true);
  });

  it('has no Show older when ten lines or fewer', () => {
    const { game, push } = logGame();
    push(10);
    expect(showOlder(createLogPanel(game, ctx))?.hidden ?? true).toBe(true);
  });

  it('a refresh with no new line and no change of time builds nothing', () => {
    const { game, push } = logGame();
    push(30);
    const panel = createLogPanel(game, ctx);
    dom.created = 0;
    panel.refresh?.();
    expect(dom.created).toBe(0);
  });

  it('rebuilds from the log when a load swaps it for another world', () => {
    const { game, world, push } = logGame();
    push(10);
    const panel = createLogPanel(game, ctx);
    world.log = [{ minute: 0, text: 'loaded', level: 'info' }];
    world.logTotal = 12;
    panel.refresh?.();
    expect(texts(listOf(panel))).toEqual(['loaded']);
  });

  it('says so when nothing has happened yet', () => {
    const { game } = logGame();
    expect(texts(listOf(createLogPanel(game, ctx)))).toEqual(['Nothing has happened yet.']);
  });
});

describe('room panel flags', () => {
  function roomGame(): { game: never; room: Record<string, unknown> } {
    const room: Record<string, unknown> = {
      id: 1,
      kind: 'office',
      floor: 2,
      height: 1,
      eval: 0.8,
      tenants: [],
      occupancy: 0,
      vacant: true,
      dirty: false,
      infested: false,
      onFire: false,
      rent: RENT.default,
    };
    return { game: { world: { rooms: new Map([[1, room]]), shafts: new Map(), sims: new Map() } } as never, room };
  }

  const flags = (panel: unknown): FakeElement[] =>
    node(panel).descendants().filter((n) => n.className.startsWith('hs-flag'));

  it('builds no flag spans on a refresh where the flags did not change', () => {
    const { game } = roomGame();
    const panel = createQueryPanel(game, { roomId: 1 }, ctx);
    expect(flags(panel).map((n) => n.textContent)).toEqual(['Empty']);
    dom.created = 0;
    panel.refresh?.();
    panel.refresh?.();
    expect(dom.created).toBe(0);
  });

  it('rebuilds the flags when the string changes', () => {
    const { game, room } = roomGame();
    const panel = createQueryPanel(game, { roomId: 1 }, ctx);
    room['vacant'] = false;
    room['onFire'] = true;
    panel.refresh?.();
    expect(flags(panel).map((n) => [n.textContent, n.className])).toEqual([['On fire', 'hs-flag is-alert']]);
  });
});

describe('settings panel sound section', () => {
  function stubSound() {
    const calls: string[] = [];
    const settings = { on: false, effects: 70, ambient: 50 };
    const sound: Sound = {
      settings,
      hasContext: false,
      setEnabled: (on) => {
        settings.on = on;
        calls.push(`on:${on}`);
      },
      setEffects: (n) => calls.push(`effects:${n}`),
      setAmbient: (n) => calls.push(`ambient:${n}`),
      destroy: () => {},
    };
    return { sound, calls };
  }
  const fire = (target: FakeElement, type: string): void => {
    for (const fn of target.listeners.get(type) ?? []) fn({});
  };
  const settingsGame = { world: { seed: 1, log: [], logTotal: 0 } } as never;

  it('shows the switch off and both levels disabled by default, and wires them to the sound module', () => {
    const { sound, calls } = stubSound();
    const panel = node(createSettingsPanel(settingsGame, { ...ctx, sound }));
    const all = panel.descendants();
    expect(all.some((n) => n.className === 'hs-section-title' && n.textContent === 'Sound')).toBe(true);
    const box = all.find((n) => n.id === 'hs-sound') as FakeElement;
    const effects = all.find((n) => n.id === 'hs-sound-effects') as unknown as FakeElement & { value: string; disabled: boolean };
    const ambient = all.find((n) => n.id === 'hs-sound-ambient') as unknown as FakeElement & { value: string; disabled: boolean };
    expect([box.tagName, box.getAttribute('role'), box.getAttribute('aria-checked')]).toEqual(['BUTTON', 'switch', 'false']);
    expect([effects.value, ambient.value]).toEqual(['70', '50']);
    expect([effects.disabled, ambient.disabled]).toEqual([true, true]);

    fire(box, 'click');
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect([effects.disabled, ambient.disabled]).toEqual([false, false]);
    effects.value = '25';
    fire(effects, 'input');
    ambient.value = '0';
    fire(ambient, 'input');
    expect(calls).toEqual(['on:true', 'effects:25', 'ambient:0']);
  });

  it('has no sound section when the shell made no sound module', () => {
    const panel = node(createSettingsPanel(settingsGame, ctx));
    expect(panel.descendants().some((n) => n.textContent === 'Sound')).toBe(false);
  });
});

describe('panel header', () => {
  const head = (panel: unknown): FakeElement => {
    const found = node(panel).children.find((n) => n.className === 'hs-panel-head');
    if (!found) throw new Error('no header');
    return found;
  };

  it('gives every panel the same header: a section icon, the title, and Close', () => {
    const { game } = logGame();
    const room = {
      world: {
        rooms: new Map([[1, { id: 1, kind: 'office', floor: 2, height: 1, eval: 0.5, tenants: [], occupancy: 0, vacant: true, rent: RENT.default }]]),
        shafts: new Map(),
        sims: new Map(),
      },
    } as never;
    const cases: [unknown, string, string][] = [
      [createLogPanel(game, ctx), 'News', 'log'],
      [createSettingsPanel({ world: { seed: 1, log: [], logTotal: 0 } } as never, ctx), 'Settings', 'settings'],
      [createQueryPanel(room, { roomId: 1 }, ctx), 'Office', 'room'],
      [createQueryPanel(room, { roomId: 99 }, ctx), 'Nothing selected', 'query'],
    ];
    for (const [panel, title, section] of cases) {
      const [name, close] = head(panel).children;
      expect(name?.tagName).toBe('H2');
      const svg = name?.children[0] as FakeElement;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.children[0]?.getAttribute('href')).toBe(`#hs-icon-${section}`);
      expect(name?.textContent).toBe(title);
      expect(close?.textContent).toBe('Close');
      expect(close?.getAttribute('aria-label')).toBe(`Close ${title.toLowerCase()}`);
    }
  });
});

describe('settings: saved games and new game', () => {
  const click = (target: FakeElement): void => {
    for (const fn of target.listeners.get('click') ?? []) fn({});
  };
  const named = (panel: unknown, text: string): FakeElement[] =>
    node(panel).descendants().filter((n) => n.tagName === 'BUTTON' && n.textContent === text);

  it('says the tower saves by itself and names each save button in plain words', () => {
    const panel = createSettingsPanel({ world: { seed: 1, log: [], logTotal: 0 } } as never, ctx);
    const all = node(panel).descendants();
    expect(all.some((n) => n.className === 'hs-section-title' && n.textContent === 'Saving')).toBe(true);
    expect(all.some((n) => n.className === 'hs-note' && n.textContent === 'Your tower saves by itself.')).toBe(true);
    for (const text of ['Save now', 'Go back to last save', 'Save to a file', 'Open a saved file']) expect(named(panel, text)).toHaveLength(1);
    for (const old of ['Save', 'Load', 'Export', 'Import']) expect(named(panel, old)).toHaveLength(0);
    const file = all.find((n) => n.id === 'hs-import') as FakeElement;
    expect(file.getAttribute('aria-label')).toBe('Open a saved file');
    expect(named(panel, 'Open a saved file')[0]?.getAttribute('aria-controls')).toBe('hs-import');
  });

  it('tells the player where they are after going back to the last save', async () => {
    const notices: string[] = [];
    const game = { world: { seed: 1, log: [], logTotal: 0 }, load: async () => ({ ok: true }) } as never;
    const panel = createSettingsPanel(game, { ...ctx, notice: (t) => notices.push(t) });
    click(named(panel, 'Go back to last save')[0] as FakeElement);
    await Promise.resolve();
    await Promise.resolve();
    expect(notices).toEqual(['Back to your last save.']);
  });

  it('has no starting number field, and New game starts a fresh random tower', () => {
    const started: number[] = [];
    const notices: string[] = [];
    const game = { world: { seed: 424242, log: [], logTotal: 0 }, newGame: (n: number) => started.push(n) } as never;
    const panel = createSettingsPanel(game, { ...ctx, notice: (t) => notices.push(t) });
    const all = node(panel).descendants();
    expect(all.some((n) => n.id === 'hs-seed')).toBe(false);
    expect(all.some((n) => n.tagName === 'INPUT' && (n as unknown as { type: string }).type === 'number')).toBe(false);
    const realNow = Date.now;
    Date.now = () => 1_758_700_000_123;
    try {
      click(named(panel, 'New game')[0] as FakeElement);
    } finally {
      Date.now = realNow;
    }
    expect(started).toEqual([123]);
    expect(notices).toEqual(['New game started.']);
  });
});

describe('room panel rent stepper', () => {
  function rentGame(rent: number = RENT.default) {
    const room: Record<string, unknown> = {
      id: 1, kind: 'office', floor: 2, height: 1, eval: 0.8, tenants: [], occupancy: 0,
      vacant: false, dirty: false, infested: false, onFire: false, rent,
    };
    const applied: unknown[] = [];
    const game = { world: { seed: 1, rooms: new Map([[1, room]]), shafts: new Map(), sims: new Map() } } as never;
    const c: PanelContext = { ...ctx, apply: (cmd) => (applied.push(cmd), { ok: true }) as never };
    return { game, room, applied, c };
  }
  const click = (target: FakeElement): void => {
    for (const fn of target.listeners.get('click') ?? []) fn({});
  };

  it('is one pill: minus, the percent, plus, with the old labels, and the money under it', () => {
    const { game, applied, c } = rentGame();
    const panel = node(createQueryPanel(game, { roomId: 1 }, c));
    const pill = panel.descendants().find((n) => n.className === 'hs-stepper') as FakeElement;
    expect(pill.getAttribute('role')).toBe('group');
    expect(pill.getAttribute('aria-label')).toBe('Rent');
    expect(pill.children.map((n) => [n.tagName, n.getAttribute('aria-label'), n.textContent])).toEqual([
      ['BUTTON', 'Lower rent', '−'],
      ['SPAN', null, `${RENT.default}%`],
      ['BUTTON', 'Raise rent', '+'],
    ]);
    const money = panel.descendants().find((n) => n.className === 'hs-money') as FakeElement;
    expect(money.textContent).toMatch(/^\$[\d,]+ per quarter now$/);
    click(pill.children[0] as FakeElement);
    click(pill.children[2] as FakeElement);
    expect(applied).toEqual([
      { kind: 'room.setRent', roomId: 1, rent: RENT.default - RENT.step },
      { kind: 'room.setRent', roomId: 1, rent: RENT.default + RENT.step },
    ]);
    const reset = panel.descendants().find((n) => n.getAttribute('aria-label') === 'Reset rent') as FakeElement;
    expect(reset.hidden).toBe(true);
  });

  it('follows the room on refresh and holds at the ends', () => {
    const { game, room, c } = rentGame(RENT.min);
    const panel = createQueryPanel(game, { roomId: 1 }, c);
    const pill = node(panel).descendants().find((n) => n.className === 'hs-stepper') as FakeElement;
    const [minus, value, plus] = pill.children as [FakeElement, FakeElement, FakeElement];
    expect([minus.disabled, plus.disabled, value.textContent]).toEqual([true, false, `${RENT.min}%`]);
    room['rent'] = RENT.max;
    panel.refresh?.();
    expect([minus.disabled, plus.disabled, value.textContent]).toEqual([false, true, `${RENT.max}%`]);
  });
});

describe('finances bento', () => {
  it('shows cash now and last quarter as tiles, a small label over a big number in the money face', () => {
    const stats = { lastQuarter: { income: 30_000, upkeep: 12_000, net: 18_000 }, incomeByKind: { office: 30_000 }, upkeepByKind: {} };
    const world = { cash: 250_000, stats };
    const panel = node(createFinancesPanel({ world } as never, ctx));
    const bento = panel.descendants().find((n) => n.className === 'hs-bento') as FakeElement;
    const tiles = bento.children.map((t) => [t.className, t.children[0]?.textContent, t.children[1]?.textContent, t.children[1]?.className]);
    expect(tiles).toEqual([
      ['hs-tile is-wide', 'Cash now', '$250,000', 'hs-tile-value hs-money'],
      ['hs-tile', 'Income last quarter', '$30,000', 'hs-tile-value hs-money'],
      ['hs-tile', 'Costs last quarter', '$12,000', 'hs-tile-value hs-money'],
      ['hs-tile is-wide is-up', 'Profit last quarter', '+$18,000', 'hs-tile-value hs-money'],
    ]);
    world.cash = 1_000;
    stats.lastQuarter = { income: 0, upkeep: 5_000, net: -5_000 };
    (panel as unknown as { refresh(): void }).refresh();
    expect(bento.children[0]?.children[1]?.textContent).toBe('$1,000');
    expect(bento.children[3]?.className).toBe('hs-tile is-wide is-down');
    expect(panel.descendants().some((n) => n.className === 'hs-row-value hs-money' && n.textContent === '$30,000')).toBe(true);
  });
});

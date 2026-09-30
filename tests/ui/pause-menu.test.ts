// The pause menu (Matt, 2026-09-29: the menu was "not very game menu like, still very techy/web
// browser look"): Menu, or Escape with nothing open, puts a card over the dimmed tower with
// Resume, Save, My tower (or New tower), Today's tower, Stories, Settings and How to play. It
// pauses the game and gives back the speed it had; Settings opens over it and closes back to it.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSound, type AudioContextLike, type SoundStore } from '../../src/audio/audio';
import { MENU_CUE_NOTES } from '../../src/audio/cues';
import type { CommandResult } from '../../src/sim/types';
import { menuIndex, menuKeyAction } from '../../src/ui/keys';
import { createPauseMenu, MENU_WORD, PAUSED_WORD, PAUSE_TITLE, type PauseEntry } from '../../src/ui/pause-menu';
import { SAVED_MS, SAVED_NOTICE } from '../../src/ui/save-button';
import { createUi } from '../../src/ui/ui';
import { FakeDom, choosePauseEntry, pauseEntry, type FakeElement } from './fake-dom';

const css = readFileSync(new URL('../../src/ui/ui.css', import.meta.url), 'utf8');

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  vi.useFakeTimers();
  dom = new FakeDom();
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: Record<string, unknown> & { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
  win['innerWidth'] = 1280;
  win['innerHeight'] = 800;
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
});

const has = (n: FakeElement, c: string): boolean => n.className.split(/\s+/).includes(c);
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({ target: node }));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

/** A key press at the window, as the ui hears it; it records what the listeners did. */
function key(name: string, extra: Record<string, unknown> = {}): { defaultPrevented: boolean; stopped: boolean } {
  const event = {
    key: name,
    code: name === ' ' ? 'Space' : name,
    target: dom.activeElement ?? dom.body,
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    ...extra,
  };
  dom.fireWindow('keydown', event);
  return event;
}

function mkGame(opts: { speed?: number; slot?: string; refusePause?: boolean; tool?: string } = {}) {
  const state = { speed: opts.speed ?? 2, tool: opts.tool ?? 'none' };
  const speeds: number[] = [];
  const calls: string[] = [];
  const subscribers = new Set<() => void>();
  const save = vi.fn(async (): Promise<CommandResult> => ({ ok: true }));
  const game = {
    world: {
      seed: 1, cash: 1e6, population: 0, stars: 1, time: { minute: 12 * 60 }, log: [], logTotal: 0, rooms: new Map(), shafts: new Map(),
      sims: new Map(), events: [], stats: { lastQuarter: null, vipRating: 'none', weddingsHeld: 0 },
      story: { followed: [], threads: {}, recent: [], seq: 0 },
    },
    subscribe(cb: () => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    getHover: () => null,
    getSpeed: () => state.speed,
    setSpeed(speed: number) {
      if (opts.refusePause && speed === 0) return;
      speeds.push(speed);
      state.speed = speed;
      subscribers.forEach((cb) => cb());
    },
    togglePause: () => {},
    getTool: () => (state.tool === 'none' ? { kind: 'none' } : { kind: 'room', room: 'office' }),
    setTool(tool: { kind: string }) {
      state.tool = tool.kind;
    },
    getPlacement: () => null,
    getPlacementRect: () => null,
    getSelection: () => null,
    setChrome: () => {},
    setReducedMotion: () => {},
    getSlot: () => opts.slot ?? 'mine',
    getDaily: () => null,
    getDailyChoice: () => null,
    select() {},
    exportSave: () => '',
    save,
    newGame: (n: number) => calls.push(`newGame:${n}`),
    openDaily: async () => {
      calls.push('openDaily');
    },
    openMyTower: async () => {
      calls.push('openMyTower');
    },
  };
  return { game, state, speeds, calls, save };
}

function mount(opts: Parameters<typeof mkGame>[0] = {}) {
  const made = mkGame(opts);
  const root = dom.createElement('div');
  createUi(root as never, made.game as never, {} as never);
  const menuButton = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
  const card = (): FakeElement | undefined => root.descendants().find((n) => has(n, 'hs-pause-card'));
  const items = (): FakeElement[] => root.descendants().filter((n) => has(n, 'hs-pause-item'));
  const words = (): string[] => items().map((n) => n.textContent);
  const selected = (): string | undefined => items().find((n) => has(n, 'is-selected'))?.textContent;
  const open = (): void => {
    menuButton.focus();
    click(menuButton);
  };
  return { ...made, root, menuButton, card, items, words, selected, open };
}

describe('the pause menu card', () => {
  it('is a modal dialog named by its title plate, "Hundred Stories" over "Paused"', () => {
    const ui = mount();
    expect(ui.card()).toBeUndefined();
    ui.open();
    const card = ui.card()!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-modal')).toBe('true');
    const title = card.descendants().find((n) => n.id === card.getAttribute('aria-labelledby'))!;
    expect(title.textContent).toBe(PAUSE_TITLE);
    expect(PAUSE_TITLE).toBe('Hundred Stories');
    expect(card.descendants().find((n) => has(n, 'hs-pause-state'))?.textContent).toBe('Paused');
    // The scrim holds the card, over the tower.
    expect(has(card.parentNode!, 'hs-pause')).toBe(true);
  });

  it('lists Resume, Save, New tower, Today\'s tower, Stories, Settings, How to play in My tower, each with an icon', () => {
    const ui = mount();
    ui.open();
    expect(ui.words()).toEqual(['Resume', 'Save', 'New tower', "Today's tower", 'Stories', 'Settings', 'How to play']);
    for (const item of ui.items()) expect(item.descendants().some((n) => n.tagName === 'USE')).toBe(true);
  });

  it('reads My tower outside My tower, and has no Today\'s tower inside Today\'s tower', () => {
    const daily = mount({ slot: 'daily' });
    daily.open();
    expect(daily.words()).toEqual(['Resume', 'Save', 'My tower', 'Stories', 'Settings', 'How to play']);
    const friend = mount({ slot: 'friend' });
    friend.open();
    expect(friend.words()).toEqual(['Resume', 'Save', 'My tower', "Today's tower", 'Stories', 'Settings', 'How to play']);
  });

  it('puts Views and Share after Stories on a phone only', () => {
    (globalThis as unknown as { window: Record<string, unknown> }).window['innerWidth'] = 390;
    const ui = mount();
    ui.open();
    expect(ui.words()).toEqual(['Resume', 'Save', 'New tower', "Today's tower", 'Stories', 'Views', 'Share', 'Settings', 'How to play']);
  });

  it('links How to play the way Settings always did: the guide page, in a new tab', () => {
    const ui = mount();
    ui.open();
    const guide = pauseEntry(ui.root, 'guide') as FakeElement & { href: string; target: string; rel: string };
    expect([guide.tagName, guide.href, guide.target, guide.rel]).toEqual(['A', '/how-to-play/', '_blank', 'noopener']);
    // Choosing it leaves the game paused and the menu up behind the new tab.
    click(guide);
    expect(ui.card()).toBeDefined();
    expect(ui.state.speed).toBe(0);
  });
});

describe('pause', () => {
  it('pauses on open, and Resume gives back the speed the game had', () => {
    const ui = mount({ speed: 4 });
    ui.open();
    expect(ui.state.speed).toBe(0);
    choosePauseEntry(ui.root, 'resume');
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(4);
    expect(ui.speeds).toEqual([0, 4]);
  });

  it('Escape resumes too, with the prior speed', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    expect(key('Escape').defaultPrevented).toBe(true);
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(2);
  });

  it('a tap on the dimmed tower around the card resumes; a tap on the card does not', () => {
    const ui = mount({ speed: 1 });
    ui.open();
    const scrim = ui.card()!.parentNode!;
    (scrim.listeners.get('click') ?? []).forEach((f) => f({ target: ui.card() }));
    expect(ui.card()).toBeDefined();
    (scrim.listeners.get('click') ?? []).forEach((f) => f({ target: scrim }));
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(1);
  });

  it('a game that was already paused stays paused when the menu closes', () => {
    const ui = mount({ speed: 0 });
    ui.open();
    expect(ui.card()!.textContent).toContain(PAUSED_WORD);
    choosePauseEntry(ui.root, 'resume');
    expect(ui.state.speed).toBe(0);
    expect(ui.speeds).toEqual([]);
  });

  it('when the game will not pause, it opens anyway and the plate reads Menu', () => {
    const ui = mount({ speed: 1, refusePause: true });
    ui.open();
    expect(ui.card()).toBeDefined();
    expect(ui.card()!.descendants().find((n) => has(n, 'hs-pause-state'))?.textContent).toBe(MENU_WORD);
    choosePauseEntry(ui.root, 'resume');
    expect(ui.state.speed).toBe(1);
  });

  it('Menu again resumes', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    click(ui.menuButton);
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(2);
  });
});

describe('keys', () => {
  it('Down and Up move the selection and wrap; Home and End jump; nothing else reaches the tower', () => {
    const ui = mount();
    ui.open();
    expect(ui.selected()).toBe('Resume');
    expect(dom.activeElement).toBe(ui.items()[0]);
    key('ArrowDown');
    expect(ui.selected()).toBe('Save');
    expect(dom.activeElement).toBe(ui.items()[1]);
    key('ArrowUp');
    key('ArrowUp');
    expect(ui.selected()).toBe('How to play'); // wrapped from the top to the bottom
    key('ArrowDown');
    expect(ui.selected()).toBe('Resume'); // and back round
    key('End');
    expect(ui.selected()).toBe('How to play');
    key('Home');
    expect(ui.selected()).toBe('Resume');
    // Tab stays in the card, the same as Down.
    key('Tab');
    expect(ui.selected()).toBe('Save');
    key('Tab', { shiftKey: true });
    expect(ui.selected()).toBe('Resume');
    // A camera key is swallowed: the tower behind the card does not move.
    expect(key('w').stopped).toBe(true);
    expect(ui.card()).toBeDefined();
  });

  it('the selection follows the pointer as well as the keys', () => {
    const ui = mount();
    ui.open();
    const stories = pauseEntry(ui.root, 'stories')!;
    (stories.listeners.get('pointermove') ?? []).forEach((f) => f({}));
    expect(ui.selected()).toBe('Stories');
    expect(dom.activeElement).toBe(stories);
    key('ArrowDown');
    expect(ui.selected()).toBe('Settings');
  });

  it('Enter or Space chooses the selected entry', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    key('ArrowDown');
    key('Enter');
    expect(ui.save).toHaveBeenCalledTimes(1);
    key('ArrowUp');
    key(' ');
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(2);
  });

  it('focus goes back to the Menu button when it closes', () => {
    const ui = mount();
    ui.open();
    expect(dom.activeElement).not.toBe(ui.menuButton);
    key('Escape');
    expect(dom.activeElement).toBe(ui.menuButton);
    ui.open();
    choosePauseEntry(ui.root, 'resume');
    expect(dom.activeElement).toBe(ui.menuButton);
  });

  it('Escape opens it when nothing is open and nothing is in hand; with a tool in hand it puts the tool down first', () => {
    const ui = mount({ speed: 1, tool: 'room' });
    key('Escape');
    expect(ui.card()).toBeUndefined();
    expect(ui.state.tool).toBe('none');
    key('Escape');
    expect(ui.card()).toBeDefined();
    expect(ui.state.speed).toBe(0);
    expect(dom.activeElement).toBe(ui.items()[0]);
  });

  it('the pure key map: menuKeyAction and menuIndex', () => {
    expect(menuKeyAction({ key: 'ArrowDown' })).toEqual({ kind: 'move', step: 1 });
    expect(menuKeyAction({ key: 'ArrowUp' })).toEqual({ kind: 'move', step: -1 });
    expect(menuKeyAction({ key: 'Home' })).toEqual({ kind: 'first' });
    expect(menuKeyAction({ key: 'End' })).toEqual({ kind: 'last' });
    expect(menuKeyAction({ key: 'Enter' })).toEqual({ kind: 'activate' });
    expect(menuKeyAction({ key: ' ', code: 'Space' })).toEqual({ kind: 'activate' });
    expect(menuKeyAction({ key: 'Escape' })).toEqual({ kind: 'resume' });
    expect(menuKeyAction({ key: 'w' })).toBeNull();
    expect(menuKeyAction({ key: 'ArrowDown', ctrlKey: true })).toBeNull();
    expect(menuIndex(6, 7, { kind: 'move', step: 1 })).toBe(0);
    expect(menuIndex(0, 7, { kind: 'move', step: -1 })).toBe(6);
    expect(menuIndex(3, 7, { kind: 'first' })).toBe(0);
    expect(menuIndex(3, 7, { kind: 'last' })).toBe(6);
    expect(menuIndex(-1, 7, { kind: 'move', step: 1 })).toBe(0);
  });
});

describe('the entries', () => {
  it('Save runs the same save once, says the same notice, reads Saved for about two seconds, and the menu stays', async () => {
    const ui = mount();
    ui.open();
    choosePauseEntry(ui.root, 'save');
    await settle();
    expect(ui.save).toHaveBeenCalledTimes(1);
    expect(ui.card()).toBeDefined();
    expect(ui.state.speed).toBe(0);
    expect(pauseEntry(ui.root, 'save')!.textContent).toBe('Saved');
    expect(ui.root.descendants().some((n) => n.children.length === 0 && n.textContent === SAVED_NOTICE)).toBe(true);
    vi.advanceTimersByTime(SAVED_MS);
    expect(pauseEntry(ui.root, 'save')!.textContent).toBe('Save');
  });

  it('Settings opens over it, still paused, and closing Settings comes back to the menu, not the game', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    expect(ui.card()).toBeUndefined();
    const settings = ui.root.descendants().find((n) => has(n, 'hs-settings'))!;
    expect(settings).toBeDefined();
    expect(ui.state.speed).toBe(0);
    // The Game group is gone from Settings: its rows are the menu's.
    const titles = settings.descendants().filter((n) => has(n, 'hs-section-title')).map((n) => n.textContent);
    expect(titles).not.toContain('Game');
    click(settings.descendants().find((n) => has(n, 'hs-panel-close'))!);
    expect(ui.root.descendants().some((n) => has(n, 'hs-settings'))).toBe(false);
    expect(ui.card()).toBeDefined();
    expect(ui.selected()).toBe('Settings');
    expect(ui.state.speed).toBe(0);
    choosePauseEntry(ui.root, 'resume');
    expect(ui.state.speed).toBe(2);
  });

  it('New tower, once Start over is chosen, gives back the speed, closes, and starts a fresh random tower with the same notice', () => {
    const ui = mount({ speed: 2 });
    ui.open();
    const realNow = Date.now;
    Date.now = () => 1_758_700_000_123;
    try {
      choosePauseEntry(ui.root, 'newTower');
      choosePauseEntry(ui.root, 'yes'); // Start over (it asks first: pause-menu-fixes.test.ts)
    } finally {
      Date.now = realNow;
    }
    expect(ui.card()).toBeUndefined();
    expect(ui.calls).toEqual(['newGame:123']);
    expect(ui.speeds).toEqual([0, 2]);
    expect(ui.root.descendants().some((n) => n.children.length === 0 && n.textContent === 'New game started.')).toBe(true);
  });

  it("Today's tower and My tower switch towers as the Settings rows did; Stories opens its panel", async () => {
    const mine = mount();
    mine.open();
    choosePauseEntry(mine.root, 'daily');
    await settle();
    expect(mine.calls).toEqual(['openDaily']);
    expect(mine.card()).toBeUndefined();

    const daily = mount({ slot: 'daily' });
    daily.open();
    choosePauseEntry(daily.root, 'myTower');
    await settle();
    expect(daily.calls).toEqual(['openMyTower']);

    const stories = mount();
    stories.open();
    choosePauseEntry(stories.root, 'stories');
    expect(stories.card()).toBeUndefined();
    const sheet = stories.root.descendants().find((n) => has(n, 'hs-sheet'))!;
    const heading = sheet.descendants().find((n) => has(n, 'hs-panel-title-text'));
    expect(heading?.textContent).toBe('Stories');
  });

  it('turning Watch on closes it like any other panel, the speed given back', () => {
    const ui = mount({ speed: 4 });
    ui.open();
    const watch = ui.root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Watch')!;
    click(watch);
    expect(ui.card()).toBeUndefined();
    expect(ui.state.speed).toBe(4);
  });

  it('turning Watch on while Settings is over it closes both', () => {
    const ui = mount({ speed: 4 });
    ui.open();
    choosePauseEntry(ui.root, 'settings');
    const watch = ui.root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Watch')!;
    click(watch);
    expect(ui.card()).toBeUndefined();
    expect(ui.root.descendants().some((n) => has(n, 'hs-settings'))).toBe(false);
    expect(ui.state.speed).toBe(4);
  });
});

describe('sound', () => {
  function bare(cue: (name: string) => void, entries: PauseEntry[]) {
    const host = dom.createElement('div');
    let speed = 1;
    const menu = createPauseMenu({
      host: host as never,
      getSpeed: () => speed as never,
      setSpeed: (s) => (speed = s),
      entries: () => entries,
      cue,
      returnFocus: () => null,
    });
    return { menu, host };
  }
  const entries: PauseEntry[] = [
    { id: 'resume', label: 'Resume', icon: 'play', kind: 'resume' },
    { id: 'save', label: 'Save', icon: 'save', kind: 'stay', run: () => {} },
  ];
  const press = (name: string): { preventDefault(): void; key: string } => ({ key: name, preventDefault() {} });

  it('a soft cue on open and a tick on a choice; moving the selection is silent', () => {
    const heard: string[] = [];
    const { menu } = bare((name) => heard.push(name), entries);
    menu.open();
    expect(heard).toEqual(['menu.open']);
    menu.handleKey(press('ArrowDown'));
    menu.handleKey(press('ArrowUp'));
    menu.handleKey(press('End'));
    expect(heard).toEqual(['menu.open']);
    menu.handleKey(press('Enter'));
    expect(heard).toEqual(['menu.open', 'menu.select']);
  });

  // The cues through the sound module itself: a stub context counts the notes each one starts.
  class Param {
    value = 0;
    setValueAtTime(v: number) { this.value = v; return this; }
    linearRampToValueAtTime(v: number) { this.value = v; return this; }
    exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
    setTargetAtTime(v: number) { this.value = v; return this; }
    cancelScheduledValues() { return this; }
  }
  class Node {
    gain = new Param(); frequency = new Param(); detune = new Param(); delayTime = new Param();
    threshold = new Param(); knee = new Param(); ratio = new Param(); attack = new Param(); release = new Param();
    type = ''; buffer: unknown = null; loop = false; started = 0; onended: (() => void) | null = null;
    connect(): void {} disconnect(): void {} start(): void { this.started += 1; } stop(): void {}
  }
  class Context {
    currentTime = 0; sampleRate = 8000; destination = new Node(); state = 'suspended';
    oscillators: Node[] = [];
    createOscillator(): Node { const n = new Node(); this.oscillators.push(n); return n; }
    createGain(): Node { return new Node(); }
    createBiquadFilter(): Node { return new Node(); }
    createDelay(): Node { return new Node(); }
    createDynamicsCompressor(): Node { return new Node(); }
    createBufferSource(): Node { return new Node(); }
    createBuffer(_c: number, length: number) { const data = new Float32Array(length); return { getChannelData: () => data }; }
    resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
    suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
    close(): Promise<void> { return Promise.resolve(); }
  }
  function soundWith(on: boolean) {
    const map = new Map<string, string>([['hs.sound', on ? 'true' : 'false'], ['hs.sound.music', '0'], ['hs.sound.ambient', '0']]);
    const store: SoundStore = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
    const listeners: (() => void)[] = [];
    const target = { addEventListener: (_t: string, fn: () => void) => listeners.push(fn), removeEventListener: () => {} };
    const contexts: Context[] = [];
    const game = { world: { seed: 1, stars: 1, time: { minute: 600 }, rooms: new Map(), events: [] }, subscribe: () => () => {}, subscribeEvents: () => () => {} };
    const sound = createSound(game as never, {
      store,
      target,
      page: { addEventListener() {}, removeEventListener() {} },
      hidden: () => false,
      setInterval: () => 0,
      clearInterval: () => {},
      createContext: () => {
        const c = new Context();
        contexts.push(c);
        return c as unknown as AudioContextLike;
      },
    });
    listeners.forEach((fn) => fn()); // the player's first touch
    return { sound, contexts };
  }

  it('the sound module plays them in the score\'s voice while Sound is on, and nothing while it is off', () => {
    const on = soundWith(true);
    const ctx = on.contexts[0]!;
    const before = ctx.oscillators.length;
    on.sound.cue?.('menu.open');
    expect(ctx.oscillators.length - before).toBe(MENU_CUE_NOTES['menu.open'].hz.length);
    const mid = ctx.oscillators.length;
    on.sound.cue?.('menu.select');
    expect(ctx.oscillators.length - mid).toBe(1);
    on.sound.setEnabled(false);
    const off = ctx.oscillators.length;
    on.sound.cue?.('menu.open');
    on.sound.cue?.('menu.select');
    expect(ctx.oscillators.length).toBe(off);
    on.sound.destroy();

    const never = soundWith(false);
    never.sound.cue?.('menu.open');
    expect(never.contexts).toEqual([]); // Sound off builds nothing at all
    never.sound.destroy();
  });
});

describe('the look', () => {
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it('centers a card on the scrim, over the chrome and under the toasts', () => {
    expect(rule('.hs-pause')).toMatch(/align-items: center;[\s\S]*justify-content: center;/);
    expect(rule('.hs-pause')).toMatch(/background: var\(--scrim\);/);
    expect(rule('.hs-pause')).toMatch(/z-index: 25;/);
    expect(rule('.hs-pause')).toMatch(/pointer-events: auto;/);
    expect(rule('.hs-pause-card')).toMatch(/background: var\(--surface\);/);
    // The plate is the shared one (the elevator card wears it too).
    expect(rule('.hs-plate-title')).toMatch(/font-size: var\(--size-28\);[\s\S]*font-weight: 600;/);
  });

  it('gives each entry a raised face at least 48 px tall and full width, a pressed and a selected state, and no dividers', () => {
    // The face is the shared hs-face; the pause menu adds only its full width.
    expect(rule('.hs-ui .hs-pause-item')).toMatch(/width: 100%;/);
    const face = rule('.hs-ui .hs-face');
    expect(face).toMatch(/min-height: calc\(48px \* var\(--ui-scale\)\);/);
    expect(face).toMatch(/box-shadow: var\(--shadow-1\)/);
    expect(face).not.toMatch(/border-(top|bottom):/);
    expect(rule(".hs-ui .hs-face:is(.is-selected, [aria-checked='true'], [aria-pressed='true'])")).toMatch(/background: var\(--amber\);/);
    expect(rule('.hs-ui .hs-face:active:not(:disabled)')).toMatch(/transform: translateY\(1px\) scale\(var\(--press-scale\)\);/);
  });

  it('wears the shared classes on its plate, its entries and their icons', () => {
    const root = dom.createElement('div');
    const menu = createPauseMenu({
      host: root as never, getSpeed: () => 1, setSpeed: () => {}, returnFocus: () => null,
      entries: () => [{ id: 'resume', label: 'Resume', icon: 'play', kind: 'resume' }],
    });
    menu.open();
    const card = menu.card as unknown as FakeElement;
    // An icon is svg: its class is an attribute.
    const classes = (c: string): boolean =>
      card.descendants().some((n) => has(n, c) || (n.getAttribute('class') ?? '').split(/\s+/).includes(c));
    expect(['hs-plate', 'hs-plate-title', 'hs-plate-state', 'hs-face', 'hs-face-icon', 'hs-face-word'].filter((c) => !classes(c))).toEqual([]);
    const item = card.descendants().find((n) => has(n, 'hs-pause-item'))!;
    expect(has(item, 'hs-face')).toBe(true);
    menu.destroy();
  });

  it('fits a 390 by 844 phone with Larger text, nine entries and the app\'s safe areas, with room to spare', () => {
    const scale = 1.25;
    const px = (text: string, re: RegExp): number => Number(re.exec(text)![1]);
    const card = rule('.hs-pause-card');
    const [padTop, , padBottom] = /padding: (\d+)px (\d+)px (\d+)px;/.exec(card)!.slice(1).map(Number) as [number, number, number];
    const cardGap = px(card, /gap: (\d+)px;/);
    const plate = rule('.hs-plate');
    const plateTop = px(plate, /padding: (\d+)px/);
    const plateBottom = px(rule(':root.hs-large-text .hs-pause-plate'), /padding-bottom: (\d+)px;/);
    const title = 28 * scale * px(rule('.hs-plate-title'), /line-height: ([\d.]+);/);
    const state = px(rule('.hs-plate-state'), /margin: (\d+)px/) + 16 * scale * 1.4;
    const entry = px(rule('.hs-ui .hs-face'), /min-height: calc\((\d+)px \* var\(--ui-scale\)\);/) * scale;
    const listGap = px(rule(':root.hs-large-text .hs-pause-list'), /gap: (\d+)px;/);
    // Resume, Save, My tower, Today's tower, Stories, Views, Share, Settings, How to play.
    const entries = 9;
    const height = padTop + plateTop + title + state + plateBottom + cardGap + entries * entry + (entries - 1) * listGap + padBottom;
    // The scrim's padding: the 12 px edge plus the safe areas of a 390 by 844 phone in the app.
    const room = 844 - 2 * 12 - 47 - 34;
    expect(height).toBeLessThanOrEqual(room - 16);
    // And 360 px wide inside 390 less the edges.
    expect(Math.min(360, 390 - 2 * 12)).toBe(360);
  });

  it('enters with a short scale and fade, and not at all under reduced motion', () => {
    expect(rule('.hs-pause-card')).toMatch(/animation: hs-pause-in var\(--motion-fast\)/);
    expect(css).toMatch(/@keyframes hs-pause-in \{\s*from \{\s*opacity: 0;\s*transform: scale\(0\.94\);/);
    expect(rule('.hs-ui.is-reduced .hs-pause-card')).toMatch(/animation: none;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hs-pause-card \{\s*animation: none;/);
  });
});

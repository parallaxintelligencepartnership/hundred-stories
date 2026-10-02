// Save and exit (P4d): the pause menu's last entry saves the tower in hand (GameApi.leave('exit'))
// and then puts up the exited screen; a save that did not go through shows the leave card and
// never loses the tower. The real ui on the fake DOM, over the real game and the real storage
// module on fake browser stores (tests/game/leave-stores.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { SAVE_PRESENT_KEY } from '../../src/game/storage';
import { createUi } from '../../src/ui/ui';
import { LEAVE_WITHOUT_SAVING } from '../../src/ui/leave-card';
import { NEW_TOWER_QUESTION } from '../../src/ui/pause-menu';
import { readSoundSettings } from '../../src/audio/audio';
import { CLIPS_URL } from '../../src/ui/clips';
import {
  CONTINUE_TOWER,
  EXIT_LOGO_ALT,
  EXIT_SAVING_WORD,
  EXIT_WORD,
  EXIT_SAVED_NOTE,
  EXIT_SAVED_TEXT,
  EXIT_UNSAVED_TEXT,
} from '../../src/ui/exit-screen';
import { FakeDom, choosePauseEntry, pauseEntry, type FakeElement } from './fake-dom';
import { fakeIdb, fakeLocalStorage, handClock, savedTower, settle } from '../game/leave-stores';

const MINE_LS = 'hundred-stories:autosave';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  const win = (globalThis as unknown as { window: { localStorage: { setItem(k: string, v: string): void } } }).window;
  win.localStorage.setItem('hs.intro.seen', 'true');
  win.localStorage.setItem('hs.guide.done', 'true');
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const hasClass = (node: FakeElement, name: string): boolean => node.className.split(/\s+/).includes(name);
const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({ target: node }));
const exitNode = (root: FakeElement): FakeElement | undefined => root.descendants().find((n) => hasClass(n, 'hs-exit'));
const exitFace = (root: FakeElement, id: string): FakeElement => {
  const found = exitNode(root)?.descendants().find((n) => n.dataset['exit'] === id);
  if (!found) throw new Error(`no exit face ${id}`);
  return found;
};
const leaveBody = (root: FakeElement): FakeElement | undefined => root.descendants().find((n) => hasClass(n, 'hs-leave'));
const answer = (root: FakeElement, id: string): FakeElement => {
  const found = leaveBody(root)?.descendants().find((n) => n.dataset['answer'] === id);
  if (!found) throw new Error(`no answer ${id}`);
  return found;
};

function key(name: string, extra: Record<string, unknown> = {}) {
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

function gameOn(seed = 11) {
  const { clock, opts } = handClock();
  const game = createGame(seed, opts);
  const second = (): void => {
    clock.ms += 1000;
    game.stepOnce();
  };
  return { game, second };
}

function mount(game: ReturnType<typeof createGame>) {
  const order: string[] = [];
  const root = dom.createElement('div');
  const ui = createUi(root as never, game, {} as never, { reload: () => order.push('reload') });
  const menuButton = root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
  const openMenu = (): void => {
    menuButton.focus();
    click(menuButton);
  };
  const saveAndExit = (): void => {
    openMenu();
    choosePauseEntry(root, 'exit');
  };
  return { order, root, ui, openMenu, saveAndExit };
}

describe('Save and exit with a store that works', () => {
  it('saves the final tower, then the exited screen: the wordmark, the saved line, Continue tower with focus', async () => {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const { root, ui, saveAndExit } = mount(game);
    const open = idb.hold();
    saveAndExit();
    await settle();
    // Busy while the save runs, and saying so, and no screen yet.
    expect(pauseEntry(root, 'exit')?.getAttribute('aria-busy')).toBe('true');
    expect(pauseEntry(root, 'exit')?.textContent).toBe(EXIT_SAVING_WORD);
    expect(exitNode(root)).toBeUndefined();
    // Still busy a while later, for the whole save: a slow save does not look stuck.
    await settle();
    await settle();
    expect(pauseEntry(root, 'exit')?.getAttribute('aria-busy')).toBe('true');
    expect(pauseEntry(root, 'exit')?.textContent).toBe(EXIT_SAVING_WORD);
    open();
    await settle();
    const minute = game.world.time.minute;
    expect(savedTower(idb.data.get('autosave'))).toMatchObject({ minute, lobbies: [150] });
    const screen = exitNode(root)!;
    expect(screen).toBeDefined();
    expect(hasClass(root.descendants().find((n) => hasClass(n, 'hs-ui'))!, 'is-exited')).toBe(true);
    const logo = screen.descendants().find((n) => hasClass(n, 'hs-exit-logo'))!;
    expect(logo.tagName).toBe('IMG');
    expect(logo.getAttribute('alt')).toBe(EXIT_LOGO_ALT);
    expect(logo.getAttribute('src')).toMatch(/\.svg/);
    expect(screen.textContent).toContain(EXIT_SAVED_TEXT);
    expect(screen.textContent).toContain(EXIT_SAVED_NOTE);
    const faces = screen.descendants().filter((n) => n.dataset['exit']).map((n) => n.textContent);
    expect(faces).toEqual([CONTINUE_TOWER, 'Clips', 'New tower']);
    expect(dom.activeElement?.dataset['exit']).toBe('continue');
    // The pause card is out of sight under it; the clock holds and nothing can be built.
    expect(root.descendants().some((n) => hasClass(n, 'hs-pause-card'))).toBe(false);
    second();
    second();
    expect(game.world.time.minute).toBe(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(false);
    ui.destroy();
  });

  it('Continue tower: the screen goes, the clock runs at the speed from before the menu, a build is accepted', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    game.setSpeed(2);
    const store = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
    store.setItem('hs.sound', 'true');
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    expect(exitNode(root)).toBeDefined();
    expect(game.getSpeed()).toBe(0);
    // The score goes quiet, but the saved setting stays on for a game closed from here.
    expect(store.getItem('hs.sound')).toBe('true');
    click(exitFace(root, 'continue'));
    expect(exitNode(root)).toBeUndefined();
    expect(root.descendants().some((n) => hasClass(n, 'hs-pause-card'))).toBe(false);
    expect(game.getSpeed()).toBe(2);
    const minute = game.world.time.minute;
    second();
    expect(game.world.time.minute).toBeGreaterThan(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    expect(store.getItem('hs.sound')).toBe('true');
    ui.destroy();
  });

  it('keys do nothing while exited: Space, comma, period, a tool key and Escape; Tab stays inside', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    game.setSpeed(1);
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    const tool = game.getTool();
    for (const name of [' ', ',', '.', '1', 'Escape']) {
      const event = key(name);
      expect(event.stopped).toBe(true);
    }
    expect(game.getSpeed()).toBe(0);
    expect(game.getTool()).toEqual(tool);
    expect(exitNode(root)).toBeDefined();
    expect(root.descendants().some((n) => hasClass(n, 'hs-pause-card'))).toBe(false);
    // Tab walks the three faces and wraps; Shift+Tab goes back.
    expect(dom.activeElement?.dataset['exit']).toBe('continue');
    expect(key('Tab').defaultPrevented).toBe(true);
    expect(dom.activeElement?.dataset['exit']).toBe('clips');
    key('Tab');
    key('Tab');
    expect(dom.activeElement?.dataset['exit']).toBe('continue');
    key('Tab', { shiftKey: true });
    expect(dom.activeElement?.dataset['exit']).toBe('newTower');
    ui.destroy();
  });

  it('New tower asks the menu question first; Keep my tower goes back to the screen', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    const seed = game.world.seed;
    click(exitFace(root, 'newTower'));
    expect(exitNode(root)?.textContent).toContain(NEW_TOWER_QUESTION);
    expect(dom.activeElement?.dataset['exit']).toBe('no');
    click(exitFace(root, 'no'));
    expect(exitNode(root)?.textContent).toContain(EXIT_SAVED_TEXT);
    click(exitFace(root, 'newTower'));
    click(exitFace(root, 'yes'));
    await settle();
    expect(exitNode(root)).toBeUndefined();
    expect(game.world.seed).not.toBe(seed);
    ui.destroy();
  });

  it('Clips shows the clips inside the screen, and Back returns to it with the clips let go', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    click(exitFace(root, 'clips'));
    const videos = (exitNode(root)?.descendants() ?? []).filter((n) => n.tagName === 'VIDEO');
    expect(videos).toHaveLength(4);
    click(exitNode(root)!.descendants().find((n) => hasClass(n, 'hs-exit-back'))!);
    expect(videos.every((v) => v.getAttribute('src') === null)).toBe(true);
    expect(dom.activeElement?.dataset['exit']).toBe('clips');
    ui.destroy();
  });

  it('with a room card open: the card is not under the screen, Continue tower has focus, Enter continues and the card comes back', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const roomId = [...game.world.rooms.keys()][0]!;
    const { root, ui, saveAndExit } = mount(game);
    game.select({ roomId });
    ui.update();
    const sheets = (): FakeElement[] => root.descendants().filter((n) => hasClass(n, 'hs-sheet'));
    expect(sheets()).toHaveLength(1);
    saveAndExit();
    await settle();
    expect(exitNode(root)).toBeDefined();
    expect(sheets()).toHaveLength(0);
    expect(dom.activeElement?.dataset['exit']).toBe('continue');
    ui.update(); // a game step while exited mounts nothing under it
    expect(sheets()).toHaveLength(0);
    expect(dom.activeElement?.dataset['exit']).toBe('continue');
    // Enter is left to the browser, which presses the button with focus: Continue tower.
    const enter = key('Enter');
    expect(enter.defaultPrevented).toBe(false);
    click(dom.activeElement!);
    expect(exitNode(root)).toBeUndefined();
    expect(sheets()).toHaveLength(1);
    ui.destroy();
  });

  it('on the Clips view, Tab and the arrow keys reach each clip, and Space and Enter play and pause it', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    click(exitFace(root, 'clips'));
    const videos = (exitNode(root)?.descendants() ?? []).filter((n) => n.tagName === 'VIDEO');
    const plays = videos.map((v) => {
      const count = { plays: 0, pauses: 0 };
      const player = v as FakeElement & { paused: boolean };
      Object.assign(v, {
        paused: true,
        play: () => ((count.plays += 1), (player.paused = false), Promise.resolve()),
        pause: () => ((count.pauses += 1), (player.paused = true)),
        load: () => {},
      });
      return count;
    });
    expect(hasClass(dom.activeElement!, 'hs-exit-back')).toBe(true);
    key('Tab');
    expect(dom.activeElement).toBe(videos[0]);
    key('ArrowDown');
    expect(dom.activeElement).toBe(videos[1]);
    key('Tab');
    key('ArrowDown');
    expect(dom.activeElement).toBe(videos[3]);
    key('ArrowUp');
    expect(dom.activeElement).toBe(videos[2]);
    expect(key(' ').defaultPrevented).toBe(true);
    expect(plays[2]).toEqual({ plays: 1, pauses: 0 });
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(plays[2]).toEqual({ plays: 1, pauses: 1 });
    expect(exitNode(root)?.dataset['view']).toBe('clips');
    ui.destroy();
  });

  it('in the desktop shell, Clips opens the site\'s Clips page in the browser and the screen stays', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    const opened: string[] = [];
    (globalThis as unknown as { window: Record<string, unknown> }).window['open'] = (url: string) => opened.push(url);
    const { game } = gameOn();
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    click(exitFace(root, 'clips'));
    expect(opened).toEqual([CLIPS_URL]);
    expect(exitNode(root)?.dataset['view']).toBe('main');
    expect((exitNode(root)?.descendants() ?? []).some((n) => n.tagName === 'VIDEO')).toBe(false);
    ui.destroy();
  });

  for (const on of [true, false]) {
    it(`Sound ${on ? 'on' : 'off'}: the stored setting is never written across exit, Continue, and a reload from the screen`, async () => {
      vi.stubGlobal('localStorage', fakeLocalStorage().store);
      const store = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
      store.setItem('hs.sound', on ? 'true' : 'false');
      const writes: string[] = [];
      const setItem = store.setItem.bind(store);
      store.setItem = (k: string, v: string) => {
        if (k === 'hs.sound') writes.push(v);
        setItem(k, v);
      };
      const { game } = gameOn();
      const { order, root, ui, saveAndExit } = mount(game);
      saveAndExit();
      await settle();
      expect(exitNode(root)).toBeDefined();
      expect(store.getItem('hs.sound')).toBe(on ? 'true' : 'false');
      click(exitFace(root, 'continue'));
      expect(store.getItem('hs.sound')).toBe(on ? 'true' : 'false');
      const button = root.descendants().find((n) => hasClass(n, 'hs-sound-btn'))!;
      expect(button.getAttribute('aria-pressed')).toBe(on ? 'true' : 'false');
      // Out again, then the update notice's reload: the next launch reads Sound as it was.
      saveAndExit();
      await settle();
      ui.updateReady();
      click(root.descendants().find((n) => hasClass(n, 'is-update') && !hasClass(n, 'is-leaving'))!);
      await settle();
      expect(order).toEqual(['reload']);
      expect(readSoundSettings(store).on).toBe(on);
      expect(writes).toEqual([]);
      ui.destroy();
    });
  }

  it('the update notice still reloads from the exited screen, without the leave card', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const { game } = gameOn();
    const { order, root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    ui.updateReady();
    const toast = root.descendants().find((n) => hasClass(n, 'is-update') && !hasClass(n, 'is-leaving'))!;
    click(toast);
    await settle();
    expect(order).toEqual(['reload']);
    expect(leaveBody(root)).toBeUndefined();
    ui.destroy();
  });
});

describe('Save and exit when the save does not go through', () => {
  it('a refusing store: no screen, the leave card; Try again then succeeds into the screen', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const world = game.world;
    ls.ctl.refuse = true;
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    expect(exitNode(root)).toBeUndefined();
    expect(game.world).toBe(world);
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    ls.ctl.refuse = false;
    click(answer(root, 'retry'));
    await settle();
    expect(savedTower(ls.data.get(MINE_LS))?.lobbies).toEqual([150]);
    expect(exitNode(root)?.textContent).toContain(EXIT_SAVED_TEXT);
    ui.destroy();
  });

  it('a refusing store: Keep playing returns to the tower with the clock running and a build accepted', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    click(answer(root, 'stay'));
    await settle();
    expect(leaveBody(root)).toBeUndefined();
    expect(exitNode(root)).toBeUndefined();
    const minute = game.world.time.minute;
    second();
    expect(game.world.time.minute).toBeGreaterThan(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    ui.destroy();
  });

  it('a held My tower: Leave without saving, the screen says not saved, and nothing was written', async () => {
    const ls = fakeLocalStorage();
    ls.data.set(MINE_LS, '{"version": 2, "rooms": "not a tower"');
    vi.stubGlobal('localStorage', ls.store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    await game.load();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const old = ls.data.get(MINE_LS);
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    expect(leaveBody(root)?.dataset['leave']).toBe('held');
    expect(answer(root, 'leave').textContent).toBe(LEAVE_WITHOUT_SAVING);
    click(answer(root, 'leave'));
    await settle();
    expect(exitNode(root)?.textContent).toContain(EXIT_UNSAVED_TEXT);
    expect(exitNode(root)?.textContent).not.toContain(EXIT_SAVED_TEXT);
    expect(ls.data.get(MINE_LS)).toBe(old);
    // A page hide from here writes nothing either, and no leave card comes back.
    dom.fireWindow('pagehide');
    await settle();
    expect(ls.data.get(MINE_LS)).toBe(old);
    expect(leaveBody(root)).toBeUndefined();
    ui.destroy();
  });

  it('a slot that could not be read: Leave without saving, the screen says not saved, nothing written', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    ls.data.set(SAVE_PRESENT_KEY, '1');
    idb.ctl.failOpens = 1;
    vi.stubGlobal('localStorage', ls.store);
    vi.stubGlobal('indexedDB', idb.factory);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    await game.load();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const { root, ui, saveAndExit } = mount(game);
    saveAndExit();
    await settle();
    expect(leaveBody(root)?.dataset['leave']).toBe('unread');
    click(answer(root, 'leave'));
    await settle();
    expect(exitNode(root)?.textContent).toContain(EXIT_UNSAVED_TEXT);
    expect(ls.data.has(MINE_LS)).toBe(false);
    expect(idb.data.has('autosave')).toBe(false);
    ui.destroy();
  });
});

// The update toast's Reload and the leave card (package P1a, lane A F1): the real ui on the fake
// DOM, over the real game and the real storage module on fake browser stores. Reload happens only
// once the tower is written or nothing had moved; anything else keeps the tower and asks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, LEAVE_NOT_SAVED, NEW_TOWER_NOT_SAVED, STILL_HERE } from '../../src/game/game';
import { SAVE_PRESENT_KEY } from '../../src/game/storage';
import { createUi } from '../../src/ui/ui';
import { createPauseMenu } from '../../src/ui/pause-menu';
import {
  KEEP_PLAYING,
  LEAVE_CONFLICT_TITLE,
  LEAVE_FAILED_TEXT,
  LEAVE_FAILED_TITLE,
  LEAVE_UNSAVED_TITLE,
  LEAVE_WITHOUT_SAVING,
  OPEN_NEWER,
  SAVE_OLD_TO_FILE,
  SAVE_THIS_TO_FILE,
  SAVE_TO_FILE,
  showLeaveCard,
  TRY_AGAIN,
} from '../../src/ui/leave-card';
import { HELD_SAVE_NO, HELD_SAVE_QUESTION, HELD_SAVE_YES } from '../../src/ui/save-button';
import { FakeDom, choosePauseEntry, type FakeElement } from './fake-dom';
import { fakeIdb, fakeLocalStorage, handClock, savedTower, settle } from '../game/leave-stores';

const MINE_LS = 'hundred-stories:autosave';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => {
  uninstall();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const click = (node: FakeElement): void => (node.listeners.get('click') ?? []).forEach((f) => f({}));
const hasClass = (node: FakeElement, name: string): boolean => node.className.split(/\s+/).includes(name);
const updateToasts = (root: FakeElement): FakeElement[] => root.descendants().filter((n) => hasClass(n, 'is-update') && !hasClass(n, 'is-leaving'));
const leaveBody = (root: FakeElement): FakeElement | undefined => root.descendants().find((n) => hasClass(n, 'hs-leave'));
const answer = (root: FakeElement, id: string): FakeElement => {
  const found = leaveBody(root)?.descendants().find((n) => n.dataset['answer'] === id);
  if (!found) throw new Error(`no answer ${id}`);
  return found;
};
const answerWords = (root: FakeElement): string[] =>
  (leaveBody(root)?.children ?? []).filter((n) => n.dataset['answer']).map((n) => n.textContent);
const plateTitle = (root: FakeElement): string => root.descendants().find((n) => hasClass(n, 'hs-pause-title'))?.textContent ?? '';

function mount(game: ReturnType<typeof createGame>) {
  const order: string[] = [];
  const root = dom.createElement('div');
  const ui = createUi(root as never, game, {} as never, { reload: () => order.push('reload') });
  ui.updateReady();
  const tapReload = (): void => {
    const toast = updateToasts(root)[0];
    if (!toast) throw new Error('no update toast');
    click(toast);
  };
  return { order, root, ui, tapReload };
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

describe('Reload waits for the save, and the tower holds still meanwhile', () => {
  it('a slow write: a build is refused and the clock stands; then one reload, with the tower as it was on disk', async () => {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const { order, root, ui, tapReload } = mount(game);
    const open = idb.hold();
    const minute = game.world.time.minute;
    tapReload();
    await settle();
    expect(order).toEqual([]);
    second();
    second();
    expect(game.world.time.minute).toBe(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(false);
    open();
    await settle();
    expect(order).toEqual(['reload']);
    expect(savedTower(idb.data.get('autosave'))).toMatchObject({ minute, lobbies: [150] });
    expect(leaveBody(root)).toBeUndefined();
    ui.destroy();
  });
});

describe('a Reload whose save fails keeps the tower and shows the leave card', () => {
  it('the store refuses (the leave resolves not ok): no reload, the card, and Try again reloads once the store takes it', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const world = game.world;
    ls.ctl.refuse = true;
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(order).toEqual([]);
    expect(game.world).toBe(world);
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    expect(plateTitle(root)).toBe(LEAVE_FAILED_TITLE);
    expect(leaveBody(root)?.textContent).toContain(LEAVE_FAILED_TEXT);
    expect(answerWords(root)).toEqual([TRY_AGAIN, SAVE_TO_FILE, KEEP_PLAYING]);
    expect(dom.activeElement?.dataset['answer']).toBe('stay'); // focus never starts on a way out
    // Still refusing: Try again shows the card again, and does not reload.
    click(answer(root, 'retry'));
    await settle();
    expect(order).toEqual([]);
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    ls.ctl.refuse = false;
    click(answer(root, 'retry'));
    await settle();
    expect(order).toEqual(['reload']);
    expect(savedTower(ls.data.get(MINE_LS))?.lobbies).toEqual([150]);
    ui.destroy();
  });

  it('the leave itself rejects: no reload, the card, and Try again works', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const real = game.leave.bind(game);
    let rejectOnce = true;
    game.leave = (why) => {
      if (!rejectOnce) return real(why);
      rejectOnce = false;
      return Promise.reject(new Error('disk full'));
    };
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(order).toEqual([]);
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    click(answer(root, 'retry'));
    await settle();
    expect(order).toEqual(['reload']);
    expect(savedTower(ls.data.get(MINE_LS))?.lobbies).toEqual([150]);
    ui.destroy();
  });

  it('Try again, then Back before the retry lands: no reload, and once it lands the clock runs and a build is accepted', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', ls.store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    idb.ctl.failPuts = true;
    ls.ctl.refuse = true;
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    idb.ctl.failPuts = false;
    ls.ctl.refuse = false;
    const open = idb.hold(); // the store works again, slowly
    click(answer(root, 'retry'));
    await settle();
    click(root.descendants().find((n) => hasClass(n, 'hs-pause-back'))!); // Back while writing
    await settle();
    open();
    await settle();
    click(root.descendants().find((n) => n.dataset['entry'] === 'resume')!);
    expect(order).toEqual([]);
    expect(game.getSpeed()).toBe(1);
    const minute = game.world.time.minute;
    second();
    second();
    expect(game.world.time.minute).not.toBe(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    ui.destroy();
  });

  it('Keep playing: the card and the menu go, the tower runs again, and the update toast is back', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(updateToasts(root)).toHaveLength(0);
    click(answer(root, 'stay'));
    await settle();
    expect(leaveBody(root)).toBeUndefined();
    expect(order).toEqual([]);
    expect(updateToasts(root)).toHaveLength(1);
    const minute = game.world.time.minute;
    second();
    expect(game.world.time.minute).toBeGreaterThan(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    ui.destroy();
  });
});

describe('a stand-in asks before the page goes', () => {
  it('a held My tower: nothing written; Save anyway asks the Save question, then saves and reloads', async () => {
    const ls = fakeLocalStorage();
    ls.data.set(MINE_LS, '{"version": 2, "rooms": "not a tower"');
    vi.stubGlobal('localStorage', ls.store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    await game.load();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const old = ls.data.get(MINE_LS);
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(order).toEqual([]);
    expect(ls.data.get(MINE_LS)).toBe(old);
    expect(leaveBody(root)?.dataset['leave']).toBe('held');
    expect(plateTitle(root)).toBe(LEAVE_UNSAVED_TITLE);
    expect(answerWords(root)).toEqual([HELD_SAVE_YES, SAVE_OLD_TO_FILE, LEAVE_WITHOUT_SAVING, KEEP_PLAYING]);
    expect(dom.activeElement?.dataset['answer']).toBe('stay');
    click(answer(root, 'saveAnyway'));
    expect(leaveBody(root)?.dataset['leave']).toBe('heldSave');
    expect(leaveBody(root)?.textContent).toContain(HELD_SAVE_QUESTION);
    expect(answerWords(root)).toEqual([HELD_SAVE_YES, HELD_SAVE_NO]);
    expect(dom.activeElement?.dataset['answer']).toBe('no');
    click(answer(root, 'yes'));
    await settle();
    expect(order).toEqual(['reload']);
    expect(savedTower(ls.data.get(MINE_LS))?.lobbies).toEqual([150]);
    ui.destroy();
  });

  it('a slot that could not be read: Leave without saving reloads and writes nothing', async () => {
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
    const { order, root, ui, tapReload } = mount(game);
    tapReload();
    await settle();
    expect(leaveBody(root)?.dataset['leave']).toBe('unread');
    expect(answerWords(root)).toEqual([SAVE_TO_FILE, LEAVE_WITHOUT_SAVING, KEEP_PLAYING]);
    expect(dom.activeElement?.dataset['answer']).toBe('stay');
    click(answer(root, 'leave'));
    await settle();
    expect(order).toEqual(['reload']);
    expect(ls.data.has(MINE_LS)).toBe(false);
    expect(idb.data.has('autosave')).toBe(false);
    ui.destroy();
  });
});

describe("a save another window overtook shows the conflict card, with no leave behind it", () => {
  /** A real game on fake stores whose tab can be hidden, with My tower read and saved once. */
  async function staleGame() {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const view = { hidden: false };
    const game = createGame(11, { ...handClock().opts, hidden: () => view.hidden });
    await game.load();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    expect(await game.save()).toEqual({ ok: true });
    // Another window saves My tower: the number in IndexedDB passes this page's.
    idb.data.set('autosave:seq', Number(idb.data.get('autosave:seq')) + 1000);
    return { game, view };
  }

  /** A background save: pausing with an unsaved change saves in the next idle slot. */
  async function backgroundSave(game: ReturnType<typeof createGame>, x: number): Promise<void> {
    game.setSpeed(1);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    game.setSpeed(0);
    await settle();
  }

  it('the first background conflict shows it once; a later one shows nothing; a pressed Save shows it again', async () => {
    const { game } = await staleGame();
    const { order, root, ui } = mount(game);
    await backgroundSave(game, 60);
    expect(plateTitle(root)).toBe(LEAVE_CONFLICT_TITLE);
    expect(answerWords(root)).toEqual([OPEN_NEWER, SAVE_THIS_TO_FILE, KEEP_PLAYING]);
    expect(dom.activeElement?.dataset['answer']).toBe('stay');
    click(answer(root, 'stay'));
    expect(leaveBody(root)).toBeUndefined();

    await backgroundSave(game, 61);
    expect(leaveBody(root)).toBeUndefined();

    expect(await game.save()).toMatchObject({ ok: false, conflict: true });
    expect(plateTitle(root)).toBe(LEAVE_CONFLICT_TITLE);
    click(answer(root, 'newer'));
    expect(order).toEqual(['reload']);
    ui.destroy();
  });

  it('a conflict while the page is hidden shows the card when it is visible again', async () => {
    const { game, view } = await staleGame();
    const { root, ui } = mount(game);
    const doc = globalThis.document as unknown as Record<string, unknown>;
    const win = globalThis.window as unknown as Record<string, unknown>;
    const docListeners = new Map<string, () => void>();
    doc['addEventListener'] = (type: string, fn: () => void) => docListeners.set(type, fn);
    doc['removeEventListener'] = (type: string) => docListeners.delete(type);
    win['setInterval'] = () => 1;
    win['clearInterval'] = () => {};
    game.start();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 60 });
    view.hidden = true;
    docListeners.get('visibilitychange')?.(); // going away saves, and the save is refused
    await settle();
    expect(leaveBody(root)).toBeUndefined();
    view.hidden = false;
    docListeners.get('visibilitychange')?.();
    expect(plateTitle(root)).toBe(LEAVE_CONFLICT_TITLE);
    game.stop();
    ui.destroy();
  });
});

describe('the leave card, review round (P1a A1, A4, A5; P3a A6)', () => {
  const buttonNamed = (root: FakeElement, text: string): FakeElement | undefined =>
    root.descendants().find((n) => n.tagName === 'BUTTON' && n.textContent === text);
  const menuButton = (root: FakeElement): FakeElement =>
    root.descendants().find((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-label') === 'Menu')!;
  const pausePage = (root: FakeElement): string | null =>
    root.descendants().find((n) => hasClass(n, 'hs-pause-card'))?.getAttribute('data-page') ?? null;
  const notices = (root: FakeElement, text: string): FakeElement[] =>
    root.descendants().filter((n) => hasClass(n, 'is-notice') && !hasClass(n, 'is-leaving') && n.textContent.includes(text));

  /** The ui over a real game, with a notification tap to open Stories from outside the menu. */
  function mountWithTap(game: ReturnType<typeof createGame>) {
    const order: string[] = [];
    let tap: ((kind: string) => void) | null = null;
    const notifier = { alert: () => {}, updateReady: () => {}, onTap: (fn: (kind: string) => void) => (tap = fn) };
    const root = dom.createElement('div');
    const ui = createUi(root as never, game, {} as never, { reload: () => order.push('reload'), notifier: notifier as never });
    ui.updateReady();
    return { order, root, ui, openStories: () => tap?.('alerts') };
  }

  it('A1: a double tap on Reload starts one leave and one card; Keep playing puts back one toast', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const leave = vi.spyOn(game, 'leave');
    const { root, ui } = mount(game);
    const toast = updateToasts(root)[0]!;
    click(toast);
    click(toast); // the toast is still fading out under the finger
    await settle();
    expect(leave).toHaveBeenCalledTimes(1);
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    click(answer(root, 'stay'));
    await settle();
    expect(leaveBody(root)).toBeUndefined();
    expect(updateToasts(root)).toHaveLength(1);
    ui.destroy();
  });

  it('A4: a refused tower switch says why every time, and a New tower that did not save says so', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    expect(await game.openFriend(4242)).toEqual({ ok: true });
    const { root, ui } = mount(game);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const refused = `${LEAVE_NOT_SAVED} ${STILL_HERE}`;
    const myTower = root.descendants().find((n) => hasClass(n, 'hs-my-tower'))!;
    click(myTower);
    await settle();
    expect(notices(root, refused)).toHaveLength(1);
    click(myTower);
    await settle();
    expect(notices(root, refused)).toHaveLength(2);
    expect(game.getSlot()).toBe('friend');
    ui.destroy();

    // New tower in My tower, with the store refusing: the notice says the new tower did not save.
    const mine = gameOn(12).game;
    mine.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const again = mount(mine);
    click(menuButton(again.root));
    choosePauseEntry(again.root, 'newTower');
    choosePauseEntry(again.root, 'yes');
    await settle();
    expect(notices(again.root, NEW_TOWER_NOT_SAVED)).toHaveLength(1);
    again.ui.destroy();
  });

  it('A5: a card owed while Send feedback covers the menu waits for it, without holding the tower, then shows', async () => {
    const ls = fakeLocalStorage();
    ls.data.set(MINE_LS, '{"version": 2, "rooms": "not a tower"');
    vi.stubGlobal('localStorage', ls.store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    await game.load();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const { order, root, ui, tapReload } = mount(game);
    click(menuButton(root));
    choosePauseEntry(root, 'settings');
    click(buttonNamed(root, 'Send feedback')!);
    const feedback = (): FakeElement | undefined => root.descendants().find((n) => hasClass(n, 'hs-feedback'));
    expect(feedback()).toBeDefined();
    tapReload();
    await settle();
    // Nothing goes into the hidden menu, the feedback card stays, and the tower is not held.
    expect(leaveBody(root)).toBeUndefined();
    expect(feedback()).toBeDefined();
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    click(buttonNamed(feedback()!, 'Cancel')!);
    await settle();
    expect(feedback()).toBeUndefined();
    expect(leaveBody(root)?.dataset['leave']).toBe('held');
    expect(dom.activeElement?.dataset['answer']).toBe('stay');
    click(answer(root, 'leave'));
    expect(order).toEqual(['reload']);
    ui.destroy();
  });

  it('P3a A6: Try again, Stories opened over the card, and the retry fails: the new card replaces both, and Back leaves the card', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', ls.store);
    vi.stubGlobal('indexedDB', idb.factory);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    idb.ctl.failPuts = true;
    ls.ctl.refuse = true;
    const { order, root, ui, openStories } = mountWithTap(game);
    click(updateToasts(root)[0]!);
    await settle();
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    const open = idb.hold();
    click(answer(root, 'retry'));
    await settle();
    openStories();
    expect(pausePage(root)).toBe('stories');
    open(); // the retry fails too
    await settle();
    expect(pausePage(root)).toBe('leave');
    expect(leaveBody(root)?.dataset['leave']).toBe('failed');
    click(root.descendants().find((n) => hasClass(n, 'hs-pause-back'))!);
    expect(pausePage(root)).toBeNull(); // no Stories and no dead card left under it
    expect(leaveBody(root)).toBeUndefined();
    expect(order).toEqual([]);
    expect(updateToasts(root)).toHaveLength(1);
    ui.destroy();
  });
});

describe('the leave card on its own', () => {
  function menuOn() {
    const host = dom.createElement('div');
    let speed: 0 | 1 = 1;
    const menu = createPauseMenu({
      host: host as never,
      getSpeed: () => speed,
      setSpeed: (s) => {
        speed = s === 0 ? 0 : 1;
      },
      entries: () => [{ id: 'resume', label: 'Resume', icon: 'play', kind: 'resume' }],
      returnFocus: () => null,
    });
    return { host, menu };
  }

  it('a conflict: Open the newer tower goes on, Save this one to a file keeps the card', () => {
    const { host, menu } = menuOn();
    const calls: string[] = [];
    showLeaveCard({
      menu,
      result: { ok: false, reason: 'x', conflict: true },
      retry: async () => ({ ok: true, wrote: true }),
      proceed: () => calls.push('proceed'),
      stay: () => calls.push('stay'),
      saveFile: (text) => calls.push(`file:${text}`),
      game: { exportSave: () => 'TOWER', getKeptCopy: () => null, save: async () => ({ ok: true }) },
    });
    expect(plateTitle(host)).toBe(LEAVE_CONFLICT_TITLE);
    expect(answerWords(host)).toEqual([OPEN_NEWER, SAVE_THIS_TO_FILE, KEEP_PLAYING]);
    expect(dom.activeElement?.dataset['answer']).toBe('stay');
    click(answer(host, 'file'));
    expect(calls).toEqual(['file:TOWER']);
    click(answer(host, 'newer'));
    expect(calls).toEqual(['file:TOWER', 'proceed']);
    expect(menu.isOpen()).toBe(false);
  });

  it('Back keeps playing, once', () => {
    const { menu } = menuOn();
    const calls: string[] = [];
    showLeaveCard({
      menu,
      result: { ok: true, wrote: false, unsaved: 'unread' },
      retry: async () => ({ ok: true, wrote: true }),
      proceed: () => calls.push('proceed'),
      stay: () => calls.push('stay'),
      saveFile: () => {},
      game: { exportSave: () => '', getKeptCopy: () => null, save: async () => ({ ok: true }) },
    });
    expect(menu.page()?.id).toBe('leave');
    menu.popPage();
    menu.close();
    expect(calls).toEqual(['stay']);
  });
});

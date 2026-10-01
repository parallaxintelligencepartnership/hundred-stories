// One save before leaving a tower (package P1a): GameApi.leave, the switches, Open a saved file and
// New tower, through the real game and the real storage module on fake browser stores. Each test
// names the gap it closes (lane A: F1, F2, N1 to N4).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGame,
  FILE_NOT_OPENED,
  LEAVE_NOT_SAVED,
  LEAVING_REASON,
  NEW_TOWER_NOT_SAVED,
  NOT_SAVING_NOTICE,
  READ_FAILED_NOTICE,
  STILL_HERE,
} from '../../src/game/game';
import { SAVE_PRESENT_KEY } from '../../src/game/storage';
import { fakeIdb, fakeLocalStorage, handClock, savedTower, settle } from './leave-stores';

const MINE_LS = 'hundred-stories:autosave';
const FRIEND_LS = 'hundred-stories:friend';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function gameOn(seed = 11) {
  const { clock, opts } = handClock();
  const game = createGame(seed, opts);
  const second = (): void => {
    clock.ms += 1000;
    game.stepOnce();
  };
  return { game, second };
}

const warns = (game: ReturnType<typeof createGame>): string[] => game.world.log.filter((l) => l.level === 'warn').map((l) => l.text);

describe('leave holds the tower still from the save on (F1d)', () => {
  it('a build during a slow write is refused, the clock stands, and the stored tower is the one in hand', async () => {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game, second } = gameOn();
    second(); // the clock runs before the leave
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
    const open = idb.hold();
    const minute = game.world.time.minute;
    const lines = game.world.log.length;
    let result: unknown = null;
    const leaving = game.leave('reload').then((r) => (result = r));
    await settle();
    expect(result).toBeNull(); // still writing
    for (let i = 0; i < 3; i++) second();
    expect(game.world.time.minute).toBe(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 })).toEqual({ ok: false, reason: LEAVING_REASON });
    expect(game.world.log.length).toBe(lines); // a refusal here adds no line to the tower being saved
    open();
    await leaving;
    expect(result).toEqual({ ok: true, wrote: true });
    expect(savedTower(idb.data.get('autosave'))).toMatchObject({ minute, lobbies: [150] });
    // The hold stays after a good save, until the page goes or the player stays.
    second();
    expect(game.world.time.minute).toBe(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(false);
    game.resumeAfterLeave();
    second();
    expect(game.world.time.minute).toBeGreaterThan(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
  });

  it('nothing moved since the last save: ok, nothing written', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    expect(await game.save()).toEqual({ ok: true });
    ls.ctl.refuse = true; // a write now would fail
    expect(await game.leave('exit')).toEqual({ ok: true, wrote: false });
  });
});

describe('a leave whose save fails keeps the tower and says why, every time (F1a)', () => {
  it('a refusing store: the reason both times, no once-per-session gate, and the hold let go', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const world = game.world;
    expect(await game.leave('reload')).toEqual({ ok: false, reason: LEAVE_NOT_SAVED });
    expect(await game.leave('reload')).toEqual({ ok: false, reason: LEAVE_NOT_SAVED });
    expect(game.world).toBe(world);
    expect(warns(game)).not.toContain(NOT_SAVING_NOTICE); // the caller says it, every time
    const minute = game.world.time.minute;
    second();
    expect(game.world.time.minute).toBeGreaterThan(minute);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }).ok).toBe(true);
    ls.ctl.refuse = false;
    expect(await game.leave('reload')).toEqual({ ok: true, wrote: true });
    expect(savedTower(ls.data.get(MINE_LS))?.lobbies).toEqual([140, 150]);
  });

  it('an IndexedDB write that aborts with the fallback full: the same', async () => {
    const idb = fakeIdb();
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    idb.ctl.failPuts = true;
    ls.ctl.refuse = true;
    expect(await game.leave('reload')).toEqual({ ok: false, reason: LEAVE_NOT_SAVED });
    expect(idb.data.has('autosave')).toBe(false);
  });
});

describe('leave during a tower switch waits for it (F1e)', () => {
  it('resolves only after the switch, with My tower written first', async () => {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const open = idb.hold();
    const order: string[] = [];
    const switched = game.openDaily().then(() => order.push('switch'));
    await settle();
    const left = game.leave('reload').then((r) => {
      order.push('leave');
      return r;
    });
    await settle();
    expect(order).toEqual([]);
    expect(idb.data.has('autosave')).toBe(false);
    open();
    await Promise.all([switched, left]);
    expect(order).toEqual(['switch', 'leave']);
    expect(savedTower(idb.data.get('autosave'))?.lobbies).toEqual([150]);
    expect(game.getSlot()).toBe('daily');
    expect((await left).ok).toBe(true);
  });
});

describe('Open a saved file leaves a friend tower only once it is saved (F2, N3)', () => {
  function fileOf(seed: number): string {
    const other = createGame(seed);
    other.apply({ kind: 'build', room: 'lobby', floor: 1, x: 120 });
    return other.exportSave();
  }

  it('a dirty friend tower and a refusing store: the friend tower and its slot stay, with the reason', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    expect(await game.openFriend(4242)).toEqual({ ok: true });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const friend = game.world;
    ls.ctl.refuse = true;
    const res = await game.importSave(fileOf(9));
    expect(res).toEqual({ ok: false, reason: `${LEAVE_NOT_SAVED} ${FILE_NOT_OPENED}` });
    expect(game.getSlot()).toBe('friend');
    expect(game.world).toBe(friend);
    expect([...game.world.rooms.values()].some((r) => r.kind === 'lobby' && r.x === 150)).toBe(true);
  });

  it('a slow friend save: the file opens after it lands, and My tower saves never touch the friend slot', async () => {
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    vi.stubGlobal('indexedDB', idb.factory);
    const { game } = gameOn();
    await game.openFriend(4242);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const open = idb.hold();
    let done = false;
    const importing = game.importSave(fileOf(9)).then((r) => {
      done = true;
      return r;
    });
    await settle();
    expect(done).toBe(false);
    expect(game.getSlot()).toBe('friend'); // still the friend tower while its save is on the way
    open();
    expect(await importing).toEqual({ ok: true });
    expect(game.getSlot()).toBe('mine');
    expect(game.world.seed).toBe(9);
    const friendText = idb.data.get('friend');
    expect(savedTower(friendText)).toMatchObject({ seed: 4242, lobbies: [150] });
    expect(await game.save()).toEqual({ ok: true });
    expect(savedTower(idb.data.get('autosave'))).toMatchObject({ seed: 9, lobbies: [120] });
    expect(idb.data.get('friend')).toBe(friendText);
  });
});

describe('a refused switch says why every time (N1)', () => {
  it('the second refusal returns the same reason as the first, and the tower stays', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    ls.ctl.refuse = true;
    const refused = { ok: false, reason: `${LEAVE_NOT_SAVED} ${STILL_HERE}` };
    expect(await game.openDaily()).toEqual(refused);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 });
    expect(await game.openFriend(4242)).toEqual(refused);
    expect(await game.openDaily()).toEqual(refused);
    expect(game.getSlot()).toBe('mine');
    expect([...game.world.rooms.values()].filter((r) => r.kind === 'lobby')).toHaveLength(2);
  });
});

describe('New tower says when its save fails (N2)', () => {
  it('a refusing store: the result says so, and the old tower is still the stored one', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    const old = ls.data.get(MINE_LS);
    ls.ctl.refuse = true;
    expect(await game.newGame(5)).toEqual({ ok: false, reason: NEW_TOWER_NOT_SAVED });
    expect(ls.data.get(MINE_LS)).toBe(old);
    ls.ctl.refuse = false;
    expect(await game.newGame(6)).toEqual({ ok: true });
    expect(savedTower(ls.data.get(MINE_LS))?.seed).toBe(6);
  });
});

describe('a stand-in is reported unsaved and never written by a leave (protections 2 and 3)', () => {
  it('a held My tower: unsaved held, nothing written, and no autosave while the hold is kept', async () => {
    const ls = fakeLocalStorage();
    ls.data.set(MINE_LS, '{"version": 2, "rooms": "not a tower"');
    vi.stubGlobal('localStorage', ls.store);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game, second } = gameOn();
    expect((await game.load()).ok).toBe(false);
    expect(game.saveHeld()).toBe(true);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const before = ls.data.get(MINE_LS);
    expect(await game.leave('reload')).toEqual({ ok: true, wrote: false, unsaved: 'held' });
    game.world.time.minute = 360 + 1440 - 1; // an autosave boundary, were the clock to run
    second();
    await settle();
    expect(ls.data.get(MINE_LS)).toBe(before);
    game.resumeAfterLeave();
    expect(game.saveHeld()).toBe(true);
  });

  it('a slot that could not be read: unsaved unread, nothing written', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    ls.data.set(SAVE_PRESENT_KEY, '1'); // a save is there, but IndexedDB will not open to read it
    idb.ctl.failOpens = 1;
    vi.stubGlobal('localStorage', ls.store);
    vi.stubGlobal('indexedDB', idb.factory);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game } = gameOn();
    expect(await game.load()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    expect(await game.leave('exit')).toEqual({ ok: true, wrote: false, unsaved: 'unread' });
    expect(ls.data.has(MINE_LS)).toBe(false);
    expect(idb.data.has('autosave')).toBe(false);
  });
});

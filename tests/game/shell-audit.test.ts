// The game shell's slot switches, saves and the daily opening, driven through the real storage
// module with fake browser stores (audit 2026-09-25, package P4). Each describe names the
// finding it closes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { dailyOpening } from '../../src/game/daily';
import { bootTarget } from '../../src/main';

/** An in memory localStorage. `refuse` makes every write throw the way a full quota does. */
function fakeLocalStorage(refuseKey?: (key: string) => boolean) {
  const data = new Map<string, string>();
  const ctl = { refuse: false };
  const store = {
    get length(): number {
      return data.size;
    },
    clear: (): void => data.clear(),
    getItem: (key: string): string | null => data.get(key) ?? null,
    key: (index: number): string | null => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string): void => {
      data.delete(key);
    },
    setItem: (key: string, value: string): void => {
      if (ctl.refuse || refuseKey?.(key)) throw new DOMException('quota', 'QuotaExceededError');
      data.set(key, value);
    },
  } as Storage;
  return { store, data, ctl };
}

const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(n = 5): Promise<void> {
  for (let i = 0; i < n; i++) await task();
}

/** A game on a hand driven clock, idle work run at once, the tab hidden (the timer drives). */
function gameOn(today = '2026-09-28', seed = 11, extra: { hidden?: () => boolean; scheduleIdle?: (run: () => void) => () => void } = {}) {
  const clock = { ms: 0 };
  const game = createGame(seed, {
    now: () => clock.ms,
    hidden: extra.hidden ?? (() => true),
    scheduleIdle:
      extra.scheduleIdle ??
      ((run) => {
        run();
        return () => {};
      }),
    today: () => today,
    freshSeed: () => 77,
  });
  const second = (): void => {
    clock.ms += 1000;
    game.stepOnce();
  };
  return { game, clock, second };
}

const lobbies = (game: ReturnType<typeof createGame>): number => [...game.world.rooms.values()].filter((r) => r.kind === 'lobby').length;
const warns = (game: ReturnType<typeof createGame>): string[] => game.world.log.filter((l) => l.level === 'warn').map((l) => l.text);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('D S1: a tower switch never writes the old tower under the new key', () => {
  /**
   * An IndexedDB where open() and every request settle in later tasks, and transactions run in
   * the order they were made, the way a browser runs overlapping readwrite scopes.
   */
  function orderedIndexedDb() {
    const store = new Map<string, unknown>();
    let queue: Promise<void> = Promise.resolve();
    const later = (fn: () => void): void => {
      queue = queue.then(task).then(fn);
    };
    const factory = {
      open() {
        const req: Record<string, unknown> = {};
        const db = {
          transaction() {
            const tx: Record<string, unknown> = { error: null };
            tx.objectStore = () => ({
              put(value: unknown, key: string) {
                later(() => {
                  store.set(key, value);
                  (tx.oncomplete as (() => void) | undefined)?.();
                });
              },
              get(key: string) {
                const g: Record<string, unknown> = {};
                later(() => {
                  g.result = store.get(key);
                  (g.onsuccess as (() => void) | undefined)?.();
                });
                return g;
              },
            });
            return tx;
          },
        };
        req.result = db;
        setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    return { factory, store };
  }

  it('a frame that crosses 06:00 during the My tower read leaves seed 11 under the autosave key', async () => {
    const idb = orderedIndexedDb();
    vi.stubGlobal('indexedDB', idb.factory);
    // The game's own scheduleIdle: no requestIdleCallback in node, so a zero timeout (Safari).
    const clock = { ms: 0 };
    const real = createGame(11, { now: () => clock.ms, hidden: () => false, today: () => '2026-09-28', freshSeed: () => 77 });
    real.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await real.save();
    await real.openFriend(4242);
    real.world.time.minute = 360 + 1440 - 1; // a minute before 06:00 in the friend's tower

    const opening = real.openMyTower();
    await task();
    clock.ms += 1000;
    real.frameOnce(); // a frame, its own task, while the read is still out
    await opening;
    await settle(10);

    expect(JSON.parse(idb.store.get('autosave') as string).seed).toBe(11);
    expect(real.getSlot()).toBe('mine');
    expect(real.world.seed).toBe(11);
  });

  it('still saves the slot being left when it moved, and never rewrites one nobody played in', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    second();
    const minute = game.world.time.minute;
    await game.openFriend(4242);
    expect(JSON.parse(ls.data.get('hundred-stories:autosave')!).minute).toBe(minute);
    const friend = ls.data.get('hundred-stories:friend');
    await game.openMyTower();
    expect(ls.data.get('hundred-stories:friend')).toBe(friend);
  });
});

describe('new S1: tapping My tower keeps an unreadable My tower save', () => {
  it('leaves the refused payload under the slot key, keeps a copy, and says what boot says', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const g0 = gameOn().game;
    g0.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const good = g0.exportSave();
    const corrupt = good.slice(0, Math.floor(good.length / 2));

    // The boot path, for the message it shows.
    ls.data.set('hundred-stories:autosave', corrupt);
    const booted = gameOn('2026-09-28', 5).game;
    expect((await booted.load()).ok).toBe(false);
    const bootMessage = warns(booted);
    expect(bootMessage).toHaveLength(1);
    ls.data.delete('hs.save.unreadable');

    for (const entry of ['friend', 'daily'] as const) {
      ls.data.delete('hs.save.unreadable');
      const { game, second } = gameOn('2026-09-28', 5);
      if (entry === 'friend') await game.openFriend(4242);
      else await game.openDaily();
      await game.openMyTower();
      expect(game.getSlot()).toBe('mine');
      expect(ls.data.get('hundred-stories:autosave')).toBe(corrupt);
      expect(ls.data.get('hs.save.unreadable')).toBe(corrupt);
      expect(warns(game)).toEqual(bootMessage);
      // An autosave does not write over it either.
      game.world.time.minute = 360 + 1440 - 1;
      second();
      await settle();
      expect(ls.data.get('hundred-stories:autosave')).toBe(corrupt);
    }
  });

  it('a good save still resumes and an empty slot still starts a fresh tower', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game } = gameOn();
    await game.openFriend(4242);
    await game.openMyTower();
    expect(game.world.seed).toBe(77);
    expect(JSON.parse(ls.data.get('hundred-stories:autosave')!).seed).toBe(77);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    await game.openFriend(4242);
    await game.openMyTower();
    expect(lobbies(game)).toBe(1);
  });
});

describe('checkpoint: a damaged daily or friend save shows no field path', () => {
  for (const entry of ['friend', 'daily'] as const) {
    it(`${entry}: load says it in plain words and sends the path to the console`, async () => {
      const ls = fakeLocalStorage();
      vi.stubGlobal('localStorage', ls.store);
      const { game } = gameOn();
      if (entry === 'friend') await game.openFriend(4242);
      else await game.openDaily();
      expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 })).toEqual({ ok: true });
      await game.save();
      const key = `hundred-stories:${entry}`;
      const damaged = JSON.parse(ls.data.get(key)!) as { rooms: { floor: number }[] };
      damaged.rooms[0]!.floor = 0;
      ls.data.set(key, JSON.stringify(damaged));

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = await game.load();
        expect(result).toEqual({ ok: false, reason: 'This save is damaged and was not loaded.' });
        const said = warns(game);
        expect(said[said.length - 1]).toBe('We could not open this saved tower. This save is damaged and was not loaded.');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('rooms[0].floor');
      } finally {
        warn.mockRestore();
      }
    });
  }
});

describe('C S2: a daily dated after today is never thrown away', () => {
  it('dailyOpening never says fresh for a stored date later than today', () => {
    expect(dailyOpening({ date: '2026-09-25', finished: false }, '2026-09-24')).not.toBe('fresh');
    expect(dailyOpening({ date: '2026-09-25', finished: true }, '2026-09-24')).not.toBe('fresh');
    // Unchanged: the same date resumes, an earlier unfinished one asks, an earlier finished one gives way.
    expect(dailyOpening({ date: '2026-09-24', finished: false }, '2026-09-24')).toBe('resume');
    expect(dailyOpening({ date: '2026-09-23', finished: false }, '2026-09-24')).toBe('choose');
    expect(dailyOpening({ date: '2026-09-23', finished: true }, '2026-09-24')).toBe('fresh');
  });

  it('openDaily on a device whose date moved back leaves the daily slot bytes alone and offers the choice', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const later = gameOn('2026-09-25');
    await later.game.openDaily();
    later.game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await later.game.save();
    const stored = ls.data.get('hundred-stories:daily')!;

    const { game } = gameOn('2026-09-24');
    await game.openDaily();
    await settle();
    expect(ls.data.get('hundred-stories:daily')).toBe(stored);
    expect(game.getDaily()?.date).toBe('2026-09-25');
    expect(game.getDailyChoice()).toEqual({ savedDate: '2026-09-25', today: '2026-09-24', yesterday: false, ahead: true });
    expect(game.getSpeed()).toBe(0);

    // "Start today's tower instead" keeps a copy of the later run.
    await game.chooseDaily('today');
    expect(game.getDaily()?.date).toBe('2026-09-24');
    expect(ls.data.get('hs.save.daily-kept')).toBe(stored);
  });

  it('keeping the later run goes on with it', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const later = gameOn('2026-09-25');
    await later.game.openDaily();
    await later.game.save();
    const { game } = gameOn('2026-09-24');
    await game.openDaily();
    await game.chooseDaily('finish');
    expect(game.getDailyChoice()).toBe(null);
    expect(game.getDaily()?.date).toBe('2026-09-25');
    expect(game.getSpeed()).toBe(1);
  });
});

describe('D S6: Open a saved file inside Today\'s tower leaves the daily first', () => {
  it('the daily slot keeps today\'s run and the imported tower opens as My tower with a moving clock', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    game.world.time.minute = 20 * 1440;
    const myFile = game.exportSave();
    await game.save();
    await game.openDaily();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }); // moved and not saved yet

    expect(game.importSave(myFile)).toEqual({ ok: true });
    await settle();
    expect(game.getSlot()).toBe('mine');
    expect(game.getDaily()).toBe(null);
    const daily = JSON.parse(ls.data.get('hundred-stories:daily')!);
    expect(daily.buildLog.mode).toBe('daily:2026-09-28');
    expect(daily.rooms.length).toBe(1); // the daily's own lobby, saved on the way out
    const m = game.world.time.minute;
    second();
    expect(game.world.time.minute).not.toBe(m);
    await game.save();
    expect(JSON.parse(ls.data.get('hundred-stories:autosave')!).seed).toBe(11);
    expect(JSON.parse(ls.data.get('hundred-stories:daily')!).buildLog.mode).toBe('daily:2026-09-28');
  });
});

describe('D S7: when the browser refuses writes', () => {
  const NOTICE = 'This device is not saving your tower right now.';

  it('a switch while the tower is dirty and unsaved is refused, with one plain notice', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    expect(await game.save()).toEqual({ ok: true });
    ls.ctl.refuse = true;
    for (let x = 100; x < 110; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    expect((await game.save()).ok).toBe(false);
    game.world.time.minute = 360 + 1440 - 1;
    second(); // the autosave at 06:00 fails
    await settle();
    await game.openDaily();
    expect(game.getSlot()).toBe('mine');
    expect(lobbies(game)).toBe(11);
    expect(warns(game)).toEqual([NOTICE]);

    // Once the browser takes writes again, the switch goes through and nothing was lost.
    ls.ctl.refuse = false;
    await game.openDaily();
    expect(game.getSlot()).toBe('daily');
    await game.openMyTower();
    expect(lobbies(game)).toBe(11);
  });
});

describe('D S8: saves while paused and when the page is hidden or closed', () => {
  function stubBrowser() {
    const doc = new Map<string, () => void>();
    const win = new Map<string, () => void>();
    vi.stubGlobal('window', {
      setInterval: () => 7,
      clearInterval: () => {},
      addEventListener: (type: string, fn: () => void) => win.set(type, fn),
      removeEventListener: (type: string) => win.delete(type),
    });
    vi.stubGlobal('document', {
      hidden: false,
      addEventListener: (type: string, fn: () => void) => doc.set(type, fn),
      removeEventListener: (type: string) => doc.delete(type),
    });
    vi.stubGlobal('requestAnimationFrame', () => 3);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    return { doc, win };
  }

  /** Paused, ten lobbies built, two thousand timer steps; the idle slot never comes. */
  async function pausedWithTenUnsaved() {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const view = { hidden: true };
    const { game, second } = gameOn('2026-09-28', 11, { hidden: () => view.hidden, scheduleIdle: () => () => {} });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    game.setSpeed(0);
    for (let x = 100; x < 110; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    for (let i = 0; i < 2000; i++) second();
    await settle();
    return { game, ls, view };
  }

  const roomsOnDisk = (ls: ReturnType<typeof fakeLocalStorage>): number => JSON.parse(ls.data.get('hundred-stories:autosave')!).rooms.length;

  it('after a visibilitychange to hidden the disk holds all 11 rooms', async () => {
    const { doc } = stubBrowser();
    const { game, ls, view } = await pausedWithTenUnsaved();
    game.start();
    expect(roomsOnDisk(ls)).toBe(1);
    view.hidden = true;
    doc.get('visibilitychange')?.();
    await settle();
    expect(roomsOnDisk(ls)).toBe(11);
    game.stop();
  });

  it('after a pagehide the disk holds all 11 rooms', async () => {
    const { win } = stubBrowser();
    const { game, ls } = await pausedWithTenUnsaved();
    game.start();
    win.get('pagehide')?.();
    await settle();
    expect(roomsOnDisk(ls)).toBe(11);
    game.stop();
  });

  it('a build while paused schedules an idle save, and pausing saves a tower that moved', async () => {
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    const { game, second } = gameOn();
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    game.setSpeed(0);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    await settle();
    expect(roomsOnDisk(ls)).toBe(2);

    game.setSpeed(1);
    second();
    const minute = game.world.time.minute;
    game.setSpeed(0);
    await settle();
    expect(JSON.parse(ls.data.get('hundred-stories:autosave')!).minute).toBe(minute);
  });

  it('a build made during a slow save is written by one follow-up save, with no hide event (fix review s8b)', async () => {
    // An IndexedDB whose writes settle 50 ms later, and the browser-like idle slot (a timeout).
    const store = new Map<string, unknown>();
    let puts = 0;
    vi.stubGlobal('indexedDB', {
      open() {
        const req: Record<string, unknown> = {};
        req.result = {
          transaction() {
            const tx: Record<string, unknown> = {};
            tx.objectStore = () => ({
              put(value: unknown, key: string) {
                if (key === 'autosave') puts++;
                setTimeout(() => {
                  store.set(key, value);
                  (tx.oncomplete as (() => void) | undefined)?.();
                }, 50);
              },
              get(key: string) {
                const g: Record<string, unknown> = {};
                setTimeout(() => {
                  g.result = store.get(key);
                  (g.onsuccess as (() => void) | undefined)?.();
                }, 1);
                return g;
              },
            });
            return tx;
          },
        };
        setTimeout(() => (req.onsuccess as (() => void) | undefined)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory);
    const { game } = gameOn('2026-09-28', 11, {
      hidden: () => false,
      scheduleIdle: (run) => {
        const t = setTimeout(run, 0);
        return () => clearTimeout(t);
      },
    });
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const onDisk = (): number => JSON.parse(store.get('autosave') as string).rooms.length;
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    await game.save();
    game.setSpeed(0);
    for (let x = 140; x < 150; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    await wait(300);
    expect(onDisk()).toBe(11);

    const before = puts;
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 139 });
    await wait(10); // that save is writing now
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 138 });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 137 });
    await wait(500);
    expect(game.world.rooms.size).toBe(14);
    expect(onDisk()).toBe(14);
    expect(puts - before).toBe(2); // the two asks during the write made one follow-up
  });
});

describe('D S9: an unreadable save at boot', () => {
  function corruptSave(): string {
    const g0 = gameOn().game;
    g0.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    const good = g0.exportSave();
    return good.slice(0, Math.floor(good.length / 2));
  }

  it('does not claim a copy when the copy failed, and no autosave writes over the slot', async () => {
    const corrupt = corruptSave();
    const ls = fakeLocalStorage((key) => key === 'hs.save.unreadable');
    vi.stubGlobal('localStorage', ls.store);
    ls.data.set('hundred-stories:autosave', corrupt);
    const { game, second } = gameOn('2026-09-28', 5);
    expect((await game.load()).ok).toBe(false);
    const said = warns(game);
    expect(said).toHaveLength(1);
    expect(said[0]).not.toMatch(/kept a copy/i);
    expect(ls.data.has('hs.save.unreadable')).toBe(false);
    // Save to a file can still take the text out this session, from memory.
    expect(game.getKeptCopy()).toBe(corrupt);

    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    game.world.time.minute = 360 + 1440 - 1;
    second();
    await settle();
    expect(ls.data.get('hundred-stories:autosave')).toBe(corrupt);

    // Save now is the player choosing the new tower.
    expect(await game.save()).toEqual({ ok: true });
    expect(JSON.parse(ls.data.get('hundred-stories:autosave')!).seed).toBe(5);
  });

  it('says it kept a copy only when it did, and the copy can be taken out', async () => {
    const corrupt = corruptSave();
    const ls = fakeLocalStorage();
    vi.stubGlobal('localStorage', ls.store);
    ls.data.set('hundred-stories:autosave', corrupt);
    const { game, second } = gameOn('2026-09-28', 5);
    await game.load();
    expect(warns(game)[0]).toMatch(/We kept a copy of it/);
    expect(game.getKeptCopy()).toBe(corrupt);
    game.world.time.minute = 360 + 1440 - 1;
    second();
    await settle();
    expect(ls.data.get('hundred-stories:autosave')).toBe(corrupt);
  });
});

describe('decision 11: ?seed takes the share link range only', () => {
  it('refuses a number past the 32 bit range and anything that is not plain digits', () => {
    expect(bootTarget('?seed=4294967296')).toEqual({ kind: 'mine', fresh: false });
    expect(bootTarget('?seed=1e3')).toEqual({ kind: 'mine', fresh: false });
    expect(bootTarget('?seed=0x10')).toEqual({ kind: 'mine', fresh: false });
    expect(bootTarget('?seed=1.0')).toEqual({ kind: 'mine', fresh: false });
    expect(bootTarget('?seed=4294967295')).toEqual({ kind: 'friend', seed: 4294967295 });
    expect(bootTarget('?seed=0')).toEqual({ kind: 'friend', seed: 0 });
  });
});

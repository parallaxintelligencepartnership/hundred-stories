// Closeout 2026-09-25, real-data lane (probe-rd parts A, A2 and B), with the real storage module
// under the game: no storage mock. A read that fails is not "no save", and an opened file is
// always My tower.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, READ_FAILED_NOTICE } from '../../src/game/game';
import { createFileStorage, createTauriStorage, SAVE_PRESENT_KEY, SaveReadError, type FileSlotFs, type TauriSlotFs } from '../../src/game/storage';

const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await task();
};

// A minimal IndexedDB: every call settles in a later task; open() fails while failOpens > 0.
const idbData = new Map<string, unknown>();
let failOpens = 0;
const indexedDB = {
  open() {
    const req: Record<string, unknown> & { onsuccess?: () => void; onerror?: () => void } = {};
    if (failOpens > 0) {
      failOpens--;
      req.error = new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
      setTimeout(() => req.onerror?.(), 0);
      return req;
    }
    req.result = {
      transaction() {
        const tx: Record<string, unknown> & { oncomplete?: () => void } = { error: null };
        let pending = 0;
        tx.objectStore = () => ({
          put(v: unknown, k: string) {
            pending++;
            setTimeout(() => {
              idbData.set(k, v);
              if (--pending === 0) tx.oncomplete?.();
            }, 0);
          },
          get(k: string) {
            const g: Record<string, unknown> & { onsuccess?: () => void } = {};
            setTimeout(() => {
              g.result = idbData.get(k);
              g.onsuccess?.();
            }, 0);
            return g;
          },
        });
        return tx;
      },
    };
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  },
};
const ls = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
  clear: () => ls.clear(),
  key: () => null,
  get length() {
    return ls.size;
  },
};

beforeEach(() => {
  idbData.clear();
  ls.clear();
  failOpens = 0;
  vi.stubGlobal('localStorage', localStorage);
});
afterEach(() => vi.unstubAllGlobals());

function gameOn(seed: number) {
  const clock = { ms: 0 };
  const game = createGame(seed, {
    now: () => clock.ms,
    hidden: () => true,
    scheduleIdle: (run: () => void) => {
      run();
      return () => {};
    },
    today: () => '2026-09-28',
    freshSeed: () => 77,
  });
  const second = (): void => {
    clock.ms += 1000;
    game.stepOnce();
  };
  return { game, second };
}
const saved = (t: unknown): { seed: number; rooms: number } | null =>
  typeof t === 'string' ? { seed: JSON.parse(t).seed, rooms: JSON.parse(t).rooms.length } : null;

describe('a save that could not be read is not "no save" (probe-rd A)', () => {
  it('one failed IndexedDB open at boot, then a 06:00 autosave, leaves seed 11 with 40 rooms stored', async () => {
    vi.stubGlobal('indexedDB', indexedDB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const s1 = gameOn(11).game;
      for (let x = 100; x < 140; x++) s1.apply({ kind: 'build', room: 'lobby', floor: 1, x });
      expect(await s1.save()).toEqual({ ok: true });
      expect(saved(idbData.get('autosave'))).toEqual({ seed: 11, rooms: 40 });

      failOpens = 1; // the boot read's one open fails, the next works
      const { game: s2, second } = gameOn(555);
      expect(await s2.load()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
      expect(s2.world.log.some((l) => l.level === 'warn' && l.text === READ_FAILED_NOTICE)).toBe(true);
      expect(warn).toHaveBeenCalled();

      s2.world.time.minute = 360 + 1440 - 1;
      second();
      await settle();
      expect(saved(idbData.get('autosave'))).toEqual({ seed: 11, rooms: 40 });
      // Save now is refused in the same words; the stored tower stays.
      expect(await s2.save()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
      expect(saved(idbData.get('autosave'))).toEqual({ seed: 11, rooms: 40 });

      const s3 = gameOn(999).game;
      expect(await s3.load()).toEqual({ ok: true });
      expect(s3.world.seed).toBe(11);
      expect(s3.world.rooms.size).toBe(40);

      // New game on purpose lifts the protection.
      s2.newGame(12);
      await settle();
      expect(saved(idbData.get('autosave'))).toEqual({ seed: 12, rooms: 0 });
    } finally {
      warn.mockRestore();
    }
  });

  it('a first visit with a broken IndexedDB and no marker starts a tower: no notice, the first autosave lands in localStorage', async () => {
    vi.stubGlobal('indexedDB', indexedDB);
    failOpens = 1000; // IndexedDB never opens in this browser
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { game, second } = gameOn(555);
      expect(await game.load()).toEqual({ ok: false, reason: 'There is no saved game yet.' });
      expect(game.world.log.some((l) => l.text === READ_FAILED_NOTICE)).toBe(false);
      game.world.time.minute = 360 + 1440 - 1;
      second();
      await settle();
      expect(saved(ls.get('hundred-stories:autosave'))).toEqual({ seed: 555, rooms: 0 });
      expect(ls.get(SAVE_PRESENT_KEY)).toBe('1');
    } finally {
      warn.mockRestore();
    }
  });

  it('a returning visit (marker set) with a broken IndexedDB and no localStorage copy gets the notice and a protected slot', async () => {
    vi.stubGlobal('indexedDB', indexedDB);
    ls.set(SAVE_PRESENT_KEY, '1');
    failOpens = 1000;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { game, second } = gameOn(555);
      expect(await game.load()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
      expect(game.world.log.some((l) => l.level === 'warn' && l.text === READ_FAILED_NOTICE)).toBe(true);
      expect(warn).toHaveBeenCalled();
      game.world.time.minute = 360 + 1440 - 1;
      second();
      await settle();
      expect(ls.get('hundred-stories:autosave')).toBeUndefined();
      expect(idbData.size).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('an empty slot still reads as no save', async () => {
    vi.stubGlobal('indexedDB', indexedDB);
    expect(await gameOn(5).game.load()).toEqual({ ok: false, reason: 'There is no saved game yet.' });
  });
});

describe('the shell slots tell a failed read from a missing file (probe-rd A2)', () => {
  const tauri = (fail: unknown): TauriSlotFs => ({
    ensureDir: async () => {},
    writeTextFile: async () => {},
    rename: async () => {},
    readTextFile: async () => {
      throw fail;
    },
  });
  const cap = (fail: unknown): FileSlotFs => ({
    writeFile: async () => ({}),
    readFile: async () => {
      throw fail;
    },
  });

  it('a locked Tauri file and a Capacitor I/O error are read failures, not null', async () => {
    const locked = new Error('The process cannot access the file because it is being used by another process. (os error 32)');
    await expect(createTauriStorage(tauri(locked)).readSave()).rejects.toBeInstanceOf(SaveReadError);
    await expect(createFileStorage(cap(new Error('Unable to read file: I/O error'))).readSave()).rejects.toBeInstanceOf(SaveReadError);
  });

  it('a file that is not there yet still reads as null', async () => {
    for (const missing of [
      'failed to open file at path: /x/autosave.json with error: No such file or directory (os error 2)',
      'The system cannot find the path specified. (os error 3)',
    ]) {
      expect(await createTauriStorage(tauri(missing)).readSave()).toBeNull();
    }
    const plugin = Object.assign(new Error("'readFile' failed because file at '/data/autosave.json' does not exist."), { code: 'OS-PLUG-FILE-0008' });
    expect(await createFileStorage(cap(plugin)).readSave()).toBeNull();
  });
});

describe('Open a saved file always opens My tower (probe-rd B)', () => {
  it("opened in Friend's tower, the file is in My tower after the next friend link", async () => {
    const src = gameOn(11).game;
    for (let x = 100; x < 130; x++) src.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    const file = src.exportSave();

    const { game } = gameOn(5);
    await game.openFriend(4242);
    expect(game.importSave(file)).toEqual({ ok: true });
    expect(game.getSlot()).toBe('mine');
    expect(game.world.seed).toBe(11);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 140 }); // the player builds on the opened file

    await game.openFriend(8888); // another friend link: leaving My tower saves it
    await settle();
    expect(saved(ls.get('hundred-stories:friend'))?.seed).toBe(8888);
    expect(saved(ls.get('hundred-stories:autosave'))).toEqual({ seed: 11, rooms: 31 });

    // Reload at /play/: My tower is the opened file.
    const r = gameOn(6).game;
    expect(await r.load()).toEqual({ ok: true });
    expect(r.world.seed).toBe(11);
  });
});

// Two windows on one slot (game readiness F3) and the page's IndexedDB connection (R3). Each
// "page" is a fresh module graph (vi.resetModules) on one shared fake IndexedDB and localStorage,
// the way a second tab or the installed app beside a browser tab loads the game.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handClock, savedTower } from './leave-stores';

type StorageModule = typeof import('../../src/game/storage');

function fakeLocalStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
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
      data.set(key, value);
    },
  };
}

type Handler = (() => void) | undefined;

/**
 * An IndexedDB stand-in. Requests settle in later tasks; a transaction's puts land only when it
 * completes, and an aborted one lands nothing. `stallOpen`: open() never answers. `txThrows`:
 * transaction() throws (a lost connection). Counts opens and closes and keeps every connection.
 */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = { stallOpen: false, txThrows: false, opens: 0, closes: 0, dbs: [] as Record<string, unknown>[] };
  const later = (f: () => void): void => void setTimeout(f, 0);
  const factory = {
    open: () => {
      ctl.opens++;
      const req: Record<string, unknown> = {};
      if (ctl.stallOpen) return req;
      const db: Record<string, unknown> = {
        closed: false,
        close: () => {
          db.closed = true;
          ctl.closes++;
        },
        transaction: () => {
          if (ctl.txThrows || db.closed) throw new DOMException('Connection to Indexed Database server lost', 'UnknownError');
          const tx: Record<string, unknown> = { error: null };
          const fire = (name: string): void => (tx[name] as Handler)?.();
          const writes: [string, unknown][] = [];
          let pending = 0;
          let aborted = false;
          const done = (): void => {
            if (--pending > 0 || aborted) return;
            for (const [k, v] of writes) data.set(k, v);
            fire('oncomplete');
          };
          tx.abort = () => {
            if (aborted) return;
            aborted = true;
            later(() => fire('onabort'));
          };
          tx.objectStore = () => ({
            put: (v: unknown, k: string) => {
              pending++;
              writes.push([k, v]);
              later(done);
            },
            get: (k: string) => {
              pending++;
              const g: Record<string, unknown> = {};
              later(() => {
                if (aborted) return;
                g.result = data.get(k);
                (g.onsuccess as Handler)?.();
                done();
              });
              return g;
            },
          });
          return tx;
        },
      };
      ctl.dbs.push(db);
      req.result = db;
      later(() => (req.onsuccess as Handler)?.());
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, ctl, data };
}

/** One page: a fresh copy of the storage module. */
async function page(): Promise<StorageModule> {
  vi.resetModules();
  return await import('../../src/game/storage');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const conflictOf = (p: Promise<unknown>): Promise<unknown> => p.then(() => 'resolved', (e: unknown) => e);

describe('F3: a page holding an older copy never saves over a newer one', () => {
  it('two pages on one IndexedDB: A saves, B (loaded before) is refused, A stays stored', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('base');
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('base');

    await A.createStorage(deps).writeSave('tower A');
    const err = await conflictOf(B.createStorage(deps).writeSave('stale B'));
    expect(err).toBeInstanceOf(B.SaveConflictError);
    expect((err as Error).name).toBe('SaveConflictError');
    expect(idb.data.get('autosave')).toBe('tower A');
    expect(ls.getItem('hundred-stories:autosave')).toBeNull(); // no fallback copy either
    // Never retried or settled by the higher number: B's next try is refused the same way.
    await expect(B.createStorage(deps).writeSave('stale B again')).rejects.toThrow(B.SaveConflictError);
    expect(idb.data.get('autosave')).toBe('tower A');
  });

  it('localStorage only (no IndexedDB): the same refusal, and the copies now carry a number', async () => {
    const ls = fakeLocalStorage();
    const deps = { localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    expect(ls.getItem('hundred-stories:autosave:seq')).not.toBeNull();
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('base');
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('base');
    await A.createStorage(deps).writeSave('tower A');
    await expect(B.createStorage(deps).writeSave('stale B')).rejects.toThrow(B.SaveConflictError);
    expect(ls.getItem('hundred-stories:autosave')).toBe('tower A');
  });

  it('old data with no number keeps loading and saving on both paths', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    idb.data.set('autosave', 'old idb tower');
    const m = await page();
    expect(await m.createStorage({ indexedDB: idb.factory, localStorage: ls }).readSave()).toBe('old idb tower');
    await m.createStorage({ indexedDB: idb.factory, localStorage: ls }).writeSave('saved over it');
    expect(idb.data.get('autosave')).toBe('saved over it');

    const ls2 = fakeLocalStorage();
    ls2.setItem('hundred-stories:autosave', 'old local tower');
    const m2 = await page();
    expect(await m2.createStorage({ localStorage: ls2 }).readSave()).toBe('old local tower');
    await m2.createStorage({ localStorage: ls2 }).writeSave('saved over it');
    expect(ls2.getItem('hundred-stories:autosave')).toBe('saved over it');
  });

  it('a page saving over its own writes, in either store, never conflicts; a page that read before them is refused', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('base');
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('base');
    for (let i = 1; i <= 4; i++) await A.createStorage(deps).writeSave(`A ${i}`);
    idb.ctl.txThrows = true; // A's IndexedDB goes: its saves fall back to localStorage
    await A.createStorage(deps).writeSave('A 5');
    expect(ls.getItem('hundred-stories:autosave')).toBe('A 5');
    idb.ctl.txThrows = false;
    await A.createStorage(deps).writeSave('A 6');
    expect(await A.createStorage(deps).readSave()).toBe('A 6');
    await A.createStorage(deps).writeSave('A 7');
    expect(idb.data.get('autosave')).toBe('A 7');
    await expect(B.createStorage(deps).writeSave('stale B')).rejects.toThrow(B.SaveConflictError);
  });

  it("a page whose IndexedDB is down is refused by another window's IndexedDB save (the device record)", async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('base');
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('base');
    await A.createStorage(deps).writeSave('tower A');
    idb.ctl.txThrows = true;
    await expect(B.createStorage(deps).writeSave('stale B')).rejects.toThrow(B.SaveConflictError);
    expect(ls.getItem('hundred-stories:autosave')).toBeNull();
  });

  it('a forced write (New tower, Save anyway) replaces the newer save', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('base');
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('base');
    await A.createStorage(deps).writeSave('tower A');
    await expect(B.createStorage(deps).writeSave('stale B')).rejects.toThrow(B.SaveConflictError);
    await B.createStorage(deps).writeSave('new tower B', { force: true });
    expect(idb.data.get('autosave')).toBe('new tower B');
    // B now holds the newest: its next ordinary save goes through, and A's is the stale one.
    await B.createStorage(deps).writeSave('B goes on');
    await expect(A.createStorage(deps).writeSave('stale A')).rejects.toThrow(A.SaveConflictError);
  });

  it('a slot this page never read is written without the check, forced or not, and is guarded from then on', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('saved elsewhere');
    const C = await page(); // a link boot: My tower is never read
    await C.createStorage(deps).writeSave('opened file');
    expect(idb.data.get('autosave')).toBe('opened file');
    const D = await page();
    await D.createStorage(deps).writeSave('forced file', { force: true });
    expect(idb.data.get('autosave')).toBe('forced file');
    // C wrote once, so it holds a base now: D's write is newer and C's next save is refused.
    await expect(C.createStorage(deps).writeSave('C again')).rejects.toThrow(C.SaveConflictError);
    expect(idb.data.get('autosave')).toBe('forced file');
  });

  it('a slot that could not be read is still a read failure, and the guard writes nothing on its own', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('the real tower');
    const m = await page();
    idb.ctl.txThrows = true;
    await expect(m.createStorage(deps).readSave()).rejects.toThrow(m.SaveReadError);
    idb.ctl.txThrows = false;
    expect(idb.data.get('autosave')).toBe('the real tower');
    expect(ls.getItem('hundred-stories:autosave')).toBeNull();
  });
});

describe('R3: one connection per page, and an open deadline', () => {
  it('two saves and a load open one connection; a closed connection is reopened', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    const m = await page();
    await m.createStorage(deps).writeSave('one');
    await m.createStorage(deps).writeSave('two');
    expect(await m.createStorage(deps).readSave()).toBe('two');
    expect(idb.ctl.opens).toBe(1);

    // The browser closes it (onclose): the next call opens a fresh one.
    const first = idb.ctl.dbs[0]!;
    first.closed = true;
    (first.onclose as Handler)?.();
    await m.createStorage(deps).writeSave('three');
    expect(idb.ctl.opens).toBe(2);

    // Another page asks for a newer version: this page closes its connection and lets it go.
    const second = idb.ctl.dbs[1]!;
    (second.onversionchange as Handler)?.();
    expect(second.closed).toBe(true);
    expect(await m.createStorage(deps).readSave()).toBe('three');
    expect(idb.ctl.opens).toBe(3);
  });

  it('a lost connection is let go and the next call opens a fresh one', async () => {
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: fakeLocalStorage() };
    const m = await page();
    await m.createStorage(deps).writeSave('one');
    idb.ctl.dbs[0]!.closed = true; // lost with no close event
    await m.createStorage(deps).writeSave('two');
    expect(idb.data.get('autosave')).toBe('two');
    expect(idb.ctl.opens).toBe(2);
  });

  it('a stalled open fails a read with SaveReadError within the deadline, first visit or not', async () => {
    const idb = fakeIdb();
    idb.ctl.stallOpen = true;
    const m = await page();
    const s = m.createStorage({ indexedDB: idb.factory, localStorage: fakeLocalStorage(), openDeadlineMs: 30 });
    const t0 = Date.now();
    await expect(s.readSave()).rejects.toThrow(m.SaveReadError);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a stalled open fails a write (no fallback copy), and the next call tries a fresh open', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    idb.ctl.stallOpen = true;
    const m = await page();
    const s = m.createStorage({ indexedDB: idb.factory, localStorage: ls, openDeadlineMs: 30 });
    await expect(s.writeSave('tower')).rejects.toThrow('This browser would not let the game save.');
    expect(ls.getItem('hundred-stories:autosave')).toBeNull();
    idb.ctl.stallOpen = false;
    await s.writeSave('tower');
    expect(idb.data.get('autosave')).toBe('tower');
    expect(idb.ctl.opens).toBe(2);
  });
});

describe('F3 through the game: the stale window is told, and New tower still replaces', () => {
  async function game() {
    vi.resetModules();
    return await import('../../src/game/game');
  }

  it("page B's Save now and leave report the conflict; A's tower stays stored; B's New tower replaces it", async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('indexedDB', idb.factory);
    const seed = (await game()).createGame(11, handClock().opts);
    expect(seed.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
    expect((await seed.save()).ok).toBe(true);

    const gA = await game();
    const A = gA.createGame(11, handClock().opts);
    expect((await A.load()).ok).toBe(true);
    const gB = await game();
    const B = gB.createGame(11, handClock().opts);
    expect((await B.load()).ok).toBe(true);

    expect(A.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }).ok).toBe(true);
    expect(await A.save()).toEqual({ ok: true });
    expect(B.apply({ kind: 'build', room: 'lobby', floor: 1, x: 60 }).ok).toBe(true);
    expect(await B.save()).toMatchObject({ ok: false, conflict: true });
    expect(await B.leave('reload')).toEqual({ ok: false, reason: gB.LEAVE_CONFLICT, conflict: true });
    expect(savedTower(idb.data.get('autosave'))?.lobbies).toContain(100);
    expect(savedTower(idb.data.get('autosave'))?.lobbies).not.toContain(60);

    expect(await B.newGame(5)).toMatchObject({ ok: true });
    expect(savedTower(idb.data.get('autosave'))?.seed).toBe(5);
  });

  it('Save anyway over a held save replaces a newer one from another window', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('indexedDB', idb.factory);
    idb.data.set('autosave', 'not a save');
    idb.data.set('autosave:seq', 3);
    const B = (await game()).createGame(11, handClock().opts);
    expect((await B.load()).ok).toBe(false);
    expect(B.saveHeld()).toBe(true);
    const A = (await game()).createGame(12, handClock().opts);
    await A.load();
    expect(await A.save()).toEqual({ ok: true }); // A's Save anyway
    expect(savedTower(idb.data.get('autosave'))?.seed).toBe(12);
    expect(await B.save()).toEqual({ ok: true }); // B's Save anyway: on purpose, past the check
    expect(savedTower(idb.data.get('autosave'))?.seed).toBe(11);
  });
});

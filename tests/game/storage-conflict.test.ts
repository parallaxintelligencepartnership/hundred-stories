// Two windows on one slot (game readiness F3) and the page's IndexedDB connection (R3). Each
// "page" is a fresh module graph (vi.resetModules) on one shared fake IndexedDB and localStorage,
// the way a second tab or the installed app beside a browser tab loads the game.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handClock, savedTower, settle } from './leave-stores';

type StorageModule = typeof import('../../src/game/storage');

/** An in memory localStorage. `refuse` makes every write throw the way a full quota does. */
function fakeLocalStorage(): Storage & { data: Map<string, string>; refuse: boolean } {
  const data = new Map<string, string>();
  const ls = {
    data,
    refuse: false,
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
      if (ls.refuse) throw new DOMException('quota', 'QuotaExceededError');
      data.set(key, value);
    },
  };
  return ls;
}

type Handler = (() => void) | undefined;

/**
 * An IndexedDB stand-in. Requests settle in later tasks; a transaction's puts land only when it
 * completes, and an aborted one lands nothing. `stallOpen`: open() never answers. `lateOpenMs`:
 * open() answers after that long. `openFails`: open() errors. `txThrows`: transaction() throws (a
 * lost connection). `abortCommit`: a transaction with puts aborts at commit (a full quota). Counts
 * opens and closes and keeps every connection.
 */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = {
    stallOpen: false,
    lateOpenMs: 0,
    openFails: false,
    txThrows: false,
    abortCommit: false,
    opens: 0,
    closes: 0,
    dbs: [] as Record<string, unknown>[],
  };
  const later = (f: () => void, ms = 0): void => void setTimeout(f, ms);
  const factory = {
    open: () => {
      ctl.opens++;
      const req: Record<string, unknown> = {};
      if (ctl.stallOpen) return req;
      if (ctl.openFails) {
        req.error = new DOMException('Connection to Indexed Database server lost', 'UnknownError');
        later(() => (req.onerror as Handler)?.());
        return req;
      }
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
            if (writes.length > 0 && ctl.abortCommit) {
              aborted = true;
              tx.error = new DOMException('quota', 'QuotaExceededError');
              fire('onabort');
              return;
            }
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
      later(() => (req.onsuccess as Handler)?.(), ctl.lateOpenMs);
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

describe('P1b fixes in the store: own numbers, the device record, reads that are not adopted', () => {
  it('I1: a save that failed in both stores leaves no number as its own, so the stale page is still refused (IndexedDB)', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const A = await page();
    await A.createStorage(deps).readSave();
    const B = await page();
    await B.createStorage(deps).readSave();
    idb.ctl.abortCommit = true;
    ls.refuse = true;
    await expect(A.createStorage(deps).writeSave('A fails')).rejects.toThrow('This browser would not let the game save.');
    idb.ctl.abortCommit = false;
    ls.refuse = false;
    await B.createStorage(deps).writeSave('B progress');
    await expect(A.createStorage(deps).writeSave('A stale over B')).rejects.toThrow(A.SaveConflictError);
    expect(idb.data.get('autosave')).toBe('B progress');
  });

  it('I1: the same on localStorage only', async () => {
    const ls = fakeLocalStorage();
    const deps = { localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const A = await page();
    await A.createStorage(deps).readSave();
    const B = await page();
    await B.createStorage(deps).readSave();
    ls.refuse = true;
    await expect(A.createStorage(deps).writeSave('A fails')).rejects.toThrow('This browser would not let the game save.');
    ls.refuse = false;
    await B.createStorage(deps).writeSave('B progress');
    await expect(A.createStorage(deps).writeSave('A stale over B')).rejects.toThrow(A.SaveConflictError);
    expect(ls.getItem('hundred-stories:autosave')).toBe('B progress');
  });

  it("a number the page's own write landed stays its own: a read that took an older copy meanwhile does not refuse its next save", async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    const m = await page();
    await m.createStorage(deps).writeSave('one');
    // The read takes the copy from before 'two' lands, and is put in hand after 'two' moved the
    // base on (Go back to last save while an autosave writes): the base goes back to 'one'.
    const receipt: { adopt?: () => void } = {};
    const [, read] = await Promise.all([m.createStorage(deps).writeSave('two'), m.createStorage(deps).readSave(receipt)]);
    expect(read).toBe('one');
    receipt.adopt?.();
    await m.createStorage(deps).writeSave('three');
    expect(idb.data.get('autosave')).toBe('three');
  });

  it('A1: no IndexedDB and a device record left from before: the page reads, saves and saves again, across a reload', async () => {
    const ls = fakeLocalStorage();
    ls.setItem('hundred-stories:autosave:seq-high', '42');
    ls.setItem('hs.save.present', '1');
    const deps = { localStorage: ls };
    for (let reload = 0; reload < 2; reload++) {
      const m = await page();
      await m.createStorage(deps).readSave();
      await m.createStorage(deps).writeSave(`save ${reload}`);
      await m.createStorage(deps).writeSave(`again ${reload}`);
    }
    expect(ls.getItem('hundred-stories:autosave')).toBe('again 1');
    // The record still only goes up.
    expect(Number(ls.getItem('hundred-stories:autosave:seq-high'))).toBeGreaterThan(42);
  });

  it('A1: the record is still a newer save when it rose after the read', async () => {
    const ls = fakeLocalStorage();
    ls.setItem('hundred-stories:autosave:seq-high', '42');
    const deps = { localStorage: ls };
    const A = await page();
    await A.createStorage(deps).readSave();
    const B = await page();
    await B.createStorage(deps).readSave();
    await B.createStorage(deps).writeSave('B');
    await expect(A.createStorage(deps).writeSave('stale A')).rejects.toThrow(A.SaveConflictError);
  });

  it('A2: a read handed a receipt moves the base only when adopted', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const A = await page();
    await A.createStorage(deps).readSave();
    const B = await page();
    await B.createStorage(deps).readSave();
    await A.createStorage(deps).writeSave('A');
    const peek: { adopt?: () => void } = {};
    expect(await B.createStorage(deps).readSave(peek)).toBe('A');
    await expect(B.createStorage(deps).writeSave('stale B')).rejects.toThrow(B.SaveConflictError);
    peek.adopt?.();
    await B.createStorage(deps).writeSave('B on top of A');
    expect(idb.data.get('autosave')).toBe('B on top of A');
  });
});

describe('P1b coverage: the fallback copy in the check, a late open, a fallback read, a dropped connection', () => {
  it("an IndexedDB save is refused by another window's newer fallback copy, and the next boot reads that copy", async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    await (await page()).createStorage(deps).writeSave('base');
    const A = await page();
    await A.createStorage(deps).readSave();
    const B = await page();
    await B.createStorage(deps).readSave();
    idb.ctl.txThrows = true; // B's IndexedDB is down: its save falls back
    await B.createStorage(deps).writeSave('B via fallback');
    idb.ctl.txThrows = false;
    expect(ls.getItem('hundred-stories:autosave')).toBe('B via fallback');
    await expect(A.createStorage(deps).writeSave('A stale')).rejects.toThrow(A.SaveConflictError);
    expect(await (await page()).createStorage(deps).readSave()).toBe('B via fallback');
  });

  it('an open that answers after the deadline is closed, not kept; the next call opens fresh', async () => {
    const idb = fakeIdb();
    idb.ctl.lateOpenMs = 60;
    const m = await page();
    const s = m.createStorage({ indexedDB: idb.factory, localStorage: fakeLocalStorage(), openDeadlineMs: 15 });
    await expect(s.readSave()).rejects.toThrow(m.SaveReadError);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(idb.ctl.closes).toBe(1);
    expect(idb.ctl.dbs[0]?.closed).toBe(true);
    idb.ctl.lateOpenMs = 0;
    await s.writeSave('x');
    expect(idb.ctl.opens).toBe(2);
    expect(idb.ctl.dbs[1]?.closed).toBe(false);
    expect(idb.data.get('autosave')).toBe('x');
  });

  it('a read served by the fallback copy sets the base: another window saving after it refuses this page', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    const first = await page();
    await first.createStorage(deps).writeSave('base');
    idb.ctl.txThrows = true;
    await first.createStorage(deps).writeSave('fallback'); // a fallback copy, newer than IndexedDB
    const A = await page();
    expect(await A.createStorage(deps).readSave()).toBe('fallback'); // IndexedDB will not answer A
    idb.ctl.txThrows = false;
    const B = await page();
    expect(await B.createStorage(deps).readSave()).toBe('fallback');
    await B.createStorage(deps).writeSave('B');
    await expect(A.createStorage(deps).writeSave('stale A')).rejects.toThrow(A.SaveConflictError);
    expect(idb.data.get('autosave')).toBe('B');
  });

  it('a kept connection the browser drops, then an open that fails: the save falls back to localStorage and the next boot reads it', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    const deps = { indexedDB: idb.factory, localStorage: ls };
    const m = await page();
    await m.createStorage(deps).writeSave('one');
    const kept = idb.ctl.dbs[0]!;
    kept.closed = true;
    (kept.onclose as Handler)?.();
    idb.ctl.openFails = true;
    await m.createStorage(deps).writeSave('two');
    expect(idb.ctl.opens).toBe(2);
    expect(ls.getItem('hundred-stories:autosave')).toBe('two');
    expect(idb.data.get('autosave')).toBe('one');
    idb.ctl.openFails = false;
    expect(await (await page()).createStorage(deps).readSave()).toBe('two');
  });
});

describe('P1b fixes through the game: the stale window is told, once, and stops saving on its own', () => {
  async function gamePage() {
    vi.resetModules();
    return await import('../../src/game/game');
  }

  /** A game clock whose tab can be hidden or shown, counting the idle saves it schedules. */
  function visibleClock() {
    const hand = handClock();
    const view = { hidden: false, idles: 0 };
    const opts = {
      ...hand.opts,
      hidden: () => view.hidden,
      scheduleIdle: (run: () => void) => {
        view.idles++;
        run();
        return () => {};
      },
    };
    return { view, opts };
  }

  /** My tower saved, then page A and page B both read it; A saves again, so B is stale. */
  async function twoWindows() {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('indexedDB', idb.factory);
    const first = (await gamePage()).createGame(11, handClock().opts);
    first.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    expect((await first.save()).ok).toBe(true);
    const A = (await gamePage()).createGame(11, handClock().opts);
    expect((await A.load()).ok).toBe(true);
    const gB = await gamePage();
    const clock = visibleClock();
    const B = gB.createGame(11, clock.opts);
    expect((await B.load()).ok).toBe(true);
    A.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    expect(await A.save()).toEqual({ ok: true });
    return { ls, idb, A, B, gB, view: clock.view };
  }

  const warns = (g: { world: { log: { text: string; level?: string }[] } }, from: number): string[] =>
    g.world.log.slice(from).filter((l) => l.level === 'warn').map((l) => l.text);

  /** A background save: pausing with an unsaved change saves in the next idle slot. */
  async function backgroundSave(B: { apply(c: { kind: 'build'; room: 'lobby'; floor: number; x: number }): unknown; setSpeed(s: 0 | 1): void }, x: number): Promise<void> {
    B.setSpeed(1);
    B.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    B.setSpeed(0);
    await settle();
  }

  it('I2: the first background conflict owes the card and logs once; a second schedules nothing and says nothing; Save now owes it every time', async () => {
    const { idb, B, gB, view } = await twoWindows();
    const lines = B.world.log.length;
    await backgroundSave(B, 60);
    expect(view.idles).toBe(1);
    expect(warns(B, lines)).toEqual([gB.LEAVE_CONFLICT]);
    expect(B.takeSaveConflict?.()).toEqual({ ok: false, reason: gB.LEAVE_CONFLICT, conflict: true });
    expect(B.takeSaveConflict?.()).toBeNull();

    await backgroundSave(B, 61);
    expect(view.idles).toBe(1); // no further background save was scheduled
    expect(warns(B, lines)).toEqual([gB.LEAVE_CONFLICT]);
    expect(B.takeSaveConflict?.()).toBeNull();
    expect(savedTower(idb.data.get('autosave'))?.lobbies).not.toContain(60);

    expect(await B.save()).toMatchObject({ ok: false, conflict: true });
    expect(B.takeSaveConflict?.()).toMatchObject({ conflict: true });
    expect(await B.save()).toMatchObject({ ok: false, conflict: true });
    expect(B.takeSaveConflict?.()).toMatchObject({ conflict: true });
    expect(warns(B, lines)).toEqual([gB.LEAVE_CONFLICT]); // and never the generic not-saving line
  });

  it('I2: a conflict while the page is hidden is owed once it is visible again', async () => {
    const { B, view } = await twoWindows();
    view.hidden = true;
    await backgroundSave(B, 60);
    expect(B.takeSaveConflict?.()).toBeNull();
    view.hidden = false;
    expect(B.takeSaveConflict?.()).toMatchObject({ conflict: true });
  });

  it('I2: Leave reports the conflict and owes no second card; Go back to last save ends the stale state', async () => {
    const { idb, B, gB } = await twoWindows();
    B.apply({ kind: 'build', room: 'lobby', floor: 1, x: 60 });
    expect(await B.leave('reload')).toEqual({ ok: false, reason: gB.LEAVE_CONFLICT, conflict: true });
    expect(B.takeSaveConflict?.()).toBeNull();
    expect((await B.load()).ok).toBe(true);
    await backgroundSave(B, 70);
    expect(savedTower(idb.data.get('autosave'))?.lobbies).toEqual([70, 100, 150]);
  });

  it('A2: a read whose tower is not put in hand does not let a stale save through', async () => {
    const ls = fakeLocalStorage();
    const idb = fakeIdb();
    vi.stubGlobal('indexedDB', idb.factory);
    vi.stubGlobal('localStorage', ls);
    const A = (await gamePage()).createGame(1, handClock().opts);
    await A.openFriend(4242);
    const B = (await gamePage()).createGame(1, handClock().opts);
    await B.openFriend(4242);
    A.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    expect(await A.save()).toEqual({ ok: true });
    // B's Go back to last save meets a copy it cannot open: B keeps its tower, and its base.
    const text = idb.data.get('friend');
    idb.data.set('friend', '{"broken":');
    expect((await B.load()).ok).toBe(false);
    idb.data.set('friend', text);
    B.apply({ kind: 'build', room: 'lobby', floor: 1, x: 60 });
    expect(await B.save()).toMatchObject({ ok: false, conflict: true });
    expect(savedTower(idb.data.get('friend'))?.lobbies).toContain(100);
  });

  it('A3: Open a saved file replaces My tower on purpose, from a stale My tower page and from a link boot alike', async () => {
    const { idb, A, B } = await twoWindows();
    const file = (await gamePage()).createGame(99, handClock().opts).exportSave();
    expect(await B.importSave(file)).toEqual({ ok: true });
    expect(await B.save()).toEqual({ ok: true });
    expect(savedTower(idb.data.get('autosave'))?.seed).toBe(99);
    expect(await B.save()).toEqual({ ok: true }); // B now holds the newest
    // The window that did not open the file is the stale one now.
    A.apply({ kind: 'build', room: 'lobby', floor: 1, x: 130 });
    expect(await A.save()).toMatchObject({ ok: false, conflict: true });

    const C = (await gamePage()).createGame(5, handClock().opts);
    await C.openDaily(); // a link boot: My tower never read
    const other = (await gamePage()).createGame(98, handClock().opts).exportSave();
    expect(await C.importSave(other)).toEqual({ ok: true });
    expect(await C.save()).toEqual({ ok: true });
    expect(savedTower(idb.data.get('autosave'))?.seed).toBe(98);
  });

  it('A1: no IndexedDB and a device record left from before: an ordinary player loads, saves and leaves, across a reload', async () => {
    const ls = fakeLocalStorage();
    ls.setItem('hundred-stories:autosave:seq-high', '42');
    ls.setItem('hs.save.present', '1');
    vi.stubGlobal('indexedDB', undefined);
    vi.stubGlobal('localStorage', ls);
    for (let reload = 0; reload < 2; reload++) {
      const g = (await gamePage()).createGame(1, handClock().opts);
      await g.load();
      g.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 + reload });
      expect(await g.save()).toEqual({ ok: true });
      g.apply({ kind: 'build', room: 'lobby', floor: 1, x: 110 + reload });
      expect(await g.leave('reload')).toEqual({ ok: true, wrote: true });
    }
    expect(savedTower(ls.getItem('hundred-stories:autosave'))?.lobbies).toEqual([100, 101, 110, 111]);
  });
});

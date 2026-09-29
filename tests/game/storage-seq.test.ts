// Sequence numbers for a slot this page never read, and which copy goes after a good IndexedDB
// write (the 2026-09-28 storage package review, F1 to F4). A reload here is a fresh module.
import { afterEach, describe, expect, it, vi } from 'vitest';

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

type Mode = 'ok' | 'openFails' | 'txThrows' | 'putFails';

/** An IndexedDB whose steps settle in a later task; while `gate` is set, puts wait on it. */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = { mode: 'ok' as Mode, data, gate: null as Promise<void> | null };
  const lost = (): DOMException =>
    new DOMException('Connection to Indexed Database server lost. Refresh the page to try again', 'UnknownError');
  const later = (f: () => void): void => void setTimeout(f, 0);
  const factory = {
    open: () => {
      const req: Record<string, unknown> = {};
      const fire = (name: string): void => (req[name] as (() => void) | undefined)?.();
      if (ctl.mode === 'openFails') {
        req.error = lost();
        later(() => fire('onerror'));
        return req;
      }
      req.result = {
        transaction: () => {
          if (ctl.mode === 'txThrows') throw lost();
          const failing = ctl.mode === 'putFails';
          const tx: Record<string, unknown> = { error: null };
          const txFire = (name: string): void => (tx[name] as (() => void) | undefined)?.();
          let pending = 0;
          tx.objectStore = () => ({
            put: (v: unknown, k: string) => {
              pending++;
              const run = (): void =>
                later(() => {
                  if (failing) {
                    if (!tx.error) {
                      tx.error = new DOMException('quota', 'QuotaExceededError');
                      txFire('onerror');
                    }
                    return;
                  }
                  data.set(k, v);
                  if (--pending === 0) txFire('oncomplete');
                });
              if (ctl.gate) void ctl.gate.then(run);
              else run();
            },
            get: (k: string) => {
              const g: Record<string, unknown> = {};
              later(() => {
                g.result = data.get(k);
                (g.onsuccess as (() => void) | undefined)?.();
              });
              return g;
            },
          });
          return tx;
        },
      };
      later(() => fire('onsuccess'));
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, ctl };
}

async function reload(): Promise<typeof import('../../src/game/storage')> {
  vi.resetModules();
  return await import('../../src/game/storage');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('F1: a slot this page never read', () => {
  for (const mode of ['openFails', 'txThrows'] as const) {
    it(`${mode}: a link boot, then Open a saved file, then IndexedDB lost: the next boot reads the opened file`, async () => {
      const ls = fakeLocalStorage();
      const { factory, ctl } = fakeIdb();
      let m = await reload();
      const mine = () => m.createStorage({ indexedDB: factory, localStorage: ls });
      for (const minute of [1000, 2000, 3000]) await mine().writeSave(`{"minute":${minute}}`);
      m = await reload(); // boots on ?seed=: My tower is never read
      ctl.mode = mode;
      await mine().writeSave('{"imported":1}');
      await mine().writeSave('{"imported":2}');
      ctl.mode = 'ok';
      m = await reload();
      expect(await mine().readSave()).toBe('{"imported":2}');
    });
  }

  it('the unknown-slot number never goes backward when the clock is set back', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    let m = await reload();
    const mine = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    await mine().writeSave('{"minute":1000}');
    m = await reload();
    ctl.mode = 'txThrows';
    await mine().writeSave('{"imported":1}'); // unknown slot: numbered from the clock
    ctl.mode = 'ok';
    m = await reload();
    expect(await mine().readSave()).toBe('{"imported":1}');
    await mine().writeSave('{"minute":5000}'); // IndexedDB, counting on from the clock number
    now.mockReturnValue(1_700_000_000_000); // the clock goes back a few years
    m = await reload();
    ctl.mode = 'txThrows';
    await mine().writeSave('{"imported":2}');
    ctl.mode = 'ok';
    m = await reload();
    expect(await mine().readSave()).toBe('{"imported":2}');
  });

  it('a slot whose number was learned keeps counting from it, and each slot keeps its own', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    let m = await reload();
    for (const n of [1, 2, 3, 4, 5]) await m.createStorage({ indexedDB: factory, localStorage: ls }, 'daily').writeSave(`d${n}`);
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('mine 1');
    m = await reload();
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('mine 2'); // learns 1 from IndexedDB
    ctl.mode = 'openFails';
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('mine 3');
    expect(ls.getItem('hundred-stories:autosave:seq')).toBe('3');
  });

  it('a private window (IndexedDB never works) keeps its tower in localStorage across reloads', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ctl.mode = 'openFails';
    let m = await reload();
    const mine = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    expect(await mine().readSave()).toBeNull();
    for (const minute of [1, 2, 3]) await mine().writeSave(`{"minute":${minute}}`);
    m = await reload();
    expect(await mine().readSave()).toBe('{"minute":3}');
    await mine().writeSave('{"minute":4}');
    m = await reload();
    expect(await mine().readSave()).toBe('{"minute":4}');
  });
});

describe('F2: a slow IndexedDB write never drops a newer fallback copy', () => {
  it('autosave A commits after save B fell back: the next boot reads B', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    let m = await reload();
    const mine = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    await mine().writeSave('{"minute":1000}');
    expect(await mine().readSave()).toBe('{"minute":1000}');
    let release!: () => void;
    ctl.gate = new Promise<void>((r) => (release = r));
    const a = mine().writeSave('{"minute":2000}'); // A: a slow commit
    await new Promise((r) => setTimeout(r, 20)); // A has its number and its puts queued
    ctl.gate = null;
    ctl.mode = 'openFails';
    await mine().writeSave('{"minute":3000}'); // B: newer, falls back to localStorage
    release();
    await a;
    expect(ls.getItem('hundred-stories:autosave')).toBe('{"minute":3000}');
    ctl.mode = 'ok';
    m = await reload();
    expect(await mine().readSave()).toBe('{"minute":3000}');
  });
});

describe('F3: a healthy boot drops an older local copy', () => {
  const stale = (ls: Storage, ctl: { data: Map<string, unknown> }): void => {
    ls.setItem('hundred-stories:autosave', '{"minute":2000}');
    ls.setItem('hundred-stories:autosave:seq', '2');
    ls.setItem('hs.save.present', '1');
    ctl.data.set('autosave', '{"minute":5000}');
    ctl.data.set('autosave:seq', 5);
  };

  it('a copy left by an earlier build is gone after the first healthy boot', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    stale(ls, ctl);
    let m = await reload();
    expect(await m.createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('{"minute":5000}');
    expect(ls.getItem('hundred-stories:autosave')).toBeNull();
    ctl.mode = 'openFails';
    m = await reload();
    // the slot is unknown, not the stale 2000
    await expect(m.createStorage({ indexedDB: factory, localStorage: ls }).readSave()).rejects.toThrow(m.SaveReadError);
  });

  it('a newer local copy stays on a healthy boot', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    stale(ls, ctl);
    ls.setItem('hundred-stories:autosave:seq', '6');
    const m = await reload();
    expect(await m.createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('{"minute":2000}');
    expect(ls.getItem('hundred-stories:autosave')).toBe('{"minute":2000}');
  });
});

describe('F4: a boot that read only the localStorage copy counts on from it', () => {
  it('even when that copy is gone by the first write and the clock reads 1970', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ls.setItem('hundred-stories:autosave', '{"minute":2000}');
    ls.setItem('hundred-stories:autosave:seq', '5');
    ctl.mode = 'openFails';
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const m = await reload();
    const mine = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    expect(await mine().readSave()).toBe('{"minute":2000}');
    ls.clear(); // another tab's good write took the copy
    await mine().writeSave('{"minute":2100}');
    expect(Number(ls.getItem('hundred-stories:autosave:seq'))).toBeGreaterThan(5);
  });
});

// The browser slot across reloads when IndexedDB stops answering (the 2026-09-28 audit, lane D
// S1 and S2). On iOS Safari and home-screen installs WebKit tears down its IndexedDB process
// while the page is in the background; every open or transaction then fails with "Connection to
// Indexed Database server lost" until a reload. A reload here is a fresh module (vi.resetModules).
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

/** An IndexedDB whose steps settle in a later task, like a browser's. */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = { mode: 'ok' as Mode, data };
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
  vi.useRealTimers();
  vi.resetModules();
});

describe('S1: IndexedDB stops answering after a good boot read', () => {
  for (const mode of ['openFails', 'txThrows'] as const) {
    it(`${mode}: the next boot reads the saves made after it stopped`, async () => {
      const ls = fakeLocalStorage();
      const { factory, ctl } = fakeIdb();
      let m = await reload();
      const slot = () => m.createStorage({ indexedDB: factory, localStorage: ls });
      for (const minute of [1000, 2000, 3000]) await slot().writeSave(`{"minute":${minute}}`);
      m = await reload();
      expect(await slot().readSave()).toBe('{"minute":3000}');
      ctl.mode = mode;
      await slot().writeSave('{"minute":4000}');
      await slot().writeSave('{"minute":9000}');
      ctl.mode = 'ok';
      m = await reload();
      expect(await slot().readSave()).toBe('{"minute":9000}');
    });
  }

  it('the slots keep their own numbers', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    let m = await reload();
    for (const minute of [1, 2, 3, 4, 5]) await m.createStorage({ indexedDB: factory, localStorage: ls }, 'daily').writeSave(`d${minute}`);
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('mine 1');
    m = await reload();
    expect(await m.createStorage({ indexedDB: factory, localStorage: ls }, 'daily').readSave()).toBe('d5');
    expect(await m.createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('mine 1');
    ctl.mode = 'openFails';
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('mine 2');
    // My tower counts on from its own 1, not from Today's 5
    expect(ls.getItem('hundred-stories:autosave:seq')).toBe('2');
  });
});

describe('S2: a fallback copy never outlives a later IndexedDB save', () => {
  it('a boot where IndexedDB will not open does not load the old fallback copy', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    let m = await reload();
    const slot = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    await slot().writeSave('{"minute":1000}');
    ctl.mode = 'putFails';
    await slot().writeSave('{"minute":2000}'); // falls back to localStorage
    ctl.mode = 'ok';
    for (const minute of [3000, 4000, 5000]) await slot().writeSave(`{"minute":${minute}}`);
    expect(ls.getItem('hundred-stories:autosave')).toBeNull();
    expect(ls.getItem('hundred-stories:autosave:seq')).toBeNull();
    expect(ls.getItem('hundred-stories:autosave:written')).toBeNull();
    m = await reload();
    ctl.mode = 'openFails';
    // the slot is unknown, not the stale 2000: the read fails, so no tower is started over it
    await expect(slot().readSave()).rejects.toThrow(m.SaveReadError);
  });

  it('a newer fallback copy still wins when IndexedDB will not open', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    let m = await reload();
    const slot = () => m.createStorage({ indexedDB: factory, localStorage: ls });
    await slot().writeSave('{"minute":1000}');
    ctl.mode = 'putFails';
    await slot().writeSave('{"minute":2000}');
    m = await reload();
    ctl.mode = 'openFails';
    expect(await slot().readSave()).toBe('{"minute":2000}');
  });

  it('a good IndexedDB write of one slot leaves the other slots alone', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const m = await reload();
    ctl.mode = 'putFails';
    await m.createStorage({ indexedDB: factory, localStorage: ls }, 'friend').writeSave('friend tower');
    ctl.mode = 'ok';
    await m.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('my tower');
    expect(ls.getItem('hundred-stories:friend')).toBe('friend tower');
  });
});

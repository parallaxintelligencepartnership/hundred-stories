// The browser and desktop save slots under the failures the 2026-09-25 audit found: a write that
// fell back to localStorage, a transaction that aborts with no error event, and two desktop
// writes of one slot at once.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage, createTauriStorage } from '../../src/game/storage';

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

/** An IndexedDB that opens; requests settle in a microtask. mode: ok, error (tx.onerror), abort (tx.onabort only). */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const ctl = { mode: 'ok' as 'ok' | 'error' | 'abort', data };
  const factory = {
    open: () => {
      const db = {
        transaction: () => {
          const tx: Record<string, unknown> = { error: null };
          let failed = false;
          const fire = (name: string): void => (tx[name] as (() => void) | undefined)?.();
          tx.objectStore = () => ({
            put: (v: unknown, k: string) => {
              const m = ctl.mode;
              queueMicrotask(() => {
                if (failed) return;
                if (m === 'ok') {
                  data.set(k, v);
                  queueMicrotask(() => fire('oncomplete'));
                } else if (m === 'error') {
                  failed = true;
                  tx.error = new Error('write failed');
                  fire('onerror');
                } else {
                  failed = true;
                  tx.error = new DOMException('quota', 'QuotaExceededError');
                  fire('onabort');
                }
              });
            },
            get: (k: string) => {
              const req: Record<string, unknown> = {};
              queueMicrotask(() => {
                req.result = data.get(k);
                (req.onsuccess as (() => void) | undefined)?.();
              });
              return req;
            },
          });
          return tx;
        },
      };
      const req: Record<string, unknown> = { result: db };
      queueMicrotask(() => (req.onsuccess as (() => void) | undefined)?.());
      return req;
    },
  } as unknown as IDBFactory;
  return { factory, ctl };
}

const race = <T,>(p: Promise<T>): Promise<T | string> =>
  Promise.race([p, new Promise<string>((res) => setTimeout(() => res('PENDING after 500 ms'), 500))]);

describe('D S3: after a fallback write the newest copy wins', () => {
  it('reads the localStorage copy written after the IndexedDB one failed', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const s = createStorage({ indexedDB: factory, localStorage: ls });
    await s.writeSave('{"minute":1000}');
    ctl.mode = 'error';
    await s.writeSave('{"minute":5000}'); // falls back to localStorage
    ctl.mode = 'ok';
    expect(await s.readSave()).toBe('{"minute":5000}');
  });

  it('reads the IndexedDB copy again once it is the newer one', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const s = createStorage({ indexedDB: factory, localStorage: ls });
    ctl.mode = 'error';
    await s.writeSave('{"minute":1000}');
    ctl.mode = 'ok';
    await s.writeSave('{"minute":5000}');
    expect(await s.readSave()).toBe('{"minute":5000}');
  });

  it('an old save with no stamps in either store still reads IndexedDB first', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ctl.data.set('autosave', 'idb tower');
    ls.setItem('hundred-stories:autosave', 'local tower');
    expect(await createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('idb tower');
  });
});

describe('checkpoint: the newest copy wins with the clock set back across a reload', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('reads the fallback copy written after a reload with the clock a day earlier', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    const T = Date.UTC(2026, 8, 25, 12);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T);
    vi.resetModules();
    const first = await import('../../src/game/storage');
    await first.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('{"minute":1000}');
    // a reload: a fresh module, and the device clock set back one day
    vi.setSystemTime(T - 86_400_000);
    vi.resetModules();
    const second = await import('../../src/game/storage');
    expect(second).not.toBe(first);
    ctl.mode = 'error';
    await second.createStorage({ indexedDB: factory, localStorage: ls }).writeSave('{"minute":5000}');
    expect(await second.createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('{"minute":5000}');
  });

  it('a numbered copy beats an old one with no number, whatever the stamps say', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ctl.data.set('autosave', 'old idb tower');
    ctl.data.set('autosave:written', Date.UTC(2030, 0, 1));
    ctl.mode = 'error';
    await createStorage({ indexedDB: factory, localStorage: ls }).writeSave('new local tower');
    expect(await createStorage({ indexedDB: factory, localStorage: ls }).readSave()).toBe('new local tower');
  });
});

describe('D S4: an aborted IndexedDB write settles', () => {
  it('falls back to localStorage on abort instead of hanging', async () => {
    const ls = fakeLocalStorage();
    const { factory, ctl } = fakeIdb();
    ctl.mode = 'abort';
    const s = createStorage({ indexedDB: factory, localStorage: ls });
    expect(await race(s.writeSave('x').then(() => 'resolved', () => 'rejected'))).toBe('resolved');
    expect(ls.data.get('hundred-stories:autosave')).toBe('x');
  });

  it('rejects with the plain refusal on abort when there is no localStorage either', async () => {
    const { factory, ctl } = fakeIdb();
    ctl.mode = 'abort';
    const s = createStorage({ indexedDB: factory });
    expect(await race(s.writeSave('x').then(() => 'resolved', (e: Error) => e.message))).toBe('This browser would not let the game save.');
  });

  it('a successful write resolves exactly once', async () => {
    const { factory } = fakeIdb();
    const s = createStorage({ indexedDB: factory, localStorage: fakeLocalStorage() });
    let settled = 0;
    await s.writeSave('y').then(() => settled++);
    expect(settled).toBe(1);
    expect(await s.readSave()).toBe('y');
  });
});

describe('D S11: two desktop saves of one slot at once', () => {
  it('both resolve ok and the last one lands', async () => {
    const files = new Map<string, string>();
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));
    const fs = {
      ensureDir: async (): Promise<void> => {},
      writeTextFile: async (p: string, d: string): Promise<void> => {
        await tick();
        files.set(p, d);
      },
      readTextFile: async (p: string): Promise<string> => {
        const v = files.get(p);
        if (v === undefined) throw new Error('ENOENT');
        return v;
      },
      rename: async (a: string, b: string): Promise<void> => {
        await tick();
        const v = files.get(a);
        if (v === undefined) throw new Error('ENOENT ' + a);
        files.delete(a);
        files.set(b, v);
      },
    };
    const s = createTauriStorage(fs);
    const results = await Promise.allSettled([s.writeSave('autosave text'), s.writeSave('save now text')]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(files.get('autosave.json')).toBe('save now text');
  });
});

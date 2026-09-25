// The browser save slot, driven with fake stores. The real IndexedDB and localStorage need a
// browser, so createStorage takes them as dependencies and these tests supply stand ins.
import { describe, expect, it } from 'vitest';
import { createStorage } from '../../src/game/storage';

const REFUSED = 'This browser would not let the game save.';

/** An in memory stand in for window.localStorage. */
function fakeLocalStorage(onSet?: (key: string, value: string) => void): Storage {
  const data = new Map<string, string>();
  return {
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
      onSet?.(key, value);
      data.set(key, value);
    },
  };
}

/** An IndexedDB whose open() always fails, the way a private window behaves. */
function brokenIndexedDb(): IDBFactory {
  return {
    open: () => {
      const req = { error: new Error('open refused'), onupgradeneeded: null, onsuccess: null, onerror: null } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => req.onerror?.(new Event('error')));
      return req;
    },
  } as unknown as IDBFactory;
}

describe('storage with localStorage only', () => {
  it('writes then reads the same text back', async () => {
    const storage = createStorage({ localStorage: fakeLocalStorage() });
    await storage.writeSave('{"version":1,"tower":"mine"}');
    expect(await storage.readSave()).toBe('{"version":1,"tower":"mine"}');
  });

  it('reads null when nothing has been saved yet', async () => {
    const storage = createStorage({ localStorage: fakeLocalStorage() });
    expect(await storage.readSave()).toBeNull();
  });

  it('keeps the newest save only', async () => {
    const storage = createStorage({ localStorage: fakeLocalStorage() });
    await storage.writeSave('first');
    await storage.writeSave('second');
    expect(await storage.readSave()).toBe('second');
  });
});

describe('storage when the browser has no save slot', () => {
  it('refuses to write in plain English', async () => {
    const storage = createStorage({});
    await expect(storage.writeSave('anything')).rejects.toThrow(REFUSED);
  });

  it('reads null rather than throwing', async () => {
    const storage = createStorage({});
    expect(await storage.readSave()).toBeNull();
  });
});

describe('storage when the store is full', () => {
  it('surfaces a quota error as the same refusal', async () => {
    const full = fakeLocalStorage(() => {
      throw new DOMException('exceeded the quota', 'QuotaExceededError');
    });
    const storage = createStorage({ localStorage: full });
    await expect(storage.writeSave('a very large tower')).rejects.toThrow(REFUSED);
  });
});

describe('storage falls back from IndexedDB to localStorage', () => {
  it('writes and reads through localStorage when IndexedDB refuses to open', async () => {
    const local = fakeLocalStorage();
    const storage = createStorage({ indexedDB: brokenIndexedDb(), localStorage: local });
    await storage.writeSave('fallback tower');
    expect(await storage.readSave()).toBe('fallback tower');
  });
});

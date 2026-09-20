// Browser save slot. IndexedDB first, localStorage as the fallback, both wrapped so a private window never throws.
//
// The stores arrive as dependencies rather than as bare globals, so the fallback chain can be
// driven from a test with fakes. The module still exports the plain writeSave and readSave the
// game calls; those run on the default instance, which reads the real stores off globalThis.

const DB = 'hundred-stories';
const STORE = 'saves';
const KEY = 'autosave';

const REFUSED_REASON = 'The browser refused to store the save.';

export interface StorageDeps {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
}

export interface SaveStorage {
  writeSave(text: string): Promise<void>;
  readSave(): Promise<string | null>;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createStorage(deps: StorageDeps = {}): SaveStorage {
  const localKey = `${DB}:${KEY}`;

  async function writeSave(text: string): Promise<void> {
    if (deps.indexedDB) {
      try {
        const db = await openDb(deps.indexedDB);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(text, KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        return;
      } catch {
        // fall through to localStorage
      }
    }
    try {
      if (!deps.localStorage) throw new Error('no localStorage');
      deps.localStorage.setItem(localKey, text);
    } catch {
      // a full quota, a private window, or no store at all: all one message to the player
      throw new Error(REFUSED_REASON);
    }
  }

  async function readSave(): Promise<string | null> {
    if (deps.indexedDB) {
      try {
        const db = await openDb(deps.indexedDB);
        const text = await new Promise<string | null>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(KEY);
          req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
          req.onerror = () => reject(req.error);
        });
        if (text) return text;
      } catch {
        // fall through to localStorage
      }
    }
    try {
      return deps.localStorage?.getItem(localKey) ?? null;
    } catch {
      return null;
    }
  }

  return { writeSave, readSave };
}

// The stores are read on every call, not captured at import time, so the module is safe to
// import where there is no browser at all (tests, a worker, server side rendering).
function globalDeps(): StorageDeps {
  const g = globalThis as { indexedDB?: IDBFactory; localStorage?: Storage };
  const deps: StorageDeps = {};
  if (g.indexedDB) deps.indexedDB = g.indexedDB;
  if (g.localStorage) deps.localStorage = g.localStorage;
  return deps;
}

export const storage: SaveStorage = {
  writeSave: (text: string) => createStorage(globalDeps()).writeSave(text),
  readSave: () => createStorage(globalDeps()).readSave(),
};

export const writeSave = (text: string): Promise<void> => storage.writeSave(text);
export const readSave = (): Promise<string | null> => storage.readSave();

const UNREADABLE_KEY = 'hs.save.unreadable';

// Stashes a save the deserializer refused, so the player isn't left with nothing after a
// corrupt or foreign-version save. Silent on failure, same as the rest of this module: a full
// quota or missing store just means no backup, not a crash.
export function stashUnreadable(text: string): void {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return;
    ls.setItem(UNREADABLE_KEY, text);
  } catch {
    // a full quota, a private window, or no store at all: silent, same as writeSave
  }
}

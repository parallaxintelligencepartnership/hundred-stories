// Save slot. In the browser: IndexedDB first, localStorage as the fallback, both wrapped so a
// private window never throws. In the iOS and Android shells: one file, autosave.json, in the
// app data directory through Capacitor Filesystem (saves run 0.7 to 3.3 MB, past what
// Preferences is comfortable with on iOS). The backend is chosen by Capacitor.isNativePlatform().
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

/** The slice of @capacitor/filesystem the file slot uses, so a test can hand in a stub. */
export interface FileSlotFs {
  writeFile(options: { path: string; data: string; directory: string; encoding: string }): Promise<unknown>;
  readFile(options: { path: string; directory: string; encoding: string }): Promise<{ data: string | Blob }>;
}

export const FILE_SLOT_NAME = 'autosave.json';
// The string values of the plugin's Directory.Data and Encoding.UTF8 enums, written out so this
// module never imports the plugin on the web path.
const DATA_DIRECTORY = 'DATA';
const UTF8 = 'utf8';
const DEVICE_REFUSED_REASON = 'The device refused to store the save.';

/**
 * The native save slot: one file in the app data directory, the same interface as the browser
 * slot. `fs` may be a promise so the plugin can be loaded lazily on first use.
 */
export function createFileStorage(fs: FileSlotFs | Promise<FileSlotFs>): SaveStorage {
  const opts = { path: FILE_SLOT_NAME, directory: DATA_DIRECTORY, encoding: UTF8 };

  async function writeSave(text: string): Promise<void> {
    try {
      await (await fs).writeFile({ ...opts, data: text });
    } catch {
      throw new Error(DEVICE_REFUSED_REASON);
    }
  }

  async function readSave(): Promise<string | null> {
    try {
      const { data } = await (await fs).readFile(opts);
      // With an encoding the plugin always returns a string; a Blob only comes back without one.
      const text = typeof data === 'string' ? data : await data.text();
      return text ? text : null;
    } catch {
      // no file yet (first launch) reads as no save, same as an empty browser slot
      return null;
    }
  }

  return { writeSave, readSave };
}

interface CapacitorGlobal {
  Capacitor?: { isNativePlatform?: () => boolean };
}

/**
 * True inside the iOS or Android shell. Asks the Capacitor global the native bridge injects
 * before the page loads (the same object @capacitor/core wraps), so the web bundle does not
 * need to import Capacitor to find out it is on the web.
 */
export function isNativePlatform(g: CapacitorGlobal = globalThis as CapacitorGlobal): boolean {
  try {
    return g.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export interface SelectDeps {
  global?: CapacitorGlobal;
  /** Loads the Filesystem plugin; only called on a native platform. */
  loadFs?: () => Promise<FileSlotFs>;
}

// A Capacitor plugin is a Proxy that answers every property with a native call, `then` included,
// so it must never be the value a promise resolves with: the promise would call Filesystem.then(),
// which never settles, and boot would hang on a blank page. Hand back plain wrappers instead.
async function loadCapacitorFs(): Promise<FileSlotFs> {
  const { Filesystem } = await import('@capacitor/filesystem');
  return {
    writeFile: (options) => Filesystem.writeFile(options as Parameters<typeof Filesystem.writeFile>[0]),
    readFile: (options) => Filesystem.readFile(options as Parameters<typeof Filesystem.readFile>[0]),
  };
}

/**
 * Picks the save backend: the Filesystem slot on a native platform, else the browser slot
 * (which reads IndexedDB and localStorage off globalThis on every call, as it always has).
 */
export function selectStorage(deps: SelectDeps = {}): SaveStorage {
  if (isNativePlatform(deps.global)) return createFileStorage((deps.loadFs ?? loadCapacitorFs)());
  return {
    writeSave: (text: string) => createStorage(globalDeps()).writeSave(text),
    readSave: () => createStorage(globalDeps()).readSave(),
  };
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

export const EXPORT_FILE_NAME = 'hundred-stories.json';
const CACHE_DIRECTORY = 'CACHE';

export interface ShareDeps {
  fs: { writeFile(options: { path: string; data: string; directory: string; encoding: string }): Promise<{ uri: string }> };
  share: { share(options: { title?: string; files?: string[] }): Promise<unknown> };
}

async function loadShareDeps(): Promise<ShareDeps> {
  const [{ Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  // Plain wrappers, never the plugin proxies themselves (see loadCapacitorFs).
  return {
    fs: { writeFile: (options) => Filesystem.writeFile(options as Parameters<typeof Filesystem.writeFile>[0]) },
    share: { share: (options) => Share.share(options) },
  };
}

/**
 * Export on a native shell: a WebView ignores `<a download>`, so the save is written to the
 * cache directory as hundred-stories.json and handed to the system share sheet. Import needs
 * nothing native: the file input opens the system picker in both shells. The web export path
 * (a download link in src/ui/panels.ts) is unchanged; the ui calls this when isNativePlatform().
 */
export async function shareSave(text: string, deps?: ShareDeps): Promise<void> {
  const { fs, share } = deps ?? (await loadShareDeps());
  const { uri } = await fs.writeFile({ path: EXPORT_FILE_NAME, data: text, directory: CACHE_DIRECTORY, encoding: UTF8 });
  await share.share({ title: 'Hundred Stories save', files: [uri] });
}

// Chosen once, on the first save or load at boot, then kept: the platform cannot change
// under a running page.
let selected: SaveStorage | null = null;
function active(): SaveStorage {
  return (selected ??= selectStorage());
}

export const storage: SaveStorage = {
  writeSave: (text: string) => active().writeSave(text),
  readSave: () => active().readSave(),
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

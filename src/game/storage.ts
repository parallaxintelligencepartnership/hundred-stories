// Save slot. In the browser: IndexedDB first, localStorage as the fallback, both wrapped so a
// private window never throws. In the iOS and Android shells: one file, autosave.json, in the
// app data directory through Capacitor Filesystem (saves run 0.7 to 3.3 MB, past what
// Preferences is comfortable with on iOS). In the desktop shell for Steam (Tauri): the same one
// file in the app data directory through the Tauri fs plugin. The backend is chosen at boot:
// Tauri first (window.__TAURI__ or the Tauri internals global), then
// Capacitor.isNativePlatform(), then the browser.
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
  global?: CapacitorGlobal & TauriGlobal;
  /** Loads the Filesystem plugin; only called on a native platform. */
  loadFs?: () => Promise<FileSlotFs>;
  /** Loads the Tauri fs plugin; only called inside the desktop shell. */
  loadTauriFs?: () => Promise<TauriSlotFs>;
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
 * Picks the save backend, in this order: the Tauri slot inside the desktop shell, the
 * Filesystem slot on a Capacitor native platform, else the browser slot (which reads IndexedDB
 * and localStorage off globalThis on every call, as it always has). Tauri is asked first so a
 * stray Capacitor global can never send a desktop save to a plugin that is not there.
 */
export function selectStorage(deps: SelectDeps = {}): SaveStorage {
  if (isTauri(deps.global)) return createTauriStorage((deps.loadTauriFs ?? loadTauriFs)());
  if (isNativePlatform(deps.global)) return createFileStorage((deps.loadFs ?? loadCapacitorFs)());
  return {
    writeSave: (text: string) => createStorage(globalDeps()).writeSave(text),
    readSave: () => createStorage(globalDeps()).readSave(),
  };
}

interface TauriGlobal {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
}

/**
 * True inside the Tauri desktop shell. `__TAURI__` exists when the config sets withGlobalTauri;
 * `__TAURI_INTERNALS__` is injected by every Tauri 2 webview. Read directly so the web bundle
 * does not import the Tauri api to find out it is on the web.
 */
export function isTauri(g: object = globalThis): boolean {
  try {
    const t = g as TauriGlobal;
    return t.__TAURI__ != null || t.__TAURI_INTERNALS__ != null;
  } catch {
    return false;
  }
}

/**
 * The slice of the Tauri fs plugin the desktop slot uses, with paths relative to the app data
 * directory, so a test can hand in a stub. Export and import pass absolute paths the dialog
 * returned; the dialog plugin adds a picked path to the fs scope.
 */
export interface TauriSlotFs {
  /** Creates the app data directory if it is missing. */
  ensureDir(): Promise<void>;
  writeTextFile(path: string, data: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
}

const TEMP_SUFFIX = '.tmp';

/**
 * The desktop save slot: autosave.json in the app data directory, the same interface as the
 * other slots. A save is written to autosave.json.tmp and renamed over the old one, so a crash
 * or a full disk mid-write (saves run to 3.3 MB) leaves the last good save in place. `fs` may be
 * a promise so the plugin can be loaded lazily on first use.
 */
export function createTauriStorage(fs: TauriSlotFs | Promise<TauriSlotFs>): SaveStorage {
  let dirReady: Promise<void> | null = null;

  async function writeSave(text: string): Promise<void> {
    try {
      const f = await fs;
      await (dirReady ??= f.ensureDir().catch((e: unknown) => {
        dirReady = null;
        throw e;
      }));
      await f.writeTextFile(FILE_SLOT_NAME + TEMP_SUFFIX, text);
      await f.rename(FILE_SLOT_NAME + TEMP_SUFFIX, FILE_SLOT_NAME);
    } catch {
      throw new Error(DEVICE_REFUSED_REASON);
    }
  }

  async function readSave(): Promise<string | null> {
    try {
      const text = await (await fs).readTextFile(FILE_SLOT_NAME);
      return text ? text : null;
    } catch {
      // no file yet (first launch) reads as no save, same as an empty browser slot
      return null;
    }
  }

  return { writeSave, readSave };
}

async function loadTauriFs(): Promise<TauriSlotFs> {
  const [{ BaseDirectory, mkdir, readTextFile, rename, writeTextFile }, { appDataDir }] = await Promise.all([
    import('@tauri-apps/plugin-fs'),
    import('@tauri-apps/api/path'),
  ]);
  const appData = { baseDir: BaseDirectory.AppData };
  return {
    // Absolute, so the directory itself is made (the fs scope allows $APPDATA and below).
    ensureDir: async () => mkdir(await appDataDir(), { recursive: true }),
    writeTextFile: (path, data) => writeTextFile(path, data, appData),
    readTextFile: (path) => readTextFile(path, appData),
    rename: (from, to) => rename(from, to, { oldPathBaseDir: BaseDirectory.AppData, newPathBaseDir: BaseDirectory.AppData }),
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

/** The slice of the Tauri dialog plugin export and import use. Null is a cancelled dialog. */
export interface TauriDialog {
  save(options: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  open(options: { title?: string; multiple?: false; directory?: false; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
}

/** Absolute paths from the dialog, so no base directory. */
export interface TauriFileDeps {
  fs: Pick<TauriSlotFs, 'writeTextFile' | 'readTextFile'>;
  dialog: TauriDialog;
}

const SAVE_FILTERS = [{ name: 'Hundred Stories save', extensions: ['json'] }];

async function loadTauriFileDeps(): Promise<TauriFileDeps> {
  const [fs, dialog] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/plugin-dialog')]);
  return {
    fs: { writeTextFile: (path, data) => fs.writeTextFile(path, data), readTextFile: (path) => fs.readTextFile(path) },
    dialog: { save: (options) => dialog.save(options), open: (options) => dialog.open(options) },
  };
}

/**
 * Export in the desktop shell: a system save dialog offering hundred-stories.json, then the save
 * is written where the player chose. False when the player cancels. The ui calls this when
 * isTauri(), in place of the web download link.
 */
export async function exportSaveWithDialog(text: string, deps?: TauriFileDeps): Promise<boolean> {
  const { fs, dialog } = deps ?? (await loadTauriFileDeps());
  const path = await dialog.save({ title: 'Export save', defaultPath: EXPORT_FILE_NAME, filters: SAVE_FILTERS });
  if (!path) return false;
  await fs.writeTextFile(path, text);
  return true;
}

/**
 * Import in the desktop shell: a system open dialog for one .json file, then its text for
 * GameApi.importSave. Null when the player cancels.
 */
export async function importSaveWithDialog(deps?: TauriFileDeps): Promise<string | null> {
  const { fs, dialog } = deps ?? (await loadTauriFileDeps());
  const path = await dialog.open({ title: 'Import save', multiple: false, directory: false, filters: SAVE_FILTERS });
  if (!path) return null;
  return fs.readTextFile(path);
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

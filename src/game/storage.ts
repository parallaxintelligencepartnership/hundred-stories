// Save slots. There are three, the same on every platform: "My tower" (slot `mine`, the one
// slot there ever was, under its old key and file name so no player loses a tower), "Today's
// tower" (`daily`) and "Friend's tower" (`friend`). Each slot holds one whole save, build log
// included, and writing one never touches another.
//
// In the browser: IndexedDB first, localStorage as the fallback, both wrapped so a
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

export type SlotName = 'mine' | 'daily' | 'friend';
export const SLOT_NAMES: readonly SlotName[] = ['mine', 'daily', 'friend'];

/** The player's names for the slots. */
export const SLOT_LABELS: Record<SlotName, string> = {
  mine: 'My tower',
  daily: "Today's tower",
  friend: "Friend's tower",
};

/** The IndexedDB key (and, after `hundred-stories:`, the localStorage key) per slot. `autosave` is the original. */
export const SLOT_KEYS: Record<SlotName, string> = { mine: 'autosave', daily: 'daily', friend: 'friend' };

/** The file per slot in the app data directory of the phone and desktop shells. */
export const SLOT_FILES: Record<SlotName, string> = { mine: 'autosave.json', daily: 'daily.json', friend: 'friend.json' };

const REFUSED_REASON = 'This browser would not let the game save.';

export interface StorageDeps {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
}

export interface SaveStorage {
  writeSave(text: string): Promise<void>;
  /** The slot's text, null when nothing is stored. Throws a SaveReadError when the store could not be read. */
  readSave(): Promise<string | null>;
}

/**
 * A slot that could not be read: the store failed, which is not the same as holding nothing.
 * The game must never start a tower over a slot that threw this (src/game/game.ts). `cause`
 * carries the store's own error for the console.
 */
export class SaveReadError extends Error {
  constructor(cause: unknown) {
    super(`The save could not be read: ${describeError(cause)}`, { cause });
    this.name = 'SaveReadError';
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

/**
 * A native read that failed only because the file is not there yet (first launch, or a slot
 * never used). The Capacitor Filesystem plugin says "... does not exist." with the code
 * OS-PLUG-FILE-0008 on both phones (and "File does not exist." on the web); the Tauri fs plugin
 * passes on the OS error: "No such file or directory (os error 2)" on macOS and Linux, "The
 * system cannot find the file specified. (os error 2)" or "... the path specified. (os error 3)"
 * on Windows. Anything else (a locked file, an I/O error, a denied permission) is a read failure.
 */
function isMissingFile(e: unknown): boolean {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'OS-PLUG-FILE-0008' || code === 'ENOENT') return true;
  return /does not exist|no such file or directory|cannot find the (file|path) specified|\(os error 2\)|\bENOENT\b/i.test(describeError(e));
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Beside each browser copy, under its key plus this: when it was written (ms since 1970). */
const STAMP_SUFFIX = ':written';
/** Beside each browser copy, under its key plus this: its save sequence number. */
const SEQ_SUFFIX = ':seq';

interface StampedText {
  text: string;
  stamp: number;
  seq: number;
}

// Two writes in the same millisecond still stamp in the order they were made.
let lastStamp = 0;
function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

// The last sequence number this page wrote, per slot key. A reload starts it at 0 again, which is
// why each write also asks both stores for the highest number already there.
const lastSeq = new Map<string, number>();

function stampOf(raw: unknown): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function createStorage(deps: StorageDeps = {}, slot: SlotName = 'mine'): SaveStorage {
  const KEY = SLOT_KEYS[slot];
  const localKey = `${DB}:${KEY}`;
  // When IndexedDB is in play each copy carries a save sequence number beside it, under its own
  // key (the save text itself is untouched, so an older build still reads it). Each write takes
  // one more than the highest number in either store or in memory, so the number never goes
  // backwards, not across a reload and not when the device clock is set back. A write that fell
  // back to localStorage is then newer than the IndexedDB copy it could not replace, and the read
  // takes it. A copy without a number (written before sequence numbers) counts as 0. The wall
  // clock stamp is still written and decides only between equal numbers; a copy with no stamp
  // counts as 0 too, so two old copies still read IndexedDB first, as they always did. Not the game minute: a new tower
  // or an opened file starts at an earlier minute and is still the newer save.
  const idbStampKey = `${KEY}${STAMP_SUFFIX}`;
  const localStampKey = `${localKey}${STAMP_SUFFIX}`;
  const idbSeqKey = `${KEY}${SEQ_SUFFIX}`;
  const localSeqKey = `${localKey}${SEQ_SUFFIX}`;

  async function readIndexedDbSeq(factory: IDBFactory): Promise<number> {
    try {
      const db = await openDb(factory);
      return await new Promise<number>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(idbSeqKey);
        req.onsuccess = () => resolve(stampOf(req.result));
        req.onerror = () => reject(req.error);
      });
    } catch {
      return 0;
    }
  }

  function readLocalSeq(): number {
    try {
      return stampOf(deps.localStorage?.getItem(localSeqKey));
    } catch {
      return 0;
    }
  }

  async function nextSeq(): Promise<number> {
    const found = deps.indexedDB ? Math.max(await readIndexedDbSeq(deps.indexedDB), readLocalSeq()) : 0;
    // No await between reading lastSeq and setting it, so two writes at once still get two numbers.
    const seq = Math.max(found, lastSeq.get(KEY) ?? 0) + 1;
    lastSeq.set(KEY, seq);
    return seq;
  }

  async function writeSave(text: string): Promise<void> {
    const stamp = nextStamp();
    const seq = await nextSeq();
    if (deps.indexedDB) {
      try {
        const db = await openDb(deps.indexedDB);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          store.put(text, KEY);
          store.put(stamp, idbStampKey);
          store.put(seq, idbSeqKey);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('write failed'));
          // A quota failure at commit can abort with no error event. Without this the write
          // never settles, and every later save and slot switch waits on it for the session.
          tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
        });
        return;
      } catch {
        // fall through to localStorage
      }
    }
    try {
      if (!deps.localStorage) throw new Error('no localStorage');
      deps.localStorage.setItem(localKey, text);
      if (deps.indexedDB) {
        deps.localStorage.setItem(localStampKey, String(stamp));
        deps.localStorage.setItem(localSeqKey, String(seq));
      }
    } catch {
      // a full quota, a private window, or no store at all: all one message to the player
      throw new Error(REFUSED_REASON);
    }
  }

  async function readIndexedDb(factory: IDBFactory): Promise<StampedText | null> {
    try {
      const db = await openDb(factory);
      return await new Promise<StampedText | null>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const req = store.get(KEY);
        const stampReq = store.get(idbStampKey);
        const seqReq = store.get(idbSeqKey);
        let text: string | null = null;
        let stamp = 0;
        // Requests in one transaction succeed in the order they were made.
        req.onsuccess = () => {
          text = (req.result as string | undefined) ?? null;
        };
        req.onerror = () => reject(req.error);
        stampReq.onsuccess = () => {
          stamp = stampOf(stampReq.result);
        };
        stampReq.onerror = () => reject(stampReq.error);
        seqReq.onsuccess = () => resolve(text ? { text, stamp, seq: stampOf(seqReq.result) } : null);
        seqReq.onerror = () => reject(seqReq.error);
      });
    } catch (e) {
      throw new SaveReadError(e);
    }
  }

  function readLocal(): StampedText | null {
    try {
      const text = deps.localStorage?.getItem(localKey) ?? null;
      if (!text) return null;
      return {
        text,
        stamp: stampOf(deps.localStorage?.getItem(localStampKey)),
        seq: stampOf(deps.localStorage?.getItem(localSeqKey)),
      };
    } catch {
      return null;
    }
  }

  async function readSave(): Promise<string | null> {
    let fromDb: StampedText | null = null;
    if (deps.indexedDB) {
      try {
        fromDb = await readIndexedDb(deps.indexedDB);
      } catch (e) {
        // IndexedDB would not open or read. A localStorage copy, when there is one, is read as
        // before (a browser whose IndexedDB never works keeps its tower there). With none, the
        // slot is unknown, not empty: a read failure, so no fresh tower is saved over it.
        const local = readLocal();
        if (local) return local.text;
        throw e;
      }
    }
    const fromLocal = readLocal();
    if (fromDb && fromLocal) {
      // A copy with no number was written by a build before sequence numbers, so any numbered
      // copy is newer. The stamp decides only between equal numbers (two copies without one).
      if (fromLocal.seq !== fromDb.seq) return fromLocal.seq > fromDb.seq ? fromLocal.text : fromDb.text;
      return fromLocal.stamp > fromDb.stamp ? fromLocal.text : fromDb.text;
    }
    return fromDb?.text ?? fromLocal?.text ?? null;
  }

  return { writeSave, readSave };
}

/** The slice of @capacitor/filesystem the file slot uses, so a test can hand in a stub. */
export interface FileSlotFs {
  writeFile(options: { path: string; data: string; directory: string; encoding: string }): Promise<unknown>;
  readFile(options: { path: string; directory: string; encoding: string }): Promise<{ data: string | Blob }>;
}

export const FILE_SLOT_NAME = SLOT_FILES.mine;
// The string values of the plugin's Directory.Data and Encoding.UTF8 enums, written out so this
// module never imports the plugin on the web path.
const DATA_DIRECTORY = 'DATA';
const UTF8 = 'utf8';
const DEVICE_REFUSED_REASON = 'This device would not let the game save.';

/**
 * The native save slot: one file in the app data directory, the same interface as the browser
 * slot. `fs` may be a promise so the plugin can be loaded lazily on first use.
 */
export function createFileStorage(fs: FileSlotFs | Promise<FileSlotFs>, slot: SlotName = 'mine'): SaveStorage {
  const opts = { path: SLOT_FILES[slot], directory: DATA_DIRECTORY, encoding: UTF8 };

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
    } catch (e) {
      // No file yet (first launch) reads as no save, same as an empty browser slot. Any other
      // failure is not "no save": the file may hold a tower this read could not get at.
      if (isMissingFile(e)) return null;
      throw new SaveReadError(e);
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
export function selectStorage(deps: SelectDeps = {}, slot: SlotName = 'mine'): SaveStorage {
  const platform = savePlatform(deps.global);
  if (platform === 'tauri') return createTauriStorage((deps.loadTauriFs ?? loadTauriFs)(), slot);
  if (platform === 'capacitor') return createFileStorage((deps.loadFs ?? loadCapacitorFs)(), slot);
  return {
    writeSave: (text: string) => createStorage(globalDeps(), slot).writeSave(text),
    readSave: () => createStorage(globalDeps(), slot).readSave(),
  };
}

export type SavePlatform = 'tauri' | 'capacitor' | 'web';

/**
 * Which shell the save lives in, in the order selectStorage asks: Tauri first (so a stray
 * Capacitor global never wins on the desktop), then a Capacitor native platform, else the web.
 * The settings panel asks this to pick its export and import path; it never detects itself.
 */
export function savePlatform(g: object = globalThis): SavePlatform {
  if (isTauri(g)) return 'tauri';
  if (isNativePlatform(g as CapacitorGlobal)) return 'capacitor';
  return 'web';
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
export function createTauriStorage(fs: TauriSlotFs | Promise<TauriSlotFs>, slot: SlotName = 'mine'): SaveStorage {
  const FILE_SLOT_NAME = SLOT_FILES[slot];
  let dirReady: Promise<void> | null = null;
  // Writes of this slot run one after another: two at once (an autosave and Save now) would
  // share the one .tmp file, and the second rename would find it gone.
  let queue: Promise<void> = Promise.resolve();

  function writeSave(text: string): Promise<void> {
    const run = queue.then(() => writeNow(text));
    queue = run.catch(() => {});
    return run;
  }

  async function writeNow(text: string): Promise<void> {
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
    } catch (e) {
      // No file yet (first launch) reads as no save, same as an empty browser slot. A locked
      // file or any other failure is a read failure, never "no save".
      if (isMissingFile(e)) return null;
      throw new SaveReadError(e);
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
  const path = await dialog.save({ title: 'Save to a file', defaultPath: EXPORT_FILE_NAME, filters: SAVE_FILTERS });
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
  const path = await dialog.open({ title: 'Open a saved file', multiple: false, directory: false, filters: SAVE_FILTERS });
  if (!path) return null;
  return fs.readTextFile(path);
}

// Images (the tower chronicle) leave by the same doors as a save: the desktop save dialog, the
// phone share sheet, or, on the web, a download link the ui makes. Nothing is uploaded.

export const IMAGE_FILE_NAME = 'hundred-stories-chronicle.png';
const IMAGE_FILTERS = [{ name: 'PNG image', extensions: ['png'] }];

/** The slice of the Tauri plugins an image export uses. */
export interface TauriImageDeps {
  fs: { writeFile(path: string, data: Uint8Array): Promise<void> };
  dialog: Pick<TauriDialog, 'save'>;
}

async function loadTauriImageDeps(): Promise<TauriImageDeps> {
  const [fs, dialog] = await Promise.all([import('@tauri-apps/plugin-fs'), import('@tauri-apps/plugin-dialog')]);
  return {
    fs: { writeFile: (path, data) => fs.writeFile(path, data) },
    dialog: { save: (options) => dialog.save(options) },
  };
}

/** Image export in the desktop shell: a save dialog offering a .png, then the bytes. False when cancelled. */
export async function exportImageWithDialog(bytes: Uint8Array, deps?: TauriImageDeps): Promise<boolean> {
  const { fs, dialog } = deps ?? (await loadTauriImageDeps());
  const path = await dialog.save({ title: 'Save image', defaultPath: IMAGE_FILE_NAME, filters: IMAGE_FILTERS });
  if (!path) return false;
  await fs.writeFile(path, bytes);
  return true;
}

/** The slice of the Capacitor plugins an image export uses: base64 data with no encoding is binary. */
export interface ImageShareDeps {
  fs: { writeFile(options: { path: string; data: string; directory: string }): Promise<{ uri: string }> };
  share: ShareDeps['share'];
}

async function loadImageShareDeps(): Promise<ImageShareDeps> {
  const [{ Filesystem }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  return {
    fs: { writeFile: (options) => Filesystem.writeFile(options as Parameters<typeof Filesystem.writeFile>[0]) },
    share: { share: (options) => Share.share(options) },
  };
}

/** Image export on a phone: written to the cache directory and handed to the share sheet. */
export async function shareImage(base64: string, deps?: ImageShareDeps): Promise<void> {
  const { fs, share } = deps ?? (await loadImageShareDeps());
  const { uri } = await fs.writeFile({ path: IMAGE_FILE_NAME, data: base64, directory: CACHE_DIRECTORY });
  await share.share({ title: 'Hundred Stories chronicle', files: [uri] });
}

// Chosen once per slot, on the first save or load, then kept: the platform cannot change under
// a running page.
const selected = new Map<SlotName, SaveStorage>();
function active(slot: SlotName): SaveStorage {
  let found = selected.get(slot);
  if (!found) {
    found = selectStorage({}, slot);
    selected.set(slot, found);
  }
  return found;
}

/** My tower, the original slot. */
export const storage: SaveStorage = {
  writeSave: (text: string) => active('mine').writeSave(text),
  readSave: () => active('mine').readSave(),
};

export const writeSave = (text: string): Promise<void> => storage.writeSave(text);
export const readSave = (): Promise<string | null> => storage.readSave();

/** Any slot by name. The game writes My tower through writeSave and the other two through this. */
export const writeSlot = (slot: SlotName, text: string): Promise<void> => active(slot).writeSave(text);
export const readSlot = (slot: SlotName): Promise<string | null> => active(slot).readSave();

const UNREADABLE_KEY = 'hs.save.unreadable';
const DAILY_KEPT_KEY = 'hs.save.daily-kept';

function keep(key: string, text: string): boolean {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return false;
    ls.setItem(key, text);
    return ls.getItem(key) === text;
  } catch {
    // a full quota, a private window, or no store at all: no copy, and the caller says so
    return false;
  }
}

function kept(key: string): string | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * Keeps a copy of a My tower save the deserializer refused, so the player isn't left with
 * nothing after a corrupt or foreign-version save. True only when the copy is really there: the
 * game tells the player it kept a copy only then.
 */
export function stashUnreadable(text: string): boolean {
  return keep(UNREADABLE_KEY, text);
}

/** The copy stashUnreadable kept, for Save to a file; null when there is none. */
export function readUnreadable(): string | null {
  return kept(UNREADABLE_KEY);
}

/**
 * Keeps a copy of a daily dated after today (the device's date moved back) before today's
 * tower takes the daily slot. True only when the copy is there.
 */
export function keepDailyCopy(text: string): boolean {
  return keep(DAILY_KEPT_KEY, text);
}

/** The daily keepDailyCopy kept, or null. */
export function readDailyCopy(): string | null {
  return kept(DAILY_KEPT_KEY);
}

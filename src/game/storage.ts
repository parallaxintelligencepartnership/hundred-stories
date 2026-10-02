// Save slots. There are three, the same on every platform: "My tower" (slot `mine`, the one
// slot there ever was, under its old key and file name so no player loses a tower), "Today's
// tower" (`daily`) and "Friend's tower" (`friend`). Each slot holds one whole save, build log
// included, and writing one never touches another.
//
// In the browser: IndexedDB first, localStorage as the fallback, both wrapped so a
// private window never throws. In the iOS and Android shells: one file, autosave.json, in the
// app data directory through Capacitor Filesystem (saves run 0.7 to 3.3 MB, past what
// Preferences is comfortable with on iOS), written through a .tmp file with the save before it kept
// as .bak (createFileStorage). In the desktop shell for Steam (Tauri): the same one
// file in the app data directory through the Tauri fs plugin. The backend is chosen at boot:
// Tauri first (window.__TAURI__ or the Tauri internals global), then
// Capacitor.isNativePlatform(), then the browser.
//
// Only the browser slot guards against another window: two tabs, or the installed app beside a
// browser tab, share its stores, and a page holding an older copy must not save over a newer one
// (SaveConflictError). The phone and desktop shells are one process each; their slots take the
// same write options and ignore them.
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

/** How long the browser slot waits for IndexedDB to open before it gives up on that call. */
export const OPEN_DEADLINE_MS = 5000;

export interface StorageDeps {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
  /** The open deadline in ms (OPEN_DEADLINE_MS when not given), so a test need not wait 5 s. */
  openDeadlineMs?: number;
}

export interface WriteOptions {
  /**
   * An intentional replacement: New tower, Save anyway over a held save. The write skips the
   * check for a newer save from another window and replaces whatever the slot holds.
   */
  force?: boolean;
}

/**
 * Handed to readSave by a caller that decides later whether the tower it read is put in hand (the
 * game: a read whose save does not open, or a peek, leaves the tower in hand as it was). readSave
 * fills in `adopt`; calling it makes this read the slot's base for the stale-window check. A read
 * with no receipt is adopted at once. Only the browser slot fills it in.
 */
export interface ReadReceipt {
  adopt?: () => void;
}

export interface SaveStorage {
  /** Rejects with a SaveConflictError when another window saved the slot after this page read it. */
  writeSave(text: string, options?: WriteOptions): Promise<void>;
  /** The slot's text, null when nothing is stored. Throws a SaveReadError when the store could not be read. */
  readSave(receipt?: ReadReceipt): Promise<string | null>;
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

/**
 * A write refused because another window (another tab, or the installed app beside a browser
 * tab) saved this slot after this page read it: writing would throw that window's tower away.
 * Never retried and never settled by taking the higher number; the game says so to the player
 * (src/game/game.ts knows it by its name).
 */
export class SaveConflictError extends Error {
  readonly conflict = true;
  constructor() {
    super('Another window saved this tower after you opened it.');
    this.name = 'SaveConflictError';
  }
}

/** IndexedDB did not open within the deadline: a read fails, a write is refused. */
class OpenDeadlineError extends Error {
  constructor(ms: number) {
    super(`IndexedDB did not open within ${ms} ms`);
    this.name = 'OpenDeadlineError';
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

// One IndexedDB connection per page (per factory), opened on first use and kept. It closes itself
// when another page asks for a newer database version (onversionchange), and the cache lets go of
// it then and when the browser closes it (onclose), so the next call opens a fresh one. An open
// that fails or misses the deadline is not kept either: the next call tries again.
const connections = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

function forgetConnection(factory: IDBFactory, which: Promise<IDBDatabase>): void {
  if (connections.get(factory) === which) connections.delete(factory);
}

function closeQuietly(db: IDBDatabase): void {
  try {
    db.close();
  } catch {
    // already closed, or a connection the browser lost
  }
}

function openDb(factory: IDBFactory, deadlineMs: number): Promise<IDBDatabase> {
  const cached = connections.get(factory);
  if (cached) return cached;
  const opening: Promise<IDBDatabase> = new Promise((resolve, reject) => {
    let late = false;
    // A WebKit open can hang with no event at all; past the deadline this call fails instead of
    // waiting for ever, and an open that succeeds after that is closed at once.
    const timer = setTimeout(() => {
      late = true;
      reject(new OpenDeadlineError(deadlineMs));
    }, deadlineMs);
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB, 1);
    } catch (e) {
      clearTimeout(timer);
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (late) {
        closeQuietly(db);
        return;
      }
      db.onversionchange = () => {
        forgetConnection(factory, opening);
        closeQuietly(db);
      };
      db.onclose = () => forgetConnection(factory, opening);
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error);
    };
  });
  connections.set(factory, opening);
  opening.catch(() => forgetConnection(factory, opening));
  return opening;
}

/**
 * A transaction on the page's connection. A kept connection the browser has since lost throws
 * here (WebKit's "Connection to Indexed Database server lost"): it is let go and one fresh
 * connection is tried before the call fails, as every call opened its own connection before.
 */
async function beginTransaction(factory: IDBFactory, mode: IDBTransactionMode, deadlineMs: number): Promise<IDBTransaction> {
  const reused = connections.has(factory);
  let pending = openDb(factory, deadlineMs);
  let db = await pending;
  try {
    return db.transaction(STORE, mode);
  } catch (e) {
    forgetConnection(factory, pending);
    closeQuietly(db);
    if (!reused) throw e;
  }
  pending = openDb(factory, deadlineMs);
  db = await pending;
  try {
    return db.transaction(STORE, mode);
  } catch (e) {
    forgetConnection(factory, pending);
    closeQuietly(db);
    throw e;
  }
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

/**
 * Set in localStorage beside the browser slots on every successful write of My tower, to either
 * store, and never cleared (New game writes its new tower, so it stays). It tells a returning
 * player from a first visit when IndexedDB will not open and there is no localStorage copy: with
 * it, the slot is unknown and the read fails; without it, nothing was ever saved here.
 */
export const SAVE_PRESENT_KEY = 'hs.save.present';

// Two writes in the same millisecond still stamp in the order they were made.
let lastStamp = 0;
function nextStamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

// The highest sequence number this page wrote or read, per slot key. A reload starts it at 0
// again, which is why each write also asks both stores for the highest number already there, and
// why the boot read records the numbers it saw: when IndexedDB stops answering later in the
// session (WebKit's "Connection to Indexed Database server lost"), the write cannot ask it, and
// the fallback copy must still count on from the IndexedDB copy it could not replace.
const lastSeq = new Map<string, number>();

// The slot keys whose IndexedDB number this page has read (at the boot read or before a write).
// A slot not in here may hold any number in IndexedDB: a boot on a Today's or friend link never
// reads My tower, and Open a saved file then writes it. When IndexedDB also will not answer, the
// write cannot learn that number, so it takes one no earlier copy can beat (see nextSeq).
const learnedSeq = new Set<string>();

// The stale-window guard (compare and swap). Per slot key: the number of the copy this page last
// read and put in hand (set by readSave from the copy it returned, when that read is adopted, and
// advanced after each good write), and every number this page wrote: a number counts as written
// only once its write landed (the transaction completed, or the localStorage copy was set), never
// when it was claimed, so a save that failed leaves nothing another window could reuse. A write finds the slot's number in the store; one newer than this
// page's base that this page did not write came from another window, and the write is refused
// with a SaveConflictError. A slot this page never read (no base) is written without the check:
// this page holds no tower from it that could be stale (an opened file into My tower after a
// link boot, or a slot whose read failed, which the game itself never writes but New tower).
// A copy with no number (from before sequence numbers) counts as 0, so old data never conflicts.
const baseSeq = new Map<string, number>();
const ownSeqs = new Map<string, Set<number>>();

function ownSet(key: string): Set<number> {
  let set = ownSeqs.get(key);
  if (!set) {
    set = new Set<number>();
    ownSeqs.set(key, set);
  }
  return set;
}

/** True when the store's number shows another window saved the slot after this page read it. */
function overtaken(key: string, stored: number): boolean {
  const base = baseSeq.get(key);
  if (base === undefined) return false;
  return stored > base && !ownSet(key).has(stored);
}

/** A good write: the page's base moves up to the number it just wrote. */
function wroteSeq(key: string, seq: number): void {
  baseSeq.set(key, Math.max(seq, baseSeq.get(key) ?? 0));
}

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

  // The highest number this device gave the slot, in either store. Unlike the copy's own :seq it
  // stays after a good IndexedDB write, so a write that cannot ask IndexedDB still counts on from
  // what IndexedDB holds, and a clock-based number never goes back when the clock does.
  const localHighKey = `${localKey}${SEQ_SUFFIX}-high`;

  const deadlineMs = deps.openDeadlineMs ?? OPEN_DEADLINE_MS;

  /** The number of the localStorage copy itself (0 with no copy or no number). */
  function readCopySeq(): number {
    try {
      return stampOf(deps.localStorage?.getItem(localSeqKey));
    } catch {
      return 0;
    }
  }

  function readLocalSeq(): number {
    try {
      return Math.max(readCopySeq(), stampOf(deps.localStorage?.getItem(localHighKey)));
    } catch {
      return 0;
    }
  }

  function recordHigh(seq: number): void {
    try {
      if (seq > stampOf(deps.localStorage?.getItem(localHighKey))) deps.localStorage?.setItem(localHighKey, String(seq));
    } catch {
      // no record: the next unknown-slot write still starts from the clock
    }
  }

  /**
   * The next number, one more than the highest in either store or in memory. `fromDb` is the
   * IndexedDB number when this write could read it, else null. Synchronous from reading lastSeq to
   * setting it, so two writes at once still get two numbers. The number counts as this page's only
   * once its write lands (landed()).
   */
  function nextSeq(fromDb: number | null): number {
    let found = readLocalSeq();
    if (fromDb !== null) {
      learnedSeq.add(KEY);
      found = Math.max(found, fromDb);
    } else if (deps.indexedDB && !learnedSeq.has(KEY)) {
      // IndexedDB holds a number this page never saw. A save from a build before the device
      // record counts in ones from 1, so the clock in ms is above it; the device record keeps
      // the number from going back when the clock is set back.
      found = Math.max(found, Date.now());
    }
    const seq = Math.max(found, lastSeq.get(KEY) ?? 0) + 1;
    lastSeq.set(KEY, seq);
    return seq;
  }

  /** A write of this number landed: from now on a store holding it holds this page's save. */
  function landed(seq: number): void {
    ownSet(KEY).add(seq);
  }

  /** The device record alone (0 with none). */
  function readHigh(): number {
    try {
      return stampOf(deps.localStorage?.getItem(localHighKey));
    } catch {
      return 0;
    }
  }

  /** Records a number a read saw, so later writes on this page count on from it. */
  function sawSeq(seq: number): void {
    lastSeq.set(KEY, Math.max(seq, lastSeq.get(KEY) ?? 0));
  }

  /**
   * After a good IndexedDB write the localStorage copy is older by construction, so it goes.
   * Any copy left there is then newer than IndexedDB, and a boot where IndexedDB will not open
   * never serves a stale one.
   */
  function dropLocalCopy(): void {
    try {
      deps.localStorage?.removeItem(localKey);
      deps.localStorage?.removeItem(localStampKey);
      deps.localStorage?.removeItem(localSeqKey);
    } catch {
      // a store that throws on remove holds no copy it let us write either
    }
  }

  function markPresent(): void {
    if (slot !== 'mine') return;
    try {
      deps.localStorage?.setItem(SAVE_PRESENT_KEY, '1');
    } catch {
      // no marker: a later failed IndexedDB open then reads as a first visit, as before
    }
  }

  function markedPresent(): boolean {
    try {
      return deps.localStorage?.getItem(SAVE_PRESENT_KEY) === '1';
    } catch {
      return false;
    }
  }

  /**
   * Writes text, stamp and number in one readwrite transaction that first reads the slot's number
   * there. IndexedDB runs readwrite transactions on one store one after another, across tabs too,
   * so the check and the write cannot be split by another window's write. Resolves with the number
   * written. `seen` gets the stored number as soon as it is read, for a fallback after a failed put.
   */
  async function writeIndexedDb(factory: IDBFactory, text: string, stamp: number, force: boolean, seen: { seq: number | null }): Promise<number> {
    const tx = await beginTransaction(factory, 'readwrite', deadlineMs);
    return await new Promise<number>((resolve, reject) => {
      const store = tx.objectStore(STORE);
      let seq = 0;
      let conflict = false;
      const req = store.get(idbSeqKey);
      req.onsuccess = () => {
        const stored = stampOf(req.result);
        seen.seq = stored;
        // A fallback copy newer than IndexedDB (another window could not reach IndexedDB) is the
        // slot's newest save too, and this write would hide it.
        if (!force && (overtaken(KEY, stored) || overtaken(KEY, readCopySeq()))) {
          conflict = true;
          reject(new SaveConflictError());
          try {
            tx.abort();
          } catch {
            // already finished: nothing was put
          }
          return;
        }
        seq = nextSeq(stored);
        store.put(text, KEY);
        store.put(stamp, idbStampKey);
        store.put(seq, idbSeqKey);
      };
      req.onerror = () => reject(req.error ?? new Error('read failed'));
      tx.oncomplete = () => {
        landed(seq);
        resolve(seq);
      };
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      // A quota failure at commit can abort with no error event. Without this the write
      // never settles, and every later save and slot switch waits on it for the session.
      tx.onabort = () => reject(conflict ? new SaveConflictError() : (tx.error ?? new Error('write aborted')));
    });
  }

  async function writeSave(text: string, options: WriteOptions = {}): Promise<void> {
    const force = options.force === true;
    const stamp = nextStamp();
    const seen: { seq: number | null } = { seq: null };
    if (deps.indexedDB) {
      try {
        const seq = await writeIndexedDb(deps.indexedDB, text, stamp, force, seen);
        wroteSeq(KEY, seq);
        markPresent();
        recordHigh(seq);
        // A save that fell back while this one was committing holds a higher number: it stays.
        if (readCopySeq() <= seq) dropLocalCopy();
        return;
      } catch (e) {
        if (e instanceof SaveConflictError) throw e;
        // A stalled open is a failed save, not a reason to put a whole tower in localStorage
        // behind the player's back: the game's save-failure path runs.
        if (e instanceof OpenDeadlineError) throw new Error(REFUSED_REASON, { cause: e });
        // fall through to localStorage
      }
    }
    // The same check before the fallback copy, against the copy's number and the device record
    // (which every good write of this slot raises, in either store, from any window). Unlike the
    // IndexedDB check this is not atomic across tabs: two windows writing in the same moment can
    // both pass. It closes the ordinary case, and catches another window's IndexedDB writes when
    // this window cannot reach IndexedDB.
    if (!force && overtaken(KEY, readLocalSeq())) throw new SaveConflictError();
    const seq = nextSeq(seen.seq);
    try {
      if (!deps.localStorage) throw new Error('no localStorage');
      deps.localStorage.setItem(localKey, text);
      // Numbered with IndexedDB or without: a browser with no IndexedDB at all takes part in the
      // check through these keys too.
      deps.localStorage.setItem(localStampKey, String(stamp));
      deps.localStorage.setItem(localSeqKey, String(seq));
      landed(seq);
      recordHigh(seq);
      markPresent();
    } catch {
      // a full quota, a private window, or no store at all: all one message to the player
      throw new Error(REFUSED_REASON);
    }
    wroteSeq(KEY, seq);
  }

  async function readIndexedDb(factory: IDBFactory): Promise<StampedText | null> {
    try {
      const tx = await beginTransaction(factory, 'readonly', deadlineMs);
      return await new Promise<StampedText | null>((resolve, reject) => {
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

  async function readSave(receipt?: ReadReceipt): Promise<string | null> {
    if (receipt) delete receipt.adopt;
    // The device record before either store is read. A number it already holds is no save made
    // after this read: when the read saw every store and took a lower copy, the record is left from
    // a store since cleared (IndexedDB gone or wiped, localStorage kept), never another window's
    // newer save, and it must not lock this page's saves. A write landing after this moment raises
    // the record above the base and is still caught.
    const highBefore = readHigh();
    let fromDb: StampedText | null = null;
    if (deps.indexedDB) {
      try {
        fromDb = await readIndexedDb(deps.indexedDB);
      } catch (e) {
        // IndexedDB would not open or read. A localStorage copy, when there is one, is read as
        // before (a browser whose IndexedDB never works keeps its tower there). With none, a
        // first visit (no marker) has nothing to lose: no save, and the writes fall back to
        // localStorage. A returning player's slot is unknown, not empty: a read failure, so no
        // fresh tower is saved over it. Only My tower's writes set the marker; a link to Today's
        // or a friend's tower on a first visit reads the same way, so no notice shows there either.
        // An open that stalled past the deadline is never "nothing saved", marker or not: the
        // slot is unknown, so the game's unread protection holds it.
        const local = readLocal();
        if (local) {
          sawSeq(local.seq);
          // IndexedDB was not read, so the record may be its newer save: not counted.
          return took(local, 0, receipt);
        }
        const stalled = e instanceof SaveReadError && e.cause instanceof OpenDeadlineError;
        // Read as empty only on a first visit, and with no base: the guard then checks nothing,
        // so a slot this read never saw is written as it always was.
        if (!stalled && !markedPresent()) return null;
        throw e;
      }
    }
    if (deps.indexedDB) learnedSeq.add(KEY);
    const fromLocal = readLocal();
    sawSeq(Math.max(fromDb?.seq ?? 0, fromLocal?.seq ?? 0));
    if (fromDb && fromLocal && fromLocal.seq < fromDb.seq) {
      // Older than IndexedDB (left by a build before copies were dropped): it would only load on
      // a later boot where IndexedDB will not open, as a stale tower.
      dropLocalCopy();
      return took(fromDb, highBefore, receipt);
    }
    if (fromDb && fromLocal) {
      // A copy with no number was written by a build before sequence numbers, so any numbered
      // copy is newer. The stamp decides only between equal numbers (two copies without one).
      if (fromLocal.seq !== fromDb.seq) return took(fromLocal.seq > fromDb.seq ? fromLocal : fromDb, highBefore, receipt);
      return took(fromLocal.stamp > fromDb.stamp ? fromLocal : fromDb, highBefore, receipt);
    }
    return took(fromDb ?? fromLocal, highBefore, receipt);
  }

  /**
   * The copy readSave returns, or none. Its number (or the device record read before it, when
   * that is higher: see readSave) is this page's base for the guard once the read is adopted: at
   * once with no receipt, else when the caller calls receipt.adopt.
   */
  function took(copy: StampedText | null, highBefore: number, receipt: ReadReceipt | undefined): string | null {
    const base = Math.max(copy?.seq ?? 0, highBefore);
    const adopt = (): void => {
      baseSeq.set(KEY, base);
    };
    if (receipt) receipt.adopt = adopt;
    else adopt();
    return copy?.text ?? null;
  }

  return { writeSave, readSave };
}

/**
 * The slice of @capacitor/filesystem the file slot uses, so a test can hand in a stub. Every call
 * rejects with the plugin's `{ code, message }` error; a missing file is code OS-PLUG-FILE-0008
 * ("'<method>' failed because file at '<path>' does not exist.") on iOS and Android alike: readFile,
 * stat, deleteFile and rename (for a missing source) all say it that way (FilesystemError.swift,
 * FilesystemErrors.kt in node_modules/@capacitor/filesystem). Any other code is a real failure.
 */
export interface FileSlotFs {
  writeFile(options: { path: string; data: string; directory: string; encoding: string }): Promise<unknown>;
  readFile(options: { path: string; directory: string; encoding: string }): Promise<{ data: string | Blob }>;
  /** Resolves when the file exists; rejects with the missing code when it does not. */
  stat(options: { path: string; directory: string }): Promise<unknown>;
  /** Moves `from` to `to` in the same directory. Never called with an existing `to` (see createFileStorage). */
  rename(options: { from: string; to: string; directory: string; toDirectory: string }): Promise<unknown>;
  deleteFile(options: { path: string; directory: string }): Promise<unknown>;
}

export const FILE_SLOT_NAME = SLOT_FILES.mine;
// The string values of the plugin's Directory.Data and Encoding.UTF8 enums, written out so this
// module never imports the plugin on the web path.
const DATA_DIRECTORY = 'DATA';
const UTF8 = 'utf8';
const DEVICE_REFUSED_REASON = 'This device would not let the game save.';

const BACKUP_SUFFIX = '.bak';

/** Runs a file step where a missing file is fine (nothing to delete or move); anything else throws. */
async function unlessMissing(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (e) {
    if (!isMissingFile(e)) throw e;
  }
}

/** A file that is there, not empty and parses as JSON: a whole save. */
function isWhole(text: string): boolean {
  if (!text) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The native save slot: one file per slot in the app data directory (X = autosave.json,
 * daily.json or friend.json), the same interface as the browser slot. `fs` may be a promise so the
 * plugin can be loaded lazily on first use. The phone shells are one process each (one WebView,
 * one JS context), so the browser slot's guard against another window is not needed here and the
 * write options are ignored.
 *
 * The plugin's writeFile is not atomic on iOS (a killed app or a full disk leaves a cut-off file)
 * and its rename deletes an existing destination before moving, so a save never writes or renames
 * onto the live file:
 *   1. If X is missing but X.tmp is there (a save killed between its two renames), X.tmp is moved
 *      to X first, so the newest copy is not overwritten by this save's step 2.
 *   2. Write the new text to X.tmp.
 *   3. Delete X.bak if there is one, 4. rename X to X.bak if X exists, 5. rename X.tmp to X.
 * A failure at any step rejects the save. Until step 2 has finished, X (or X.bak) is untouched; from
 * then on X.tmp is a whole copy until it becomes X, so there is always a whole copy on disk. A
 * successful save leaves exactly X and X.bak (the save before it): leftovers are taken up here,
 * never by a read. An install that only has X (from before this) saves the same way.
 */
export function createFileStorage(fs: FileSlotFs | Promise<FileSlotFs>, slot: SlotName = 'mine'): SaveStorage {
  const file = SLOT_FILES[slot];
  const temp = file + TEMP_SUFFIX;
  const backup = file + BACKUP_SUFFIX;
  const at = (path: string) => ({ path, directory: DATA_DIRECTORY });
  const move = (from: string, to: string) => ({ from, to, directory: DATA_DIRECTORY, toDirectory: DATA_DIRECTORY });
  // Writes of this slot run one after another, in call order: two at once (an autosave and Save
  // now) would share the one .tmp file.
  let queue: Promise<void> = Promise.resolve();

  function writeSave(text: string): Promise<void> {
    const run = queue.then(() => writeNow(text));
    queue = run.catch(() => {});
    return run;
  }

  async function writeNow(text: string): Promise<void> {
    try {
      const f = await fs;
      let liveMissing = false;
      try {
        await f.stat(at(file));
      } catch (e) {
        if (!isMissingFile(e)) throw e;
        liveMissing = true;
      }
      if (liveMissing) await unlessMissing(() => f.rename(move(temp, file)));
      await f.writeFile({ ...at(temp), encoding: UTF8, data: text });
      await unlessMissing(() => f.deleteFile(at(backup)));
      await unlessMissing(() => f.rename(move(file, backup)));
      await f.rename(move(temp, file));
    } catch {
      throw new Error(DEVICE_REFUSED_REASON);
    }
  }

  // Read order: X.tmp, then X, then X.bak, the first that is whole. Why X.tmp first:
  // - killed while writing X.tmp: X.tmp is cut off (does not parse), X is the newest whole save;
  // - killed after deleting X.bak, or between the renames, or inside the last rename: X.tmp is a
  //   whole copy newer than X (X may be gone), so it must win;
  // - a whole X.tmp is never older than X: every save that finishes renames it away.
  // X.bak is the save before X, read only when X.tmp and X are both missing or cut off.
  const ORDER = [temp, file, backup];

  async function readSave(): Promise<string | null> {
    const f = await Promise.resolve(fs).catch((e: unknown) => {
      throw new SaveReadError(e);
    });
    let found: unknown = null;
    for (const path of ORDER) {
      let text: string;
      try {
        const { data } = await f.readFile({ ...at(path), encoding: UTF8 });
        // With an encoding the plugin always returns a string; a Blob only comes back without one.
        text = typeof data === 'string' ? data : await data.text();
      } catch (e) {
        if (isMissingFile(e)) continue;
        // Not "missing" and not read: this file may hold the newest tower, so an older copy is
        // not taken in its place. A read failure, never "no save".
        throw new SaveReadError(e);
      }
      if (isWhole(text)) return text;
      found ??= new Error(`${path} is ${text ? 'cut off' : 'empty'}`);
    }
    // None there at all: a first launch or a slot never used, same as an empty browser slot.
    // Files there but none whole: the slot holds a tower this read could not get at.
    if (found === null) return null;
    throw new SaveReadError(found);
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
    stat: (options) => Filesystem.stat(options as Parameters<typeof Filesystem.stat>[0]),
    rename: (options) => Filesystem.rename(options as Parameters<typeof Filesystem.rename>[0]),
    deleteFile: (options) => Filesystem.deleteFile(options as Parameters<typeof Filesystem.deleteFile>[0]),
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
    writeSave: (text: string, options?: WriteOptions) => createStorage(globalDeps(), slot).writeSave(text, options),
    readSave: (receipt?: ReadReceipt) => createStorage(globalDeps(), slot).readSave(receipt),
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
  writeSave: (text: string, options?: WriteOptions) => active('mine').writeSave(text, options),
  readSave: (receipt?: ReadReceipt) => active('mine').readSave(receipt),
};

export const writeSave = (text: string, options?: WriteOptions): Promise<void> => storage.writeSave(text, options);
export const readSave = (receipt?: ReadReceipt): Promise<string | null> => storage.readSave(receipt);

/** Any slot by name. The game writes My tower through writeSave and the other two through this. */
export const writeSlot = (slot: SlotName, text: string, options?: WriteOptions): Promise<void> => active(slot).writeSave(text, options);
export const readSlot = (slot: SlotName, receipt?: ReadReceipt): Promise<string | null> => active(slot).readSave(receipt);

const UNREADABLE_KEY = 'hs.save.unreadable';
const DAILY_KEPT_KEY = 'hs.save.daily-kept';
const DAILY_RECORD_KEY = 'hs.save.daily-record';

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

/**
 * Which Today's tower dates this device has played, kept beside the daily slot so a date once
 * finished never opens fresh again, and moving the device's date back never opens a new one:
 * `latest` is the newest date ever started or finished, `finished` the finished dates (the
 * newest 60, src/game/daily.ts). Dates are YYYY-MM-DD.
 */
export interface DailyRecord {
  latest: string | null;
  finished: string[];
}

const RECORD_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Stores the record. True only when it is there. */
export function writeDailyRecord(record: DailyRecord): boolean {
  return keep(DAILY_RECORD_KEY, JSON.stringify({ latest: record.latest, finished: record.finished }));
}

/** The stored record, or null when there is none (an install from before it) or it does not read. */
export function readDailyRecord(): DailyRecord | null {
  const text = kept(DAILY_RECORD_KEY);
  if (text === null) return null;
  try {
    const raw = JSON.parse(text) as { latest?: unknown; finished?: unknown };
    const latest = typeof raw.latest === 'string' && RECORD_DATE.test(raw.latest) ? raw.latest : null;
    const finished = Array.isArray(raw.finished) ? raw.finished.filter((d): d is string => typeof d === 'string' && RECORD_DATE.test(d)) : [];
    return { latest, finished };
  } catch {
    return null;
  }
}

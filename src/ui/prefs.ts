// The chrome's remembered choices, all through one door. Every read and write is wrapped, so
// private browsing, a full disk or a blocked store never throws. A write the store refuses is
// kept in memory and read back from there, so a choice made while storage is blocked still
// takes effect and lasts for this session only.
//
// Keys live in localStorage. New ones use the `hs.` prefix; the older keys keep their names.

/** Where a key is stored. The older keys keep the names they shipped with. */
export const PREF_KEYS = {
  reducedMotion: 'hundredStories.reducedMotion',
  paletteCollapsed: 'hs.palette.collapsed',
  hintSeen: 'hs.hintSeen',
  introSeen: 'hs.intro.seen',
  guideDone: 'hs.guide.done',
  tips: 'hs.tips',
  goalsCollapsed: 'hs.goals.collapsed',
  /** The Display switches in Settings. Package 2B reads largeText and colorBlind. */
  largeText: 'hs.largeText',
  colorBlind: 'hs.colorBlind',
  glassClear: 'hs.glassClear',
  // Haptics on or off; on unless the player turned them off.
  haptics: 'hs.haptics',
} as const;

export type PrefKey = (typeof PREF_KEYS)[keyof typeof PREF_KEYS];

/** The little of Storage this module needs, so a test can hand it a stub. */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's localStorage, or null where there is no window or the getter itself throws. */
function defaultStore(): PrefStore | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

/**
 * This session's copy of the writes a store refused, per store (the page's own store is one
 * object; no store at all, or a getter that throws, is the null key). A refused write is newer
 * than anything the store holds, so the copy answers first; a write the store takes drops it.
 */
const sessionCopies = new WeakMap<PrefStore, Map<string, string>>();
const noStoreCopy = new Map<string, string>();

function sessionCopy(store: PrefStore | null): Map<string, string> {
  if (!store) return noStoreCopy;
  let copy = sessionCopies.get(store);
  if (!copy) {
    copy = new Map();
    sessionCopies.set(store, copy);
  }
  return copy;
}

export function getPref(key: PrefKey, store: PrefStore | null = defaultStore()): string | null {
  const copy = sessionCopy(store).get(key);
  if (copy !== undefined || !store) return copy ?? null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

type PrefListener = (key: PrefKey) => void;
const listeners = new Set<PrefListener>();

/**
 * Hear every write through setPref (and so setFlag): the Settings switches only write, and
 * whoever acts on a choice listens here. Returns the way to stop listening.
 */
export function onPrefChange(listener: PrefListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPref(key: PrefKey, value: string, store: PrefStore | null = defaultStore()): void {
  const copy = sessionCopy(store);
  let stored = false;
  if (store) {
    try {
      store.setItem(key, value);
      stored = true;
    } catch {
      // Kept below: the choice stays for this session only.
    }
  }
  if (stored) copy.delete(key);
  else copy.set(key, value);
  for (const listener of [...listeners]) {
    try {
      listener(key);
    } catch (error) {
      console.warn('prefs: a listener failed', key, error);
    }
  }
}

/** 'true' or 'false' as a boolean; anything else, or nothing, is null. */
export function getFlag(key: PrefKey, store?: PrefStore | null): boolean | null {
  const stored = getPref(key, store === undefined ? defaultStore() : store);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return null;
}

export function setFlag(key: PrefKey, on: boolean, store?: PrefStore | null): void {
  setPref(key, on ? 'true' : 'false', store === undefined ? defaultStore() : store);
}

/** A stored JSON list of strings. Junk reads as an empty list. */
export function getList(key: PrefKey, store?: PrefStore | null): string[] {
  const stored = getPref(key, store === undefined ? defaultStore() : store);
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Add one string to a stored list, once. */
export function addToList(key: PrefKey, item: string, store?: PrefStore | null): void {
  const target = store === undefined ? defaultStore() : store;
  const list = getList(key, target);
  if (list.includes(item)) return;
  list.push(item);
  setPref(key, JSON.stringify(list), target);
}

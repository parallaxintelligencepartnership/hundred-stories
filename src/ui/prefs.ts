// The chrome's remembered choices, all through one door. Every read and write is wrapped, so
// private browsing, a full disk or a blocked store never throws: a read answers null and a
// write is dropped, and the choice lasts for this session only.
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

export function getPref(key: PrefKey, store: PrefStore | null = defaultStore()): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function setPref(key: PrefKey, value: string, store: PrefStore | null = defaultStore()): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // Nothing to do: the choice stays for this session only.
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

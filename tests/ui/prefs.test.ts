// src/ui/prefs.ts is the one door to localStorage: a store that throws must never throw past it.
import { describe, expect, it } from 'vitest';
import { PREF_KEYS, addToList, getFlag, getList, getPref, setFlag, setPref, type PrefStore } from '../../src/ui/prefs';

function memoryStore(): PrefStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing: PrefStore = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('prefs', () => {
  it('never throws with a storage that throws, and reads nothing from it', () => {
    expect(() => setPref(PREF_KEYS.introSeen, 'true', throwing)).not.toThrow();
    expect(() => setFlag(PREF_KEYS.guideDone, true, throwing)).not.toThrow();
    expect(() => addToList(PREF_KEYS.tips, 'nightSpeed', throwing)).not.toThrow();
    expect(getPref(PREF_KEYS.introSeen, throwing)).toBe(null);
    expect(getFlag(PREF_KEYS.guideDone, throwing)).toBe(null);
    expect(getList(PREF_KEYS.tips, throwing)).toEqual([]);
  });

  it('answers null with no storage at all', () => {
    expect(getPref(PREF_KEYS.hintSeen, null)).toBe(null);
    expect(() => setPref(PREF_KEYS.hintSeen, '1', null)).not.toThrow();
  });

  it('keeps the older keys under their shipped names', () => {
    expect(PREF_KEYS.reducedMotion).toBe('hundredStories.reducedMotion');
    expect(PREF_KEYS.paletteCollapsed).toBe('hs.palette.collapsed');
    expect(PREF_KEYS.hintSeen).toBe('hs.hintSeen');
    expect(PREF_KEYS.introSeen).toBe('hs.intro.seen');
    expect(PREF_KEYS.guideDone).toBe('hs.guide.done');
    expect(PREF_KEYS.tips).toBe('hs.tips');
  });

  it('round trips flags and lists, adds a list item once, and reads junk as empty', () => {
    const store = memoryStore();
    setFlag(PREF_KEYS.introSeen, true, store);
    expect(store.data.get('hs.intro.seen')).toBe('true');
    expect(getFlag(PREF_KEYS.introSeen, store)).toBe(true);
    addToList(PREF_KEYS.tips, 'firstRent', store);
    addToList(PREF_KEYS.tips, 'firstRent', store);
    addToList(PREF_KEYS.tips, 'nightSpeed', store);
    expect(getList(PREF_KEYS.tips, store)).toEqual(['firstRent', 'nightSpeed']);
    store.data.set('hs.tips', '{not json');
    expect(getList(PREF_KEYS.tips, store)).toEqual([]);
    store.data.set('hs.tips', '[1,"longWait",null]');
    expect(getList(PREF_KEYS.tips, store)).toEqual(['longWait']);
  });
});

// The three named save slots on every platform: My tower keeps its original key and file, and
// Today's tower and Friend's tower each get their own, so writing one never touches another.
import { describe, expect, it } from 'vitest';
import {
  createFileStorage,
  createStorage,
  createTauriStorage,
  SLOT_FILES,
  SLOT_KEYS,
  SLOT_LABELS,
  type FileSlotFs,
  type TauriSlotFs,
} from '../../src/game/storage';

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

function fakeFiles(): FileSlotFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async writeFile({ path, data }) {
      files.set(path, data);
      return {};
    },
    async readFile({ path }) {
      const data = files.get(path);
      if (data === undefined) throw new Error('no file');
      return { data };
    },
  };
}

function fakeTauri(): TauriSlotFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    ensureDir: async () => {},
    writeTextFile: async (path, data) => {
      files.set(path, data);
    },
    readTextFile: async (path) => {
      const data = files.get(path);
      if (data === undefined) throw new Error('no file');
      return data;
    },
    rename: async (from, to) => {
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
  };
}

describe('named save slots', () => {
  it('names the slots the way the player reads them, and keeps My tower on its original key and file', () => {
    expect(SLOT_LABELS).toEqual({ mine: 'My tower', daily: "Today's tower", friend: "Friend's tower" });
    expect(SLOT_KEYS.mine).toBe('autosave');
    expect(SLOT_FILES.mine).toBe('autosave.json');
  });

  it('web: each slot has its own key, and My tower still reads the old key', async () => {
    const ls = fakeLocalStorage();
    ls.setItem('hundred-stories:autosave', 'old tower');
    const mine = createStorage({ localStorage: ls });
    const daily = createStorage({ localStorage: ls }, 'daily');
    const friend = createStorage({ localStorage: ls }, 'friend');
    expect(await mine.readSave()).toBe('old tower');
    await daily.writeSave('daily tower');
    await friend.writeSave('friend tower');
    expect(await mine.readSave()).toBe('old tower');
    expect(await daily.readSave()).toBe('daily tower');
    expect(await friend.readSave()).toBe('friend tower');
    expect([...ls.data.keys()].sort()).toEqual(['hundred-stories:autosave', 'hundred-stories:daily', 'hundred-stories:friend']);
  });

  it('phone: one file per slot in the app data directory', async () => {
    const fs = fakeFiles();
    await createFileStorage(fs).writeSave('mine');
    await createFileStorage(fs, 'daily').writeSave('daily');
    await createFileStorage(fs, 'friend').writeSave('friend');
    expect(Object.fromEntries(fs.files)).toEqual({ 'autosave.json': 'mine', 'daily.json': 'daily', 'friend.json': 'friend' });
    expect(await createFileStorage(fs, 'daily').readSave()).toBe('daily');
  });

  it('desktop: one file per slot, each through its own temporary file', async () => {
    const fs = fakeTauri();
    await createTauriStorage(fs).writeSave('mine');
    await createTauriStorage(fs, 'daily').writeSave('daily');
    await createTauriStorage(fs, 'friend').writeSave('friend');
    expect(Object.fromEntries(fs.files)).toEqual({ 'autosave.json': 'mine', 'daily.json': 'daily', 'friend.json': 'friend' });
    expect(await createTauriStorage(fs, 'friend').readSave()).toBe('friend');
  });
});

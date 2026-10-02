// The phone save slot's write protocol (storage.ts createFileStorage): X.tmp, then X.bak, then X,
// against a stub of @capacitor/filesystem that answers like the plugin does on iOS and Android
// (missing file: code OS-PLUG-FILE-0008; any other failure: OS-PLUG-FILE-0013; a rename onto an
// existing file deletes it first, as the iOS library does). The stub can "die" at a chosen step,
// the way a killed app or a full disk stops a save, and the slot is then read as a relaunch would.
// This proves the protocol against the stub, not the real plugin on a device.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Op = 'writeFile' | 'readFile' | 'stat' | 'rename' | 'deleteFile';
type Verdict = 'die' | 'half' | 'fail' | undefined;

const plugin = vi.hoisted(() => {
  const DIR = 'DATA';
  function makeFs() {
    const files = new Map<string, string>();
    const log: string[] = [];
    const state = {
      files,
      log,
      dead: false,
      /** Called before each step; 'die' kills the app there, 'half' writes half then dies, 'fail' rejects that step. */
      hook: undefined as ((op: Op, path: string, to?: string) => Verdict) | undefined,
      /** A delay per write, by its text, so two saves can overlap. */
      writeDelay: undefined as ((data: string) => number) | undefined,
    };
    const missing = (m: string, p: string) =>
      Object.assign(new Error(`'${m}' failed because file at 'file:///data/${p}' does not exist.`), { code: 'OS-PLUG-FILE-0008' });
    const failed = (m: string) => Object.assign(new Error(`'${m}' failed with: No space left on device`), { code: 'OS-PLUG-FILE-0013' });
    const killed = () => new Error('the app was killed');
    function gate(op: Op, path: string, to?: string, data?: string): void {
      if (state.dead) throw killed();
      log.push(to ? `${op} ${path} ${to}` : `${op} ${path}`);
      const v = state.hook?.(op, path, to);
      if (v === 'fail') throw failed(op);
      if (v === 'half' && data !== undefined) files.set(path, data.slice(0, Math.floor(data.length / 2)));
      if (v === 'die' || v === 'half') {
        state.dead = true;
        throw killed();
      }
    }
    const api = {
      async writeFile(o: { path: string; data: string; directory: string; encoding: string }) {
        if (o.directory !== DIR || o.encoding !== 'utf8') throw new Error('wrong directory or encoding');
        const ms = state.writeDelay?.(o.data) ?? 0;
        if (ms) await new Promise((r) => setTimeout(r, ms));
        gate('writeFile', o.path, undefined, o.data);
        files.set(o.path, o.data);
        return { uri: `file:///data/${o.path}` };
      },
      async readFile(o: { path: string; directory: string; encoding: string }) {
        gate('readFile', o.path);
        const data = files.get(o.path);
        if (data === undefined) throw missing('readFile', o.path);
        return { data };
      },
      async stat(o: { path: string; directory: string }) {
        gate('stat', o.path);
        if (!files.has(o.path)) throw missing('stat', o.path);
        return { type: 'file', size: files.get(o.path)!.length };
      },
      async rename(o: { from: string; to: string; directory: string; toDirectory: string }) {
        if (o.directory !== DIR || o.toDirectory !== DIR) throw new Error('wrong directory');
        gate('rename', o.from, o.to);
        const data = files.get(o.from);
        if (data === undefined) throw missing('rename', o.from);
        files.delete(o.to); // the iOS library deletes an existing destination, then moves
        files.delete(o.from);
        files.set(o.to, data);
      },
      async deleteFile(o: { path: string; directory: string }) {
        gate('deleteFile', o.path);
        if (!files.delete(o.path)) throw missing('deleteFile', o.path);
      },
    };
    return { state, api };
  }
  return { makeFs, shared: makeFs() };
});

// The game's own storage loads the plugin through the real loader; this is that plugin.
vi.mock('@capacitor/filesystem', () => ({ Filesystem: plugin.shared.api }));

import { createGame, READ_FAILED_NOTICE } from '../../src/game/game';
import { createFileStorage, SaveReadError, type FileSlotFs } from '../../src/game/storage';

const save = (n: number, pad = 0): string => JSON.stringify({ n, pad: 'x'.repeat(pad) });
const X = 'autosave.json';

function fresh() {
  const { state, api } = plugin.makeFs();
  const fs: FileSlotFs = api;
  /** A relaunch: the app is alive again and reads the disk as it was left. */
  const relaunch = () => {
    state.dead = false;
    state.hook = undefined;
    return createFileStorage(fs);
  };
  return { state, fs, relaunch, files: state.files };
}

describe('the phone slot writes through X.tmp and keeps X.bak', () => {
  it('a normal save and load, leaving X and the save before it as X.bak', async () => {
    const { fs, files } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    expect(await slot.readSave()).toBe(save(2));
    expect(Object.fromEntries(files)).toEqual({ [X]: save(2), [`${X}.bak`]: save(1) });
  });

  it('two overlapping saves land whole, in call order, the newer one last', async () => {
    const { state, fs, files } = fresh();
    state.writeDelay = (data) => (data === save(1, 5000) ? 20 : 0); // the older save is the slower write
    const slot = createFileStorage(fs);
    await Promise.all([slot.writeSave(save(1, 5000)), slot.writeSave(save(2))]);
    expect(files.get(X)).toBe(save(2));
    const written = [...state.log];
    expect(await slot.readSave()).toBe(save(2));
    // The second save starts only after the first one's last rename (the first finds no X, so it
    // tries to take up an X.tmp first).
    const steps = [`writeFile ${X}.tmp`, `deleteFile ${X}.bak`, `rename ${X} ${X}.bak`, `rename ${X}.tmp ${X}`];
    expect(written).toEqual([`stat ${X}`, `rename ${X}.tmp ${X}`, ...steps, `stat ${X}`, ...steps]);
  });

  it('killed halfway through writing X.tmp: the previous save is read', async () => {
    const { state, fs, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1, 100));
    state.hook = (op) => (op === 'writeFile' ? 'half' : undefined);
    await expect(slot.writeSave(save(2, 100))).rejects.toThrow('This device would not let the game save.');
    expect(await relaunch().readSave()).toBe(save(1, 100));
  });

  it('killed between the two renames (X gone, X.tmp whole): the new save is read', async () => {
    const { state, fs, files, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    state.hook = (op, path, to) => (op === 'rename' && path === `${X}.tmp` && to === X ? 'die' : undefined);
    await expect(slot.writeSave(save(3))).rejects.toThrow();
    expect(Object.fromEntries(files)).toEqual({ [`${X}.tmp`]: save(3), [`${X}.bak`]: save(2) });
    expect(await relaunch().readSave()).toBe(save(3));
  });

  it('killed after X.bak was removed: the new save in X.tmp is read', async () => {
    const { state, fs, files, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    state.hook = (op, path) => (op === 'rename' && path === X ? 'die' : undefined);
    await expect(slot.writeSave(save(3))).rejects.toThrow();
    expect(Object.fromEntries(files)).toEqual({ [X]: save(2), [`${X}.tmp`]: save(3) });
    expect(await relaunch().readSave()).toBe(save(3));
  });

  it('all three there with a cut-off X reads the next whole one', async () => {
    const { fs, files } = fresh();
    files.set(`${X}.tmp`, save(3).slice(0, 5));
    files.set(X, save(2).slice(0, 5));
    files.set(`${X}.bak`, save(1));
    expect(await createFileStorage(fs).readSave()).toBe(save(1));
    files.set(X, save(2));
    expect(await createFileStorage(fs).readSave()).toBe(save(2));
  });

  it('none of the three there: an empty slot, and the read touches nothing', async () => {
    const { state, fs } = fresh();
    expect(await createFileStorage(fs).readSave()).toBeNull();
    expect(state.log.every((l) => l.startsWith('readFile'))).toBe(true);
  });

  it('files there but none whole: SaveReadError, never an empty slot', async () => {
    const { fs, files } = fresh();
    files.set(X, '');
    files.set(`${X}.bak`, save(1).slice(0, 4));
    await expect(createFileStorage(fs).readSave()).rejects.toBeInstanceOf(SaveReadError);
  });

  it('an old install with only X reads it, and its first save keeps it as X.bak', async () => {
    const { fs, files } = fresh();
    files.set(X, save(1));
    const slot = createFileStorage(fs);
    expect(await slot.readSave()).toBe(save(1));
    await slot.writeSave(save(2));
    expect(Object.fromEntries(files)).toEqual({ [X]: save(2), [`${X}.bak`]: save(1) });
  });

  it('a good save takes up a cut-off X.tmp and an old X.bak', async () => {
    const { fs, files } = fresh();
    files.set(X, save(2));
    files.set(`${X}.tmp`, save(3).slice(0, 5));
    files.set(`${X}.bak`, save(1));
    await createFileStorage(fs).writeSave(save(4));
    expect(Object.fromEntries(files)).toEqual({ [X]: save(4), [`${X}.bak`]: save(2) });
  });

  it('a slot left with X gone and a whole X.tmp keeps that copy even if the next save is killed', async () => {
    const { state, fs, files, relaunch } = fresh();
    files.set(`${X}.tmp`, save(3));
    files.set(`${X}.bak`, save(2));
    const slot = createFileStorage(fs);
    expect(await slot.readSave()).toBe(save(3)); // the read leaves the files as they are
    expect(Object.fromEntries(files)).toEqual({ [`${X}.tmp`]: save(3), [`${X}.bak`]: save(2) });
    state.hook = (op) => (op === 'writeFile' ? 'half' : undefined);
    await expect(slot.writeSave(save(4))).rejects.toThrow();
    expect(await relaunch().readSave()).toBe(save(3));
    await relaunch().writeSave(save(5));
    expect(Object.fromEntries(files)).toEqual({ [X]: save(5), [`${X}.bak`]: save(3) });
  });

  it('the three slots keep to their own files', async () => {
    const { state, fs, files } = fresh();
    for (const n of [1, 2]) {
      await createFileStorage(fs).writeSave(save(n));
      await createFileStorage(fs, 'daily').writeSave(save(10 + n));
      await createFileStorage(fs, 'friend').writeSave(save(20 + n));
    }
    expect(Object.fromEntries(files)).toEqual({
      'autosave.json': save(2),
      'autosave.json.bak': save(1),
      'daily.json': save(12),
      'daily.json.bak': save(11),
      'friend.json': save(22),
      'friend.json.bak': save(21),
    });
    state.hook = (op, path) => (op === 'rename' && path.startsWith('daily') ? 'fail' : undefined);
    await expect(createFileStorage(fs, 'daily').writeSave(save(13))).rejects.toThrow();
    await createFileStorage(fs, 'friend').writeSave(save(23));
    expect(await createFileStorage(fs).readSave()).toBe(save(2));
    expect(await createFileStorage(fs, 'friend').readSave()).toBe(save(23));
    expect(await createFileStorage(fs, 'daily').readSave()).toBe(save(13)); // its whole X.tmp
  });
});

// The game on the phone slot: the real storage module, the real plugin loader, this stub plugin.
const ls = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => ls.get(k) ?? null,
  setItem: (k: string, v: string) => void ls.set(k, v),
  removeItem: (k: string) => void ls.delete(k),
  clear: () => ls.clear(),
  key: () => null,
  get length() {
    return ls.size;
  },
};
const task = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (n = 20): Promise<void> => {
  for (let i = 0; i < n; i++) await task();
};

function gameOn(seed: number) {
  const clock = { ms: 0 };
  const game = createGame(seed, {
    now: () => clock.ms,
    hidden: () => true,
    scheduleIdle: (run: () => void) => {
      run();
      return () => {};
    },
    today: () => '2026-09-28',
    freshSeed: () => 77,
  });
  const second = (): void => {
    clock.ms += 1000;
    game.stepOnce();
  };
  return { game, second };
}

describe('the game on the phone slot', () => {
  const { state } = plugin.shared;
  const files = state.files;
  beforeAll(() => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    vi.stubGlobal('localStorage', localStorage);
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => {
    files.clear();
    ls.clear();
    state.log.length = 0;
    state.dead = false;
    state.hook = undefined;
  });

  it('files there but none whole: the read fails, and the game never writes the slot', async () => {
    files.set(X, ''); // what an old non-atomic write killed at its start leaves
    files.set(`${X}.bak`, '{"version":2,"seed":11,"roo');
    const before = Object.fromEntries(files);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { game, second } = gameOn(555);
      expect(await game.load()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
      game.world.time.minute = 360 + 1440 - 1; // the 06:00 autosave
      second();
      await settle();
      expect(await game.save()).toEqual({ ok: false, reason: READ_FAILED_NOTICE });
      expect(Object.fromEntries(files)).toEqual(before);
      expect(state.log.some((l) => !l.startsWith('readFile'))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });

  it('a failed rename rejects the save, keeps the last good one and leaves the tower unsaved', async () => {
    const { game } = gameOn(11);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    expect(await game.save()).toEqual({ ok: true });
    const first = files.get(X);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 101 });
    state.hook = (op) => (op === 'rename' ? 'fail' : undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await game.save();
      expect(res.ok).toBe(false);
    } finally {
      warn.mockRestore();
    }
    expect(files.get(X)).toBe(first);
    expect(JSON.parse(first!).rooms.length).toBe(1);
    // Still dirty: leaving now writes the tower.
    state.hook = undefined;
    expect(await game.leave('exit')).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(files.get(X)!).rooms.length).toBe(2);
  });
});

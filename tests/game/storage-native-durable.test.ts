// The phone save slot's protocol (storage.ts createFileStorage): one listing of the data directory,
// X.tmp, then X.bak, then X, and the 0.6.12 direct write onto X when any step is not understood.
// The stub plugin answers the way @capacitor/filesystem 8.1.3 does on iOS (read from its source:
// a missing file is code OS-PLUG-FILE-0008 with "does not exist", any other failure 0013, a rename
// onto an existing file deletes it first, readdir gives { files: [{ name, type }] }) and, on
// request, the way a plugin that has not been proven might: "missing" errors with an unknown code
// and message, no readdir, a listing that fails or gives paths or leaves files out, a rename that
// always fails. It can also "die" at a chosen step, the way a killed app stops a save, and the slot
// is then read as a relaunch would. This proves the protocol against the stub, not on a device.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Op = 'writeFile' | 'readFile' | 'readdir' | 'rename' | 'deleteFile';
type Verdict = 'die' | 'half' | 'fail' | undefined;

interface Behaviour {
  /** 'ios': missing is 0008 "does not exist". 'unknown': missing is a code and message the slot cannot know. */
  missing?: 'ios' | 'unknown';
  /** 'names' (plugin 8.x), 'paths' (full paths), 'none' (no method), 'fail' (rejects), 'blind' (always empty). */
  readdir?: 'names' | 'paths' | 'none' | 'fail' | 'blind';
  /** Every rename rejects with a failure, before it moves anything. */
  renameFails?: boolean;
}

const plugin = vi.hoisted(() => {
  const DIR = 'DATA';
  function makeFs(how: Behaviour = {}) {
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
      how.missing === 'unknown'
        ? Object.assign(new Error(`${m} could not complete (17)`), { code: 'OS-PLUG-FILE-0013' })
        : Object.assign(new Error(`'${m}' failed because file at 'file:///data/${p}' does not exist.`), { code: 'OS-PLUG-FILE-0008' });
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
    const api: Record<string, (o: never) => Promise<unknown>> = {
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
      async rename(o: { from: string; to: string; directory: string; toDirectory: string }) {
        if (o.directory !== DIR || o.toDirectory !== DIR) throw new Error('wrong directory');
        gate('rename', o.from, o.to);
        if (how.renameFails) throw failed('rename');
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
      // Not called by the slot any more; there so the build before this one can run these tests.
      async stat(o: { path: string }) {
        if (!files.has(o.path)) throw missing('stat', o.path);
        return { type: 'file' };
      },
    };
    const listing = how.readdir ?? 'names';
    if (listing !== 'none') {
      api.readdir = async (o: { path: string; directory: string }) => {
        if (o.directory !== DIR || o.path !== '') throw new Error('wrong directory');
        gate('readdir', '.');
        if (listing === 'fail') throw failed('readdir');
        if (listing === 'blind') return { files: [] };
        const names = [...files.keys()];
        return {
          files: names.map((name) => ({ name: listing === 'paths' ? `/data/user/0/app/files/${name}` : name, type: 'file', size: files.get(name)!.length })),
        };
      };
    }
    return { state, api };
  }
  return { makeFs, shared: makeFs() };
});

// The game's own storage loads the plugin through the real loader; this is that plugin.
vi.mock('@capacitor/filesystem', () => ({ Filesystem: plugin.shared.api }));

import { createGame, NEW_TOWER_NOT_SAVED } from '../../src/game/game';
import { createFileStorage, SaveReadError, type FileSlotFs } from '../../src/game/storage';

const save = (n: number, pad = 0): string => JSON.stringify({ n, pad: 'x'.repeat(pad) });
const X = 'autosave.json';
const T = `${X}.tmp`;
const B = `${X}.bak`;
const REFUSED = 'This device would not let the game save.';

function fresh(how: Behaviour = {}) {
  const { state, api } = plugin.makeFs(how);
  const fs = api as unknown as FileSlotFs;
  /** A relaunch: the app is alive again and reads the disk as it was left. */
  const relaunch = () => {
    state.dead = false;
    state.hook = undefined;
    return createFileStorage(fs);
  };
  return { state, fs, relaunch, files: state.files, disk: () => Object.fromEntries(state.files) };
}

describe('the phone slot writes through X.tmp and keeps X.bak', () => {
  it('a normal save and load: one listing per call, and X and X.bak are all that stays on disk', async () => {
    const { state, fs, disk } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    state.log.length = 0;
    await slot.writeSave(save(3));
    expect(state.log).toEqual(['readdir .', `writeFile ${T}`, `deleteFile ${B}`, `rename ${X} ${B}`, `rename ${T} ${X}`]);
    state.log.length = 0;
    expect(await slot.readSave()).toBe(save(3));
    expect(state.log).toEqual(['readdir .', `readFile ${X}`]);
    expect(disk()).toEqual({ [X]: save(3), [B]: save(2) });
  });

  it('two overlapping saves land whole, in call order, the newer one last', async () => {
    const { state, fs, files } = fresh();
    state.writeDelay = (data) => (data === save(1, 5000) ? 20 : 0); // the older save is the slower write
    const slot = createFileStorage(fs);
    await Promise.all([slot.writeSave(save(1, 5000)), slot.writeSave(save(2))]);
    expect(files.get(X)).toBe(save(2));
    // The second save starts only after the first one's last rename.
    expect(state.log).toEqual([
      'readdir .',
      `writeFile ${T}`,
      `rename ${T} ${X}`,
      'readdir .',
      `writeFile ${T}`,
      `rename ${X} ${B}`,
      `rename ${T} ${X}`,
    ]);
    expect(await slot.readSave()).toBe(save(2));
  });

  it('a read queued behind a save waits for it and reads that save', async () => {
    const { state, fs } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    state.writeDelay = (data) => (data === save(2) ? 20 : 0);
    const writing = slot.writeSave(save(2));
    const reading = slot.readSave();
    expect(await reading).toBe(save(2));
    await writing;
  });

  it('a first save killed halfway through writing X.tmp: the cut text is read, as a cut X was', async () => {
    const { state, fs, disk, relaunch } = fresh();
    state.hook = (op) => (op === 'writeFile' ? 'half' : undefined);
    await expect(createFileStorage(fs).writeSave(save(1, 100))).rejects.toThrow();
    expect(Object.keys(disk())).toEqual([T]);
    expect(await relaunch().readSave()).toBe(save(1, 100).slice(0, Math.floor(save(1, 100).length / 2)));
    // The next save goes through and leaves the slot whole.
    await relaunch().writeSave(save(2));
    expect(await relaunch().readSave()).toBe(save(2));
  });

  it('killed halfway through writing X.tmp: the previous save is read', async () => {
    const { state, fs, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1, 100));
    state.hook = (op) => (op === 'writeFile' ? 'half' : undefined);
    await expect(slot.writeSave(save(2, 100))).rejects.toThrow();
    expect(await relaunch().readSave()).toBe(save(1, 100));
  });

  it('killed between the two renames (X gone, X.tmp whole): X.tmp is read, and the next save moves it to X first', async () => {
    const { state, fs, disk, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    state.hook = (op, path, to) => (op === 'rename' && path === T && to === X ? 'die' : undefined);
    await expect(slot.writeSave(save(3))).rejects.toThrow();
    expect(disk()).toEqual({ [T]: save(3), [B]: save(2) });
    expect(await relaunch().readSave()).toBe(save(3));
    const next = relaunch();
    state.hook = (op) => (op === 'writeFile' ? 'half' : undefined);
    await expect(next.writeSave(save(4))).rejects.toThrow();
    expect(await relaunch().readSave()).toBe(save(3)); // moved to X before the write was cut
    await relaunch().writeSave(save(5));
    expect(disk()).toEqual({ [X]: save(5), [B]: save(3) });
  });

  it('killed after X.bak was removed: X, the last save that finished, is read', async () => {
    const { state, fs, disk, relaunch } = fresh();
    const slot = createFileStorage(fs);
    await slot.writeSave(save(1));
    await slot.writeSave(save(2));
    state.hook = (op, path) => (op === 'rename' && path === X ? 'die' : undefined);
    await expect(slot.writeSave(save(3))).rejects.toThrow();
    expect(disk()).toEqual({ [X]: save(2), [T]: save(3) });
    expect(await relaunch().readSave()).toBe(save(2));
  });

  it('a stale whole X.tmp beside a newer X reads X, and the next save takes it up', async () => {
    const { fs, files, disk } = fresh();
    files.set(T, save(3)); // left by this build, then 0.6.12 (a downgrade) saved X twice
    files.set(X, save(50));
    const slot = createFileStorage(fs);
    expect(await slot.readSave()).toBe(save(50));
    await slot.writeSave(save(51));
    expect(disk()).toEqual({ [X]: save(51), [B]: save(50) });
  });

  it('the three slots keep to their own files', async () => {
    const { state, fs, disk } = fresh();
    for (const n of [1, 2]) {
      await createFileStorage(fs).writeSave(save(n));
      await createFileStorage(fs, 'daily').writeSave(save(10 + n));
      await createFileStorage(fs, 'friend').writeSave(save(20 + n));
    }
    expect(disk()).toEqual({
      'autosave.json': save(2),
      'autosave.json.bak': save(1),
      'daily.json': save(12),
      'daily.json.bak': save(11),
      'friend.json': save(22),
      'friend.json.bak': save(21),
    });
    state.hook = (op, path) => (op === 'rename' && path.startsWith('daily') ? 'fail' : undefined);
    await createFileStorage(fs, 'daily').writeSave(save(13)); // by the direct write
    await createFileStorage(fs, 'friend').writeSave(save(23));
    expect(await createFileStorage(fs).readSave()).toBe(save(2));
    expect(await createFileStorage(fs, 'friend').readSave()).toBe(save(23));
    expect(await createFileStorage(fs, 'daily').readSave()).toBe(save(13));
    expect(disk()).toEqual({
      'autosave.json': save(2),
      'autosave.json.bak': save(1),
      'daily.json': save(13),
      'friend.json': save(23),
      'friend.json.bak': save(22),
    });
  });

  it('an old install with only X reads it, and its first save keeps it as X.bak', async () => {
    const { fs, files, disk } = fresh();
    files.set(X, save(1));
    const slot = createFileStorage(fs);
    expect(await slot.readSave()).toBe(save(1));
    await slot.writeSave(save(2));
    expect(disk()).toEqual({ [X]: save(2), [B]: save(1) });
  });

  it('a good save takes up a cut-off X.tmp and an old X.bak', async () => {
    const { fs, files, disk } = fresh();
    files.set(X, save(2));
    files.set(T, save(3).slice(0, 5));
    files.set(B, save(1));
    await createFileStorage(fs).writeSave(save(4));
    expect(disk()).toEqual({ [X]: save(4), [B]: save(2) });
  });
});

describe('read order: X, then X.tmp, then X.bak', () => {
  type Kind = 'whole' | 'torn' | 'empty' | 'missing';
  const kinds: Kind[] = ['whole', 'torn', 'empty', 'missing'];
  const text = (kind: Kind, n: number): string | undefined =>
    kind === 'whole' ? save(n) : kind === 'torn' ? save(n).slice(0, 6) : kind === 'empty' ? '' : undefined;

  it('every combination of whole, torn, empty and missing reads the right copy', async () => {
    const wrong: string[] = [];
    for (const x of kinds)
      for (const t of kinds)
        for (const b of kinds) {
          const { fs, files } = fresh();
          const disk: [string, string | undefined][] = [
            [X, text(x, 2)],
            [T, text(t, 3)],
            [B, text(b, 1)],
          ];
          for (const [name, value] of disk) if (value !== undefined) files.set(name, value);
          // The rule, written out: the first whole one; else the first non-empty one (the damaged
          // path); else no save.
          const values = disk.map(([, v]) => v);
          const expected = values.find((v) => v !== undefined && v !== '' && v.endsWith('}')) ?? values.find((v) => v) ?? null;
          let got: unknown;
          try {
            got = await createFileStorage(fs).readSave();
          } catch (e) {
            got = e;
          }
          if (got !== expected) wrong.push(`X ${x}, T ${t}, B ${b}: got ${String(got)}, wanted ${String(expected)}`);
        }
    expect(wrong).toEqual([]);
  });

  it('a read that fails on X.tmp or X.bak does not stop a whole copy elsewhere', async () => {
    const { state, fs, files } = fresh();
    files.set(X, save(2));
    files.set(T, save(3).slice(0, 7));
    state.hook = (op, path) => (op === 'readFile' && path === T ? 'fail' : undefined);
    expect(await createFileStorage(fs).readSave()).toBe(save(2));
    files.set(X, save(2).slice(0, 4)); // X cut, X.tmp unreadable, X.bak whole
    files.set(B, save(1));
    expect(await createFileStorage(fs).readSave()).toBe(save(1));
  });

  it('a read that fails on X.tmp with nothing else there is a read failure, never no save', async () => {
    const { state, fs, files } = fresh();
    files.set(T, save(3));
    state.hook = (op, path) => (op === 'readFile' && path === T ? 'fail' : undefined);
    await expect(createFileStorage(fs).readSave()).rejects.toBeInstanceOf(SaveReadError);
  });

  it('a read that fails on X itself is a read failure, as it was, even beside a whole X.bak', async () => {
    const { state, fs, files } = fresh();
    files.set(X, save(2));
    files.set(B, save(1));
    state.hook = (op, path) => (op === 'readFile' && path === X ? 'fail' : undefined);
    await expect(createFileStorage(fs).readSave()).rejects.toBeInstanceOf(SaveReadError);
  });
});

describe('a save that fails is never the one read back', () => {
  const points: [string, (op: Op, path: string, to?: string) => boolean][] = [
    ['the listing', (op) => op === 'readdir'],
    ['writing X.tmp', (op, path) => op === 'writeFile' && path === T],
    ['deleting X.bak', (op, path) => op === 'deleteFile' && path === B],
    ['renaming X to X.bak', (op, path) => op === 'rename' && path === X],
    ['renaming X.tmp to X', (op, path) => op === 'rename' && path === T],
  ];
  for (const [name, at] of points) {
    it(`fails at ${name}: the direct write saves it`, async () => {
      const { state, fs, disk, relaunch } = fresh();
      const slot = createFileStorage(fs);
      await slot.writeSave(save(1));
      await slot.writeSave(save(2));
      state.hook = (op, path, to) => (at(op, path, to) ? 'fail' : undefined);
      await slot.writeSave(save(3));
      expect(await relaunch().readSave()).toBe(save(3));
      expect(disk()[T]).toBeUndefined();
    });
    it(`fails at ${name} and the direct write fails too: rejected, and the last save is read`, async () => {
      const { state, fs, disk, relaunch } = fresh();
      const slot = createFileStorage(fs);
      await slot.writeSave(save(1));
      await slot.writeSave(save(2));
      state.hook = (op, path, to) => (at(op, path, to) || (op === 'writeFile' && path === X) ? 'fail' : undefined);
      await expect(slot.writeSave(save(3))).rejects.toThrow(REFUSED);
      expect(disk()[T]).toBeUndefined();
      expect(await relaunch().readSave()).toBe(save(2));
      await relaunch().writeSave(save(4)); // nothing left behind blocks the next save
      expect(await relaunch().readSave()).toBe(save(4));
    });
  }
});

describe('a plugin that behaves differently still saves and loads', () => {
  for (const how of [
    { missing: 'unknown' },
    { missing: 'unknown', readdir: 'paths' },
    { readdir: 'none' },
    { readdir: 'fail' },
    { renameFails: true },
    { missing: 'unknown', renameFails: true },
  ] as Behaviour[]) {
    const label = JSON.stringify(how);
    it(`${label}: a new player`, async () => {
      const { disk, relaunch } = fresh(how);
      expect(await relaunch().readSave()).toBeNull();
      for (const n of [1, 2, 3]) await relaunch().writeSave(save(n));
      expect(await relaunch().readSave()).toBe(save(3));
      expect(disk()[T]).toBeUndefined();
    });
    it(`${label}: an existing player with only X`, async () => {
      const { files, disk, relaunch } = fresh(how);
      files.set(X, save(1));
      expect(await relaunch().readSave()).toBe(save(1));
      for (const n of [2, 3]) await relaunch().writeSave(save(n));
      expect(await relaunch().readSave()).toBe(save(3));
      expect(disk()[T]).toBeUndefined();
    });
  }

  it('without readdir the save is the 0.6.12 write onto X, then a try at a leftover X.tmp', async () => {
    const { state, fs, files } = fresh({ readdir: 'none' });
    files.set(T, save(0));
    await createFileStorage(fs).writeSave(save(1));
    expect(state.log).toEqual([`writeFile ${X}`, `deleteFile ${T}`]);
    expect(Object.fromEntries(files)).toEqual({ [X]: save(1) });
  });

  it('a listing that leaves files out never reads as an empty slot over a save', async () => {
    const { files, relaunch } = fresh({ readdir: 'blind' });
    files.set(X, save(1));
    expect(await relaunch().readSave()).toBe(save(1));
    files.set(X, save(1).slice(0, 4));
    files.set(B, save(0));
    expect(await relaunch().readSave()).toBe(save(0));
  });

  it('a listing that cannot be had: the read is the old read of X, then the others', async () => {
    const { files, relaunch } = fresh({ readdir: 'fail' });
    files.set(X, save(1).slice(0, 4));
    files.set(B, save(0));
    expect(await relaunch().readSave()).toBe(save(0));
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
  return { game };
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

  it('a rename that fails saves by the direct write', async () => {
    const { game } = gameOn(11);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    expect(await game.save()).toEqual({ ok: true });
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 101 });
    state.hook = (op) => (op === 'rename' ? 'fail' : undefined);
    expect(await game.save()).toEqual({ ok: true });
    expect(JSON.parse(files.get(X)!).rooms.length).toBe(2);
    expect(files.has(T)).toBe(false);
  });

  it('a save the device refuses outright keeps the last good one and leaves the tower unsaved', async () => {
    const { game } = gameOn(11);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    expect(await game.save()).toEqual({ ok: true });
    const first = files.get(X);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 101 });
    state.hook = (op, path) => (op === 'rename' || (op === 'writeFile' && path === X) ? 'fail' : undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect((await game.save()).ok).toBe(false);
    } finally {
      warn.mockRestore();
    }
    expect(files.get(X)).toBe(first);
    expect(files.has(T)).toBe(false);
    state.hook = undefined;
    expect(await game.leave('exit')).toEqual({ ok: true, wrote: true });
    expect(JSON.parse(files.get(X)!).rooms.length).toBe(2);
  });

  it('a New tower whose save fails does not come back: the old tower is the one stored', async () => {
    const { game } = gameOn(11);
    for (let x = 100; x < 104; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    expect(await game.save()).toEqual({ ok: true });
    expect(await game.save()).toEqual({ ok: true });
    state.hook = (op, path) => (op === 'deleteFile' && path === B) || (op === 'writeFile' && path === X) ? 'fail' : undefined;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await game.newGame(9)).toEqual({ ok: false, reason: NEW_TOWER_NOT_SAVED });
    } finally {
      warn.mockRestore();
    }
    state.hook = undefined;
    const relaunched = gameOn(5).game;
    expect(await relaunched.load()).toEqual({ ok: true });
    expect(relaunched.world.rooms.size).toBe(4);
    expect(relaunched.world.seed).toBe(11);
  });

  it('a plugin whose rename always fails: the game saves and loads by the direct write', async () => {
    const { game } = gameOn(11);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
    state.hook = (op) => (op === 'rename' ? 'fail' : undefined);
    expect(await game.save()).toEqual({ ok: true });
    expect(await game.save()).toEqual({ ok: true });
    const relaunched = gameOn(5).game;
    expect(await relaunched.load()).toEqual({ ok: true });
    expect(relaunched.world.rooms.size).toBe(1);
  });
});

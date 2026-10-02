// A phone slot whose files are there but none is whole (P1c review C1): the new slot must send the
// game down the same damaged-save path the 0.6.12 slot did. Each case runs the real game twice on
// the same stub plugin and the same disk: once on this build's storage, once with the four slot
// functions swapped for the 0.6.12 file slot (one writeFile onto X, one readFile of X; written out
// below from that build). What the player sees (the load result, the kept copy, Save, leaving)
// must be the same both times.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => {
  const files = new Map<string, string>();
  const missing = (m: string, p: string) =>
    Object.assign(new Error(`'${m}' failed because file at 'file:///data/${p}' does not exist.`), { code: 'OS-PLUG-FILE-0008' });
  const api = {
    async writeFile(o: { path: string; data: string }) {
      files.set(o.path, o.data);
      return { uri: `file:///data/${o.path}` };
    },
    async readFile(o: { path: string }) {
      const data = files.get(o.path);
      if (data === undefined) throw missing('readFile', o.path);
      return { data };
    },
    async readdir() {
      return { files: [...files.keys()].map((name) => ({ name, type: 'file' })) };
    },
    async rename(o: { from: string; to: string }) {
      const data = files.get(o.from);
      if (data === undefined) throw missing('rename', o.from);
      files.delete(o.to);
      files.delete(o.from);
      files.set(o.to, data);
    },
    async deleteFile(o: { path: string }) {
      if (!files.delete(o.path)) throw missing('deleteFile', o.path);
    },
    // Not called by the slot any more; there so the build before this one can run these tests.
    async stat(o: { path: string }) {
      if (!files.has(o.path)) throw missing('stat', o.path);
      return {};
    },
  };
  return { files, api };
});
vi.mock('@capacitor/filesystem', () => ({ Filesystem: plugin.api }));

type Storage = typeof import('../../src/game/storage');
type SlotName = import('../../src/game/storage').SlotName;

/** The 0.6.12 native slot (storage.ts at d45380d), over the same plugin. */
function oldSlots(real: Storage) {
  const path = (slot: SlotName) => real.SLOT_FILES[slot];
  const missing = (e: unknown) => {
    const err = e as { code?: unknown; message?: unknown };
    return err.code === 'OS-PLUG-FILE-0008' || /does not exist/i.test(String(err.message));
  };
  async function write(slot: SlotName, text: string): Promise<void> {
    try {
      await plugin.api.writeFile({ path: path(slot), data: text });
    } catch {
      throw new Error('This device would not let the game save.');
    }
  }
  async function read(slot: SlotName): Promise<string | null> {
    try {
      const { data } = await plugin.api.readFile({ path: path(slot) });
      return data ? data : null;
    } catch (e) {
      if (missing(e)) return null;
      throw new real.SaveReadError(e);
    }
  }
  return {
    writeSave: (text: string) => write('mine', text),
    readSave: () => read('mine'),
    writeSlot: (slot: SlotName, text: string) => write(slot, text),
    readSlot: (slot: SlotName) => read(slot),
  };
}

async function gameModule(build: 'old' | 'new') {
  vi.resetModules();
  if (build === 'old') {
    vi.doMock('../../src/game/storage', async (importOriginal) => {
      const real = await importOriginal<Storage>();
      return { ...real, ...oldSlots(real) };
    });
  } else vi.doUnmock('../../src/game/storage');
  return import('../../src/game/game');
}

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
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
};

async function gameOn(build: 'old' | 'new', seed: number) {
  const { createGame } = await gameModule(build);
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

const CUT = '{"version":5,"seed":12,"roo';

/** One scenario on one build, from the same disk; returns what the player saw. */
type Scenario = (build: 'old' | 'new') => Promise<unknown>;

async function both(disk: Record<string, string>, scenario: Scenario) {
  const seen: Record<string, unknown> = {};
  for (const build of ['old', 'new'] as const) {
    plugin.files.clear();
    ls.clear();
    for (const [k, v] of Object.entries(disk)) plugin.files.set(k, v);
    seen[build] = await scenario(build);
  }
  return seen as { old: unknown; new: unknown };
}

const parses = (name: string): boolean => {
  try {
    JSON.parse(plugin.files.get(name) ?? '');
    return true;
  } catch {
    return false;
  }
};

describe('a cut save on the phone goes down the damaged-save path, as in 0.6.12', () => {
  beforeAll(() => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    vi.stubGlobal('localStorage', localStorage);
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('../../src/game/storage');
  });
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return () => warn.mockRestore();
  });

  it("Today's tower over a cut daily.json saves again, in two sessions", async () => {
    const seen = await both({ 'daily.json': CUT }, async (build) => {
      const out: unknown[] = [];
      for (let session = 1; session <= 2; session++) {
        const { game, second } = await gameOn(build, 5);
        await game.openDaily();
        game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 + session });
        for (let i = 0; i < 5; i++) second();
        out.push([game.getSlot(), await game.save(), await game.leave('exit')]);
        await settle();
        out.push(parses('daily.json'));
      }
      return out;
    });
    expect(seen.new).toEqual(seen.old);
    expect(seen.new).toEqual([
      ['daily', { ok: true }, { ok: true, wrote: false }],
      true,
      ['daily', { ok: true }, { ok: true, wrote: false }],
      true,
    ]);
  });

  it("Friend's tower over a cut friend.json saves again", async () => {
    const seen = await both({ 'friend.json': CUT }, async (build) => {
      const out: unknown[] = [];
      for (let session = 1; session <= 2; session++) {
        const { game, second } = await gameOn(build, 5);
        await game.openFriend(4242);
        game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 + session });
        for (let i = 0; i < 5; i++) second();
        out.push([game.getSlot(), await game.save()]);
        await settle();
        out.push(parses('friend.json'));
      }
      return out;
    });
    expect(seen.new).toEqual(seen.old);
    expect(seen.new).toEqual([['friend', { ok: true }], true, ['friend', { ok: true }], true]);
  });

  it('My tower over a cut autosave.json is held, the text is kept for export, and Save now works', async () => {
    const seen = await both({ 'autosave.json': CUT }, async (build) => {
      const { game } = await gameOn(build, 5);
      const loaded = await game.load();
      const kept = game.getKeptCopy();
      const held = game.saveHeld();
      const saved = await game.save();
      return { loaded, kept, held, saved, after: parses('autosave.json') };
    });
    expect(seen.new).toEqual(seen.old);
    const mine = seen.new as { loaded: { ok: boolean; reason: string }; kept: string; held: boolean; saved: unknown; after: boolean };
    expect(mine.loaded.ok).toBe(false);
    expect(mine.loaded.reason).not.toMatch(/could not read/i);
    expect(mine.kept).toBe(CUT);
    expect(mine.held).toBe(true);
    expect(mine.saved).toEqual({ ok: true });
    expect(mine.after).toBe(true);
  });

  it('an empty autosave.json is no save and a fresh tower saves, as before', async () => {
    const seen = await both({ 'autosave.json': '' }, async (build) => {
      const { game } = await gameOn(build, 5);
      return { loaded: await game.load(), saved: await game.save(), after: parses('autosave.json') };
    });
    expect(seen.new).toEqual(seen.old);
    expect(seen.new).toEqual({ loaded: { ok: false, reason: 'There is no saved game yet.' }, saved: { ok: true }, after: true });
  });

  it("a first save of Today's tower killed mid-write (only a cut daily.json.tmp) heals on the next open", async () => {
    // The old build's equivalent disk is a cut daily.json; the new one leaves the cut copy in X.tmp.
    const run = async (disk: Record<string, string>, build: 'old' | 'new') => {
      plugin.files.clear();
      ls.clear();
      for (const [k, v] of Object.entries(disk)) plugin.files.set(k, v);
      const { game, second } = await gameOn(build, 5);
      await game.openDaily();
      game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 });
      for (let i = 0; i < 5; i++) second();
      return [game.getSlot(), await game.save(), parses('daily.json')];
    };
    const old = await run({ 'daily.json': CUT }, 'old');
    const now = await run({ 'daily.json.tmp': CUT }, 'new');
    expect(now).toEqual(old);
    expect(now).toEqual(['daily', { ok: true }, true]);
  });
});

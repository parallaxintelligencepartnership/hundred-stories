// The save and load path the player actually uses, driven through the game api in node.
// createGame must not touch the DOM: only start() and attach() may, and neither runs here.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../../src/sim/rules';
import { hashWorld } from '../../src/sim/save';
import { createGame, shouldAutosave } from '../../src/game/game';
import { stashUnreadable, writeSave } from '../../src/game/storage';

// The browser save slot stands in as one in memory string, so save() and load() run end to end.
const slot = vi.hoisted(() => ({ text: null as string | null, refuse: false }));
vi.mock('../../src/game/storage', () => ({
  writeSave: vi.fn(async (text: string): Promise<void> => {
    if (slot.refuse) throw new Error('The browser refused to store the save.');
    slot.text = text;
  }),
  readSave: async (): Promise<string | null> => slot.text,
  stashUnreadable: vi.fn(),
}));

beforeEach(() => {
  slot.text = null;
  slot.refuse = false;
  vi.mocked(writeSave).mockClear();
  vi.mocked(stashUnreadable).mockClear();
});

describe('createGame in node', () => {
  it('builds without a DOM', () => {
    expect(typeof window).toBe('undefined');
    const game = createGame(1);
    expect(game.world.seed).toBe(1);
    expect(game.world.cash).toBe(LIMITS.startingCash);
  });
});

describe('export and import', () => {
  it('exports then imports to exactly the same world', () => {
    const game = createGame(1);
    const before = hashWorld(game.world);
    const text = game.exportSave();
    expect(game.importSave(text)).toEqual({ ok: true });
    expect(hashWorld(game.world)).toBe(before);
  });

  it('carries a built tower across the export and import', () => {
    const game = createGame(7);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    expect(game.apply({ kind: 'build', room: 'office', floor: 2, x: 100 })).toEqual({ ok: true });
    const text = game.exportSave();
    const before = hashWorld(game.world);

    game.newGame(7);
    expect(game.world.rooms.size).toBe(0);
    expect(game.importSave(text)).toEqual({ ok: true });
    expect(game.world.rooms.size).toBe(2);
    expect(hashWorld(game.world)).toBe(before);
  });

  it('refuses garbage and leaves the current world untouched', () => {
    const game = createGame(3);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    const before = hashWorld(game.world);

    const result = game.importSave('not even json {{{');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('This file is not a Hundred Stories save.');
    expect(hashWorld(game.world)).toBe(before);
    expect(game.world.rooms.size).toBe(1);
  });

  it('refuses a damaged save and leaves the current world untouched', () => {
    const game = createGame(3);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    const before = hashWorld(game.world);

    const damaged = JSON.parse(game.exportSave()) as Record<string, any>;
    damaged.rooms[0].floor = 0;
    const result = game.importSave(JSON.stringify(damaged));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('This save is damaged and was not loaded. (rooms[0].floor)');
    expect(hashWorld(game.world)).toBe(before);
  });
});

describe('save and load through the browser slot', () => {
  it('saves, then loads the tower back into a fresh game', async () => {
    const game = createGame(11);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    const before = hashWorld(game.world);
    expect(await game.save()).toEqual({ ok: true });

    const fresh = createGame(11);
    expect(fresh.world.rooms.size).toBe(0);
    expect(await fresh.load()).toEqual({ ok: true });
    expect(hashWorld(fresh.world)).toBe(before);
  });

  it('a new game overwrites the slot so a reload cannot resurrect the old tower', async () => {
    const game = createGame(11);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
    expect(await game.save()).toEqual({ ok: true });

    game.newGame(12);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const fresh = createGame(1);
    expect(await fresh.load()).toEqual({ ok: true });
    expect(fresh.world.rooms.size).toBe(0);
    expect(fresh.world.seed).toBe(12);
  });

  it('logs Game saved. only for a save the player asked for', async () => {
    const game = createGame(11);
    await game.save();
    expect(game.world.log.filter((line) => line.text === 'Game saved.')).toHaveLength(1);
  });

  it('reports an empty slot in plain English', async () => {
    const game = createGame(11);
    const result = await game.load();
    expect(result).toEqual({ ok: false, reason: 'There is no saved game yet.' });
  });

  it('stashes an unreadable save and warns the player instead of throwing it away', async () => {
    const game = createGame(11);
    const saved = JSON.parse(game.exportSave()) as Record<string, unknown>;
    saved.version = 3;
    const text = JSON.stringify(saved);
    slot.text = text;

    const fresh = createGame(11);
    const result = await fresh.load();

    expect(result.ok).toBe(false);
    expect(
      fresh.world.log.some((line) => line.level === 'warn' && line.text.includes('could not be read')),
    ).toBe(true);
    expect(stashUnreadable).toHaveBeenCalledTimes(1);
    expect(stashUnreadable).toHaveBeenCalledWith(text);
    expect(writeSave).not.toHaveBeenCalled();
  });

  it('reports a refused write and logs nothing', async () => {
    slot.refuse = true;
    const game = createGame(11);
    const result = await game.save();
    expect(result).toEqual({ ok: false, reason: 'The browser refused to store the save.' });
    expect(game.world.log.filter((line) => line.text === 'Game saved.')).toHaveLength(0);
  });
});

describe('newGame', () => {
  it('resets cash and the clock to the start of a new game', () => {
    const game = createGame(2);
    game.world.cash = 17;
    game.world.time.minute = 99_999;
    game.newGame(42);
    expect(game.world.seed).toBe(42);
    expect(game.world.cash).toBe(LIMITS.startingCash);
    expect(game.world.time.minute).toBe(6 * 60);
    expect(game.world.rooms.size).toBe(0);
    expect(game.getSelection()).toBeNull();
  });
});

describe('shouldAutosave', () => {
  const MORNING = 6 * 60; // 06:00 on day one, the minute a new game opens on
  const DAY = 1440;
  const QUARTER = 3 * DAY;

  it('does not save for a batch inside one morning', () => {
    expect(shouldAutosave(MORNING, MORNING + 120)).toBe(false);
  });

  it('does not save on the opening minute itself', () => {
    expect(shouldAutosave(MORNING, MORNING + 1)).toBe(false);
  });

  it('saves when the batch crosses 06:00', () => {
    expect(shouldAutosave(MORNING + DAY - 1, MORNING + DAY)).toBe(true);
    expect(shouldAutosave(MORNING + DAY - 5, MORNING + DAY + 5)).toBe(true);
  });

  it('saves once for a burst of ticks that swallows several mornings', () => {
    // One boolean for the whole batch, so a fast forward of three days writes one save.
    expect(shouldAutosave(MORNING, MORNING + 3 * DAY)).toBe(true);
  });

  it('saves when the batch crosses a quarter start', () => {
    expect(shouldAutosave(QUARTER - 1, QUARTER)).toBe(true);
    expect(shouldAutosave(QUARTER + 10, QUARTER + 20)).toBe(false);
  });

  it('saves when the batch crosses into a new year', () => {
    const YEAR = 4 * QUARTER;
    expect(shouldAutosave(YEAR - 1, YEAR + 1)).toBe(true);
  });

  it('never saves for a batch that ran no minutes or went backwards', () => {
    expect(shouldAutosave(MORNING, MORNING)).toBe(false);
    expect(shouldAutosave(MORNING + DAY, MORNING)).toBe(false);
    expect(shouldAutosave(Number.NaN, MORNING)).toBe(false);
  });
});

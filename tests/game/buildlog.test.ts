// The game shell records every accepted player command at its one boundary, and an exported
// save replays to the same world.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { buildLogOf } from '../../src/sim/buildlog';
import { verifySave } from '../../src/sim/replay';
import { tick } from '../../src/sim/tick';

const slot = vi.hoisted(() => ({ text: null as string | null }));
vi.mock('../../src/game/storage', () => ({
  writeSave: vi.fn(async (text: string): Promise<void> => {
    slot.text = text;
  }),
  readSave: async (): Promise<string | null> => slot.text,
  stashUnreadable: vi.fn(),
}));

beforeEach(() => {
  slot.text = null;
});

describe('the build log in the game shell', () => {
  it('records accepted commands from apply, not refused ones', () => {
    const game = createGame(777);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(true);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 }).ok).toBe(false);
    const log = buildLogOf(game.world);
    expect(log.unavailable).toBe(null);
    expect(log.entries).toEqual([{ t: 360, cmd: { kind: 'build', room: 'lobby', floor: 1, x: 150 } }]);
  });

  it('exports a save that replays to the same hash, and keeps its log through an import', () => {
    const game = createGame(777);
    for (let x = 150; x <= 200; x++) game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    expect(game.apply({ kind: 'shaft.build', shaft: 'standard', x: 176, floorMin: 1, floorMax: 4 }).ok).toBe(true);
    expect(game.apply({ kind: 'build', room: 'office', floor: 2, x: 158 }).ok).toBe(true);
    for (let i = 0; i < 600; i++) tick(game.world);
    const text = game.exportSave();
    expect(verifySave(text)).toMatchObject({ status: 'match', entries: 53, checkpoints: 1 });

    const other = createGame(1);
    expect(other.importSave(text).ok).toBe(true);
    expect(buildLogOf(other.world).entries.length).toBe(53);
    expect(other.apply({ kind: 'build', room: 'office', floor: 3, x: 158 }).ok).toBe(true);
    expect(verifySave(other.exportSave())).toMatchObject({ status: 'match', entries: 54 });
  });

  it('starts a fresh log for a new game', () => {
    const game = createGame(777);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    game.newGame(778);
    expect(buildLogOf(game.world)).toMatchObject({ unavailable: null, entries: [] });
  });
});

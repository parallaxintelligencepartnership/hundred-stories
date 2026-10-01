// A write another window overtook (F3) reaches the player as a conflict. storage.ts does not raise
// SaveConflictError yet (another package adds it), so My tower's write is made to throw one here,
// by name, exactly as the game knows it; the rest of storage is the real module.
import { afterEach, describe, expect, it, vi } from 'vitest';

const conflict = vi.hoisted(() => ({ on: false }));

vi.mock('../../src/game/storage', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/game/storage')>();
  return {
    ...real,
    writeSave: (text: string): Promise<void> => {
      if (!conflict.on) return real.writeSave(text);
      const error = new Error('A newer save is in another window.');
      error.name = 'SaveConflictError';
      return Promise.reject(error);
    },
  };
});

import { createGame, LEAVE_CONFLICT, STILL_HERE } from '../../src/game/game';
import { fakeLocalStorage, handClock } from './leave-stores';

afterEach(() => {
  conflict.on = false;
  vi.unstubAllGlobals();
});

describe('a save another window overtook comes back as a conflict', () => {
  it('leave, Save and a switch each carry it, and the tower stays in hand', async () => {
    vi.stubGlobal('localStorage', fakeLocalStorage().store);
    const game = createGame(11, handClock().opts);
    game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 150 });
    conflict.on = true;
    expect(await game.leave('reload')).toEqual({ ok: false, reason: LEAVE_CONFLICT, conflict: true });
    expect(await game.save()).toMatchObject({ ok: false, conflict: true });
    expect(await game.openDaily()).toEqual({ ok: false, reason: `${LEAVE_CONFLICT} ${STILL_HERE}` });
    expect(game.getSlot()).toBe('mine');
    conflict.on = false;
    expect(await game.leave('reload')).toEqual({ ok: true, wrote: true });
  });
});

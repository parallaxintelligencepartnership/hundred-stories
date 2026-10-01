// The camera a tower opens on (BB-1, extended 2026-09-29): a tower built past its lobby opens
// framed whole through renderer.frameTower, on attach and on every swap (import, a slot switch);
// a fresh tower and a lobby-only tower keep camera.reset(), so the guided start does not change.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builtPastLobby, createGame } from '../../src/game/game';
import type { Renderer } from '../../src/render/renderer';
import type { World } from '../../src/sim/types';
import { createWorld } from '../../src/sim/world';

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

type Call = { kind: 'reset' } | { kind: 'frame'; world: World };

function stubRenderer(calls: Call[]): Renderer {
  return {
    render: () => {},
    commitMotion: () => {},
    resetMotion: () => {},
    frameTower: (world: World) => calls.push({ kind: 'frame', world }),
    camera: { reset: () => calls.push({ kind: 'reset' }), ensureFloorVisible: () => {} },
    setGhost: () => {},
    setSelection: () => {},
    onPick: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
  } as unknown as Renderer;
}

/** A game holding a lobby run and, when `hotel`, a hotel room over it. */
function builtGame(hotel: boolean): ReturnType<typeof createGame> {
  const game = createGame(5, { now: () => 0, scheduleIdle: () => () => {} });
  game.world.cash = 10_000_000;
  game.world.stars = 3;
  for (let x = 90; x < 130; x += 1) expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x }).ok).toBe(true);
  if (hotel) expect(game.apply({ kind: 'build', room: 'hotelSingle', floor: 2, x: 110 }).ok).toBe(true);
  return game;
}

const host = { addEventListener: () => {} } as unknown as HTMLElement;

describe('builtPastLobby', () => {
  it('is false for an empty lot and a lobby, true for any other room or a shaft', () => {
    expect(builtPastLobby(createWorld(1))).toBe(false);
    expect(builtPastLobby(builtGame(false).world)).toBe(false);
    expect(builtPastLobby(builtGame(true).world)).toBe(true);
  });
});

describe('the opening shot', () => {
  it('frames a built tower whole on attach, and a fresh tower keeps the reset view', () => {
    const calls: Call[] = [];
    const game = builtGame(true);
    game.attach(stubRenderer(calls), host);
    expect(calls).toEqual([{ kind: 'frame', world: game.world }]);

    const freshCalls: Call[] = [];
    createGame(6, { now: () => 0, scheduleIdle: () => () => {} }).attach(stubRenderer(freshCalls), host);
    expect(freshCalls).toEqual([{ kind: 'reset' }]);
  });

  it('swapWorld frames the tower it swaps in, never resetting it, and a new game still resets', async () => {
    const text = builtGame(true).exportSave();
    const calls: Call[] = [];
    const game = createGame(7, { now: () => 0, scheduleIdle: () => () => {} });
    game.attach(stubRenderer(calls), host);
    calls.length = 0;

    expect(await game.importSave(text)).toEqual({ ok: true });
    expect(calls).toEqual([{ kind: 'frame', world: game.world }]);

    calls.length = 0;
    game.newGame(8);
    expect(calls).toEqual([{ kind: 'reset' }]);
  });

  it('a lobby-only tower (the guided start) swaps in on the reset view', async () => {
    const text = builtGame(false).exportSave();
    const calls: Call[] = [];
    const game = createGame(7, { now: () => 0, scheduleIdle: () => () => {} });
    game.attach(stubRenderer(calls), host);
    calls.length = 0;
    expect(await game.importSave(text)).toEqual({ ok: true });
    expect(calls).toEqual([{ kind: 'reset' }]);
  });
});

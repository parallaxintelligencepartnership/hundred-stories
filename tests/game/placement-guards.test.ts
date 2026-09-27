// Two ways a placement could be left stuck with no way out:
// - a finger that never lifted on the view (the window lost focus mid-touch) stayed counted as
//   down, so every later tap read as a second finger, parked nothing and moved nothing, while
//   the camera (which forgets its fingers on blur) went on panning;
// - Today's tower ending with a room in hand and an outline parked, every Build then refused.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { DAILY_END_MINUTE } from '../../src/game/daily';
import type { Renderer } from '../../src/render/renderer';

const slots = vi.hoisted(() => new Map<string, string>());
vi.mock('../../src/game/storage', () => ({
  writeSave: async (text: string): Promise<void> => {
    slots.set('mine', text);
  },
  readSave: async (): Promise<string | null> => slots.get('mine') ?? null,
  writeSlot: async (slot: string, text: string): Promise<void> => {
    slots.set(slot, text);
  },
  readSlot: async (slot: string): Promise<string | null> => slots.get(slot) ?? null,
  stashUnreadable: () => {},
}));

type Handler = (event: unknown) => void;

function listeners(): { target: { addEventListener(type: string, fn: Handler): void }; fire(type: string, event?: unknown): void } {
  const handlers = new Map<string, Handler[]>();
  return {
    target: {
      addEventListener(type, fn) {
        handlers.set(type, [...(handlers.get(type) ?? []), fn]);
      },
    },
    fire(type, event = {}) {
      for (const fn of handlers.get(type) ?? []) fn(event);
    },
  };
}

function fakeRenderer(): Renderer {
  return {
    render: () => {},
    camera: { centerOn: () => {}, ensureFloorVisible: () => {}, setGroundLine: () => {}, setObstruction: () => {}, reset: () => {} },
    screenToTile: (sx: number) => ({ floor: 2, x: Math.floor(sx / 8) }),
    setGhost: () => {},
    ghostScreenRect: () => null,
    setSelection: () => {},
    onPick: () => {},
    setPanEnabled: () => {},
    setToolOwnsDrag: () => {},
    setReducedMotion: () => {},
    setChrome: () => {},
    resetMotion: () => {},
    commitMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
}

const finger = (x: number, timeStamp: number, pointerId: number): Record<string, number | string> => ({
  button: 0,
  offsetX: x,
  offsetY: 50,
  clientX: x,
  clientY: 50,
  pointerId,
  pointerType: 'touch',
  timeStamp,
});

afterEach(() => {
  slots.clear();
  vi.unstubAllGlobals();
});

describe('a finger lost to a window blur', () => {
  it('is forgotten, so the next tap still parks the outline', () => {
    const win = listeners();
    vi.stubGlobal('window', win.target);
    const game = createGame(1);
    const host = listeners();
    game.attach(fakeRenderer(), host.target as unknown as HTMLElement);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }).ok).toBe(true);
    game.setTool({ kind: 'room', room: 'office' });

    // A finger goes down, and the window loses focus before it lifts: no pointerup ever comes.
    host.fire('pointerdown', finger(800, 0, 7));
    win.fire('blur');

    // A fresh tap, a new finger id: it parks the office where it landed.
    host.fire('pointerdown', finger(840, 1000, 8));
    host.fire('pointerup', finger(840, 1080, 8));
    expect(game.getPlacement()).toMatchObject({ pending: true, floor: 2, x: 105 });
  });
});

describe("Today's tower ending", () => {
  it('puts the tool down and clears the parked outline', async () => {
    let now = 0;
    const game = createGame(11, {
      now: () => now,
      hidden: () => true,
      scheduleIdle: (run) => {
        run();
        return () => {};
      },
      today: () => '2026-09-27',
      freshSeed: () => 77,
    });
    await game.openDaily();
    const host = listeners();
    game.attach(fakeRenderer(), host.target as unknown as HTMLElement);
    expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 }).ok).toBe(true);
    game.setTool({ kind: 'room', room: 'office' });
    host.fire('pointerdown', finger(840, 0, 1));
    host.fire('pointerup', finger(840, 80, 1));
    expect(game.getPlacement()?.pending).toBe(true);

    game.world.time.minute = DAILY_END_MINUTE - 3;
    now += 1000;
    game.stepOnce();
    expect(game.getDaily()?.finished).toBe(true);
    expect(game.getTool()).toEqual({ kind: 'none' });
    expect(game.getPlacement()).toBe(null);
  });
});

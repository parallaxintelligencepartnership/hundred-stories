// The press on the tower view: a click places a room, a press that travels is a pan and
// places nothing, a tap places the same way a click does, and a second finger hands the
// whole gesture to the camera. The renderer and the browser are faked, so this runs in node.
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import { DEFAULT_GROUND_LINE } from '../../src/render/camera';
import type { Renderer } from '../../src/render/renderer';

vi.mock('../../src/game/storage', () => ({
  writeSave: async (): Promise<void> => {},
  readSave: async (): Promise<string | null> => null,
}));

type Handler = (event: unknown) => void;

/** A host element that only remembers the listeners the game hangs on it. */
function fakeHost(): { el: HTMLElement; fire(type: string, event: unknown): void } {
  const handlers = new Map<string, Handler[]>();
  const el = {
    addEventListener(type: string, fn: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(fn);
      handlers.set(type, list);
    },
  } as unknown as HTMLElement;
  return {
    el,
    fire(type, event) {
      for (const fn of handlers.get(type) ?? []) fn(event);
    },
  };
}

/** Eight screen pixels to the tile, everything on floor 2: enough to place a room by hand. */
function fakeRenderer(): { renderer: Renderer; followed: number[]; toolDrag: boolean[]; groundLines: number[] } {
  const followed: number[] = [];
  const toolDrag: boolean[] = [];
  const groundLines: number[] = [];
  const renderer = {
    render: () => {},
    camera: {
      centerOn: () => {},
      ensureFloorVisible: (floor: number) => followed.push(floor),
      setGroundLine: (fraction: number) => groundLines.push(fraction),
    },
    screenToTile: (sx: number) => ({ floor: 2, x: Math.floor(sx / 8) }),
    setGhost: () => {},
    setSelection: () => {},
    onPick: () => {},
    setPanEnabled: () => {},
    setToolOwnsDrag: (on: boolean) => toolDrag.push(on),
    setReducedMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
  return { renderer, followed, toolDrag, groundLines };
}

const press = (x: number, y = 50): Record<string, number> => ({
  button: 0,
  offsetX: x,
  offsetY: y,
  clientX: x,
  clientY: y,
});

/** One finger, with the pointer id and the clock the tap window is read from. */
const finger = (
  x: number,
  timeStamp: number,
  pointerId = 1,
  y = 50,
): Record<string, number | string> => ({
  ...press(x, y),
  pointerId,
  pointerType: 'touch',
  timeStamp,
});

function started(): { game: ReturnType<typeof createGame>; host: ReturnType<typeof fakeHost>; parts: ReturnType<typeof fakeRenderer> } {
  const game = createGame(1);
  const parts = fakeRenderer();
  const host = fakeHost();
  game.attach(parts.renderer, host.el);
  expect(game.apply({ kind: 'build', room: 'lobby', floor: 1, x: 100 })).toEqual({ ok: true });
  game.setTool({ kind: 'room', room: 'office' });
  return { game, host, parts };
}

describe('press on the tower view', () => {
  it('places the room on release, not on the press', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', press(800));
    expect(game.world.rooms.size).toBe(rooms); // nothing yet: the press may still become a pan

    host.fire('pointerup', press(800));
    expect(game.world.rooms.size).toBe(rooms + 1);
    const built = [...game.world.rooms.values()].find((room) => room.kind === 'office');
    expect(built).toMatchObject({ floor: 2, x: 100 });
  });

  it('places nothing when the press travels: that press was a pan', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', press(800));
    host.fire('pointermove', press(860));
    host.fire('pointerup', press(860));
    expect(game.world.rooms.size).toBe(rooms);
    expect([...game.world.rooms.values()].some((room) => room.kind === 'office')).toBe(false);
  });

  it('still places when the press only trembles inside the slop', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', press(800));
    host.fire('pointermove', press(803));
    host.fire('pointerup', press(803));
    expect(game.world.rooms.size).toBe(rooms + 1);
  });

  it('opens on the street, at the line the screen it is on asks for', () => {
    const { parts } = started();
    expect(parts.groundLines).toEqual([DEFAULT_GROUND_LINE]); // a viewport with no width is a desktop
  });

  it('follows the build with the camera and leaves the drag tools their drag', () => {
    const { game, host, parts } = started();
    host.fire('pointerdown', press(800));
    host.fire('pointerup', press(800));
    expect(parts.followed).toContain(2);

    game.setTool({ kind: 'shaft', shaft: 'standard' });
    expect(parts.toolDrag.at(-1)).toBe(true);
    game.setTool({ kind: 'room', room: 'office' });
    expect(parts.toolDrag.at(-1)).toBe(false);
    game.setTool({ kind: 'room', room: 'lobby' });
    expect(parts.toolDrag.at(-1)).toBe(true);
  });
});

describe('touch on the tower view', () => {
  it('places the room on a tap, the way a click does', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    expect(game.world.rooms.size).toBe(rooms);
    host.fire('pointerup', finger(800, 120));
    expect(game.world.rooms.size).toBe(rooms + 1);
  });

  it('forgives a shaky finger: a tremble too wide for a mouse still places', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    host.fire('pointermove', finger(808, 60));
    host.fire('pointerup', finger(808, 90));
    expect(game.world.rooms.size).toBe(rooms + 1);
  });

  it('places nothing when the finger rested: that press was not a tap', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 900));
    expect(game.world.rooms.size).toBe(rooms);
  });

  it('places nothing when a second finger lands: that gesture is the camera pinching', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0, 1));
    host.fire('pointerdown', finger(600, 30, 2));
    host.fire('pointerup', finger(800, 120, 1));
    host.fire('pointerup', finger(600, 140, 2));
    expect(game.world.rooms.size).toBe(rooms);
  });

  it('gives up a lobby drag to the second finger, so two fingers pan while sizing', () => {
    const { game, host } = started();
    game.setTool({ kind: 'room', room: 'lobby' });
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(816, 0, 1)); // one new segment under the first finger
    expect(game.world.rooms.size).toBe(rooms + 1);

    host.fire('pointerdown', finger(600, 30, 2));
    host.fire('pointermove', finger(900, 60, 1));
    host.fire('pointermove', finger(700, 60, 2));
    host.fire('pointerup', finger(900, 200, 1));
    // The drag stopped painting the moment the gesture became a pinch.
    expect(game.world.rooms.size).toBe(rooms + 1);
  });
});

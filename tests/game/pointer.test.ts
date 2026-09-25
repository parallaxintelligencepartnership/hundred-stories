// The press on the tower view: a click places a room, a press that travels is a pan and
// places nothing, a tap places the same way a click does, and a second finger hands the
// whole gesture to the camera. The renderer and the browser are faked, so this runs in node.
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game/game';
import type { Ghost, Renderer } from '../../src/render/renderer';

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

/**
 * Eight screen pixels to the tile, and by default everything on floor 2: enough to place a
 * room by hand. A test that needs a span reads the floor off the y with its own mapping.
 */
function fakeRenderer(
  floorAt: (sy: number) => number = () => 2,
): { renderer: Renderer; followed: number[]; toolDrag: boolean[]; ghosts: (Ghost | null)[]; frames: number } {
  const followed: number[] = [];
  const toolDrag: boolean[] = [];
  const ghosts: (Ghost | null)[] = [];
  const parts = { frames: 0 };
  const renderer = {
    render: () => {},
    camera: {
      centerOn: () => {},
      ensureFloorVisible: (floor: number) => followed.push(floor),
      setGroundLine: () => {},
      setObstruction: () => {},
      reset: () => {
        parts.frames += 1;
      },
    },
    screenToTile: (sx: number, sy: number) => ({ floor: floorAt(sy), x: Math.floor(sx / 8) }),
    setGhost: (g: Ghost | null) => ghosts.push(g),
    ghostScreenRect: () => null,
    setSelection: () => {},
    onPick: () => {},
    setPanEnabled: () => {},
    setToolOwnsDrag: (on: boolean) => toolDrag.push(on),
    setReducedMotion: () => {},
    setChrome: () => {},
    resetMotion: () => {},
    destroy: () => {},
  } as unknown as Renderer;
  return {
    renderer,
    followed,
    toolDrag,
    ghosts,
    get frames() {
      return parts.frames;
    },
  };
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

function started(floorAt?: (sy: number) => number): {
  game: ReturnType<typeof createGame>;
  host: ReturnType<typeof fakeHost>;
  parts: ReturnType<typeof fakeRenderer>;
} {
  const game = createGame(1);
  const parts = fakeRenderer(floorAt);
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

  it('opens on the street, framed inside whatever band the chrome leaves free', () => {
    const { parts } = started();
    expect(parts.frames).toBe(1); // the opening shot is the camera's own reset, chrome and all
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
  it('parks the room on a tap and spends nothing yet', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    expect(game.world.rooms.size).toBe(rooms);
    host.fire('pointerup', finger(800, 120));
    expect(game.world.rooms.size).toBe(rooms);
    expect(game.getPlacement()).toMatchObject({ floor: 2, x: 100, pending: true });
  });

  it('forgives a shaky finger: a tremble too wide for a mouse still parks the room', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    host.fire('pointermove', finger(808, 60));
    host.fire('pointerup', finger(808, 90));
    expect(game.world.rooms.size).toBe(rooms);
    expect(game.getPlacement()?.pending).toBe(true);
  });

  it('parks even when the finger rested a long while: a still press is still a tap', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;

    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 900));
    expect(game.world.rooms.size).toBe(rooms);
    expect(game.getPlacement()?.pending).toBe(true);
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

// Ten screen pixels to the floor, counting up from y = 200: floor 1 at y = 190, floor 3 at
// y = 170, and the floor that does not exist never appears, the way the sim has it.
const byY = (sy: number): number => {
  const band = Math.round((200 - sy) / 10);
  return band > 0 ? band : band - 1;
};
const atFloor = (floor: number): number => 200 - 10 * (floor > 0 ? floor : floor + 1);

describe('the pending placement a finger parks', () => {
  it('re-anchors on a second tap instead of parking two outlines', () => {
    const { game, host } = started();

    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 100));
    expect(game.getPlacement()).toMatchObject({ x: 100, pending: true });

    host.fire('pointerdown', finger(960, 200));
    host.fire('pointerup', finger(960, 300));
    expect(game.getPlacement()).toMatchObject({ x: 120, pending: true });
    expect(game.world.rooms.size).toBe(1); // the opening lobby segment, and nothing else
  });

  it('shows the parked outline rather than the tile a later finger passes over', () => {
    const { game, host, parts } = started();
    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 100));

    parts.ghosts.length = 0;
    host.fire('pointermove', finger(1600, 200));
    expect(parts.ghosts.at(-1)).toMatchObject({ x: 100 }); // not 200, where the finger went
    expect(game.getPlacement()).toMatchObject({ x: 100, pending: true });
  });

  it('parks the span a finger drew for an elevator and builds no shaft', () => {
    const { game, host } = started(byY);
    game.setTool({ kind: 'shaft', shaft: 'standard' });

    host.fire('pointerdown', finger(1600, 0, 1, atFloor(1)));
    host.fire('pointermove', finger(1600, 60, 1, atFloor(3)));
    host.fire('pointerup', finger(1600, 90, 1, atFloor(3)));

    expect(game.world.shafts.size).toBe(0);
    expect(game.getPlacement()).toMatchObject({
      x: 200,
      floorMin: 1,
      floorMax: 3,
      pending: true,
      label: 'Elevator',
      cost: 200_000,
      ok: true,
    });
  });

  it('parks two floors for a tap that never moved, so the outline opens green', () => {
    const { game, host } = started(byY);
    game.setTool({ kind: 'shaft', shaft: 'standard' });

    host.fire('pointerdown', finger(1600, 0, 1, atFloor(2)));
    host.fire('pointerup', finger(1600, 60, 1, atFloor(2)));

    expect(game.getPlacement()).toMatchObject({ floorMin: 2, floorMax: 3, ok: true, pending: true });
  });

  it('a mouse drag still builds the elevator on release', () => {
    const { game, host } = started(byY);
    game.setTool({ kind: 'shaft', shaft: 'standard' });

    host.fire('pointerdown', { ...press(1600, atFloor(1)), pointerId: 1 });
    host.fire('pointerup', { ...press(1600, atFloor(4)), pointerId: 1 });

    expect(game.world.shafts.size).toBe(1);
    expect(game.getPlacement()?.pending).not.toBe(true);
  });
});

describe('connectors over rooms through the pointer', () => {
  // A connector may share tiles with any room (docs/DESIGN.md), and the pointer path is
  // the one a player uses: a lobby on floor 1, an office above it, then an elevator and stairs.
  function over(): ReturnType<typeof started> {
    const parts = started(byY);
    parts.game.world.cash = 1e9;
    for (let x = 101; x < 140; x++) parts.game.apply({ kind: 'build', room: 'lobby', floor: 1, x });
    expect(parts.game.apply({ kind: 'build', room: 'office', floor: 2, x: 100 })).toEqual({ ok: true });
    return parts;
  }

  it('builds an elevator dragged up from the lobby through the office', () => {
    const { game, host } = over();
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    expect(game.canBuildAt({ kind: 'shaft', shaft: 'standard' }, 1, 104)).toEqual({ ok: true });
    host.fire('pointerdown', { ...press(104 * 8 + 4, atFloor(1)), pointerId: 1 });
    host.fire('pointerup', { ...press(104 * 8 + 4, atFloor(3)), pointerId: 1 });
    expect([...game.world.shafts.values()].map((s) => [s.x, s.floorMin, s.floorMax])).toEqual([[104, 1, 3]]);
  });

  it('parks and builds an elevator a finger tapped on the lobby', () => {
    const { game, host } = over();
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    host.fire('pointerdown', finger(104 * 8 + 4, 0, 1, atFloor(1)));
    host.fire('pointerup', finger(104 * 8 + 4, 60, 1, atFloor(1)));
    expect(game.getPlacement()).toMatchObject({ floorMin: 1, floorMax: 2, ok: true, pending: true });
    expect(game.confirmPending()).toEqual({ ok: true });
    expect(game.world.shafts.size).toBe(1);
  });

  it('builds stairs clicked on the lobby under the office', () => {
    const { game, host } = over();
    game.setTool({ kind: 'room', room: 'stairs' });
    expect(game.canBuildAt({ kind: 'room', room: 'stairs' }, 1, 110)).toEqual({ ok: true });
    host.fire('pointerdown', { ...press(110 * 8 + 4, atFloor(1)), pointerId: 1 });
    host.fire('pointerup', { ...press(110 * 8 + 4, atFloor(1)), pointerId: 1 });
    expect([...game.world.rooms.values()].filter((r) => r.kind === 'stairs').map((r) => [r.floor, r.x])).toEqual([[1, 110]]);
  });
});

describe('moving and sizing a pending placement', () => {
  it('steps over the floor that does not exist, in either direction', () => {
    const { game, host } = started(byY);
    host.fire('pointerdown', finger(800, 0, 1, atFloor(1)));
    host.fire('pointerup', finger(800, 60, 1, atFloor(1)));
    expect(game.getPlacement()?.floor).toBe(1);

    game.nudgePending(0, -1);
    expect(game.getPlacement()?.floor).toBe(-1);
    game.nudgePending(0, -1);
    expect(game.getPlacement()?.floor).toBe(-2);
    game.nudgePending(0, 1);
    expect(game.getPlacement()?.floor).toBe(-1);
    game.nudgePending(0, 1);
    expect(game.getPlacement()?.floor).toBe(1);
  });

  it('never walks a placement off the left edge of the lot', () => {
    const { game, host } = started();
    host.fire('pointerdown', finger(80, 0));
    host.fire('pointerup', finger(80, 60));
    expect(game.getPlacement()?.x).toBe(10);

    for (let i = 0; i < 20; i += 1) game.nudgePending(-1, 0);
    expect(game.getPlacement()?.x).toBe(0);
  });

  it('keeps the span the same size while it slides', () => {
    const { game, host } = started(byY);
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    host.fire('pointerdown', finger(1600, 0, 1, atFloor(1)));
    host.fire('pointerup', finger(1600, 60, 1, atFloor(3)));

    game.nudgePending(1, 1);
    expect(game.getPlacement()).toMatchObject({ x: 201, floorMin: 2, floorMax: 4 });
  });

  it('stretches an elevator from the top and from the bottom, never below one floor', () => {
    const { game, host } = started(byY);
    game.setTool({ kind: 'shaft', shaft: 'standard' });
    host.fire('pointerdown', finger(1600, 0, 1, atFloor(3)));
    host.fire('pointerup', finger(1600, 60, 1, atFloor(3)));
    expect(game.getPlacement()).toMatchObject({ floorMin: 3, floorMax: 4 });

    game.resizePending(1, 0);
    expect(game.getPlacement()).toMatchObject({ floorMin: 3, floorMax: 5 });
    game.resizePending(0, 2);
    expect(game.getPlacement()).toMatchObject({ floorMin: 1, floorMax: 5 });
    game.resizePending(-9, 0);
    expect(game.getPlacement()).toMatchObject({ floorMin: 1, floorMax: 1 });
  });

  it('leaves a room alone: a room is the size its rule says', () => {
    const { game, host } = started();
    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 60));
    const before = game.getPlacement();

    game.resizePending(1, 1);
    expect(game.getPlacement()).toEqual(before);
  });
});

describe('confirming, refusing and dropping a pending placement', () => {
  it('builds on confirm, clears the outline and keeps the tool in hand', () => {
    const { game, host } = started();
    const rooms = game.world.rooms.size;
    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 60));

    expect(game.confirmPending()).toEqual({ ok: true });
    expect(game.world.rooms.size).toBe(rooms + 1);
    expect(game.getPlacement()).toBeNull();
    expect(game.getTool()).toEqual({ kind: 'room', room: 'office' });
  });

  it('keeps the outline where it is when the sim refuses the spot', () => {
    const { game, host } = started(byY);
    host.fire('pointerdown', finger(800, 0, 1, atFloor(3)));
    host.fire('pointerup', finger(800, 60, 1, atFloor(3)));

    const result = game.confirmPending();
    expect(result).toEqual({ ok: false, reason: 'Build a floor below this one first.' });
    expect(game.getPlacement()).toMatchObject({ floor: 3, x: 100, pending: true, ok: false });
    expect(game.world.log.at(-1)?.text).toBe('Build a floor below this one first.');
  });

  it('reports the palette name, the price and the reason', () => {
    const { game, host } = started(byY);
    host.fire('pointerdown', finger(800, 0, 1, atFloor(3)));
    host.fire('pointerup', finger(800, 60, 1, atFloor(3)));

    expect(game.getPlacement()).toMatchObject({
      label: 'Office',
      cost: 40_000,
      ok: false,
      reason: 'Build a floor below this one first.',
    });
  });

  it('drops the outline on cancel and on a change of tool', () => {
    const { game, host } = started();
    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 60));
    game.cancelPending();
    expect(game.getPlacement()).toBeNull();

    host.fire('pointerdown', finger(800, 200));
    host.fire('pointerup', finger(800, 260));
    expect(game.getPlacement()?.pending).toBe(true);
    game.setTool({ kind: 'none' });
    expect(game.getPlacement()).toBeNull();
  });
});

describe('stretching an elevator that is already standing', () => {
  /** A game with a standard elevator from floor 1 to 3, in the player's hand as well. */
  function withShaft(): ReturnType<typeof started> {
    const parts = started(byY);
    expect(
      parts.game.apply({ kind: 'shaft.build', shaft: 'standard', x: 200, floorMin: 1, floorMax: 3 }),
    ).toEqual({ ok: true });
    parts.game.setTool({ kind: 'shaft', shaft: 'standard' });
    return parts;
  }

  const spanOf = (game: ReturnType<typeof createGame>): { floorMin: number; floorMax: number } => {
    const shaft = [...game.world.shafts.values()][0]!;
    return { floorMin: shaft.floorMin, floorMax: shaft.floorMax };
  };

  it('a mouse drag up from inside the shaft takes it higher', () => {
    const { game, host } = withShaft();

    host.fire('pointerdown', press(1600, atFloor(2)));
    host.fire('pointermove', press(1600, atFloor(6)));
    host.fire('pointerup', press(1600, atFloor(6)));

    expect(game.world.shafts.size).toBe(1); // stretched, not a second shaft beside it
    expect(spanOf(game)).toEqual({ floorMin: 1, floorMax: 6 });
  });

  it('a drag down takes it below ground', () => {
    const { game, host } = withShaft();

    host.fire('pointerdown', press(1600, atFloor(2)));
    host.fire('pointerup', press(1600, atFloor(-2)));

    expect(spanOf(game)).toEqual({ floorMin: -2, floorMax: 3 });
  });

  it('shows the whole candidate span for free while the drag is out', () => {
    const { game, host } = withShaft();

    host.fire('pointerdown', press(1600, atFloor(2)));
    host.fire('pointermove', press(1600, atFloor(6)));

    expect(game.getPlacement()).toMatchObject({
      label: 'Extend elevator',
      cost: 0,
      floorMin: 1,
      floorMax: 6,
      ok: true,
      pending: false,
    });
  });

  it('a plain click on the shaft builds nothing and says nothing', () => {
    const { game, host } = withShaft();
    const lines = game.world.log.length;

    host.fire('pointerdown', press(1600, atFloor(2)));
    host.fire('pointerup', press(1600, atFloor(2)));

    expect(spanOf(game)).toEqual({ floorMin: 1, floorMax: 3 });
    expect(game.world.shafts.size).toBe(1);
    expect(game.world.log.length).toBe(lines);
  });

  it('a finger parks the stretch, and Build applies it', () => {
    const { game, host } = withShaft();

    host.fire('pointerdown', finger(1600, 0, 1, atFloor(2)));
    host.fire('pointermove', finger(1600, 60, 1, atFloor(5)));
    host.fire('pointerup', finger(1600, 90, 1, atFloor(5)));

    const shaftId = [...game.world.shafts.values()][0]!.id;
    expect(game.getPlacement()).toMatchObject({
      shaftId,
      floorMin: 1,
      floorMax: 5,
      cost: 0,
      pending: true,
      ok: true,
    });
    expect(spanOf(game)).toEqual({ floorMin: 1, floorMax: 3 }); // nothing applied yet

    expect(game.confirmPending()).toEqual({ ok: true });
    expect(spanOf(game)).toEqual({ floorMin: 1, floorMax: 5 });
    // The parked outline is gone; what is left is the ordinary hover preview under the finger.
    expect(game.getPlacement()?.pending).not.toBe(true);
    expect(game.getTool()).toEqual({ kind: 'shaft', shaft: 'standard' });
  });

  it('never gives back the floors the elevator already serves', () => {
    const { game, host } = withShaft();

    host.fire('pointerdown', finger(1600, 0, 1, atFloor(2)));
    host.fire('pointerup', finger(1600, 60, 1, atFloor(5)));

    game.resizePending(-9, -9); // asking for less than it has
    expect(game.getPlacement()).toMatchObject({ floorMin: 1, floorMax: 3 });
    game.resizePending(0, 1);
    expect(game.getPlacement()).toMatchObject({ floorMin: -1, floorMax: 3 });
  });
});

describe('Open a saved file drops the parked outline (audit E2 S4)', () => {
  it('parks an outline, opens a saved file, and nothing is parked any more', () => {
    const { game, host } = started();
    const text = game.exportSave();
    host.fire('pointerdown', finger(800, 0));
    host.fire('pointerup', finger(800, 120));
    expect(game.getPlacement()).toMatchObject({ pending: true });
    expect(game.importSave(text)).toEqual({ ok: true });
    expect(game.getPlacement()).toBe(null);
  });
});

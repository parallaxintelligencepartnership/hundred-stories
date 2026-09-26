// The selection stays in view beside its card (design pass 2026-09-25, D-23): at 900 css px and
// wider a query card opens on the right, and the view eases so the ring sits left of it with
// 24 px clear. The rule on its own, then in the shell on the fake DOM with a stub renderer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCamera } from '../../src/render/camera';
import { ROOMS } from '../../src/sim/rules';
import type { Room, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';
import { cardLeft, createUi, SELECTION_CLEAR_PX, selectionClearX } from '../../src/ui/ui';
import { FakeDom } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

describe('cardLeft', () => {
  it('puts the card open on the right two edges in: the shell less the card and 2 x 12', () => {
    expect(cardLeft(1000, 120)).toBe(856);
    expect(cardLeft(1440, 360)).toBe(1056);
  });
});

describe('selectionClearX', () => {
  it('moves the view by the overlap past the clear line, in world px at the zoom', () => {
    expect(SELECTION_CLEAR_PX).toBe(24);
    // Card at 600: the ring must end by 576. It ends at 590, 14 css px over; at zoom 2 that is 7.
    expect(selectionClearX({ x: 560, w: 30 }, 600, { x: 1000, zoom: 2 })).toBe(1007);
    expect(selectionClearX({ x: 560, w: 30 }, 600, { x: 1000, zoom: 1 })).toBe(1014);
  });

  it('leaves the view alone when the ring already sits clear, or exactly on the line', () => {
    expect(selectionClearX({ x: 500, w: 30 }, 600, { x: 1000, zoom: 1 })).toBeNull();
    expect(selectionClearX({ x: 546, w: 30 }, 600, { x: 1000, zoom: 1 })).toBeNull();
  });
});

describe('in the shell', () => {
  function office(world: World): Room {
    const rule = ROOMS.office;
    const room: Room = {
      id: allocId(world), kind: 'office', floor: 4, x: 100, width: rule.width, height: rule.height, eval: 0.7, tenants: [], occupancy: 0,
      builtAtMinute: 0, vacant: false, dirty: false, infested: false, lowEvalSinceMinute: null, onFire: false, rent: 100,
    };
    addRoom(world, room);
    return room;
  }

  function mount(innerWidth: number, rect: { x: number; y: number; w: number; h: number } | null) {
    const win = (globalThis as unknown as { window: { innerWidth?: number } }).window;
    win.innerWidth = innerWidth;
    const world = createWorld(3);
    const room = office(world);
    const eased: number[] = [];
    // A real camera for the minimap, at x 500 and zoom 2, with its ease recorded.
    const camera = createCamera();
    camera.x = 500;
    camera.zoom = 2;
    camera.easeToX = (x: number) => void eased.push(x);
    const renderer = {
      box: rect,
      selectionScreenRect(): { x: number; y: number; w: number; h: number } | null {
        return this.box;
      },
      camera,
    };
    const api = {
      world,
      subscribe: () => () => {},
      getHover: () => null,
      getSpeed: () => 0,
      setSpeed: () => {},
      getTool: () => ({ kind: 'none' }),
      setTool: () => {},
      getPlacement: () => null,
      getPlacementRect: () => null,
      getSelection: () => ({ roomId: room.id }),
      setChrome: () => {},
      setReducedMotion: () => {},
      getSlot: () => 'mine',
    } as never;
    const root = dom.createElement('div');
    const ui = createUi(root as never, api, renderer as never);
    ui.update();
    return { renderer, eased, ui };
  }

  // The fake shell is 1000 wide and the card 120: cardLeft = 1000 - (120 + 2 * 12) = 856, so the
  // ring must end by 832.
  it('eases the view once the ring is drawn, so it sits 24 px clear of the card', () => {
    const { renderer, eased } = mount(1200, null);
    expect(eased).toEqual([]); // nothing until a frame
    dom.runFrame(); // the renderer has not drawn the new ring yet: look again next frame
    expect(eased).toEqual([]);
    renderer.box = { x: 800, y: 200, w: 60, h: 40 }; // ends at 860, 28 over
    dom.runFrame();
    expect(eased).toEqual([500 + 28 / 2]);
    dom.runFrame();
    expect(eased).toHaveLength(1); // once per card
  });

  it('leaves the view alone when the ring is already clear of the card', () => {
    const { eased } = mount(1200, { x: 700, y: 200, w: 60, h: 40 });
    dom.runFrame();
    dom.runFrame();
    expect(eased).toEqual([]);
  });

  it('does nothing under 900 css px, where the card is a bottom sheet', () => {
    const { eased } = mount(899, { x: 800, y: 200, w: 60, h: 40 });
    dom.runFrame();
    expect(eased).toEqual([]);
  });

  it('gives up after a few frames when no ring is ever drawn', () => {
    const { renderer, eased } = mount(1200, null);
    for (let i = 0; i < 3; i++) dom.runFrame();
    renderer.box = { x: 800, y: 200, w: 60, h: 40 };
    dom.runFrame();
    expect(eased).toEqual([]);
  });
});

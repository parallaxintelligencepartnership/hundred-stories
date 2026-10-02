// The selection stays in sight beside its card. Since the owner ruling of 2026-10-01 a room,
// person or elevator card at 900 css px and wider stands beside the selection's ring and follows
// it, so the view never eases away from a fixed card (the D-23 ease is gone). The rule's own
// cases are in card-anchor.test.ts; here it runs in the shell on the fake DOM with a stub
// renderer, the chrome laid out as on a 1200 by 800 desktop.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCamera } from '../../src/render/camera';
import { ROOMS } from '../../src/sim/rules';
import type { Room, World } from '../../src/sim/types';
import { addRoom, allocId, createWorld } from '../../src/sim/world';
import { cardLeft, createUi } from '../../src/ui/ui';
import { FakeDom, FakeElement } from './fake-dom';

type Rect = { left: number; top: number; width: number; height: number };
/** Where the desktop chrome stands at 1200 by 800: the bar, the round-button row, the folded dock, the alerts' corner. */
const LAYOUT: [string, Rect][] = [
  ['hs-ui', { left: 0, top: 0, width: 1200, height: 800 }],
  ['hs-top', { left: 12, top: 12, width: 1176, height: 52 }],
  ['hs-save-btn', { left: 900, top: 72, width: 52, height: 52 }],
  ['hs-palette', { left: 12, top: 72, width: 56, height: 388 }],
  ['hs-toasts', { left: 848, top: 788, width: 340, height: 0 }],
  ['hs-sheet', { left: 828, top: 132, width: 360, height: 500 }],
];

let dom: FakeDom;
let uninstall: () => void;
const original = FakeElement.prototype.getBoundingClientRect;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
  FakeElement.prototype.getBoundingClientRect = function (this: FakeElement) {
    const classes = this.className.split(/\s+/);
    const hit = LAYOUT.find(([c]) => classes.includes(c));
    const r = hit ? hit[1] : { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, right: r.left + r.width, bottom: r.top + r.height };
  };
});
afterEach(() => {
  FakeElement.prototype.getBoundingClientRect = original;
  uninstall();
});

describe('cardLeft', () => {
  it('puts a panel that is not about the tower two edges in from the right: the shell less the card and 2 x 12', () => {
    expect(cardLeft(1000, 120)).toBe(856);
    expect(cardLeft(1440, 360)).toBe(1056);
  });
});

describe('a card beside its selection, in the shell', () => {
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
    const card = (): FakeElement => root.descendants().find((n) => n.className.split(/\s+/).includes('hs-sheet'))!;
    return { renderer, eased, ui, card, win };
  }

  it('stands right of the ring once it is drawn, below the round buttons, and never eases the view', () => {
    const { renderer, eased, card } = mount(1200, null);
    expect(card().classList.contains('is-anchored')).toBe(false); // the fixed spot until a ring is drawn
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(false);
    renderer.box = { x: 300, y: 200, w: 60, h: 40 };
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(true);
    expect(card().style['--card-left']).toBe(`${300 + 60 + 12}px`);
    expect(card().style['--card-top']).toBe('200px');
    // Room from below the round buttons (124 + 8) to the alerts' corner (788).
    expect(card().style['--card-max-h']).toBe(`${788 - 132}px`);
    expect(card().getAttribute('data-side')).toBe('right');
    expect(eased).toEqual([]);
  });

  it('follows the selection as the camera pans, on the frames it already runs, and flips near the right edge', () => {
    const { renderer, eased, card } = mount(1200, { x: 300, y: 200, w: 60, h: 40 });
    dom.runFrame();
    renderer.box = { x: 340, y: 260, w: 60, h: 40 };
    dom.runFrame();
    expect([card().style['--card-left'], card().style['--card-top']]).toEqual(['412px', '260px']);
    renderer.box = { x: 1000, y: 260, w: 60, h: 40 };
    dom.runFrame();
    expect(card().style['--card-left']).toBe(`${1000 - 12 - 360}px`);
    expect(card().getAttribute('data-side')).toBe('left');
    expect(eased).toEqual([]);
  });

  it('stays where it was, on screen, while the selection is off screen', () => {
    const { renderer, card } = mount(1200, { x: 300, y: 200, w: 60, h: 40 });
    dom.runFrame();
    renderer.box = { x: -900, y: 200, w: 60, h: 40 };
    dom.runFrame();
    expect([card().style['--card-left'], card().style['--card-top']]).toEqual(['372px', '200px']);
    expect(card().getAttribute('data-side')).toBe('kept');
  });

  it('lets go under 900 css px, where the card is a bottom sheet, and takes it up again on a resize back', () => {
    const { renderer, card, win } = mount(1200, { x: 300, y: 200, w: 60, h: 40 });
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(true);
    win.innerWidth = 800;
    dom.fireWindow('resize');
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(false);
    win.innerWidth = 1200;
    renderer.box = { x: 500, y: 300, w: 60, h: 40 };
    dom.fireWindow('resize');
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(true);
    expect(card().style['--card-left']).toBe('572px');
  });

  it('does nothing under 900 css px', () => {
    const { eased, card } = mount(899, { x: 800, y: 200, w: 60, h: 40 });
    dom.runFrame();
    dom.runFrame();
    expect(card().classList.contains('is-anchored')).toBe(false);
    expect(card().style['--card-left']).toBeUndefined();
    expect(eased).toEqual([]);
  });
});

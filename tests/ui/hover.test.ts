// The hover card: its content for a shaft and a room from a stub world, where it sits against
// the pointer, and that following the pointer measures nothing once the card is measured.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOMS } from '../../src/sim/rules';
import type { Car, Room, RoomKind, Shaft, Sim, World } from '../../src/sim/types';
import { addRoom, addShaft, addSim, allocId, createWorld } from '../../src/sim/world';
import { createHoverCard, hoverCardBox, hoverTargetAt, roomCard, shaftCard } from '../../src/ui/hover';
import { hallQueues } from '../../src/render/overlays';
import { FakeDom, type FakeElement } from './fake-dom';

let dom: FakeDom;
let uninstall: () => void;
beforeEach(() => {
  dom = new FakeDom();
  uninstall = dom.install();
});
afterEach(() => uninstall());

function makeRoom(world: World, kind: RoomKind, floor: number, x: number, extra: Partial<Room> = {}): Room {
  const rule = ROOMS[kind];
  const room: Room = {
    id: allocId(world),
    kind,
    floor,
    x,
    width: rule.width,
    height: rule.height,
    eval: 0.72,
    tenants: [],
    occupancy: 0,
    builtAtMinute: 0,
    vacant: false,
    dirty: false,
    infested: false,
    lowEvalSinceMinute: null,
    onFire: false,
    rent: 100,
    ...extra,
  };
  addRoom(world, room);
  return room;
}

function car(id: number, shaftId: number, extra: Partial<Car> = {}): Car {
  return {
    id,
    shaftId,
    y: 1,
    dir: 0,
    state: 'idle',
    doorTimer: 0,
    idleSince: null,
    passengers: [],
    calls: new Set(),
    serves: 'any',
    range: null,
    ...extra,
  };
}

function makeShaft(world: World): Shaft {
  const id = allocId(world);
  const stops = new Set<number>();
  for (let f = 1; f <= 12; f += 1) stops.add(f);
  const shaft: Shaft = {
    id,
    kind: 'standard',
    x: 40,
    width: 4,
    floorMin: 1,
    floorMax: 12,
    stops,
    homeFloor: 1,
    cars: [car(allocId(world), id), car(allocId(world), id, { serves: 'hotel', range: { lo: 5, hi: 12 } })],
    hallCalls: new Map(),
  };
  addShaft(world, shaft);
  return shaft;
}

function waiter(world: World, shaftId: number, floor: number, waitStart: number): void {
  const sim: Sim = {
    id: allocId(world),
    kind: 'worker',
    homeRoomId: null,
    pos: { floor, x: 41 },
    inCarId: null,
    inRoomId: null,
    route: [{ kind: 'ride', shaftId, fromFloor: floor, toFloor: 1 }],
    state: 'waiting',
    stress: 0,
    waitStart,
    schedule: [],
    nextScheduleIndex: 0,
    stayUntil: null,
    wallet: 0,
    leaveReason: null,
  };
  addSim(world, sim);
}

function shaftWorld(): { world: World; shaft: Shaft } {
  const world = createWorld(3);
  world.time.minute = 600;
  const shaft = makeShaft(world);
  waiter(world, shaft.id, 3, 590);
  waiter(world, shaft.id, 3, 595);
  waiter(world, shaft.id, 9, 598);
  return { world, shaft };
}

describe('hover card content', () => {
  it('shows a shaft with its waiting counts per floor served, top first, and each car’s settings', () => {
    const { world, shaft } = shaftWorld();
    const card = shaftCard(world, shaft, hallQueues(world).get(shaft.id));
    expect(card.title).toBe('Elevator');
    expect(card.rows).toEqual([
      ['Floors', 'Floor 1 to floor 12'],
      ['Cars', '2 of 8'],
      ['Waiting, floor 9', '1, 2 min'],
      ['Waiting, floor 3', '2, 10 min'],
      ['Car 1', 'Everyone, all floors'],
      ['Car 2', 'Hotel guests, 5 to 12'],
    ]);
  });

  it('says nobody is waiting on a quiet shaft', () => {
    const world = createWorld(3);
    const shaft = makeShaft(world);
    expect(shaftCard(world, shaft, undefined).rows[2]).toEqual(['Waiting', 'Nobody']);
  });

  it('shows a room with its evaluation, rent and tenants', () => {
    const world = createWorld(3);
    const office = makeRoom(world, 'office', 4, 100, { tenants: [1, 2, 3], rent: 90 });
    expect(roomCard(office)).toEqual({
      title: 'Office',
      rows: [
        ['Where', 'Floor 4'],
        ['Happiness', 'Good 72%'],
        ['Rent', '90%'],
        ['Tenants', '3'],
      ],
    });
    expect(roomCard(makeRoom(world, 'shop', 5, 100)).rows[2]).toEqual(['Rent', 'None']);
  });

  it('finds what the pointer is over the way the picture stacks', () => {
    const world = createWorld(3);
    const shaft = makeShaft(world);
    const lobby = makeRoom(world, 'lobby', 1, 41);
    const office = makeRoom(world, 'office', 4, 100);
    expect(hoverTargetAt(world, 1, 41)).toEqual({ kind: 'shaft', shaft }); // the shaft draws over the lobby
    expect(hoverTargetAt(world, 4, 104)).toEqual({ kind: 'room', room: office });
    expect(hoverTargetAt(world, 4, 300)).toBe(null);
    expect(lobby.kind).toBe('lobby');
  });
});

describe('hover card placement', () => {
  const view = { width: 1000, height: 800 };
  const chrome = { top: 56, bottom: 28 };
  const card = { width: 248, height: 120 };

  it('goes below and to the right of the pointer', () => {
    expect(hoverCardBox({ point: { x: 300, y: 300 }, card, view, chrome })).toEqual({ left: 316, top: 316 });
  });

  it('flips left and up near the right and bottom edges, and stays under the status bar', () => {
    expect(hoverCardBox({ point: { x: 900, y: 750 }, card, view, chrome })).toEqual({ left: 900 - 16 - 248, top: 750 - 16 - 120 });
    expect(hoverCardBox({ point: { x: 300, y: 10 }, card, view, chrome }).top).toBe(56 + 16);
  });
});

describe('hover card on the fake DOM', () => {
  function fakeGame(world: World) {
    const state = {
      hover: null as { floor: number; x: number } | null,
      selection: null as null | { shaftId?: number; roomId?: number },
      tool: { kind: 'none' } as { kind: string },
    };
    const api = {
      world,
      getHover: () => state.hover,
      getSelection: () => state.selection,
      getTool: () => state.tool,
    };
    return { state, api: api as never };
  }

  function move(x: number, y: number, pointerType = 'mouse', type = 'pointermove'): void {
    dom.fireWindow(type, { type, pointerType, clientX: x, clientY: y, target: { tagName: 'CANVAS' } });
  }

  function valuesOf(node: FakeElement): string[] {
    return node.descendants().filter((n) => n.tagName === 'DD').map((n) => n.textContent);
  }

  it('shows the shaft under a mouse, follows the pointer and new numbers without measuring', () => {
    const { world, shaft } = shaftWorld();
    const game = fakeGame(world);
    const shell = dom.createElement('div');
    shell.className = 'hs-ui';
    const card = createHoverCard(shell as never, game.api, () => ({ top: 56, bottom: 28 }));
    const node = card.node as unknown as FakeElement;
    expect(node.classList.contains('is-hidden')).toBe(true);

    game.state.hover = { floor: 3, x: shaft.x };
    move(200, 300);
    expect(node.classList.contains('is-hidden')).toBe(false);
    expect(node.children[0]?.textContent).toBe('Elevator');
    expect(node.style['left']).toBe('216px');
    expect(dom.measures).toBe(2); // the view and the card, once

    dom.measures = 0;
    for (let i = 0; i < 20; i += 1) {
      move(200 + i * 5, 300);
      world.time.minute += 1; // the waits tick up: new numbers, the same rows
      card.update();
    }
    expect(dom.measures).toBe(0);
    expect(node.style['left']).toBe(`${216 + 19 * 5}px`);
    expect(valuesOf(node)[3]).toBe('2, 30 min');

    // Another floor's queue appears: one more row, so one more measure of the card.
    waiter(world, shaft.id, 11, world.time.minute);
    world.time.minute += 1;
    card.update();
    expect(dom.measures).toBe(1);

    game.state.hover = null; // the pointer left the tower
    move(10, 10);
    expect(node.classList.contains('is-hidden')).toBe(true);
    card.destroy();
  });

  it('stays away while a tool is in hand, since the ghost and its chip own the pointer', () => {
    const { world, shaft } = shaftWorld();
    const game = fakeGame(world);
    const card = createHoverCard(dom.createElement('div') as never, game.api, () => ({ top: 0, bottom: 0 }));
    game.state.tool = { kind: 'room' };
    game.state.hover = { floor: 3, x: shaft.x };
    move(200, 300);
    expect((card.node as unknown as FakeElement).classList.contains('is-hidden')).toBe(true);
  });

  it('follows the selection on a touch screen: the same tap that selects shows the card', () => {
    const world = createWorld(3);
    const office = makeRoom(world, 'office', 4, 100, { tenants: [7] });
    const game = fakeGame(world);
    const card = createHoverCard(dom.createElement('div') as never, game.api, () => ({ top: 0, bottom: 0 }));
    const node = card.node as unknown as FakeElement;
    move(120, 200, 'touch'); // a finger dragging is a pan: nothing
    expect(node.classList.contains('is-hidden')).toBe(true);
    game.state.selection = { roomId: office.id };
    move(120, 200, 'touch', 'pointerup');
    expect(node.classList.contains('is-hidden')).toBe(false);
    expect(valuesOf(node)).toEqual(['Floor 4', 'Good 72%', '100%', '1']);
    game.state.selection = null;
    card.update();
    expect(node.classList.contains('is-hidden')).toBe(true);
  });
});

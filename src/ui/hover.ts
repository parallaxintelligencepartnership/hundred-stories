// The hover card: a small preview by the pointer of the shaft or room under it. A mouse gets
// it from hovering; a finger from the same tap that selects, so it follows the selection. The
// query panel keeps the full detail and every control; this only reads.
//
// Placement follows the placement chip's rule from the engine round (ui.ts positionPlacement):
// the card and the view are measured once and kept, and measured again only after something
// that can change their size (the card's rows or title, the card shown after being hidden, a
// resize, a font arriving). Moving the pointer or a new number in a row measures nothing.

import type { GameApi } from '../game/api';
import { hallQueues, type HallQueue } from '../render/overlays';
import { ROOMS, SHAFTS, takesRent } from '../sim/rules';
import { carRangeOf, type Car, type Id, type Room, type Shaft, type World } from '../sim/types';
import { roomsOnFloor, shaftAt } from '../sim/world';
import { formatCount, formatEval, formatFloor, formatFloorRange } from './format';
import { clampSpan, PLACE_GUTTER, type Box } from './layout';

export type HoverTarget = { kind: 'shaft'; shaft: Shaft } | { kind: 'room'; room: Room };

const CONNECTORS = new Set(['stairs', 'escalator']);

/**
 * What the pointer is over, the way the picture stacks: stairs and escalators over shafts,
 * shafts over the rooms behind them.
 */
export function hoverTargetAt(world: World, floor: number, x: number): HoverTarget | null {
  let room: Room | undefined;
  for (const r of roomsOnFloor(world, floor)) {
    if (x < r.x || x >= r.x + r.width) continue;
    if (!room || CONNECTORS.has(r.kind)) room = r;
  }
  if (room && CONNECTORS.has(room.kind)) return { kind: 'room', room };
  const shaft = shaftAt(world, floor, x);
  if (shaft) return { kind: 'shaft', shaft };
  return room ? { kind: 'room', room } : null;
}

export interface CardContent {
  title: string;
  rows: [label: string, value: string][];
}

/** At most this many floors of queue in the card; the query panel has the rest. */
export const CARD_WAIT_ROWS = 5;

const SERVES: Record<Car['serves'], string> = { any: 'Everyone', hotel: 'Hotel guests', office: 'Office staff' };

function shortFloor(floor: number): string {
  return floor < 0 ? `B${Math.abs(floor)}` : String(floor);
}

/** Waiting counts per floor served, top floor first, then each car's riders and floors. */
export function shaftCard(world: World, shaft: Shaft, queues: ReadonlyMap<number, HallQueue> | undefined): CardContent {
  const rule = SHAFTS[shaft.kind];
  const rows: CardContent['rows'] = [
    ['Floors', formatFloorRange(shaft.floorMin, shaft.floorMax)],
    ['Cars', `${formatCount(shaft.cars.length)} of ${formatCount(rule.maxCars)}`],
  ];
  const waiting = [...(queues ?? new Map<number, HallQueue>()).entries()]
    .filter(([floor, queue]) => queue.count > 0 && shaft.stops.has(floor))
    .sort((a, b) => b[0] - a[0]);
  if (waiting.length === 0) rows.push(['Waiting', 'Nobody']);
  for (const [floor, queue] of waiting.slice(0, CARD_WAIT_ROWS)) {
    const minutes = Math.max(0, Math.floor(world.time.minute - queue.since));
    rows.push([`Waiting, ${formatFloor(floor).toLowerCase()}`, `${formatCount(queue.count)}, ${minutes} min`]);
  }
  if (waiting.length > CARD_WAIT_ROWS) {
    const more = waiting.length - CARD_WAIT_ROWS;
    rows.push(['Waiting', `${more} more ${more === 1 ? 'floor' : 'floors'}`]);
  }
  shaft.cars.forEach((car, i) => {
    const range = carRangeOf(shaft, car);
    const floors = car.range ? `${shortFloor(range.lo)} to ${shortFloor(range.hi)}` : 'all floors';
    rows.push([`Car ${i + 1}`, `${SERVES[car.serves]}, ${floors}`]);
  });
  return { title: rule.label, rows };
}

/** Evaluation, rent and tenants, as the query panel words them. */
export function roomCard(room: Room): CardContent {
  const rule = ROOMS[room.kind];
  const where = room.height > 1 ? formatFloorRange(room.floor, room.floor + room.height - 1) : formatFloor(room.floor);
  return {
    title: rule.label,
    rows: [
      ['Where', where],
      ['Evaluation', formatEval(room.eval)],
      ['Rent', takesRent(room.kind) ? `${room.rent}%` : 'None'],
      ['Tenants', formatCount(room.tenants.length)],
    ],
  };
}

export function cardContent(world: World, target: HoverTarget, queuesOf: (id: Id) => ReadonlyMap<number, HallQueue> | undefined): CardContent {
  return target.kind === 'shaft' ? shaftCard(world, target.shaft, queuesOf(target.shaft.id)) : roomCard(target.room);
}

/** The gap between the pointer and the card, so the card never sits under the cursor. */
export const HOVER_GAP = 16;

/**
 * Where the card goes: below and to the right of the pointer, flipped to the left or above
 * when it would run off the view or under the chrome.
 */
export function hoverCardBox(frame: {
  point: { x: number; y: number };
  card: Box;
  view: Box;
  chrome: { top: number; bottom: number };
}): { left: number; top: number } {
  const { point, card, view } = frame;
  let left = point.x + HOVER_GAP;
  if (left + card.width > view.width - PLACE_GUTTER) left = point.x - HOVER_GAP - card.width;
  left = clampSpan(left, card.width, view.width);
  const topLimit = Math.max(0, frame.chrome.top) + PLACE_GUTTER;
  const bottomLimit = view.height - Math.max(0, frame.chrome.bottom) - PLACE_GUTTER;
  let top = point.y + HOVER_GAP;
  if (top + card.height > bottomLimit) top = point.y - HOVER_GAP - card.height;
  top = Math.max(topLimit, Math.min(top, bottomLimit - card.height));
  return { left: Math.round(left), top: Math.round(Math.max(topLimit, top)) };
}

// ------------------------------------------------------------------- DOM

export interface HoverCard {
  node: HTMLDivElement;
  /** Read the game again: the target, its numbers, and whether the card shows at all. */
  update(): void;
  destroy(): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * The card, appended to the ui shell by the caller. It listens to the pointer on the window
 * for where to sit and for which kind of pointer is in use.
 */
export function createHoverCard(shell: HTMLElement, game: GameApi, chrome: () => { top: number; bottom: number }): HoverCard {
  const node = h('div', 'hs-hover-card is-hidden');
  node.setAttribute('role', 'status');
  const title = h('p', 'hs-hover-title');
  const list = h('dl', 'hs-hover-rows');
  node.append(title, list);

  let point: { x: number; y: number } | null = null;
  let touch = false;
  let shown = false;
  /**
   * The title and the number of rows: what decides the card's size, since the card is a fixed
   * width and every row one line (ui.css .hs-hover-card). New numbers or a queue moving to
   * another floor keep the shape, so they measure nothing.
   */
  let shape = '';
  let rowNodes: { label: HTMLElement; value: HTMLElement }[] = [];
  let viewSize: Box | null = null;
  let cardSize: Box | null = null;
  let placedKey = '';
  let queueWorld: World | null = null;
  let queueMinute = -1;
  let queues: Map<Id, Map<number, HallQueue>> = new Map();

  /** The waiting sims are indexed once per world minute, not once per pointer move. */
  function queuesOf(id: Id): ReadonlyMap<number, HallQueue> | undefined {
    const world = game.world;
    if (world !== queueWorld || world.time.minute !== queueMinute) {
      queueWorld = world;
      queueMinute = world.time.minute;
      queues = hallQueues(world);
    }
    return queues.get(id);
  }

  function target(): HoverTarget | null {
    const tool = game.getTool();
    if (tool.kind !== 'none' && tool.kind !== 'query') return null; // the ghost and its chip own the pointer
    const world = game.world;
    if (touch) {
      const sel = game.getSelection();
      if (sel?.shaftId !== undefined) {
        const shaft = world.shafts.get(sel.shaftId);
        return shaft ? { kind: 'shaft', shaft } : null;
      }
      if (sel?.roomId !== undefined) {
        const room = world.rooms.get(sel.roomId);
        return room ? { kind: 'room', room } : null;
      }
      return null;
    }
    const hover = game.getHover();
    return hover ? hoverTargetAt(world, hover.floor, hover.x) : null;
  }

  function show(on: boolean): void {
    if (on === shown) return;
    shown = on;
    node.classList.toggle('is-hidden', !on);
    cardSize = null; // hidden, it measured nothing; shown again, measure once
    placedKey = '';
  }

  function render(content: CardContent): void {
    const nextShape = `${content.title}|${content.rows.length}`;
    if (nextShape !== shape) {
      shape = nextShape;
      cardSize = null;
      setText(title, content.title);
      rowNodes = content.rows.map(() => ({ label: h('dt', 'hs-hover-label'), value: h('dd', 'hs-hover-value') }));
      list.replaceChildren(...rowNodes.flatMap((r) => [r.label, r.value]));
    }
    content.rows.forEach(([label, value], i) => {
      const row = rowNodes[i];
      if (!row) return;
      setText(row.label, label);
      setText(row.value, value);
    });
  }

  function position(): void {
    if (!shown || !point) return;
    if (!viewSize) {
      const box = shell.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      viewSize = { width: box.width, height: box.height };
    }
    if (!cardSize) {
      const box = node.getBoundingClientRect();
      cardSize = { width: box.width, height: box.height };
    }
    const at = hoverCardBox({ point, card: cardSize, view: viewSize, chrome: chrome() });
    const key = `${at.left},${at.top}`;
    if (key === placedKey) return;
    placedKey = key;
    node.style.left = `${at.left}px`;
    node.style.top = `${at.top}px`;
  }

  function update(): void {
    const found = point ? target() : null;
    if (!found) {
      show(false);
      return;
    }
    render(cardContent(game.world, found, queuesOf));
    show(true);
    position();
  }

  const onPointer = (event: PointerEvent): void => {
    const onTower = (event.target as Element | null)?.tagName === 'CANVAS';
    const finger = event.pointerType === 'touch' || event.pointerType === 'pen';
    if (finger) {
      // A finger that is only moving is panning, and a tap on the chrome is not about the
      // tower: the card waits for a tap that lands on the view.
      if (event.type === 'pointermove' || !onTower) return;
    }
    touch = finger;
    point = onTower ? { x: event.clientX, y: event.clientY } : null;
    // The game reads the tile on the canvas before the window hears the event, so a paused
    // game still gets a card that follows the pointer.
    update();
  };
  const onResize = (): void => {
    viewSize = null;
    cardSize = null;
    placedKey = '';
    position();
  };

  window.addEventListener('pointermove', onPointer);
  window.addEventListener('pointerup', onPointer);
  window.addEventListener('resize', onResize);
  const fonts = typeof document.fonts?.addEventListener === 'function' ? document.fonts : null;
  fonts?.addEventListener('loadingdone', onResize);

  return {
    node,
    update,
    destroy() {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerup', onPointer);
      window.removeEventListener('resize', onResize);
      fonts?.removeEventListener('loadingdone', onResize);
      node.remove();
    },
  };
}

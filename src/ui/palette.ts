// The build palette: a building directory board of tool tiles. Each tile shows the room's own
// art (a thumbnail the renderer cuts from its day texture), its name, footprint and cost, and,
// while it is locked, the stars it needs with a bar of how far there is to go.
//
// States: available, selected (aria-pressed, amber), locked (aria-disabled, still focusable so
// a keyboard can read why), unaffordable (the cost in the alert color with how much is short,
// still selectable so placement can explain it on the tower).

import type { Tool } from '../game/api';
import type { ThumbnailKind } from '../render/thumbnail';
import { ROOMS, SHAFTS } from '../sim/rules';
import type { RoomKind, ShaftKind, Star } from '../sim/types';
import { formatMoney } from './format';
import { icon, type IconName } from './icons';

/** The thumbnail box, in css pixels. */
export const THUMB_W = 72;
export const THUMB_H = 36;

export interface PaletteRow {
  node: HTMLButtonElement;
  thumb: HTMLCanvasElement | null;
  cost: HTMLSpanElement;
  short: HTMLSpanElement;
  progress: HTMLSpanElement;
  progressFill: HTMLSpanElement;
  tool: Tool;
  star: Star;
  label: string;
  /** The price in dollars, or null for a tool that costs nothing to pick up. */
  price: number | null;
  kind: ThumbnailKind | null;
}

export interface PaletteParts {
  rows: PaletteRow[];
  toggle: HTMLButtonElement;
  current: HTMLSpanElement;
  chevron: HTMLSpanElement;
}

export const GROUPS: { title: string; source: 'rooms' | 'shafts' | 'tools'; group?: string }[] = [
  { title: 'Structure', source: 'rooms', group: 'structure' },
  { title: 'Elevators', source: 'shafts' },
  { title: 'Residential', source: 'rooms', group: 'residential' },
  { title: 'Hotel', source: 'rooms', group: 'hotel' },
  { title: 'Commercial', source: 'rooms', group: 'commercial' },
  { title: 'Services', source: 'rooms', group: 'services' },
  { title: 'Tools', source: 'tools' },
];

export function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'room' && b.kind === 'room') return a.room === b.room;
  if (a.kind === 'shaft' && b.kind === 'shaft') return a.shaft === b.shaft;
  return true;
}

export function needsStars(star: Star): string {
  return star === 1 ? 'Needs 1 star' : `Needs ${star} stars`;
}

/** "9 tiles", "31 tiles, 2 floors", "4 tiles, up to 30 floors", "6 tiles, any height". */
export function footprintText(kind: ThumbnailKind): string {
  const tiles = (n: number): string => (n === 1 ? '1 tile' : `${n} tiles`);
  if (kind in SHAFTS) {
    const rule = SHAFTS[kind as ShaftKind];
    return rule.maxSpan === null ? `${tiles(rule.width)}, any height` : `${tiles(rule.width)}, up to ${rule.maxSpan} floors`;
  }
  const rule = ROOMS[kind as RoomKind];
  return rule.height > 1 ? `${tiles(rule.width)}, ${rule.height} floors` : tiles(rule.width);
}

export interface ToolRowState {
  locked: boolean;
  selected: boolean;
  /** Dollars short of the price, or 0 when it is affordable (or free, or locked). */
  short: number;
  costText: string;
  shortText: string;
  /** Stars now over stars needed, only while locked. */
  progress: { value: number; max: number } | null;
}

/** What a tile shows for this world and this tool in hand. Pure, so the states are testable. */
export function toolRowState(
  row: Pick<PaletteRow, 'star' | 'price' | 'tool'>,
  world: { stars: number; cash: number },
  held: Tool,
): ToolRowState {
  const locked = world.stars < row.star;
  const selected = !locked && sameTool(row.tool, held);
  const short = !locked && row.price !== null && row.price > world.cash ? row.price - world.cash : 0;
  return {
    locked,
    selected,
    short,
    costText: locked ? needsStars(row.star) : row.price === null ? '' : formatMoney(row.price),
    shortText: short > 0 ? `Short ${formatMoney(short)}` : '',
    progress: locked ? { value: Math.max(0, Math.min(world.stars, row.star)), max: row.star } : null,
  };
}

/** Where a source of sw by sh lands, centred and whole-pixel, in a box of bw by bh. */
export function fitRect(sw: number, sh: number, bw: number, bh: number): { x: number; y: number; w: number; h: number } {
  if (sw <= 0 || sh <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(bw / sw, bh / sh);
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  return { x: Math.floor((bw - w) / 2), y: Math.floor((bh - h) / 2), w, h };
}

/**
 * Draw a thumbnail into a tile's canvas at the device pixel ratio, nearest neighbour, fitted
 * and centred. False when there is nothing to draw with (no 2d context, as in the tests).
 */
export function paintThumbnail(target: HTMLCanvasElement, source: HTMLCanvasElement, dpr: number): boolean {
  const ratio = Math.max(1, Math.min(3, Math.round(dpr || 1)));
  const bw = THUMB_W * ratio;
  const bh = THUMB_H * ratio;
  const context = typeof target.getContext === 'function' ? target.getContext('2d') : null;
  if (!context) return false;
  if (target.width !== bw) target.width = bw;
  if (target.height !== bh) target.height = bh;
  context.clearRect(0, 0, bw, bh);
  context.imageSmoothingEnabled = false;
  const box = fitRect(source.width, source.height, bw, bh);
  if (box.w > 0) context.drawImage(source, box.x, box.y, box.w, box.h);
  return true;
}

/**
 * Fill the palette: a header row that folds the board away, then a group title and a tile per
 * tool. The header is the whole board when it is collapsed, so it carries the tool in hand.
 */
export function buildPalette(palette: HTMLElement, onPick: (row: PaletteRow) => void, onToggle: () => void): PaletteParts {
  const current = el('span', 'hs-palette-current');
  const chevron = el('span', 'hs-palette-chevron', '▾');
  chevron.setAttribute('aria-hidden', 'true');
  const toggle = el('button', 'hs-palette-toggle');
  toggle.type = 'button';
  toggle.addEventListener('click', onToggle);
  toggle.replaceChildren(el('span', 'hs-palette-title', 'Build'), current, chevron);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.title = 'Show or hide the build tools';
  palette.append(toggle);

  const rows: PaletteRow[] = [];
  for (const group of GROUPS) {
    palette.append(el('h2', 'hs-group-title', group.title));
    if (group.source === 'rooms') {
      for (const kind of Object.keys(ROOMS) as RoomKind[]) {
        const rule = ROOMS[kind];
        if (rule.group !== group.group) continue;
        rows.push(addRow(palette, rule.label, footprintText(kind), rule.cost, rule.star, { kind: 'room', room: kind }, kind, null, onPick));
      }
    } else if (group.source === 'shafts') {
      for (const kind of Object.keys(SHAFTS) as ShaftKind[]) {
        const rule = SHAFTS[kind];
        rows.push(addRow(palette, rule.label, footprintText(kind), rule.shaftCost, rule.star, { kind: 'shaft', shaft: kind }, kind, null, onPick));
      }
    } else {
      rows.push(addRow(palette, 'Demolish', 'Removes what you click', null, 1, { kind: 'demolish' }, null, 'demolish', onPick));
      rows.push(addRow(palette, 'Query', 'Shows what you click', null, 1, { kind: 'query' }, null, 'query', onPick));
    }
  }
  return { rows, toggle, current, chevron };
}

function addRow(
  palette: HTMLElement,
  label: string,
  footprint: string,
  price: number | null,
  star: Star,
  tool: Tool,
  kind: ThumbnailKind | null,
  glyph: IconName | null,
  onPick: (row: PaletteRow) => void,
): PaletteRow {
  const node = el('button', 'hs-tool');
  node.type = 'button';
  node.setAttribute('aria-pressed', 'false');

  let thumb: HTMLCanvasElement | null = null;
  if (kind) {
    thumb = el('canvas', 'hs-tool-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    node.append(thumb);
  } else {
    const box = el('span', 'hs-tool-thumb is-icon');
    box.setAttribute('aria-hidden', 'true');
    if (glyph) box.append(icon(glyph, 'hs-tool-icon') as unknown as HTMLElement);
    node.append(box);
  }

  const text = el('span', 'hs-tool-text');
  text.append(el('span', 'hs-tool-name', label), el('span', 'hs-tool-footprint', footprint));
  const costLine = el('span', 'hs-tool-costline');
  const cost = el('span', 'hs-tool-cost', price === null ? '' : formatMoney(price));
  const short = el('span', 'hs-tool-short');
  costLine.append(cost, short);
  const progress = el('span', 'hs-tool-progress');
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  const progressFill = el('span', 'hs-tool-progress-fill');
  progress.append(progressFill);
  node.append(text, costLine, progress);
  palette.append(node);

  const row: PaletteRow = { node, thumb, cost, short, progress, progressFill, tool, star, label, price, kind };
  node.addEventListener('click', () => onPick(row));
  return row;
}

/** Write a tile's state, touching only what changed. */
export function applyRowState(row: PaletteRow, state: ToolRowState): void {
  setAttr(row.node, 'aria-disabled', state.locked ? 'true' : 'false');
  setAttr(row.node, 'aria-pressed', state.selected ? 'true' : 'false');
  row.node.classList.toggle('is-locked', state.locked);
  row.node.classList.toggle('is-active', state.selected);
  row.node.classList.toggle('is-short', state.short > 0);
  setText(row.cost, state.costText);
  setText(row.short, state.shortText);
  const title = state.locked ? `${row.label}: ${state.costText.toLowerCase()}` : state.short > 0 ? `${row.label}: ${state.shortText.toLowerCase()}` : row.label;
  if (row.node.title !== title) row.node.title = title;
  row.progress.hidden = state.progress === null;
  if (state.progress) {
    const { value, max } = state.progress;
    setAttr(row.progress, 'aria-valuenow', String(value));
    setAttr(row.progress, 'aria-valuemax', String(max));
    setAttr(row.progress, 'aria-label', `Stars ${value} of ${max}`);
    const width = `${Math.round((value / max) * 100)}%`;
    if (row.progressFill.style.width !== width) row.progressFill.style.width = width;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

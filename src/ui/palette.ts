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
import { assignLetters, keysLabel } from './keys';

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
  /** Index into GROUPS; the number key is one more. */
  group: number;
  /** The letter that picks this tile once its group is active; the tile shows it. */
  letter: string;
}

export interface PaletteParts {
  rows: PaletteRow[];
  toggle: HTMLButtonElement;
  current: HTMLSpanElement;
  chevron: HTMLSpanElement;
  /** The category tabs, one per group, in GROUPS order. */
  tabList: HTMLDivElement;
  tabs: HTMLButtonElement[];
  /** The group titles and the tiles, which the dock shows one category of at a time. */
  items: HTMLDivElement;
  titles: HTMLElement[];
}

export const GROUPS: { title: string; source: 'rooms' | 'shafts' | 'tools'; group?: string; icon: IconName }[] = [
  { title: 'Structure', source: 'rooms', group: 'structure', icon: 'structure' },
  { title: 'Elevators', source: 'shafts', icon: 'elevator' },
  { title: 'Homes', source: 'rooms', group: 'residential', icon: 'home' },
  { title: 'Hotel', source: 'rooms', group: 'hotel', icon: 'hotel' },
  { title: 'Shops and fun', source: 'rooms', group: 'commercial', icon: 'shop' },
  { title: 'Services', source: 'rooms', group: 'services', icon: 'services' },
  { title: 'Tools', source: 'tools', icon: 'tools' },
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
 * Draw a thumbnail into a tile's canvas at the device pixel ratio, fitted and centred. The
 * source is the illustrated room (package 8b), several times the tile's size, so it is scaled
 * down smoothly rather than by dropping pixels. False when there is nothing to draw with (no 2d
 * context, as in the tests).
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
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  const box = fitRect(source.width, source.height, bw, bh);
  if (box.w > 0) context.drawImage(source, box.x, box.y, box.w, box.h);
  return true;
}

/**
 * Fill the palette: a header row that folds the board down to its icons, the category tabs,
 * then a group title and a picture-first tile per tool. The header carries the tool in hand.
 */
export function buildPalette(
  palette: HTMLElement,
  onPick: (row: PaletteRow) => void,
  onToggle: () => void,
  onTab: (group: number) => void = () => {},
): PaletteParts {
  const current = el('span', 'hs-palette-current');
  const chevron = el('span', 'hs-palette-chevron', '▾');
  chevron.setAttribute('aria-hidden', 'true');
  const toggle = el('button', 'hs-palette-toggle');
  toggle.type = 'button';
  toggle.addEventListener('click', onToggle);
  const buildIcon = icon('build', 'hs-icon hs-palette-icon') as unknown as HTMLElement;
  toggle.replaceChildren(buildIcon, el('span', 'hs-palette-title', 'Build'), current, chevron);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.title = 'Show or hide the build tools';
  palette.append(toggle);

  // The category tabs: an icon each, the name beside it where there is room and always in the
  // aria-label. Every tab takes Tab, so a keyboard reaches each one without arrow keys.
  const tabList = el('div', 'hs-build-tabs');
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Build categories');
  const tabs = GROUPS.map((group, groupIndex) => {
    const tab = el('button', 'hs-build-tab');
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', groupIndex === 0 ? 'true' : 'false');
    tab.setAttribute('aria-label', group.title);
    tab.title = `${group.title} (key ${groupIndex + 1})`;
    tab.dataset['group'] = String(groupIndex);
    tab.append(icon(group.icon, 'hs-icon hs-build-tab-icon') as unknown as HTMLElement, el('span', 'hs-build-tab-label', group.title));
    tab.addEventListener('click', () => onTab(groupIndex));
    tabList.append(tab);
    return tab;
  });
  palette.append(tabList);

  const items = el('div', 'hs-build-items');
  palette.append(items);
  const titles: HTMLElement[] = [];
  const rows: PaletteRow[] = [];
  GROUPS.forEach((group, groupIndex) => {
    const title = el('h2', 'hs-group-title');
    const number = el('span', 'hs-group-key', String(groupIndex + 1));
    number.setAttribute('aria-hidden', 'true');
    title.append(number, el('span', 'hs-group-name', group.title));
    title.dataset['group'] = String(groupIndex);
    titles.push(title);
    items.append(title);
    const specs: RowSpec[] = [];
    if (group.source === 'rooms') {
      for (const kind of Object.keys(ROOMS) as RoomKind[]) {
        const rule = ROOMS[kind];
        if (rule.group !== group.group) continue;
        specs.push({ label: rule.label, footprint: footprintText(kind), price: rule.cost, star: rule.star, tool: { kind: 'room', room: kind }, kind, glyph: null });
      }
    } else if (group.source === 'shafts') {
      for (const kind of Object.keys(SHAFTS) as ShaftKind[]) {
        const rule = SHAFTS[kind];
        specs.push({ label: rule.label, footprint: footprintText(kind), price: rule.shaftCost, star: rule.star, tool: { kind: 'shaft', shaft: kind }, kind, glyph: null });
      }
    } else {
      specs.push({ label: 'Demolish', footprint: 'Removes what you click', price: null, star: 1, tool: { kind: 'demolish' }, kind: null, glyph: 'demolish' });
      specs.push({ label: 'Look', footprint: 'Shows what you click', price: null, star: 1, tool: { kind: 'query' }, kind: null, glyph: 'query' });
    }
    const letters = assignLetters(specs.map((spec) => spec.label));
    specs.forEach((spec, i) => rows.push(addRow(items, spec, groupIndex, letters[i] ?? '', onPick)));
  });
  return { rows, toggle, current, chevron, tabList, tabs, items, titles };
}

interface RowSpec {
  label: string;
  footprint: string;
  price: number | null;
  star: Star;
  tool: Tool;
  kind: ThumbnailKind | null;
  glyph: IconName | null;
}

function addRow(host: HTMLElement, spec: RowSpec, group: number, letter: string, onPick: (row: PaletteRow) => void): PaletteRow {
  const { label, footprint, price, star, tool, kind, glyph } = spec;
  const node = el('button', 'hs-tool');
  node.type = 'button';
  node.setAttribute('aria-pressed', 'false');

  node.dataset['group'] = String(group);

  // Picture first: the art (or the tool's icon), and on it, while locked, a lock and the stars
  // it needs. The words say the same in the cost line, so the badge is hidden from a reader.
  const pic = el('span', 'hs-tool-pic');
  pic.setAttribute('aria-hidden', 'true');
  let thumb: HTMLCanvasElement | null = null;
  if (kind) {
    thumb = el('canvas', 'hs-tool-thumb');
    thumb.setAttribute('aria-hidden', 'true');
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    pic.append(thumb);
  } else {
    const box = el('span', 'hs-tool-thumb is-icon');
    box.setAttribute('aria-hidden', 'true');
    if (glyph) box.append(icon(glyph, 'hs-tool-icon') as unknown as HTMLElement);
    pic.append(box);
  }
  const lock = el('span', 'hs-tool-lock');
  // The count is drawn from the attribute (ui.css), so the tile's own text stays its name first.
  const count = el('span', 'hs-tool-lock-count');
  count.dataset['stars'] = String(star);
  lock.append(
    icon('lock', 'hs-icon hs-tool-lock-icon') as unknown as HTMLElement,
    count,
    icon('star', 'hs-icon hs-tool-lock-star') as unknown as HTMLElement,
  );
  pic.append(lock);
  node.append(pic);

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
  if (letter) {
    const key = el('span', 'hs-tool-key', letter);
    key.setAttribute('aria-hidden', 'true'); // the title and aria-keyshortcuts say it in words
    node.append(key);
    node.setAttribute('aria-keyshortcuts', `${group + 1} ${letter}`);
  }
  host.append(node);

  const row: PaletteRow = { node, thumb, cost, short, progress, progressFill, tool, star, label, price, kind, group, letter };
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
  const title = tileTitle(row, state);
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

/** A tile's tooltip: its name, why it cannot be had right now if so, and its keys. */
export function tileTitle(row: Pick<PaletteRow, 'label' | 'group' | 'letter'>, state: Pick<ToolRowState, 'locked' | 'short' | 'costText' | 'shortText'>): string {
  const base = state.locked ? `${row.label}: ${state.costText.toLowerCase()}` : state.short > 0 ? `${row.label}: ${state.shortText.toLowerCase()}` : row.label;
  return `${base} (keys ${keysLabel(row.group, row.letter)})`;
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

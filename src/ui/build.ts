// The build dock and the build sheet around the palette tiles (src/ui/palette.ts).
//
// Desktop: a floating dock on the left. Category tabs, then the picture-first tiles of the one
// category picked. It folds down to its icons (ui.ts owns that choice, it is remembered).
//
// Phone: nothing until the round Build button in the bottom right corner, which never moves.
// It opens a bottom sheet: the category row and a sideways row of tiles. Drag up for the full
// grid, swipe down to close. With a tool in hand the sheet shrinks to a small bar that names
// the item and its cost, with Cancel. Nothing here is remembered: every load starts closed.
//
// The DOM work is plain enough for tests/ui/fake-dom.ts.

import { formatMoney } from './format';
import { icon } from './icons';
import { GROUPS, THUMB_H, THUMB_W, type PaletteParts, type PaletteRow } from './palette';
import { snapAfterDrag } from './sheet';

/** The phone sheet: shut, the one row of tiles, the full grid, or the small bar while placing. */
export type BuildSheet = 'closed' | 'row' | 'full' | 'placing';

/** The phone layout runs up to this width (the same break as ui.css). */
export const PHONE_MAX_WIDTH = 720;

/** A window this wide gets the phone's Build button and sheet. Unknown widths are not phones. */
export function isPhoneWidth(width: number | undefined): boolean {
  return typeof width === 'number' && Number.isFinite(width) && width > 0 && width <= PHONE_MAX_WIDTH;
}

/**
 * Where a drag on the open sheet ends: up opens the full grid, down steps back to the row and
 * then closes. The same distances and flick speed as the panel sheets (src/ui/sheet.ts).
 */
export function sheetAfterDrag(from: 'row' | 'full', dy: number, speed: number): 'closed' | 'row' | 'full' {
  const next = snapAfterDrag(from === 'row' ? 'half' : 'full', dy, speed);
  return next === 'closed' ? 'closed' : next === 'half' ? 'row' : 'full';
}

/**
 * The next sheet when the tool in hand changes. A tool just picked up on a phone shrinks the
 * sheet to the placing bar; a tool put down (Cancel, Escape, a key) brings the row back. The
 * Build button can still open the tiles over a tool in hand: that stays open until a new pick.
 */
export function sheetForTool(sheet: BuildSheet, holding: boolean, picked = false): BuildSheet {
  if (holding && (picked || sheet === 'closed' || sheet === 'placing')) return 'placing';
  if (!holding && sheet === 'placing') return 'row';
  return sheet;
}

/** The Build button: open, or close again, or bring the tiles back over the placing bar. */
export function sheetAfterFab(sheet: BuildSheet): BuildSheet {
  return sheet === 'closed' || sheet === 'placing' ? 'row' : 'closed';
}

export interface BuildDockOptions {
  palette: HTMLElement;
  parts: PaletteParts;
  /** True while the phone layout is on. */
  isPhone(): boolean;
  /** Put the tool down (the placing bar's Cancel). */
  cancel(): void;
  /** The sheet or the category changed: measure the chrome again, draw thumbnails. */
  changed(): void;
}

export interface BuildDock {
  /** The round Build button, bottom right on a phone. */
  fab: HTMLButtonElement;
  /** The small bar the phone sheet shrinks to while a tool is in hand. */
  placeBar: HTMLDivElement;
  category(): number;
  setCategory(group: number): void;
  sheet(): BuildSheet;
  /** Open the phone sheet (a no-op on a wide screen, where the dock is always there). */
  open(to?: 'row' | 'full'): void;
  close(): void;
  /** What is in hand now, so the phone sheet and its bar follow it. */
  sync(held: PaletteRow | null): void;
  /** Escape closes an open phone sheet. True when the key was used. */
  handleKey(event: { key: string; preventDefault(): void; defaultPrevented?: boolean }): boolean;
}

export function createBuildDock(options: BuildDockOptions): BuildDock {
  const { palette, parts } = options;
  let category = 0;
  let sheet: BuildSheet = 'closed';
  let heldRow: PaletteRow | null = null;

  // The grab handle: the phone sheet's first row. A tap toggles the row and the full grid.
  const handle = el('button', 'hs-build-handle');
  handle.type = 'button';
  palette.prepend(handle);

  // The placing bar: the item's picture, its name and cost, and Cancel.
  const placeBar = el('div', 'hs-build-placing');
  placeBar.setAttribute('role', 'group');
  placeBar.setAttribute('aria-label', 'Placing');
  const placePic = el('canvas', 'hs-build-placing-pic');
  placePic.width = THUMB_W;
  placePic.height = THUMB_H;
  placePic.setAttribute('aria-hidden', 'true');
  const placeName = el('span', 'hs-build-placing-name');
  const placeCost = el('span', 'hs-build-placing-cost');
  const placeText = el('span', 'hs-build-placing-text');
  placeText.append(placeName, placeCost);
  const placeCancel = el('button', 'hs-btn hs-build-placing-cancel', 'Cancel');
  placeCancel.type = 'button';
  placeCancel.setAttribute('aria-label', 'Cancel, put this back');
  placeCancel.addEventListener('click', () => options.cancel());
  placeBar.append(placePic, placeText, placeCancel);
  palette.append(placeBar);

  const fab = el('button', 'hs-build-fab');
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Build');
  fab.title = 'Build';
  fab.append(icon('build', 'hs-icon hs-build-fab-icon') as unknown as HTMLElement, el('span', 'hs-build-fab-label', 'Build'));
  fab.addEventListener('click', () => {
    const wasOpen = sheet === 'row' || sheet === 'full';
    setSheet(sheetAfterFab(sheet));
    if (!wasOpen && (sheet === 'row' || sheet === 'full')) focusTab();
  });

  handle.addEventListener('click', () => {
    if (swallowClick) return;
    if (sheet === 'row') setSheet('full');
    else if (sheet === 'full') setSheet('row');
  });

  // Drag: anywhere on the open sheet but the tiles of the full grid, which scroll up and down.
  let drag: { y: number; t: number; lastT: number; id: number } | null = null;
  let swallowClick = false;
  palette.addEventListener('pointerdown', (event: Event) => {
    const e = event as PointerEvent;
    if (!options.isPhone() || (sheet !== 'row' && sheet !== 'full')) return;
    if (sheet === 'full' && contains(parts.items, e.target)) return;
    drag = { y: e.clientY, t: e.timeStamp, lastT: e.timeStamp, id: e.pointerId };
    swallowClick = false;
  });
  palette.addEventListener('pointermove', (event: Event) => {
    const e = event as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    drag.lastT = e.timeStamp;
    const dy = e.clientY - drag.y;
    palette.style.setProperty('--sheet-drag', `${Math.round(dy > 0 ? dy : dy / 4)}px`);
  });
  const endDrag = (event: Event): void => {
    const e = event as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const dt = Math.max(1, e.timeStamp - drag.t);
    const speed = e.timeStamp - drag.lastT < 80 ? dy / dt : 0;
    drag = null;
    palette.style.setProperty('--sheet-drag', '0px');
    if (Math.abs(dy) < 6 || (sheet !== 'row' && sheet !== 'full')) return;
    swallowClick = true; // the release also clicks whatever it ended on; that is not a pick
    setSheet(sheetAfterDrag(sheet, dy, speed));
  };
  palette.addEventListener('pointerup', endDrag);
  palette.addEventListener('pointercancel', () => {
    drag = null;
    palette.style.setProperty('--sheet-drag', '0px');
  });
  // A drag's closing click is swallowed before any tile hears it.
  palette.addEventListener(
    'click',
    (event: Event) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    },
    { capture: true },
  );

  function setSheet(next: BuildSheet): void {
    if (next === sheet) return;
    const hadFocus = contains(palette, activeElement());
    sheet = next;
    paint();
    // Closing with focus inside hands it to the Build button, not to the page.
    if (next === 'closed' && hadFocus) (fab as { focus?: () => void }).focus?.();
    options.changed();
  }

  function focusTab(): void {
    (parts.tabs[category] as { focus?: () => void } | undefined)?.focus?.();
  }

  function paint(): void {
    for (const state of ['closed', 'row', 'full', 'placing'] as const) palette.classList.toggle(`is-sheet-${state}`, sheet === state);
    const open = sheet === 'row' || sheet === 'full';
    setAttr(fab, 'aria-expanded', open ? 'true' : 'false');
    const label = open ? 'Close build' : 'Build';
    setAttr(fab, 'aria-label', label);
    fab.title = label;
    setAttr(handle, 'aria-label', sheet === 'full' ? 'Show one row' : 'Show every tile');
    handle.title = sheet === 'full' ? 'Drag down for one row, or to close' : 'Drag up for every tile, or down to close';
    parts.tabs.forEach((tab, i) => setAttr(tab, 'aria-selected', i === category ? 'true' : 'false'));
    for (const title of parts.titles) title.classList.toggle('is-other', Number(title.dataset['group']) !== category);
    for (const row of parts.rows) row.node.classList.toggle('is-other', row.group !== category);
    palette.dataset['category'] = String(category);
  }

  function paintPlacing(): void {
    if (!heldRow) return;
    setText(placeName, heldRow.label);
    setText(placeCost, heldRow.price === null ? '' : formatMoney(heldRow.price));
    const source = heldRow.thumb;
    const context = typeof placePic.getContext === 'function' ? placePic.getContext('2d') : null;
    if (!context) return;
    context.clearRect(0, 0, placePic.width, placePic.height);
    if (source && source.width > 0) {
      placePic.width = source.width;
      placePic.height = source.height;
      context.drawImage(source, 0, 0);
    }
  }

  paint();

  return {
    fab,
    placeBar,
    category: () => category,
    setCategory(group) {
      if (group < 0 || group >= GROUPS.length || group === category) return;
      category = group;
      paint();
      options.changed();
    },
    sheet: () => sheet,
    open(to = 'row') {
      if (!options.isPhone()) return;
      setSheet(to);
    },
    close() {
      setSheet('closed');
    },
    sync(held) {
      const picked = held !== null && held !== heldRow;
      if (held !== heldRow) {
        heldRow = held;
        paintPlacing();
      }
      // A wide screen has no sheet: the dock stays as it is while placing.
      if (!options.isPhone()) {
        if (sheet !== 'closed') setSheet('closed');
        return;
      }
      setSheet(sheetForTool(sheet, held !== null, picked));
    },
    handleKey(event) {
      if (event.defaultPrevented || event.key !== 'Escape') return false;
      if (sheet !== 'row' && sheet !== 'full') return false;
      event.preventDefault();
      setSheet(heldRow ? 'placing' : 'closed');
      return true;
    },
  };
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

function activeElement(): unknown {
  return typeof document === 'undefined' ? null : document.activeElement;
}

function contains(root: unknown, node: unknown): boolean {
  const host = root as { contains?: (n: unknown) => boolean } | null;
  return !!node && typeof host?.contains === 'function' && host.contains(node);
}

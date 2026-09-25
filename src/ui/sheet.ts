// The one sheet and card every panel sits in.
//
// At 900 px wide and up it is a floating card on the right, over the tower. Below that it is a
// bottom sheet: a grab handle, a half and a full height, a drag or swipe down to close, and a
// backdrop that closes it on a tap. Either way it is a dialog titled by its own heading, Escape
// closes it, Tab stays inside it while focus is in it, and focus goes back where it came from
// when it closes. Motion lives in ui.css: a spring-like slide and fade, only a fade under
// reduced motion.
//
// The DOM work is plain enough for tests/ui/fake-dom.ts: children, attributes, listeners, focus.

import { icon, type IconName } from './icons';

export type SheetMode = 'card' | 'sheet';
export type SheetSnap = 'half' | 'full';

/** The card layout starts here; narrower screens get the bottom sheet. */
export const SHEET_CARD_MIN_WIDTH = 900;
/** A drag this far changes the height one step: full to half, half to full. */
export const SHEET_SNAP_PX = 48;
/** A drag down this far from the half height closes the sheet. */
export const SHEET_CLOSE_PX = 96;
/** A flick at least this fast (px per ms) counts even when it was short. */
export const SHEET_FLICK_SPEED = 0.5;

/** Which layout a screen this wide gets. */
export function sheetMode(width: number): SheetMode {
  return Number.isFinite(width) && width >= SHEET_CARD_MIN_WIDTH ? 'card' : 'sheet';
}

/**
 * Where a drag on the handle ends. dy is how far the finger moved, down positive; speed is
 * its speed at the end in px per ms, down positive. A flick or a long drag down steps one
 * height down (full to half, half to closed); up goes to full.
 */
export function snapAfterDrag(from: SheetSnap, dy: number, speed: number): SheetSnap | 'closed' {
  const d = Number.isFinite(dy) ? dy : 0;
  const v = Number.isFinite(speed) ? speed : 0;
  const down = v >= SHEET_FLICK_SPEED || d >= (from === 'full' ? SHEET_SNAP_PX : SHEET_CLOSE_PX);
  const up = v <= -SHEET_FLICK_SPEED || d <= -SHEET_SNAP_PX;
  if (down && d > 0) return from === 'full' ? 'half' : 'closed';
  if (up && d < 0) return 'full';
  return from;
}

export interface SheetOptions {
  title: string;
  /** The section icon before the title. */
  icon?: IconName;
  /**
   * Asked to close: Close, Escape, a backdrop tap or a swipe down. The owner takes it down with
   * unmount(). Without one, the sheet takes itself down.
   */
  onClose?: () => void;
  /** The Close button's words for a screen reader; "Close <title>" when left out. */
  closeLabel?: string;
  /** Extra classes on the dialog, e.g. hs-panel. */
  className?: string;
}

export interface SheetMountOptions {
  /** Where focus goes on close, when not where it was at mount (a panel rebuilt in place). */
  returnFocus?: FocusTarget | null;
  /** Focus this focusable (by order) instead of the dialog itself. */
  focusIndex?: number;
}

export interface Sheet {
  /** The dialog: role dialog, labelled by its heading. The handle, the head and the body are inside. */
  readonly node: HTMLDivElement;
  readonly head: HTMLDivElement;
  readonly body: HTMLDivElement;
  /** The tap-to-close layer under a bottom sheet; not used by the card. */
  readonly backdrop: HTMLDivElement;
  readonly titleId: string;
  readonly isOpen: boolean;
  readonly mode: SheetMode;
  readonly snap: SheetSnap;
  /** Where focus goes back to on close. */
  readonly returnTarget: FocusTarget | null;
  mount(host: SheetHost, options?: SheetMountOptions): void;
  /** Take it down. Focus goes back unless told not to (a rebuild that keeps it). */
  unmount(options?: { restoreFocus?: boolean }): void;
  /** Close as a player would: through onClose when there is one. */
  requestClose(): void;
  setSnap(snap: SheetSnap): void;
  /** Escape and Tab. True when the key was the sheet's (and its default is prevented). */
  handleKey(event: KeyLike): boolean;
  /** Where focus is among the focusables, or -1 when it is not inside. */
  focusIndex(): number;
  /** Is focus on the dialog or anything in it? */
  hasFocus(): boolean;
}

/** Where a sheet mounts: its backdrop and then the dialog are appended. */
export interface SheetHost {
  append(node: HTMLElement): void;
}

/** Just what the sheet reads of a key event. */
export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault(): void;
}

/** Just what the sheet needs of an element to move focus to it. */
export interface FocusTarget {
  focus?: (options?: { preventScroll?: boolean }) => void;
  isConnected?: boolean;
}

interface TreeNode {
  tagName?: string;
  children?: ArrayLike<TreeNode>;
  hidden?: boolean;
  disabled?: boolean;
  getAttribute?(name: string): string | null;
  getClientRects?(): { length: number };
  focus?: (options?: { preventScroll?: boolean }) => void;
}

const NATIVE_FOCUSABLE = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);

/** Every element Tab can reach inside root, in order. Hidden ones (attribute or no box) are skipped. */
export function focusablesIn(root: unknown): HTMLElement[] {
  const out: HTMLElement[] = [];
  const walk = (node: TreeNode): void => {
    const kids = node.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      if (!child || child.hidden) continue;
      if (typeof child.getClientRects === 'function' && child.getClientRects().length === 0) continue;
      const tag = (child.tagName ?? '').toUpperCase();
      const tabindex = child.getAttribute?.('tabindex');
      const reachable =
        tabindex !== null && tabindex !== undefined
          ? Number(tabindex) >= 0
          : (NATIVE_FOCUSABLE.has(tag) && !child.disabled) || (tag === 'A' && child.getAttribute?.('href') != null);
      if (reachable && typeof child.focus === 'function') out.push(child as unknown as HTMLElement);
      walk(child);
    }
  };
  walk(root as TreeNode);
  return out;
}

function activeElement(): unknown {
  return typeof document === 'undefined' ? null : ((document as { activeElement?: unknown }).activeElement ?? null);
}

function contains(root: unknown, node: unknown): boolean {
  if (!node) return false;
  const r = root as { contains?: (n: unknown) => boolean };
  return typeof r.contains === 'function' ? r.contains(node) : false;
}

function focus(target: FocusTarget | null | undefined): void {
  target?.focus?.({ preventScroll: true });
}

/** The layout for the screen as it is now. A browser that will not say is treated as a phone. */
function currentMode(): SheetMode {
  if (typeof window === 'undefined') return 'sheet';
  const width = (window as { innerWidth?: number }).innerWidth;
  if (typeof width === 'number' && width > 0) return sheetMode(width);
  try {
    return window.matchMedia(`(min-width: ${SHEET_CARD_MIN_WIDTH}px)`).matches ? 'card' : 'sheet';
  } catch {
    return 'sheet';
  }
}

let sheetIds = 0;

export function createSheet(options: SheetOptions): Sheet {
  const titleId = `hs-sheet-title-${++sheetIds}`;
  const node = document.createElement('div') as HTMLDivElement;
  node.className = `hs-sheet${options.className ? ` ${options.className}` : ''}`;
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-labelledby', titleId);
  node.setAttribute('tabindex', '-1');

  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'hs-sheet-handle';

  const head = document.createElement('div') as HTMLDivElement;
  head.className = 'hs-panel-head';
  const name = document.createElement('h2');
  name.className = 'hs-panel-title';
  name.id = titleId;
  if (options.icon) name.append(icon(options.icon, 'hs-panel-icon') as unknown as HTMLElement);
  const nameText = document.createElement('span');
  nameText.className = 'hs-panel-title-text';
  nameText.textContent = options.title;
  name.append(nameText);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'hs-btn hs-panel-close';
  close.textContent = 'Close';
  close.setAttribute('aria-label', options.closeLabel ?? `Close ${options.title.toLowerCase()}`);
  head.append(name, close);

  const body = document.createElement('div') as HTMLDivElement;
  body.className = 'hs-panel-body';
  node.append(handle, head, body);

  const backdrop = document.createElement('div') as HTMLDivElement;
  backdrop.className = 'hs-sheet-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');

  let open = false;
  let mode: SheetMode = 'sheet';
  let snap: SheetSnap = 'half';
  let returnTo: FocusTarget | null = null;
  let drag: { y: number; t: number; lastY: number; lastT: number; id: number } | null = null;
  /** A drag that ended on the handle also clicks it; that click is not a toggle. */
  let swallowClick = false;

  function paintSnap(): void {
    node.setAttribute('data-snap', snap);
    handle.setAttribute('aria-label', snap === 'half' ? 'Make this bigger' : 'Make this smaller');
    handle.title = snap === 'half' ? 'Drag up to make this bigger, or down to close' : 'Drag down to make this smaller';
  }

  function setSnap(next: SheetSnap): void {
    snap = next;
    paintSnap();
  }

  function requestClose(): void {
    if (options.onClose) options.onClose();
    else unmount();
  }

  function hasFocus(): boolean {
    const active = activeElement();
    return active === node || contains(node, active);
  }

  function handleKey(event: KeyLike): boolean {
    if (!open || event.defaultPrevented) return false;
    const inside = hasFocus();
    // A bottom sheet is modal: its keys are its own wherever focus is. A card only answers
    // while focus is in it, so the tower's own Escape (drop the tool) still works beside it.
    if (!inside && mode === 'card') return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      requestClose();
      return true;
    }
    if (event.key !== 'Tab') return false;
    const items = focusablesIn(node);
    event.preventDefault();
    if (items.length === 0) {
      focus(node);
      return true;
    }
    const active = activeElement();
    const at = items.indexOf(active as HTMLElement);
    const first = items[0];
    const last = items[items.length - 1];
    if (at < 0) focus(event.shiftKey ? last : first);
    else if (event.shiftKey) focus(at === 0 ? last : items[at - 1]);
    else focus(at === items.length - 1 ? first : items[at + 1]);
    return true;
  }

  const onKeyDown = (event: Event): void => {
    handleKey(event as unknown as KeyLike);
  };

  const onHandleClick = (): void => {
    if (swallowClick) {
      swallowClick = false;
      return;
    }
    setSnap(snap === 'half' ? 'full' : 'half');
  };

  // Drag: the handle and the head (not its buttons) follow a finger; the release snaps.
  const onPointerDown = (event: Event): void => {
    const e = event as PointerEvent;
    if (mode !== 'sheet') return;
    const target = e.target as { tagName?: string; closest?: (s: string) => unknown } | null;
    if (target !== handle && target?.closest?.('button') && target.closest('button') !== handle) return;
    drag = { y: e.clientY, t: e.timeStamp, lastY: e.clientY, lastT: e.timeStamp, id: e.pointerId };
    (e.currentTarget as { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(e.pointerId);
    node.classList.add('is-dragging');
  };
  const onPointerMove = (event: Event): void => {
    const e = event as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const dy = e.clientY - drag.y;
    // Down follows the finger; up stretches only a little, the snap does the rest.
    node.style.setProperty('--sheet-drag', `${Math.round(dy > 0 ? dy : dy / 4)}px`);
  };
  const onPointerUp = (event: Event): void => {
    const e = event as PointerEvent;
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    const dt = Math.max(1, e.timeStamp - drag.t);
    const recent = Math.max(1, e.timeStamp - drag.lastT);
    const speed = recent < 80 ? dy / dt : 0;
    drag = null;
    node.classList.remove('is-dragging');
    node.style.setProperty('--sheet-drag', '0px');
    // A tap on the handle is its click (toggle); only a real drag snaps here.
    if (Math.abs(dy) < 6) return;
    swallowClick = e.currentTarget === handle;
    const next = snapAfterDrag(snap, dy, speed);
    if (next === 'closed') requestClose();
    else setSnap(next);
  };
  const onBackdrop = (): void => requestClose();

  close.addEventListener('click', () => requestClose());
  handle.addEventListener('click', onHandleClick);

  function mount(host: SheetHost, mountOptions: SheetMountOptions = {}): void {
    if (open) unmount({ restoreFocus: false });
    mode = currentMode();
    open = true;
    returnTo = mountOptions.returnFocus !== undefined ? mountOptions.returnFocus : (activeElement() as FocusTarget | null);
    node.setAttribute('data-mode', mode);
    if (mode === 'sheet') node.setAttribute('aria-modal', 'true');
    else node.removeAttribute('aria-modal');
    setSnap('half');
    if (mode === 'sheet') host.append(backdrop);
    host.append(node);
    node.addEventListener('keydown', onKeyDown);
    backdrop.addEventListener('click', onBackdrop);
    for (const grip of [handle, head]) {
      grip.addEventListener('pointerdown', onPointerDown);
      grip.addEventListener('pointermove', onPointerMove);
      grip.addEventListener('pointerup', onPointerUp);
      grip.addEventListener('pointercancel', onPointerUp);
    }
    const index = mountOptions.focusIndex ?? -1;
    const target = index >= 0 ? focusablesIn(node)[index] : undefined;
    focus(target ?? node);
  }

  function unmount(unmountOptions: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    open = false;
    drag = null;
    node.removeEventListener('keydown', onKeyDown);
    backdrop.removeEventListener('click', onBackdrop);
    for (const grip of [handle, head]) {
      grip.removeEventListener('pointerdown', onPointerDown);
      grip.removeEventListener('pointermove', onPointerMove);
      grip.removeEventListener('pointerup', onPointerUp);
      grip.removeEventListener('pointercancel', onPointerUp);
    }
    const hadFocus = hasFocus();
    node.remove();
    backdrop.remove();
    const back = returnTo;
    returnTo = null;
    // Back where focus came from, if it is still on the page; a rebuild keeps it for the next one.
    if (unmountOptions.restoreFocus !== false && (hadFocus || activeElement() === null || activeElement() === document.body)) {
      if (back && back.isConnected !== false) focus(back);
    }
  }

  paintSnap();

  return {
    node,
    head,
    body,
    backdrop,
    titleId,
    get isOpen() {
      return open;
    },
    get mode() {
      return mode;
    },
    get snap() {
      return snap;
    },
    get returnTarget() {
      return returnTo;
    },
    mount,
    unmount,
    requestClose,
    setSnap,
    handleKey,
    hasFocus,
    focusIndex() {
      const items = focusablesIn(node);
      return items.indexOf(activeElement() as HTMLElement);
    },
  };
}

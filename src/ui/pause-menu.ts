// The pause menu: a card in the middle of the screen over the dimmed tower, opened by the Menu
// button and by Escape with nothing else open (ui.ts). A title plate ("Hundred Stories", with
// "Paused" under it), then one column of large buttons, each an icon and a word.
//
// Opening it pauses the game and closing it puts back the speed the game had, so a game that was
// already paused stays paused. Should the game refuse the pause, the menu still opens and the
// plate reads "Menu" instead of "Paused". Settings is the one entry that keeps the menu: the menu
// steps out of sight (hide) while the Settings sheet is up and comes back when it closes (show).
//
// Keys come through ui.ts's keydown and keys.ts (menuKeyAction): Up and Down move and wrap, Home
// and End jump, Enter or Space chooses, Escape resumes, and focus never leaves the card. The
// selection follows the pointer too. It is a dialog, modal, named by its title.
//
// The DOM work is plain enough for tests/ui/fake-dom.ts: children, attributes, listeners, focus.

import type { Speed } from '../game/api';
import type { MenuCue } from '../audio/cues';
import { icon, type IconName } from './icons';
import { menuIndex, menuKeyAction } from './keys';

export const PAUSE_TITLE = 'Hundred Stories';
/** The line under the title while the game is held still. */
export const PAUSED_WORD = 'Paused';
/** The line under the title when the game would not pause. */
export const MENU_WORD = 'Menu';

/**
 * What choosing an entry does to the menu:
 * - resume: close it, the speed put back.
 * - stay: run with the menu open (Save).
 * - leave: close it, the speed put back, then run (My tower, Stories, ...).
 * - over: hide the menu, still paused, then run; the owner calls show() when that closes (Settings).
 * - link: a link (How to play); the browser follows it and the menu stays.
 */
export type PauseEntryKind = 'resume' | 'stay' | 'leave' | 'over' | 'link';

export interface PauseEntry {
  id: string;
  label: string;
  icon: IconName;
  kind: PauseEntryKind;
  run?: () => void;
  /** For a link: where it goes, and how (the same as the rest of the game links to it). */
  href?: string;
  target?: string;
  rel?: string;
  /** A tooltip, when the word needs one. */
  title?: string;
  /** For Save: paint its word ("Saved") as the save goes. */
  bind?: (item: { setWord(word: string): void; setBusy(busy: boolean): void }) => void;
}

export interface PauseMenuOptions {
  /** Where the menu mounts while it is on screen (the shell); it is taken out while not. */
  host: { append(node: HTMLElement): void };
  getSpeed(): Speed;
  setSpeed(speed: Speed): void;
  /** The entries, asked for at every open: they follow the tower in hand and the screen width. */
  entries(): PauseEntry[];
  /** A menu sound; the sound module keeps it silent while Sound is off. */
  cue?(name: MenuCue): void;
  /** Where focus goes when the menu closes: the Menu button. */
  returnFocus(): { focus?: (options?: { preventScroll?: boolean }) => void } | null;
  /** The menu opened, closed, hid or showed: the owner redraws. */
  changed?(): void;
}

/** Just what the menu reads of a key event. */
export interface PauseKeyLike {
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault(): void;
}

export interface PauseMenu {
  /** The scrim, with the card inside it. Mounted only while on screen: not while closed or under Settings. */
  readonly node: HTMLDivElement;
  readonly card: HTMLDivElement;
  /** Open, including while Settings is over it. */
  isOpen(): boolean;
  /** Open and on screen. */
  isShown(): boolean;
  /** Did opening it pause the game (the plate reads Paused)? */
  paused(): boolean;
  open(): void;
  /** Close, and put back the speed the game had before it opened. */
  close(options?: { restoreFocus?: boolean }): void;
  /** Back on screen after Settings closes, the selection where it was. */
  show(): void;
  /** The entries' words in order, for the tests and the gamepad. */
  items(): HTMLElement[];
  /** A key press while the menu is on screen. True when it was the menu's. */
  handleKey(event: PauseKeyLike): boolean;
  destroy(): void;
}

let menuIds = 0;

function activeElement(): unknown {
  return typeof document === 'undefined' ? null : ((document as { activeElement?: unknown }).activeElement ?? null);
}

export function createPauseMenu(options: PauseMenuOptions): PauseMenu {
  const titleId = `hs-pause-title-${++menuIds}`;
  const node = document.createElement('div') as HTMLDivElement;
  node.className = 'hs-pause';

  const card = document.createElement('div') as HTMLDivElement;
  card.className = 'hs-pause-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', titleId);

  const plate = document.createElement('div');
  plate.className = 'hs-pause-plate';
  const title = document.createElement('h2');
  title.className = 'hs-pause-title';
  title.id = titleId;
  title.textContent = PAUSE_TITLE;
  const state = document.createElement('p');
  state.className = 'hs-pause-state';
  state.textContent = PAUSED_WORD;
  plate.append(title, state);

  const list = document.createElement('div');
  list.className = 'hs-pause-list';
  card.append(plate, list);
  node.append(card);

  let open = false;
  let shown = false;
  let prior: Speed = 0;
  let wePaused = false;
  let selected = -1;
  let entries: PauseEntry[] = [];
  let buttons: HTMLElement[] = [];

  function select(index: number, focus: boolean): void {
    if (index < 0 || index >= buttons.length) return;
    selected = index;
    buttons.forEach((item, i) => item.classList.toggle('is-selected', i === index));
    if (focus) buttons[index]?.focus?.({ preventScroll: true });
  }

  function build(): void {
    entries = options.entries();
    buttons = entries.map((entry, index) => {
      const item = document.createElement(entry.kind === 'link' ? 'a' : 'button') as HTMLElement;
      item.className = 'hs-pause-item';
      if (entry.kind === 'link') {
        const link = item as HTMLAnchorElement;
        link.href = entry.href ?? '';
        if (entry.target) link.target = entry.target;
        if (entry.rel) link.rel = entry.rel;
      } else {
        (item as HTMLButtonElement).type = 'button';
      }
      item.dataset['entry'] = entry.id;
      if (entry.title) item.title = entry.title;
      const word = document.createElement('span');
      word.className = 'hs-pause-word';
      word.textContent = entry.label;
      item.append(icon(entry.icon, 'hs-icon hs-pause-icon') as unknown as HTMLElement, word);
      entry.bind?.({
        setWord(text) {
          word.textContent = text;
        },
        setBusy(busy) {
          if (item.tagName.toUpperCase() === 'BUTTON') item.setAttribute('aria-busy', busy ? 'true' : 'false');
        },
      });
      // The highlight follows the pointer as it follows the keys: one selection, never two.
      item.addEventListener('pointermove', () => {
        if (selected !== index) select(index, true);
      });
      item.addEventListener('focus', () => {
        if (selected !== index) select(index, false);
      });
      item.addEventListener('click', () => choose(index));
      return item;
    });
    list.replaceChildren(...buttons);
  }

  function choose(index: number): void {
    const entry = entries[index];
    if (!entry || !open) return;
    select(index, false);
    options.cue?.('menu.select');
    switch (entry.kind) {
      case 'resume':
        close();
        return;
      case 'stay':
        entry.run?.();
        return;
      case 'leave':
        // Focus goes back to Menu first, so a panel this opens returns it there when it closes.
        close();
        entry.run?.();
        return;
      case 'over':
        // Out of sight first, then what goes over it opens, then the owner redraws: in that order
        // the owner never sees the menu hidden with nothing over it.
        shown = false;
        node.remove();
        entry.run?.();
        options.changed?.();
        return;
      case 'link':
        // The link itself does the going, as it always has; the menu stays, the game still paused.
        entry.run?.();
        return;
    }
  }

  function paint(): void {
    state.textContent = wePaused || options.getSpeed() === 0 ? PAUSED_WORD : MENU_WORD;
    card.classList.toggle('is-running', state.textContent === MENU_WORD);
  }

  function openMenu(): void {
    if (open) return;
    prior = options.getSpeed();
    if (prior !== 0) options.setSpeed(0);
    wePaused = prior !== 0 && options.getSpeed() === 0;
    open = true;
    shown = true;
    build();
    paint();
    options.host.append(node);
    select(0, true);
    options.cue?.('menu.open');
    options.changed?.();
  }

  function close(closeOptions: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    open = false;
    shown = false;
    node.remove();
    // Put back what the game had, only if the menu paused it and it is still paused.
    if (wePaused && options.getSpeed() === 0) options.setSpeed(prior);
    wePaused = false;
    if (closeOptions.restoreFocus !== false) options.returnFocus()?.focus?.({ preventScroll: true });
    options.changed?.();
  }

  function show(): void {
    if (!open || shown) return;
    shown = true;
    options.host.append(node);
    paint();
    select(selected < 0 ? 0 : selected, true);
    options.changed?.();
  }

  function handleKey(event: PauseKeyLike): boolean {
    if (!shown || event.defaultPrevented) return false;
    const action = menuKeyAction(event);
    if (!action) return false;
    event.preventDefault();
    if (action.kind === 'resume') {
      close();
      return true;
    }
    if (action.kind === 'activate') {
      const at = buttons.indexOf(activeElement() as HTMLElement);
      const index = at >= 0 ? at : selected;
      const item = buttons[index];
      // A link is followed by the browser's own click, as a tap on it would be.
      if (item && entries[index]?.kind === 'link') item.click?.();
      else choose(index);
      return true;
    }
    const at = buttons.indexOf(activeElement() as HTMLElement);
    select(menuIndex(at >= 0 ? at : selected, buttons.length, action), true);
    return true;
  }

  // A tap on the dimmed tower around the card resumes, as Escape does.
  node.addEventListener('click', (event: Event) => {
    if ((event as { target?: unknown }).target === node) close();
  });

  return {
    node,
    card,
    isOpen: () => open,
    isShown: () => shown,
    paused: () => state.textContent === PAUSED_WORD,
    open: openMenu,
    close,
    show,
    items: () => buttons,
    handleKey,
    destroy() {
      open = false;
      shown = false;
      node.remove();
    },
  };
}

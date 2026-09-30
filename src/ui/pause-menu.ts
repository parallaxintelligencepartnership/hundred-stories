// The pause menu: a card in the middle of the screen over the dimmed tower, opened by the Menu
// button and by Escape with nothing else open (ui.ts). A title plate ("Hundred Stories", with
// "Paused" under it), then one column of large buttons, each an icon and a word. The plate and
// the raised faces are shared classes (hs-plate, hs-face in ui.css): the elevator card wears them too.
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
// The entry column scrolls when the card does not fit (a phone on its side): the plate stays put,
// and a selection moved by key or controller is scrolled into the column's view.
//
// A question (ask): the column trades its entries for one line and two answers, the safe answer
// selected, for an entry that cannot be undone (New tower) or a Save that would replace a saved
// tower that could not be opened. Escape, or B on a controller, answers with the safe one.
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
/** New tower (the third entry in My tower) asks this first: nothing brings the old tower back. */
export const NEW_TOWER_QUESTION = 'Start over? This replaces My tower.';
export const NEW_TOWER_YES = 'Start over';
export const NEW_TOWER_NO = 'Keep my tower';

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

/** One answer to a question the card asks. `close` closes the menu after it runs, the speed put back. */
export interface PauseAnswer {
  label: string;
  icon: IconName;
  run?: () => void;
  close: boolean;
}

/**
 * A question in the card: the line, then the answer that goes ahead and the answer that keeps
 * things as they are. The safe answer (`no`) is selected, and Escape chooses it.
 */
export interface PauseQuestion {
  /** For the tests and the page: data-question on the card while it asks. */
  id: string;
  text: string;
  yes: PauseAnswer;
  no: PauseAnswer;
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
  /** Ask a question in the card, in place of the entries. The menu must be open. */
  ask(question: PauseQuestion): void;
  /** The question being asked, or null. */
  asking(): PauseQuestion | null;
  /** Back out of a question with its safe answer, as Escape does. False when there was none. */
  cancel(): boolean;
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
  plate.className = 'hs-pause-plate hs-plate';
  const title = document.createElement('h2');
  title.className = 'hs-pause-title hs-plate-title';
  title.id = titleId;
  title.textContent = PAUSE_TITLE;
  const state = document.createElement('p');
  state.className = 'hs-pause-state hs-plate-state';
  state.textContent = PAUSED_WORD;
  plate.append(title, state);

  const list = document.createElement('div') as HTMLDivElement;
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
  let question: PauseQuestion | null = null;
  /**
   * The entries as they were when the question was asked, and the one it was asked from: put back
   * as they were (not built again, so Save's action and word carry on) when an answer keeps the menu.
   */
  let asked: { entries: PauseEntry[]; buttons: HTMLElement[]; from: number } | null = null;

  /**
   * Scroll the entry column so this entry is inside it: the least scroll that shows it whole. The
   * column scrolls only where the card does not fit; anywhere else nothing moves.
   */
  function reveal(item: HTMLElement | undefined): void {
    if (!item || typeof list.getBoundingClientRect !== 'function' || typeof item.getBoundingClientRect !== 'function') return;
    const box = list.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    if (!(box.height > 0)) return;
    const top = Number(list.scrollTop) || 0;
    if (at.top < box.top) list.scrollTop = Math.max(0, top - (box.top - at.top));
    else if (at.bottom > box.bottom) list.scrollTop = top + (at.bottom - box.bottom);
    syncMore();
  }

  /**
   * The column draws no scroll bar, so where entries sit past its edge the card fades that edge
   * (ui.css has-more, has-above): the one cue that Settings and How to play are further down on a
   * short screen (P6 review A7). Read from the column's own scroll numbers, after every move.
   */
  function syncMore(): void {
    const top = Number(list.scrollTop) || 0;
    const seen = Number(list.clientHeight) || 0;
    const whole = Number(list.scrollHeight) || 0;
    card.classList.toggle('has-more', seen > 0 && top + seen < whole - 1);
    card.classList.toggle('has-above', seen > 0 && top > 1);
  }
  list.addEventListener('scroll', syncMore);

  /** `scroll`: bring it into the column's view (keys, the controller, a Tab), not for a pointer on it. */
  function select(index: number, focus: boolean, scroll = focus): void {
    if (index < 0 || index >= buttons.length) return;
    selected = index;
    buttons.forEach((item, i) => item.classList.toggle('is-selected', i === index));
    // The column is scrolled by reveal, the least that shows the entry, never by the browser.
    if (focus) buttons[index]?.focus?.({ preventScroll: true });
    if (scroll) reveal(buttons[index]);
  }

  function build(): void {
    question = null;
    asked = null;
    card.removeAttribute('data-question');
    fill(options.entries(), null);
  }

  /** Out of the question, back to the entries it was asked over, that entry selected. */
  function unask(): void {
    const back = asked;
    question = null;
    asked = null;
    card.removeAttribute('data-question');
    if (!back) return;
    entries = back.entries;
    buttons = back.buttons;
    list.replaceChildren(...buttons);
    select(back.from >= 0 && back.from < buttons.length ? back.from : 0, shown);
  }

  /** Put these entries in the column, with a question's line over them when there is one. */
  function fill(next: PauseEntry[], line: HTMLElement | null): void {
    entries = next;
    buttons = entries.map((entry, index) => {
      const item = document.createElement(entry.kind === 'link' ? 'a' : 'button') as HTMLElement;
      item.className = 'hs-pause-item hs-face';
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
      word.className = 'hs-pause-word hs-face-word';
      word.textContent = entry.label;
      item.append(icon(entry.icon, 'hs-icon hs-pause-icon hs-face-icon') as unknown as HTMLElement, word);
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
        if (selected !== index) select(index, true, false);
      });
      // Focus from elsewhere (the controller's d-pad, a Tab): the entry scrolls into view.
      item.addEventListener('focus', () => {
        if (selected !== index) select(index, false, true);
      });
      item.addEventListener('click', () => choose(index));
      if (line) item.setAttribute('aria-describedby', line.id);
      return item;
    });
    list.replaceChildren(...(line ? [line, ...buttons] : buttons));
    list.scrollTop = 0;
    syncMore();
  }

  function answerEntry(answer: PauseAnswer, id: string): PauseEntry {
    return {
      id,
      label: answer.label,
      icon: answer.icon,
      kind: 'stay',
      run() {
        if (answer.close) {
          close();
          answer.run?.();
          return;
        }
        // Back to the entries, the one the question came from selected, then the answer runs
        // (Save anyway paints its word on the Save entry, which is back on the card by then).
        unask();
        answer.run?.();
        options.changed?.();
      },
    };
  }

  function ask(next: PauseQuestion): void {
    if (!open) return;
    if (!asked) asked = { entries, buttons, from: selected };
    question = next;
    const line = document.createElement('p');
    line.className = 'hs-pause-question';
    line.id = `${titleId}-question`;
    line.textContent = next.text;
    card.setAttribute('data-question', next.id);
    fill([answerEntry(next.yes, 'yes'), answerEntry(next.no, 'no')], line);
    // The safe answer is selected: a press of Enter or A that was meant for the list keeps things.
    if (shown) select(1, true);
    else selected = 1;
    options.changed?.();
  }

  function cancel(): boolean {
    if (!question) return false;
    choose(1);
    return true;
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
    syncMore();
    options.cue?.('menu.open');
    options.changed?.();
  }

  function close(closeOptions: { restoreFocus?: boolean } = {}): void {
    if (!open) return;
    open = false;
    shown = false;
    question = null;
    asked = null;
    card.removeAttribute('data-question');
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
    syncMore();
    options.changed?.();
  }

  function handleKey(event: PauseKeyLike): boolean {
    if (!shown || event.defaultPrevented) return false;
    const action = menuKeyAction(event);
    if (!action) return false;
    event.preventDefault();
    if (action.kind === 'resume') {
      // Escape backs out of a question with its safe answer; with none, it resumes.
      if (!cancel()) close();
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
    ask,
    asking: () => question,
    cancel,
    destroy() {
      open = false;
      shown = false;
      node.remove();
    },
  };
}

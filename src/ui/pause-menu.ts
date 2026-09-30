// The pause menu: a card in the middle of the screen over the dimmed tower, opened by the Menu
// button and by Escape with nothing else open (ui.ts). A title plate ("Hundred Stories", with
// "Paused" under it), then one column of large buttons, each an icon and a word. The plate and
// the raised faces are shared classes (hs-plate, hs-face in ui.css): the elevator card wears them too.
//
// Opening it pauses the game and closing it puts back the speed the game had, so a game that was
// already paused stays paused. Should the game refuse the pause, the menu still opens and the
// plate reads "Menu" instead of "Paused".
//
// Pages (Matt, 2026-09-30: the screens the menu opened were "still disjointed and pull up from the
// bottom"): Settings, Stories, Share and Today's tower open as a page inside the card, never a
// sheet. The plate names the page, a round Back sits at its left, and the page's body takes the
// column's place with the column's scroll and fades. Back or Escape goes back one page, and at the
// root focus returns to the entry that opened it. The scrim, the pause and the speed given back on
// close are the menu's, the same on a page as at the root. On a page Up, Down and Tab move
// through its controls in order, Back first, and Enter or Space presses the one with focus; a
// slider with focus keeps Left, Right, Home and End for its value.
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
import { focusablesIn } from './sheet';

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
 * - leave: close it, the speed put back, then run (My tower, Views).
 * - page: run with the menu open; the run pushes a page into the card (pushPage), now or once
 *   what it shows has been read (Settings, Stories, Share, Today's tower).
 * - link: a link (How to play); the browser follows it and the menu stays.
 */
export type PauseEntryKind = 'resume' | 'stay' | 'leave' | 'page' | 'link';

/** A page in the card: its name on the plate, and its body, built when it is shown. */
export interface PausePage {
  /** For the tests and the page: data-page on the card while it is shown. */
  id: string;
  title: string;
  build(): HTMLElement;
  /** Back (the button, Escape or B) left this page. */
  onBack?(): void;
  /** The owner redrew: rewrite the live parts. */
  refresh?(): void;
  /** The page is gone for good (popped, or the menu closed): let go of what it holds. */
  dispose?(): void;
}

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
  /** The scrim, with the card inside it. Mounted only while on screen: not while closed or stepped aside. */
  readonly node: HTMLDivElement;
  readonly card: HTMLDivElement;
  /** Open, including while stepped aside for a card a page opened. */
  isOpen(): boolean;
  /** Open and on screen. */
  isShown(): boolean;
  /** Did opening it pause the game (the plate reads Paused)? */
  paused(): boolean;
  open(): void;
  /** Close, and put back the speed the game had before it opened. */
  close(options?: { restoreFocus?: boolean }): void;
  /**
   * Show a page in the card, over the root or over another page. The menu must be open. `from`:
   * the control that opened it, where Back puts focus (the root's selected entry when left out
   * at the root, else the control with focus).
   */
  pushPage(page: PausePage, from?: HTMLElement): void;
  /** Back one page; false at the root. */
  popPage(): boolean;
  /** The page on show, or null at the root. */
  page(): PausePage | null;
  /** The owner redrew: the page on show rewrites its live parts. */
  refresh(): void;
  /**
   * The page on show rewrote its rows under the player's finger (Stories' Unfollow): they wear
   * the faces again, and focus goes to `target` when it is on the page, else to Back.
   */
  settle(target: HTMLElement | null): void;
  /**
   * Counts the opens: a page read in the background (Today's tower) is pushed only into the same
   * open it was asked from, never into a menu closed and opened again since.
   */
  generation(): number;
  /**
   * The game started running under the open menu (a saved file opened from the Settings page):
   * that is the speed to give back on close, and the game is held still again until then.
   */
  hold(): void;
  /**
   * Step out of sight, still open and still paused, and run what a page opens over the game (the
   * Settings page's Send feedback and Intro); then the owner redraws. The owner calls show() when
   * that closes, and the menu is back on the page it left, focus where it was.
   */
  stepAside(run: () => void): void;
  /** Back on screen after stepping aside. */
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

/** The controls a page's body brings from the panels (panels.ts, daily.ts) that wear the card's faces there. */
const FACE_CLASSES = ['hs-set-row', 'hs-seg-btn', 'hs-btn', 'hs-occupant'];
/** Rows that hold faces (the theme choice) or only words (the Controls lines): they sit on the surface. */
const NOT_FACES = ['hs-set-choice', 'hs-controls-row'];

interface ClassTree {
  children?: ArrayLike<ClassTree>;
  classList?: { contains(name: string): boolean; add(name: string): void };
}

/**
 * A page wears the card's vocabulary: its rows and buttons become raised faces (hs-face), the same
 * as the entries. The theme choice's row holds three faces and is not one itself. Run again
 * after a page rewrites its rows, so a new row is a face too.
 */
export function wearFaces(root: unknown): void {
  const walk = (node: ClassTree): void => {
    const kids = node.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i += 1) {
      const child = kids[i];
      if (!child) continue;
      const list = child.classList;
      if (list && FACE_CLASSES.some((name) => list.contains(name)) && !NOT_FACES.some((name) => list.contains(name))) list.add('hs-face');
      walk(child);
    }
  };
  walk(root as ClassTree);
}

/** A page on the stack: its body in the card, and the control that opened it (focus goes back there). */
interface ShownPage {
  page: PausePage;
  body: HTMLDivElement;
  from: HTMLElement | null;
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
  // Back: round, at the plate's left, out of the flow so the title stays centered. Only on a page.
  const back = document.createElement('button') as HTMLButtonElement;
  back.type = 'button';
  back.className = 'hs-pause-back';
  back.setAttribute('aria-label', 'Back');
  back.append(icon('chevron', 'hs-icon hs-pause-back-icon') as unknown as HTMLElement);
  back.hidden = true;
  back.addEventListener('click', () => {
    options.cue?.('menu.select');
    popPage();
  });
  const title = document.createElement('h2');
  title.className = 'hs-pause-title hs-plate-title';
  title.id = titleId;
  title.textContent = PAUSE_TITLE;
  const state = document.createElement('p');
  state.className = 'hs-pause-state hs-plate-state';
  state.textContent = PAUSED_WORD;
  plate.append(back, title, state);

  const list = document.createElement('div') as HTMLDivElement;
  list.className = 'hs-pause-list';
  card.append(plate, list);
  node.append(card);

  let open = false;
  /** One more at every open (generation()). */
  let opens = 0;
  /** On screen: open and not stepped aside. */
  let shown = false;
  /** Where focus was when it stepped aside. */
  let asideFrom: HTMLElement | null = null;
  let prior: Speed = 0;
  let wePaused = false;
  let selected = -1;
  let entries: PauseEntry[] = [];
  let buttons: HTMLElement[] = [];
  let question: PauseQuestion | null = null;
  /** The pages over the root, the one on show last. */
  let stack: ShownPage[] = [];
  /**
   * The entries as they were when the question was asked, and the one it was asked from: put back
   * as they were (not built again, so Save's action and word carry on) when an answer keeps the menu.
   */
  let asked: { entries: PauseEntry[]; buttons: HTMLElement[]; from: number } | null = null;

  /** The page on show, or null at the root. */
  function top(): ShownPage | null {
    return stack[stack.length - 1] ?? null;
  }

  /** What scrolls now: the entry column at the root, the page's body on a page. */
  function scroller(): HTMLDivElement {
    return top()?.body ?? list;
  }

  /**
   * Scroll the column (or the page) so this control is inside it: the least scroll that shows it
   * whole. It scrolls only where the card does not fit; anywhere else nothing moves.
   */
  function reveal(item: HTMLElement | undefined): void {
    const box0 = scroller();
    if (!item || typeof box0.getBoundingClientRect !== 'function' || typeof item.getBoundingClientRect !== 'function') return;
    const box = box0.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    if (!(box.height > 0)) return;
    const scrolled = Number(box0.scrollTop) || 0;
    if (at.top < box.top) box0.scrollTop = Math.max(0, scrolled - (box.top - at.top));
    else if (at.bottom > box.bottom) box0.scrollTop = scrolled + (at.bottom - box.bottom);
    syncMore();
  }

  /**
   * The column draws no scroll bar, so where entries sit past its edge the card fades that edge
   * (ui.css has-more, has-above): the one cue that Settings and How to play are further down on a
   * short screen (P6 review A7). Read from the column's own scroll numbers, after every move. A
   * page's body is read the same way.
   */
  function syncMore(): void {
    const box = scroller();
    const scrolled = Number(box.scrollTop) || 0;
    const seen = Number(box.clientHeight) || 0;
    const whole = Number(box.scrollHeight) || 0;
    card.classList.toggle('has-more', seen > 0 && scrolled + seen < whole - 1);
    card.classList.toggle('has-above', seen > 0 && scrolled > 1);
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
    const back0 = asked;
    question = null;
    asked = null;
    card.removeAttribute('data-question');
    if (!back0) return;
    entries = back0.entries;
    buttons = back0.buttons;
    list.replaceChildren(...buttons);
    select(back0.from >= 0 && back0.from < buttons.length ? back0.from : 0, shown);
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
    // A question is asked over the entries: any page goes first.
    if (stack.length > 0) {
      dropPages();
      paintPlace();
    }
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
      case 'page':
        // The run pushes the page (pushPage), at once or once what it shows has been read.
        entry.run?.();
        return;
      case 'link':
        // The link itself does the going, as it always has; the menu stays, the game still paused.
        entry.run?.();
        return;
    }
  }

  /** The plate and the body for where the card is: the root's name and column, or the page's. */
  function paintPlace(): void {
    const current = top();
    card.replaceChildren(plate, current ? current.body : list);
    title.textContent = current ? current.page.title : PAUSE_TITLE;
    back.hidden = current === null;
    card.classList.toggle('is-page', current !== null);
    if (current) card.setAttribute('data-page', current.page.id);
    else card.removeAttribute('data-page');
    syncMore();
  }

  /** The page's controls in order, Back first: what the arrows, Tab and the d-pad move through. */
  function pageItems(onShow: ShownPage): HTMLElement[] {
    return [back, ...focusablesIn(onShow.body)];
  }

  /** Focus the page's first control, or Back when it has none. */
  function focusPage(onShow: ShownPage): void {
    const first = focusablesIn(onShow.body)[0] ?? back;
    first.focus?.({ preventScroll: true });
  }

  function pushPage(page: PausePage, opener?: HTMLElement): void {
    if (!open) return;
    if (question) unask();
    const from = opener ?? (stack.length === 0 ? (buttons[selected] ?? null) : ((activeElement() as HTMLElement | null) ?? null));
    const body = document.createElement('div') as HTMLDivElement;
    body.className = 'hs-pause-list hs-pause-page';
    body.addEventListener('scroll', syncMore);
    body.append(page.build());
    wearFaces(body);
    const entry: ShownPage = { page, body, from };
    stack.push(entry);
    paintPlace();
    body.scrollTop = 0;
    focusPage(entry);
    options.changed?.();
  }

  function popPage(): boolean {
    const gone = stack.pop();
    if (!gone) return false;
    gone.page.onBack?.();
    gone.page.dispose?.();
    paintPlace();
    const now = top();
    if (now) {
      // Back on the page before, on the control that opened the one just left.
      const target = gone.from && now.body.contains?.(gone.from) ? gone.from : null;
      if (target) target.focus?.({ preventScroll: true });
      else focusPage(now);
    } else {
      const at = gone.from ? buttons.indexOf(gone.from) : -1;
      select(at >= 0 ? at : Math.max(0, selected), true);
    }
    options.changed?.();
    return true;
  }

  /** Every page goes, each let go of; the card is left at the root. */
  function dropPages(): void {
    const gone = stack;
    stack = [];
    for (const item of gone.reverse()) item.page.dispose?.();
  }

  function refresh(): void {
    const current = top();
    if (!open || !current) return;
    current.page.refresh?.();
    wearFaces(current.body);
    syncMore();
  }

  function settle(target: HTMLElement | null): void {
    const current = top();
    if (!open || !current) return;
    wearFaces(current.body);
    syncMore();
    const to = target && current.body.contains?.(target) ? target : back;
    to.focus?.({ preventScroll: true });
    if (to !== back) reveal(to);
  }

  function hold(): void {
    if (!open) return;
    const now = options.getSpeed();
    // Held already, or a menu the game would not pause for (the plate reads Menu): nothing to hold.
    if (now === 0 || (!wePaused && prior !== 0)) return;
    options.setSpeed(0);
    if (options.getSpeed() !== 0) return;
    prior = now;
    wePaused = true;
    paint();
  }

  function paint(): void {
    state.textContent = wePaused || options.getSpeed() === 0 ? PAUSED_WORD : MENU_WORD;
    card.classList.toggle('is-running', state.textContent === MENU_WORD);
  }

  function openMenu(): void {
    if (open) return;
    opens += 1;
    prior = options.getSpeed();
    if (prior !== 0) options.setSpeed(0);
    wePaused = prior !== 0 && options.getSpeed() === 0;
    open = true;
    shown = true;
    build();
    paintPlace();
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
    asideFrom = null;
    question = null;
    asked = null;
    card.removeAttribute('data-question');
    dropPages();
    paintPlace();
    node.remove();
    // Put back what the game had, only if the menu paused it and it is still paused.
    if (wePaused && options.getSpeed() === 0) options.setSpeed(prior);
    wePaused = false;
    if (closeOptions.restoreFocus !== false) options.returnFocus()?.focus?.({ preventScroll: true });
    options.changed?.();
  }

  function stepAside(run: () => void): void {
    if (!shown) {
      run();
      return;
    }
    // Out of sight first, then what goes over it opens, then the owner redraws: in that order the
    // owner never sees the menu out of sight with nothing over it.
    asideFrom = (activeElement() as HTMLElement | null) ?? null;
    shown = false;
    node.remove();
    run();
    options.changed?.();
  }

  function show(): void {
    if (!open || shown) return;
    shown = true;
    options.host.append(node);
    paint();
    syncMore();
    const was = asideFrom;
    asideFrom = null;
    const shownPage = top();
    if (shownPage) {
      if (was && shownPage.body.contains?.(was)) was.focus?.({ preventScroll: true });
      else focusPage(shownPage);
    } else {
      select(selected < 0 ? 0 : selected, true);
    }
    options.changed?.();
  }

  /** A key on a page: Escape goes back one page; the arrows and Tab move; Enter or Space presses. */
  function pageKey(current: ShownPage, action: NonNullable<ReturnType<typeof menuKeyAction>>): void {
    if (action.kind === 'resume') {
      popPage();
      return;
    }
    const items = pageItems(current);
    const at = items.indexOf(activeElement() as HTMLElement);
    if (action.kind === 'activate') {
      items[at]?.click?.();
      return;
    }
    const next = items[menuIndex(at, items.length, action)];
    next?.focus?.({ preventScroll: true });
    if (next !== back) reveal(next);
  }

  /**
   * A slider with focus on a page (Settings' sound levels) keeps Left, Right, Home and End: they
   * set its value, a step at a time or to its ends. Up and Down still move on, so a controller's
   * d-pad never sticks on one. True when the key was the slider's.
   */
  function sliderKey(current: ShownPage, event: PauseKeyLike): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;
    const input = activeElement() as (HTMLInputElement & { tagName?: string }) | null;
    if (!input || String(input.tagName).toUpperCase() !== 'INPUT' || input.type !== 'range') return false;
    if (!current.body.contains?.(input)) return false;
    event.preventDefault();
    if (input.disabled) return true;
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step) > 0 ? Number(input.step) : 1;
    const now = Number(input.value);
    const next =
      event.key === 'Home' ? min : event.key === 'End' ? max : Math.min(max, Math.max(min, now + (event.key === 'ArrowRight' ? step : -step)));
    if (next === now) return true;
    input.value = String(next);
    // The slider's own listeners hear it as they hear a drag.
    for (const type of ['input', 'change']) input.dispatchEvent?.(new Event(type, { bubbles: true }));
    return true;
  }

  function handleKey(event: PauseKeyLike): boolean {
    if (!shown || event.defaultPrevented) return false;
    const onPage = top();
    if (onPage && sliderKey(onPage, event)) return true;
    const action = menuKeyAction(event);
    if (!action) return false;
    event.preventDefault();
    const current = top();
    if (current) {
      pageKey(current, action);
      return true;
    }
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

  // A tap on the dimmed tower around the card resumes, as Escape does at the root; from a page
  // too, everything closes at once.
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
    pushPage,
    popPage,
    page: () => top()?.page ?? null,
    refresh,
    settle,
    generation: () => opens,
    hold,
    stepAside,
    show,
    items: () => buttons,
    handleKey,
    ask,
    asking: () => question,
    cancel,
    destroy() {
      open = false;
      shown = false;
      dropPages();
      node.remove();
    },
  };
}

// The exited screen: what the player sees after Save and exit (ui.ts saveAndExit). A browser tab
// cannot close itself and an app should not, so exiting means leaving play for this screen: the
// whole view, over the pause card and the toasts, the frozen tower still there behind a dark scrim.
// The game's wordmark sits on a card in the pause menu's look, then one line that says truthfully
// whether the tower was saved, a quieter line that the game can be closed, and three faces:
// Continue tower (first focus), Clips (the clips inside this screen, with Back; in the desktop
// shell, which cannot play them, the site's Clips page in the system browser, as the pause
// menu's entry does) and New tower,
// which asks the pause menu's own question first ("Start over? This replaces My tower."); outside
// My tower that face is My tower, as the pause menu's third entry is there.
//
// The screen owns its keys while it is up (ui.ts hands it every keydown): Tab and Shift+Tab stay
// inside it, Up and Down move between its buttons and the clips, Enter and Space press the button
// with focus or play and pause the clip with focus, and nothing else does anything, Escape
// included. No entrance or exit animation, ever.
//
// The wordmark is imported through the bundle (a hashed file in assets/), not taken from public/:
// the app build drops public/wordmark-* and the offline service worker does not keep them, so only
// a bundled copy is there in every build.

import logoUrl from './hundred-stories-logo.svg?url';
import { clipsBody, CLIPS_TITLE, toggleClip, type ClipsBody } from './clips';
import { icon, type IconName } from './icons';
import { NEW_TOWER_NO, NEW_TOWER_QUESTION, NEW_TOWER_YES } from './pause-menu';
import { focusablesIn } from './sheet';

export const EXIT_SAVED_TEXT = 'Your tower is saved.';
export const EXIT_UNSAVED_TEXT = 'This tower was not saved.';
export const EXIT_SAVED_NOTE = 'It is safe to close the game now.';
export const EXIT_UNSAVED_NOTE = 'You can close the game now.';
export const CONTINUE_TOWER = 'Continue tower';
/** The pause menu's entry, and its word while the save runs. */
export const EXIT_WORD = 'Save and exit';
export const EXIT_SAVING_WORD = 'Saving';
export const EXIT_NEW_TOWER = 'New tower';
export const EXIT_MY_TOWER = 'My tower';
/** The wordmark's words, for a screen reader and for when the picture cannot show. */
export const EXIT_LOGO_ALT = 'Hundred Stories';

export interface ExitScreenOptions {
  /** Where the screen mounts: the ui shell. */
  host: { append(node: HTMLElement): void };
  /** Was the tower written, or had nothing changed since its last save? */
  saved: boolean;
  /** 'newTower' in My tower (it asks first), 'myTower' in any other tower. */
  third: 'newTower' | 'myTower';
  /** Continue tower. */
  onContinue(): void;
  /** New tower, once Start over was chosen; or My tower. */
  onThird(): void;
  /** The clips, as the pause menu's Clips page builds them. */
  clips?: () => ClipsBody;
  /**
   * Where the game cannot play the clips (the desktop shell): Clips opens them elsewhere instead
   * (clips.ts openClipsOutside) and the screen stays as it is.
   */
  clipsOutside?: () => void;
}

export interface ExitKeyLike {
  key: string;
  shiftKey?: boolean;
  target?: unknown;
  preventDefault(): void;
}

export interface ExitScreen {
  readonly node: HTMLDivElement;
  /** Which view is on show. */
  view(): 'main' | 'clips' | 'question';
  /** A key while the screen is up. Every key is the screen's: nothing reaches the tower. */
  handleKey(event: ExitKeyLike): void;
  /** Back from the clips or the question (the controller's B). False on the main view. */
  back(): boolean;
  /** Focus the view's first control again (Continue tower on the way in), wherever focus went. */
  focusFirst(): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function face(id: string, label: string, iconName: IconName, run: () => void): HTMLButtonElement {
  const button = el('button', 'hs-face hs-exit-face');
  button.type = 'button';
  button.dataset['exit'] = id;
  button.append(icon(iconName, 'hs-icon hs-face-icon') as unknown as HTMLElement, el('span', 'hs-face-word', label));
  button.addEventListener('click', () => run());
  return button;
}

let exitIds = 0;

export function createExitScreen(options: ExitScreenOptions): ExitScreen {
  const id = ++exitIds;
  const node = el('div', 'hs-exit');
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-modal', 'true');
  const card = el('div', 'hs-exit-card');
  node.append(card);
  let shown: 'main' | 'clips' | 'question' = 'main';
  let clips: ClipsBody | null = null;
  let destroyed = false;
  /** Where focus went last time the main view was drawn: Continue tower on the way in. */
  let first: HTMLElement | null = null;

  const focus = (target: HTMLElement | null | undefined): void => target?.focus?.({ preventScroll: true });

  function main(focusOn: 'continue' | 'clips' | 'third' = 'continue'): void {
    dropClips();
    shown = 'main';
    node.dataset['view'] = 'main';
    const logo = el('img', 'hs-exit-logo');
    logo.setAttribute('src', logoUrl);
    logo.setAttribute('alt', EXIT_LOGO_ALT);
    logo.setAttribute('width', '540');
    logo.setAttribute('height', '231');
    const titleId = `hs-exit-title-${id}`;
    const line = el('p', 'hs-exit-line', options.saved ? EXIT_SAVED_TEXT : EXIT_UNSAVED_TEXT);
    line.id = titleId;
    const note = el('p', 'hs-exit-note', options.saved ? EXIT_SAVED_NOTE : EXIT_UNSAVED_NOTE);
    node.setAttribute('aria-label', EXIT_LOGO_ALT);
    node.setAttribute('aria-describedby', titleId);
    const go = face('continue', CONTINUE_TOWER, 'play', () => options.onContinue());
    const outside = options.clipsOutside;
    const clipsFace = face('clips', CLIPS_TITLE, 'clips', () => (outside ? outside() : showClips()));
    const third =
      options.third === 'newTower'
        ? face('newTower', EXIT_NEW_TOWER, 'structure', () => question())
        : face('myTower', EXIT_MY_TOWER, 'home', () => options.onThird());
    const actions = el('div', 'hs-exit-actions');
    actions.append(go, clipsFace, third);
    card.replaceChildren(logo, line, note, actions);
    first = focusOn === 'clips' ? clipsFace : focusOn === 'third' ? third : go;
    focus(first);
  }

  /** New tower asks the pause menu's question, the safe answer with focus. */
  function question(): void {
    shown = 'question';
    node.dataset['view'] = 'question';
    const lineId = `hs-exit-question-${id}`;
    const line = el('p', 'hs-exit-line', NEW_TOWER_QUESTION);
    line.id = lineId;
    const yes = face('yes', NEW_TOWER_YES, 'structure', () => options.onThird());
    const no = face('no', NEW_TOWER_NO, 'home', () => main('third'));
    for (const b of [yes, no]) b.setAttribute('aria-describedby', lineId);
    const actions = el('div', 'hs-exit-actions');
    actions.append(yes, no);
    card.replaceChildren(line, actions);
    focus(no);
  }

  function showClips(): void {
    shown = 'clips';
    node.dataset['view'] = 'clips';
    const plate = el('div', 'hs-exit-plate hs-plate');
    const back = el('button', 'hs-pause-back hs-exit-back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.append(icon('chevron', 'hs-icon hs-pause-back-icon') as unknown as HTMLElement);
    back.addEventListener('click', () => main('clips'));
    const title = el('h2', 'hs-plate-title', CLIPS_TITLE);
    plate.append(back, title);
    clips = (options.clips ?? (() => clipsBody()))();
    const scroller = el('div', 'hs-exit-clips');
    scroller.append(clips.node);
    card.replaceChildren(plate, scroller);
    focus(back);
  }

  function dropClips(): void {
    clips?.dispose();
    clips = null;
  }

  function back(): boolean {
    if (shown === 'clips') main('clips');
    else if (shown === 'question') main('third');
    else return false;
    return true;
  }

  function handleKey(event: ExitKeyLike): void {
    const items = focusablesIn(node);
    const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const at = items.indexOf(active as HTMLElement);
    const step = (by: number): void => {
      if (items.length === 0) return;
      const next = at < 0 ? (by > 0 ? items[0] : items[items.length - 1]) : items[(at + by + items.length) % items.length];
      focus(next);
    };
    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
        return;
      case 'ArrowDown':
      case 'ArrowUp':
        // From a clip too, so the arrows walk every clip; Left and Right stay the player's (seeking).
        event.preventDefault();
        step(event.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Enter':
      case ' ':
        // A clip with focus plays or pauses; any other focused control presses itself (the
        // browser's own action); with focus lost, nothing.
        if (at >= 0 && toggleClip(active)) {
          event.preventDefault();
          return;
        }
        if (at < 0) event.preventDefault();
        return;
      case 'Escape':
        event.preventDefault();
        return;
      default:
        return;
    }
  }

  main();
  options.host.append(node);
  // Focus again once mounted: a node out of the page takes no focus.
  focus(first);

  return {
    node,
    view: () => shown,
    handleKey,
    back,
    focusFirst() {
      if (!destroyed && shown === 'main') focus(first);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dropClips();
      node.remove();
    },
  };
}

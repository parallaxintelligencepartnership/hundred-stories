// The leave card: what the player sees when leaving the tower in hand did not end in a save
// (GameApi.leave). Reload into a new version uses it now; Save and exit will too. It is a page in
// the pause card (pause-menu.ts pushPage), in the card's words and faces: the plate names what
// happened, one line says it plainly, then a column of answers, each an icon and a word, like a
// question's. The tower stays in hand behind it, paused by the menu.
//
// Four kinds, by the leave's result:
// - failed: Try again, Save to a file, Keep playing.
// - held (My tower's save would not open, and this stand-in was never saved): Save anyway, asked
//   first with the Save question (save-button.ts HELD_SAVE_QUESTION), Save the old tower to a
//   file, Leave without saving, Keep playing.
// - unread (the slot could not be read, so this stand-in is never saved over it): Save to a file,
//   Leave without saving, Keep playing.
// - conflict (another window saved this tower after this page opened it): Open the newer tower,
//   Save this one to a file, Keep playing.
//
// Focus starts on Keep playing, never on an answer that leaves or replaces anything; Back and
// Escape keep playing too. The card knows nothing of reloading: `proceed` is whatever leaving
// means to its caller, and `stay` gives the tower back (GameApi.resumeAfterLeave).

import type { GameApi, LeaveResult } from '../game/api';
import { icon, type IconName } from './icons';
import type { PauseMenu, PausePage } from './pause-menu';
import { HELD_SAVE_NO, HELD_SAVE_QUESTION, HELD_SAVE_YES } from './save-button';

/** The plate when the save did not go through. */
export const LEAVE_FAILED_TITLE = 'Your tower did not save';
export const LEAVE_FAILED_TEXT = 'Your tower is still here. You can try again, or save it to a file first.';
/** The plate for a stand-in that was never saved (held or unread). */
export const LEAVE_UNSAVED_TITLE = 'This tower is not saved';
export const LEAVE_HELD_TEXT = 'Your saved tower could not be opened, so this one was never saved. If you leave now, this one is gone.';
export const LEAVE_UNREAD_TEXT = 'We could not read your saved tower, so this one was not saved over it. If you leave now, this one is gone.';
/** The plate when another window saved this tower after this page opened it. */
export const LEAVE_CONFLICT_TITLE = 'Saved in another window';
export const LEAVE_CONFLICT_TEXT = 'Another window saved this tower after you opened it. Open the newer one, or save this one to a file.';
/** The plate while the Save question is asked from the card. */
export const LEAVE_HELD_ASK_TITLE = 'Save this tower?';

export const TRY_AGAIN = 'Try again';
export const SAVE_TO_FILE = 'Save to a file';
export const KEEP_PLAYING = 'Keep playing';
export const SAVE_OLD_TO_FILE = 'Save the old tower to a file';
export const LEAVE_WITHOUT_SAVING = 'Leave without saving';
export const OPEN_NEWER = 'Open the newer tower';
export const SAVE_THIS_TO_FILE = 'Save this one to a file';

export interface LeaveCardOptions {
  /** The pause menu: the card is a page in it, opened first when it is not. */
  menu: PauseMenu;
  /** What leaving came to. A plain ok result needs no card: proceed runs at once. */
  result: LeaveResult;
  /** Leave again (Try again): GameApi.leave. */
  retry(): Promise<LeaveResult>;
  /** Go on leaving: the tower was written, or the player chose to go without it. */
  proceed(): void;
  /** The player stays: give the tower back (GameApi.resumeAfterLeave). */
  stay(): void;
  /** Save a save file's text to a file, by platform (panels.ts exportSave). */
  saveFile(text: string): void;
  /** What the answers read and write. */
  game: Pick<GameApi, 'exportSave' | 'getKeptCopy' | 'save'>;
}

type Kind = 'failed' | 'held' | 'unread' | 'conflict';

function kindOf(result: LeaveResult): Kind | null {
  if (!result.ok) return result.conflict ? 'conflict' : 'failed';
  return result.unsaved ?? null;
}

interface Answer {
  id: string;
  label: string;
  icon: IconName;
  run(): void;
}

/** The answer button: the card's face, an icon and a word, as a question's answers are drawn. */
function answerButton(answer: Answer, describedBy: string): HTMLButtonElement {
  const item = document.createElement('button') as HTMLButtonElement;
  item.type = 'button';
  item.className = 'hs-pause-item hs-face';
  item.dataset['answer'] = answer.id;
  item.setAttribute('aria-describedby', describedBy);
  const word = document.createElement('span');
  word.className = 'hs-pause-word hs-face-word';
  word.textContent = answer.label;
  item.append(icon(answer.icon, 'hs-icon hs-pause-icon hs-face-icon') as unknown as HTMLElement, word);
  item.addEventListener('click', () => answer.run());
  return item;
}

let cardIds = 0;

/**
 * Show what leaving came to, in the pause card, and carry out the player's answer. A plain ok
 * result proceeds at once.
 */
export function showLeaveCard(options: LeaveCardOptions): void {
  const { menu, game } = options;
  // Settled: the player answered with a way out or Keep playing, so the page going says nothing more.
  let settled = false;
  // A page is being swapped for the next one (an answer's result): its going is not a Back.
  let swapping = false;
  let busy = false;

  const go = (): void => {
    settled = true;
    menu.close({ restoreFocus: false });
    options.proceed();
  };
  const stay = (): void => {
    if (settled) return;
    settled = true;
    options.stay();
  };
  const keepPlaying = (): void => {
    if (settled) return;
    settled = true;
    menu.close();
    options.stay();
  };

  /** The answers for a result, in order, and the safe one. */
  function answersFor(kind: Kind): Answer[] {
    const keep: Answer = { id: 'stay', label: KEEP_PLAYING, icon: 'play', run: keepPlaying };
    const toFile = (label: string): Answer => ({
      id: 'file',
      label,
      icon: 'save',
      run: () => options.saveFile(game.exportSave()),
    });
    const leave: Answer = { id: 'leave', label: LEAVE_WITHOUT_SAVING, icon: 'close', run: go };
    switch (kind) {
      case 'failed':
        return [{ id: 'retry', label: TRY_AGAIN, icon: 'reload', run: () => void retry() }, toFile(SAVE_TO_FILE), keep];
      case 'held':
        return [
          { id: 'saveAnyway', label: HELD_SAVE_YES, icon: 'save', run: () => show(heldQuestion()) },
          {
            id: 'fileOld',
            label: SAVE_OLD_TO_FILE,
            icon: 'save',
            run: () => {
              const kept = game.getKeptCopy();
              if (kept !== null) options.saveFile(kept);
            },
          },
          leave,
          keep,
        ];
      case 'unread':
        return [toFile(SAVE_TO_FILE), leave, keep];
      case 'conflict':
        return [{ id: 'newer', label: OPEN_NEWER, icon: 'reload', run: go }, toFile(SAVE_THIS_TO_FILE), keep];
    }
  }

  interface Screen {
    id: string;
    title: string;
    text: string;
    answers: Answer[];
    /** The answer focus starts on. */
    safe: string;
  }

  function screenFor(result: LeaveResult): Screen | null {
    const kind = kindOf(result);
    if (kind === null) return null;
    const title = kind === 'failed' ? LEAVE_FAILED_TITLE : kind === 'conflict' ? LEAVE_CONFLICT_TITLE : LEAVE_UNSAVED_TITLE;
    const text =
      kind === 'failed' ? LEAVE_FAILED_TEXT : kind === 'conflict' ? LEAVE_CONFLICT_TEXT : kind === 'held' ? LEAVE_HELD_TEXT : LEAVE_UNREAD_TEXT;
    return { id: kind, title, text, answers: answersFor(kind), safe: 'stay' };
  }

  /** Save anyway asks the Save question first, the same words every Save asks with. */
  function heldQuestion(): Screen {
    return {
      id: 'heldSave',
      title: LEAVE_HELD_ASK_TITLE,
      text: HELD_SAVE_QUESTION,
      answers: [
        { id: 'yes', label: HELD_SAVE_YES, icon: 'save', run: () => void saveAnyway() },
        { id: 'no', label: HELD_SAVE_NO, icon: 'close', run: () => show(screenFor({ ok: true, wrote: false, unsaved: 'held' })) },
      ],
      safe: 'no',
    };
  }

  async function retry(): Promise<void> {
    if (busy || settled) return;
    busy = true;
    let next: LeaveResult;
    try {
      next = await options.retry();
    } catch {
      next = { ok: false, reason: '' };
    }
    busy = false;
    if (settled) return;
    if (kindOf(next) === null) go();
    else show(screenFor(next));
  }

  async function saveAnyway(): Promise<void> {
    if (busy || settled) return;
    busy = true;
    let res: Awaited<ReturnType<GameApi['save']>>;
    try {
      res = await game.save();
    } catch {
      res = { ok: false, reason: '' };
    }
    busy = false;
    if (settled) return;
    if (res.ok) go();
    else show(screenFor({ ok: false, reason: res.reason, ...(res.conflict ? { conflict: true } : {}) }));
  }

  /** Put a screen in the card: the page on show, if it is one of ours, makes way for it. */
  function show(screen: Screen | null): void {
    if (screen === null) {
      go();
      return;
    }
    if (!menu.isOpen()) menu.open();
    const lineId = `hs-leave-line-${++cardIds}`;
    let safe: HTMLButtonElement | null = null;
    const page: PausePage = {
      id: 'leave',
      title: screen.title,
      build() {
        const body = document.createElement('div');
        body.className = 'hs-leave';
        body.dataset['leave'] = screen.id;
        const line = document.createElement('p');
        line.className = 'hs-pause-question hs-leave-line';
        line.id = lineId;
        line.textContent = screen.text;
        const buttons = screen.answers.map((answer) => {
          const item = answerButton(answer, lineId);
          if (answer.id === screen.safe) safe = item;
          return item;
        });
        body.append(line, ...buttons);
        return body;
      },
      // Back, Escape or the menu closing: the player stays.
      dispose() {
        if (!swapping) stay();
      },
    };
    if (menu.page()?.id === 'leave') {
      swapping = true;
      menu.popPage();
      swapping = false;
    }
    menu.pushPage(page);
    // The safe answer has focus, never one that leaves or replaces anything.
    (safe as HTMLButtonElement | null)?.focus?.({ preventScroll: true });
  }

  show(screenFor(options.result));
}

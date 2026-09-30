// The round Save button on the game view, in the row with Sound and Watch. It is an action, not a
// toggle: a tap saves the tower now through the same path as Settings, Save now (GameApi.save),
// and says the result the same way, as a notice ("Game saved." or the save's own reason). While
// the save is being written the button is disabled and a second tap does nothing; once it is
// written the word reads "Saved" for SAVED_MS, then "Save" again. Autosave is not its business.
// Watch mode hides it with the rest of the chrome, and the quiet labels fold its word away like
// Watch's and Sound's (ui.css).

import type { CommandResult } from '../sim/types';
import { icon } from './icons';

/** The Save button's tooltip. */
export const SAVE_TIP = 'Save your tower now';
/** The word on the button, and what it reads for a moment after a save is written. */
export const SAVE_WORD = 'Save';
export const SAVED_WORD = 'Saved';
/** How long "Saved" stays before the word goes back to "Save". */
export const SAVED_MS = 2_000;
/** Settings, Save now says this on success; a failure says the save's own reason. */
export const SAVED_NOTICE = 'Game saved.';
/** The words when the save itself threw, which game.ts's own save never does (it says why). */
export const SAVE_FAILED_NOTICE = 'Could not save.';

export interface SaveButtonOptions {
  /** GameApi.save: the same save Settings, Save now runs. */
  save(): Promise<CommandResult>;
  /** The ui's notice, the same place Save now's result is said. */
  notice(text: string): void;
}

export interface SaveButton {
  /** The round Save button, for the row under the top bar. No aria-pressed: it is an action. */
  button: HTMLButtonElement;
  destroy(): void;
}

/** What a save action paints: the word, and busy while the save is written. */
export interface SaveActionView {
  setWord(word: string): void;
  setBusy(busy: boolean): void;
}

export interface SaveAction {
  /** Save now, unless a save is still being written. */
  run(): void;
  destroy(): void;
}

/**
 * The save both the round Save button and the pause menu's Save run: GameApi.save, the notice
 * ("Game saved." or the save's own reason), busy while written, "Saved" for SAVED_MS after.
 */
export function createSaveAction(options: SaveButtonOptions, view: SaveActionView): SaveAction {
  let saving = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const done = (result: CommandResult): void => {
    saving = false;
    if (destroyed) return;
    view.setBusy(false);
    if (result.ok) {
      view.setWord(SAVED_WORD);
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        view.setWord(SAVE_WORD);
      }, SAVED_MS);
      options.notice(SAVED_NOTICE);
    } else {
      clearTimer();
      view.setWord(SAVE_WORD);
      options.notice(result.reason);
    }
  };

  return {
    run() {
      if (saving || destroyed) return;
      saving = true;
      view.setBusy(true);
      let pending: Promise<CommandResult>;
      try {
        pending = options.save();
      } catch {
        pending = Promise.resolve({ ok: false, reason: SAVE_FAILED_NOTICE });
      }
      void pending.then(done, () => done({ ok: false, reason: SAVE_FAILED_NOTICE }));
    },
    destroy() {
      destroyed = true;
      clearTimer();
    },
  };
}

export function createSaveButton(options: SaveButtonOptions): SaveButton {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hs-icon-btn hs-round hs-save-btn';
  const label = document.createElement('span');
  label.className = 'hs-btn-label';
  label.textContent = SAVE_WORD;
  button.append(icon('save', 'hs-icon hs-btn-icon') as unknown as HTMLElement, label);
  button.setAttribute('aria-label', SAVE_WORD);
  button.title = SAVE_TIP;

  const action = createSaveAction(options, {
    setWord(word) {
      label.textContent = word;
    },
    setBusy(busy) {
      button.disabled = busy;
    },
  });
  button.addEventListener('click', () => action.run());

  return {
    button,
    destroy() {
      action.destroy();
    },
  };
}
